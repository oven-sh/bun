//! grammarchecks.go of TypeScript 7.0.2, for signatures, members, object literals and variables.
//! The walk (check_source_file.rs) and `checkObjectLiteral` call these where checker.go does. Each returns
//! whether it reported, and the caller continues or stops as checker.go does.
//!
//! Tokens are not nodes yet: the position of a `?`, `!`, `...`, `*` or `=` is found in the source
//! text next to a node, once the token is known to exist.

use super::errors_operators::language_version;
use super::related::Place;
use super::spans::line_break_len;
use super::*;
use crate::bind::{FnOwner, MemberOwner};
use crate::resolve::{ModuleKind, ScriptTarget};
use crate::util::number_repeated;
use smallvec::SmallVec;

// `DeclarationMeaning`
const GET_ACCESSOR: u8 = 1;
const SET_ACCESSOR: u8 = 2;
const PROPERTY_ASSIGNMENT: u8 = 4;
const METHOD: u8 = 8;
const GET_OR_SET_ACCESSOR: u8 = GET_ACCESSOR | SET_ACCESSOR;

impl Checker<'_, '_> {
    /// `grammarErrorOnNode`
    pub(super) fn grammar_error_on_node(
        &mut self,
        file: FileId,
        node: impl ToNode,
        code: u32,
        args: &[Arg<'_>],
    ) -> bool {
        let is_reported = !has_parse_diagnostics(self.hir(file));
        if is_reported {
            self.error(file, node, code, args);
        }
        is_reported
    }

    /// `grammarErrorOnNodeSkippedOnNoEmit`
    fn grammar_error_on_node_skipped_on_no_emit(
        &mut self,
        file: FileId,
        node: impl ToNode,
        code: u32,
        args: &[Arg<'_>],
    ) -> bool {
        let is_reported = !has_parse_diagnostics(self.hir(file));
        if is_reported {
            self.error(file, node, code, args).skipped_on_no_emit = true;
        }
        is_reported
    }

    /// `grammarErrorOnNode` for the token `token` immediately before `pos`.
    fn grammar_error_on_token_before(
        &mut self,
        file: FileId,
        pos: u32,
        token: &[u8],
        code: u32,
    ) -> bool {
        start_of_token_before(&self.hir(file).text, pos, token).is_some_and(|start| {
            self.grammar_error_at((file, start, start + token.len() as u32), code, &[])
        })
    }

    /// `grammarErrorOnNode` for the `token` immediately after `end`.
    pub(super) fn grammar_error_on_token_after(
        &mut self,
        file: FileId,
        end: u32,
        token: u8,
        code: u32,
    ) -> bool {
        let text = &self.hir(file).text;
        let start = skip_trivia(text, end as usize) as u32;
        text.get(start as usize) == Some(&token)
            && self.grammar_error_at((file, start, start + 1), code, &[])
    }

    /// `checkGrammarForInvalidQuestionMark`, `checkGrammarForInvalidExclamationToken`: `node.PostfixToken()`, after the name at `name`.
    fn check_grammar_for_invalid_postfix_token(
        &mut self,
        file: FileId,
        name: u32,
        token: u8,
        code: u32,
    ) -> bool {
        end_of_name(&self.hir(file).text, name as usize)
            .is_some_and(|end| self.grammar_error_on_token_after(file, end as u32, token, code))
    }

    /// Both checks for a member of an object literal: 1162 1255. `start`: `Prop::postfix_token`.
    fn check_grammar_for_invalid_postfix_token_in_object_literal(
        &mut self,
        file: FileId,
        start: u32,
    ) -> bool {
        let code = match self.hir(file).text.get(start as usize) {
            _ if start == 0 => return false,
            Some(b'!') => 1255,
            _ => 1162,
        };
        self.grammar_error_at((file, start, start + 1), code, &[])
    }

    /// `checkGrammarBreakOrContinueStatement`
    pub(super) fn check_grammar_break_or_continue_statement(
        &mut self,
        file: FileId,
        s: StmtId,
    ) -> bool {
        let hir = self.hir(file);
        let (target_label, is_break) = match hir[s].kind {
            StmtKind::Break(label) => (label, true),
            StmtKind::Continue(label) => (label, false),
            _ => return false,
        };
        let mut current = hir.node(s);
        while current.is_some() {
            let kind = hir.kind(current);
            if kind.is_function_like() || kind == Kind::ClassStaticBlockDeclaration {
                return self.grammar_error_on_node(file, s, 1107, &[]);
            }
            match kind {
                Kind::LabeledStatement => {
                    if let NodeData::Stmt(labeled) = hir.data(current)
                        && let StmtKind::Labeled { label, body } = hir[labeled].kind
                        && target_label.is_some()
                        && label == target_label
                    {
                        // `continue` can only target labels that are on iteration statements.
                        return !is_break
                            && !is_iteration_statement(hir, body, true)
                            && self.grammar_error_on_node(file, s, 1115, &[]);
                    }
                }
                Kind::SwitchStatement if is_break && target_label.is_none() => return false,
                _ if target_label.is_none() && kind.is_iteration_statement() => return false,
                _ => {}
            }
            current = hir.parent(current);
        }
        let code = match (target_label.is_some(), is_break) {
            (true, true) => 1116,
            (true, false) => 1115,
            (false, true) => 1105,
            (false, false) => 1104,
        };
        self.grammar_error_on_node(file, s, code, &[])
    }

    /// Duplicate-label check from `checkLabeledStatement` (TS1114).
    pub(super) fn check_grammar_duplicate_label(&mut self, file: FileId, s: StmtId, label: Atom) {
        let hir = self.hir(file);
        let mut current = hir.parent(hir.node(s));
        while current.is_some() && !hir.kind(current).is_function_like() {
            if let NodeData::Stmt(outer) = hir.data(current)
                && matches!(hir[outer].kind, StmtKind::Labeled { label: it, .. } if it == label)
            {
                self.grammar_error_at((file, hir[s].start, 0), 1114, &[Arg::Atom(label)]);
                break;
            }
            current = hir.parent(current);
        }
    }

    /// `checkGrammarFunctionLikeDeclaration`
    pub(super) fn check_grammar_function_like_declaration(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> bool {
        self.check_grammar_modifiers(file, func)
            || self.check_grammar_type_parameter_list(file, func)
            || self.check_grammar_parameter_list(file, func)
            || self.check_grammar_arrow_function(file, func)
            || self.check_grammar_for_use_strict_simple_parameter_list(file, func)
    }

    /// `checkGrammarTypeParameterList`: `<>`. Before an arrow function the parser rejects it.
    fn check_grammar_type_parameter_list(&mut self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let (text, f) = (&hir.text[..], &hir[func]);
        if !f.type_params.is_empty()
            || f.kind == FnKind::Arrow
            || text.get(f.anchor as usize) != Some(&b'(')
        {
            return false;
        }
        let close = skip_trivia_back(text, f.anchor as usize);
        if !text[..close].ends_with(b">") {
            return false;
        }
        let open = skip_trivia_back(text, close - 1);
        text[..open].ends_with(b"<")
            && self.grammar_error_at((file, open as u32 - 1, close as u32), 1098, &[])
    }

    /// `checkGrammarParameterList`
    fn check_grammar_parameter_list(&mut self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        let mut seen_optional_parameter = false;
        for (i, p) in f.params.iter().enumerate() {
            let parameter = &hir[p];
            let is_optional = parameter.flags.contains(Flags::OPTIONAL);
            if parameter.flags.contains(Flags::REST) {
                let name = hir[parameter.pat].pos;
                if i != f.params.len() - 1 {
                    return self.grammar_error_on_token_before(file, name, b"...", 1014);
                }
                // `checkGrammarForDisallowedTrailingComma`. A signature that the reparser makes of
                // JSDoc tags has no written list.
                if (f.kind == FnKind::Arrow || hir.text.get(f.anchor as usize) == Some(&b'('))
                    && !hir.is_ambient(hir.node(p))
                {
                    let end = self.end_of_param(file, p);
                    self.grammar_error_on_token_after(file, end, b',', 1013);
                }
                if is_optional {
                    let end = self.end_of_pat(file, parameter.pat);
                    return self.grammar_error_on_token_after(file, end, b'?', 1047);
                }
                if parameter.default.is_some() {
                    return self.grammar_error_on_node(file, parameter.pat, 1048, &[]);
                }
            } else if is_optional {
                seen_optional_parameter = true;
                // A `?` synthesized from a `@param` tag is not in the source.
                if parameter.default.is_some() && !parameter.flags.contains(Flags::REPARSED) {
                    return self.grammar_error_on_node(file, parameter.pat, 1015, &[]);
                }
            } else if seen_optional_parameter && parameter.default.is_none() {
                return self.grammar_error_on_node(file, parameter.pat, 1016, &[]);
            }
        }
        false
    }

    /// `checkGrammarArrowFunction`
    fn check_grammar_arrow_function(&mut self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let (text, f) = (&hir.text[..], &hir[func]);
        if f.kind != FnKind::Arrow {
            return false;
        }
        if f.type_params.len() == 1 {
            let first = f.type_params.at(0);
            let path = self.files().module(file).file_name();
            // Neither a constraint nor a trailing comma.
            if hir[first].constraint.is_none()
                && text.get(skip_trivia(text, hir[first].end as usize)) == Some(&b'>')
                && (path.ends_with(b".mts") || path.ends_with(b".cts"))
            {
                self.grammar_error_on_node(file, first, 7060, &[]);
            }
        }
        // `GetECMALineOfPosition` of `equalsGreaterThanToken.Pos()` and of its `End()`.
        let arrow = f.anchor as usize;
        text[arrow.min(text.len())..].starts_with(b"=>")
            && (skip_trivia_back(text, arrow)..arrow).any(|at| line_break_len(text, at) != 0)
            && self.grammar_error_at((file, f.anchor, f.anchor + 2), 1200, &[])
    }

    /// `checkGrammarForUseStrictSimpleParameterList`, for nodes that satisfy
    /// `IsFunctionLikeDeclaration`.
    fn check_grammar_for_use_strict_simple_parameter_list(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        let FnBody::Block(statements) = f.body else {
            return false;
        };
        let Some(directive) = hir
            .stmts
            .get(hir.find_use_strict_prologue(statements).idx())
        else {
            return false;
        };
        let use_strict_directive = (file, directive.start, directive.loc.end);
        let non_simple_parameters: SmallVec<[ParamId; 4]> = (f.params.iter())
            .filter(|&p| {
                hir[p].default.is_some()
                    || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_))
                    || hir[p].flags.contains(Flags::REST)
            })
            .collect();
        if non_simple_parameters.is_empty() || language_version(self) < ScriptTarget::ES2016 {
            return false;
        }
        let mut related = Vec::with_capacity(non_simple_parameters.len());
        for (index, &parameter) in non_simple_parameters.iter().enumerate() {
            let used_here = Reported::bare(use_strict_directive, 1349);
            let error = self.error(file, parameter, 1346, &[]);
            error.add_related_info(used_here);
            let at = (file, error.start, error.end);
            related.push(Reported::bare(at, if index == 0 { 1348 } else { 6204 }));
        }
        let error = self.error_at(use_strict_directive, 1347, &[]);
        error.related_information.extend(related);
        true
    }

    /// `checkGrammarComputedPropertyName`
    pub(super) fn check_grammar_computed_property_name(
        &mut self,
        file: FileId,
        name: PropKey,
    ) -> bool {
        let hir = self.hir(file);
        let PropKey::Computed(expression) = name else {
            return false;
        };
        matches!(
            hir[expression].kind,
            ExprKind::Binary {
                op: BinOp::Comma,
                ..
            }
        ) && !is_parenthesized(hir, expression)
            && self.grammar_error_on_node(file, expression, 1171, &[])
    }

    /// `checkGrammarForGenerator`
    pub(super) fn check_grammar_for_generator(&mut self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        if !f.flags.contains(Flags::GENERATOR) {
            return false;
        }
        let code = if hir.is_ambient(hir.node(func)) {
            1221
        } else if !has_body_node(f) {
            1222
        } else {
            return false;
        };
        asterisk_token(hir, f)
            .is_some_and(|start| self.grammar_error_at((file, start, start + 1), code, &[]))
    }

    /// `checkGrammarMethod`
    pub(super) fn check_grammar_method(&mut self, file: FileId, func: FnId) -> bool {
        if self.check_grammar_function_like_declaration(file, func) {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (f, name) = (&hir[func], hir[func].name_pos);
        let owner = bound.fns[func.idx()].owner;
        let FnOwner::Member(m) = owner else {
            // In an object literal.
            let NodeData::Prop(p) = hir.data(hir.node(func)) else {
                return false;
            };
            let modifiers = hir.modifier_list(hir.prop_modifiers(p));
            let is_only_async =
                modifiers.len() == 1 && modifiers[0].kind == ModifierKind::Keyword(Flags::ASYNC);
            if !modifiers.is_empty() && !is_only_async {
                return self.grammar_error_at((file, hir[p].start, 0), 1184, &[]);
            }
            let postfix_token = hir[p].postfix_token;
            if self.check_grammar_for_invalid_postfix_token_in_object_literal(file, postfix_token) {
                return true;
            }
            if !has_body_node(f) {
                let end = self.end_of_fn(file, func);
                return self.grammar_error_at((file, end - 1, end), 1005, &[Arg::Bytes(b"{")]);
            }
            return self.check_grammar_for_generator(file, func);
        };
        let code = match bound.member_owner[m.idx()] {
            MemberOwner::Class(_) => {
                if self.check_grammar_for_generator(file, func) {
                    return true;
                }
                if is_ambient(hir, f.flags) {
                    1165
                } else if !has_body_node(f) {
                    1168
                } else {
                    return false;
                }
            }
            MemberOwner::Interface(_) => 1169,
            MemberOwner::TypeLiteral(_) => 1170,
            MemberOwner::None => return false,
        };
        self.check_grammar_for_invalid_dynamic_name(file, hir[m].key, name, code)
    }

    /// `checkGrammarAccessor`
    pub(super) fn check_grammar_accessor(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        let is_in_type = matches!(bound.fns[func.idx()].owner, FnOwner::Member(m)
            if !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)));
        let is_abstract = f.flags.contains(Flags::ABSTRACT);
        if !has_body_node(f) {
            if !is_in_type && !is_abstract && !hir.is_ambient(hir.node(func)) {
                let end = self.end_of_fn(file, func);
                return self.grammar_error_at((file, end - 1, end), 1005, &[Arg::Bytes(b"{")]);
            }
        } else if is_abstract {
            return self.grammar_error_on_node(file, func, 1318, &[]);
        } else if is_in_type {
            // 1183, which is reported when the HIR is built.
            return true;
        }
        let name = hir.name(hir.node(func));
        let is_getter = f.kind == FnKind::Getter;
        if !f.type_params.is_empty() {
            return self.grammar_error_on_node(file, name, 1094, &[]);
        }
        // `doesAccessorHaveCorrectParameterCount`. `this` is not among `params`.
        let count = f.params.len() + usize::from(f.this_param.is_some());
        if f.accessor_this_parameter().is_none() && count != usize::from(!is_getter) {
            let code = if is_getter { 1054 } else { 1049 };
            return self.grammar_error_on_node(file, name, code, &[]);
        }
        if is_getter {
            return false;
        }
        if f.ret.is_some() {
            return self.grammar_error_on_node(file, name, 1095, &[]);
        }
        let Some(parameter) = hir.params.get(f.set_accessor_value_parameter().idx()) else {
            return false;
        };
        if parameter.flags.contains(Flags::REST) {
            return self.grammar_error_on_token_before(file, hir[parameter.pat].pos, b"...", 1053);
        }
        if parameter.flags.contains(Flags::OPTIONAL) {
            let end = self.end_of_pat(file, parameter.pat);
            return self.grammar_error_on_token_after(file, end, b'?', 1051);
        }
        parameter.default.is_some() && self.grammar_error_on_node(file, name, 1052, &[])
    }

    /// `checkGrammarConstructorTypeParameters`. They are between the name and the `(`.
    pub(super) fn check_grammar_constructor_type_parameters(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> bool {
        let hir = self.hir(file);
        // The reparser reports those of `@template` tags: it has the range of the tags.
        if let Some(first) = hir[func].type_params.iter().next()
            && hir.is_in_jsdoc(hir[first].pos)
        {
            return true;
        }
        let text = &hir.text[..];
        let less_than = skip_trivia(
            text,
            self.end_of_token_at(file, hir[func].name_pos) as usize,
        );
        if text.get(less_than) != Some(&b'<') {
            return false;
        }
        let first = skip_trivia(text, less_than + 1);
        let start = if text.get(first) == Some(&b'>') {
            less_than + 1
        } else {
            first
        };
        // The list ends with its last parameter or the comma after that.
        let greater_than = skip_trivia_back(text, hir[func].anchor as usize) - 1;
        let end = skip_trivia_back(text, greater_than).max(start);
        self.grammar_error_at((file, start as u32, end as u32), 1092, &[])
    }

    /// `checkGrammarConstructorTypeAnnotation`
    pub(super) fn check_grammar_constructor_type_annotation(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> bool {
        let hir = self.hir(file);
        let ret = hir[func].ret;
        if ret.is_none() {
            return false;
        }
        let start = start_of_type(hir, ret);
        let end = self.end_of_type_node_from(file, ret, start);
        self.grammar_error_at((file, start, end), 1093, &[])
    }

    /// `checkGrammarProperty`
    pub(super) fn check_grammar_property(&mut self, file: FileId, m: MemberId) -> bool {
        let hir = self.hir(file);
        let (member, name, text) = (&hir[m], hir[m].name_pos, &hir.text[..]);
        let owner = self.bound(file).member_owner[m.idx()];
        // `[a in b]` was meant as a mapped type. `[(a in b)]` is an ordinary name.
        if let PropKey::Computed(key) = member.key
            && matches!(hir[key].kind, ExprKind::Binary { op: BinOp::In, .. })
            && !is_parenthesized(hir, key)
        {
            // `node.Parent.Members()`
            let members = match owner {
                MemberOwner::Class(c) => hir[c].members,
                MemberOwner::Interface(i) => hir[i].members,
                MemberOwner::TypeLiteral(t) => match hir[t].kind {
                    TypeNodeKind::Object(members) => members,
                    _ => return true,
                },
                MemberOwner::None => return true,
            };
            return self.grammar_error_on_node(file, members.at(0), 7061, &[]);
        }
        if matches!(owner, MemberOwner::Class(_)) {
            if member.key == PropKey::Name(known::constructor)
                && matches!(text.get(name as usize), Some(b'"' | b'\''))
            {
                return self.grammar_error_on_node(file, hir.name(hir.node(m)), 18006, &[]);
            }
            if self.check_grammar_for_invalid_dynamic_name(file, member.key, name, 1166)
                || member.flags.contains(Flags::ACCESSOR | Flags::OPTIONAL)
                    && self.check_grammar_for_invalid_postfix_token(file, name, b'?', 1276)
            {
                return true;
            }
        } else {
            let is_interface = matches!(owner, MemberOwner::Interface(_));
            let code = if is_interface { 1169 } else { 1170 };
            if self.check_grammar_for_invalid_dynamic_name(file, member.key, name, code) {
                return true;
            }
            if member.init.is_some() {
                let at = self.place_of_initializer(file, member.init, None);
                return self.grammar_error_at(at, if is_interface { 1246 } else { 1247 }, &[]);
            }
        }
        let is_ambient = is_ambient(hir, member.flags);
        if is_ambient {
            let is_readonly = member.flags.contains(Flags::READONLY);
            self.check_ambient_initializer(file, member.init, member.ty, is_readonly, None);
        }
        if !matches!(owner, MemberOwner::Class(_)) || !member.flags.contains(Flags::DEFINITE) {
            return false;
        }
        let code = if member.init.is_some() {
            1263
        } else if member.ty.is_none() {
            1264
        } else if is_ambient || member.flags.intersects(Flags::STATIC | Flags::ABSTRACT) {
            1255
        } else {
            return false;
        };
        self.check_grammar_for_invalid_postfix_token(file, name, b'!', code)
    }

    /// `checkGrammarForInvalidDynamicName` for the name `key` that starts at `name`.
    fn check_grammar_for_invalid_dynamic_name(
        &mut self,
        file: FileId,
        key: PropKey,
        name: u32,
        code: u32,
    ) -> bool {
        is_invalid_dynamic_name(self.hir(file), key, name)
            && self.grammar_error_at((file, name, self.end_of_bracket_at(file, name)), code, &[])
    }

    /// `checkAmbientInitializer`. `name`: the position of the variable's name, if it is a plain
    /// identifier.
    fn check_ambient_initializer(
        &mut self,
        file: FileId,
        initializer: ExprId,
        type_node: TypeNodeId,
        is_const_or_readonly: bool,
        name: Option<u32>,
    ) -> bool {
        if initializer.is_none() {
            return false;
        }
        let at = self.place_of_initializer(file, initializer, name);
        if !is_const_or_readonly || type_node.is_some() {
            return self.grammar_error_at(at, 1039, &[]);
        }
        self.is_invalid_ambient_initializer(file, initializer)
            && self.grammar_error_at(at, 1254, &[])
    }

    /// `isInvalidInitializer`, of `checkAmbientInitializer`.
    fn is_invalid_ambient_initializer(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        if is_parenthesized(hir, e) {
            return true;
        }
        match hir[e].kind {
            ExprKind::True | ExprKind::False | ExprKind::BigInt(_) => false,
            // `isInitializerBigIntLiteralExpression`
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } if matches!(hir[operand].kind, ExprKind::BigInt(_)) => is_parenthesized(hir, operand),
            // `isInitializerSimpleLiteralEnumReference`
            ExprKind::Index { obj, index, .. }
                if !is_string_or_number_literal_expression(hir, index)
                    || !is_entity_name_expression(hir, obj) =>
            {
                true
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let ty = self.type_of_expr(file, e);
                !is_enum_like(self, ty)
            }
            _ => !is_string_or_number_literal_expression(hir, e),
        }
    }

    /// `GetErrorRangeForNode` for an initializer. `name`: the position of the name of the variable
    /// it initializes, if that is a plain identifier (`getAssignedName`).
    fn place_of_initializer(&self, file: FileId, e: ExprId, name: Option<u32>) -> Place {
        let hir = self.hir(file);
        match (hir[e].kind, name) {
            (ExprKind::Fn(f), Some(name))
                if hir[f].kind == FnKind::Expr
                    && hir[f].name.is_none()
                    && !is_parenthesized(hir, e) =>
            {
                self.place_of_token(file, name)
            }
            _ => {
                let (start, end) = self.get_error_range_for_node(file, hir.child(e));
                (file, start, end)
            }
        }
    }

    /// `checkGrammarVariableDeclaration`. `list_parent`: `node.Parent.Parent.Kind`.
    pub(super) fn check_grammar_variable_declaration(
        &mut self,
        file: FileId,
        d: VarDeclId,
        list_parent: Kind,
    ) -> bool {
        let hir = self.hir(file);
        let node = &hir[d];
        let is_binding_pattern =
            matches!(hir[node.pat].kind, PatKind::Object(_) | PatKind::Array(_));
        let keyword = match node.kind {
            VarKind::AwaitUsing => "await using",
            VarKind::Using => "using",
            VarKind::Const => "const",
            _ => "",
        };
        let is_using = matches!(node.kind, VarKind::Using | VarKind::AwaitUsing);
        if is_binding_pattern && is_using {
            return self.grammar_error_on_node(file, d, 1492, &[Arg::Text(keyword)]);
        }
        let is_ambient = is_ambient(hir, node.flags);
        let name = (!is_binding_pattern).then_some(hir[node.pat].pos);
        if !matches!(list_parent, Kind::ForInStatement | Kind::ForOfStatement) {
            if is_ambient {
                let is_const_like = !keyword.is_empty();
                self.check_ambient_initializer(file, node.init, node.ty, is_const_like, name);
            } else if node.init.is_none() {
                if is_binding_pattern {
                    return self.grammar_error_on_node(file, d, 1182, &[]);
                }
                if !keyword.is_empty() {
                    return self.grammar_error_on_node(file, d, 1155, &[Arg::Text(keyword)]);
                }
            }
        }
        if node.flags.contains(Flags::DEFINITE)
            && (list_parent != Kind::VariableStatement
                || node.ty.is_none()
                || node.init.is_some()
                || is_ambient)
        {
            let code = if node.init.is_some() {
                1263
            } else if node.ty.is_none() {
                1264
            } else {
                1255
            };
            return name.is_some_and(|name| {
                self.check_grammar_for_invalid_postfix_token(file, name, b'!', code)
            });
        }
        if node.flags.contains(Flags::EXPORT)
            && !is_ambient
            && self.emit_module_format_of_file(file) < ModuleKind::System
        {
            self.check_grammar_for_es_module_marker_in_binding_name(file, node.pat);
        }
        node.kind != VarKind::Var
            && self.check_grammar_name_in_let_or_const_declarations(file, node.pat)
    }

    /// `checkGrammarForEsModuleMarkerInBindingName`
    fn check_grammar_for_es_module_marker_in_binding_name(
        &mut self,
        file: FileId,
        name: PatId,
    ) -> bool {
        let hir = self.hir(file);
        let elements: SmallVec<[PatId; 8]> = match hir[name].kind {
            PatKind::Ident(known::__esModule) => {
                return self.grammar_error_on_node_skipped_on_no_emit(file, name, 1216, &[]);
            }
            PatKind::Object(properties) => properties.iter().map(|p| hir[p].value).collect(),
            PatKind::Array(elements) => elements.iter().map(|e| hir[e].pat).collect(),
            _ => return false,
        };
        // In a pattern, only the first named element is checked.
        (elements.into_iter())
            .find(|&element| !matches!(hir[element].kind, PatKind::Missing))
            .is_some_and(|it| self.check_grammar_for_es_module_marker_in_binding_name(file, it))
    }

    /// `checkGrammarNameInLetOrConstDeclarations`
    fn check_grammar_name_in_let_or_const_declarations(
        &mut self,
        file: FileId,
        name: PatId,
    ) -> bool {
        let hir = self.hir(file);
        match hir[name].kind {
            PatKind::Ident(known::let_) => {
                return self.grammar_error_on_node(file, name, 2480, &[]);
            }
            PatKind::Object(properties) => {
                for p in properties.iter() {
                    self.check_grammar_name_in_let_or_const_declarations(file, hir[p].value);
                }
            }
            PatKind::Array(elements) => {
                for e in elements.iter() {
                    self.check_grammar_name_in_let_or_const_declarations(file, hir[e].pat);
                }
            }
            _ => {}
        }
        false
    }

    /// `GetPropertyNameForPropertyNameNode`, for the name `key` at `pos`.
    /// `None`: `InternalSymbolNameMissing`.
    pub(super) fn get_property_name_for_property_name_node(
        &self,
        file: FileId,
        key: PropKey,
        pos: u32,
    ) -> Option<Atom> {
        let hir = self.hir(file);
        let text = match key {
            PropKey::Name(name) => return Some(name),
            PropKey::Private(name) => self.written_name(name).to_vec(),
            PropKey::Computed(e) if is_signed_numeric_literal(hir, e) => {
                let ExprKind::Unary { op, operand } = hir[e].kind else {
                    return None;
                };
                let ExprKind::Number(n) = hir[operand].kind else {
                    return None;
                };
                let sign: &[u8] = if op == UnOp::Minus { b"-" } else { b"" };
                cat!(sign, crate::atom::number_to_string(hir.numbers[n as usize]))
            }
            PropKey::Computed(_) => return None,
            // A name that declares nothing (`getDeclarationName`) is not stored.
            PropKey::None if is_private_name_at(hir, pos) => self.declaration_name_at(file, pos),
            PropKey::None if is_bigint_literal_at(hir, pos) => {
                let mut text = self.declaration_name_at(file, pos);
                text.retain(|&digit| digit != b'_');
                text
            }
            PropKey::None => return None,
        };
        Some(self.atoms().intern(&text))
    }

    /// `getEffectivePropertyNameForPropertyNameNode`, for the name of the property `p` of an object
    /// literal.
    fn get_effective_property_name_for_property_name_node(
        &mut self,
        file: FileId,
        p: PropId,
    ) -> Option<Atom> {
        let property = &self.hir(file)[p];
        let (key, pos) = (property.key, property.pos);
        let name = self.get_property_name_for_property_name_node(file, key, pos);
        let PropKey::Computed(expression) = key else {
            return name;
        };
        if name.is_some() {
            return name;
        }
        // `tryGetNameFromType`
        let ty = self.get_type_of_expression(file, expression);
        self.property_name_of_type(ty)
    }

    /// `checkGrammarObjectLiteralExpression`
    pub(super) fn check_grammar_object_literal_expression(
        &mut self,
        file: FileId,
        node: ExprId,
        properties: Span<PropId>,
    ) -> bool {
        let hir = self.hir(file);
        // The text of the default library is not retained, and nothing is reported for a JSON file.
        // `ImportAttributes` are stored as an object literal but are not one.
        if hir.text.is_empty()
            || hir.kind == FileKind::Json
            || hir.import_attributes.iter().any(|kept| kept.1 == node)
        {
            return false;
        }
        let in_destructuring = self.bound(file).get_assignment_target(hir, node).is_some();
        // If every name is a literal name and all are distinct, there is nothing to report.
        let mut written: SmallVec<[Atom; 16]> = SmallVec::new();
        let mut is_all_written = true;
        // The key of `#a` and of `1n` is not `name.Text()`.
        let mut has_other_text = false;
        for prop in properties.iter().map(|p| &hir[p]) {
            match prop.key {
                _ if prop.kind == PropKind::Spread => {}
                PropKey::Name(name) => written.push(name),
                PropKey::Computed(_) => is_all_written = false,
                PropKey::Private(_) | PropKey::None => has_other_text = true,
            }
        }
        let has_repeated = has_other_text
            || match written.len() {
                n @ 0..=8 => (1..n).any(|i| written[..i].contains(&written[i])),
                _ => !number_repeated(&written).is_empty(),
            };
        // A computed name is evaluated (`getTypeOfExpression`) even if it is the only name.
        let may_repeat =
            !in_destructuring && (!is_all_written || properties.len() > 1 && has_repeated);
        // `lateBindMember`
        let container = self.bound(file).expr_symbol[node.idx()];
        if may_repeat && !is_all_written && properties.len() > 1 && container.is_some() {
            let container = self.files().sym(file, container);
            self.report_conflicts_of_late_bound_members(file, container, false);
        }
        let mut seen: SmallVec<[(Atom, u8); 8]> = SmallVec::new();
        for p in properties.iter() {
            let prop = &hir[p];
            let current_kind = match prop.kind {
                PropKind::Spread => {
                    // A rest property cannot be destructured any further.
                    if in_destructuring
                        && prop.value.is_some()
                        && matches!(
                            hir[prop.value].kind,
                            ExprKind::Array(_) | ExprKind::Object(_)
                        )
                    {
                        return self.grammar_error_on_node(file, hir.child(prop.value), 2501, &[]);
                    }
                    continue;
                }
                PropKind::Init | PropKind::Shorthand => PROPERTY_ASSIGNMENT,
                PropKind::Method => METHOD,
                PropKind::Getter => GET_ACCESSOR,
                PropKind::Setter => SET_ACCESSOR,
            };
            self.check_grammar_computed_property_name(file, prop.key);
            // The `=` of `{ a = 1 }`, which only a destructuring assignment can have.
            if !in_destructuring
                && prop.kind == PropKind::Shorthand
                && prop.value.is_some()
                && matches!(hir[prop.value].kind, ExprKind::Assign { op: None, .. })
                && let Some(start) = equals_token_after_name(&hir.text, prop.pos)
            {
                self.grammar_error_at((file, start, start + 1), 1312, &[]);
            }
            // Outside a class the key of `#a` is `PropKey::None`.
            if hir.text.get(prop.pos as usize) == Some(&b'#') {
                self.grammar_error_at(self.place_of_token(file, prop.pos), 18016, &[]);
            }
            // "Modifiers are never allowed on properties except for 'async' on a method
            // declaration"
            if !hir.modifiers_of_props.is_empty() {
                for modifier in hir.modifier_list(hir.prop_modifiers(p)) {
                    if let ModifierKind::Keyword(keyword) = modifier.kind
                        && (keyword != Flags::ASYNC || prop.kind != PropKind::Method)
                    {
                        let text = Arg::Text(modifier_text(keyword));
                        self.grammar_error_at((file, modifier.pos, 0), 1042, &[text]);
                    }
                }
            }
            // `checkGrammarForInvalidExclamationToken`, `checkGrammarForInvalidQuestionMark`
            if current_kind == PROPERTY_ASSIGNMENT {
                self.check_grammar_for_invalid_postfix_token_in_object_literal(
                    file,
                    prop.postfix_token,
                );
                // `addErrorOrSuggestion`: a file with parse errors has this one too.
                if prop.key == PropKey::None && is_bigint_literal_at(hir, prop.pos) {
                    self.error_at((file, prop.pos, 0), 1539, &[]);
                }
            }
            if !may_repeat {
                continue;
            }
            let Some(effective_name) =
                self.get_effective_property_name_for_property_name_node(file, p)
            else {
                continue;
            };
            let Some(existing) = seen.iter_mut().find(|seen| seen.0 == effective_name) else {
                seen.push((effective_name, current_kind));
                continue;
            };
            let name = hir.name(hir.node(p));
            if current_kind & existing.1 & METHOD != 0 {
                let (start, end) = self.get_error_range_for_node(file, name);
                let text = self.source_text(file, start, end);
                self.grammar_error_at((file, start, end), 2300, &[Arg::Bytes(&text)]);
            } else if current_kind & existing.1 & PROPERTY_ASSIGNMENT != 0 {
                self.grammar_error_on_node(file, name, 1117, &[]);
            } else if current_kind & GET_OR_SET_ACCESSOR != 0
                && existing.1 & GET_OR_SET_ACCESSOR != 0
            {
                if existing.1 == GET_OR_SET_ACCESSOR || current_kind == existing.1 {
                    return self.grammar_error_on_node(file, name, 1118, &[]);
                }
                existing.1 |= current_kind;
            } else {
                return self.grammar_error_on_node(file, name, 1119, &[]);
            }
        }
        false
    }
}

// ───────────────────────────── the syntax tree ─────────────────────────────

/// `NodeFlagsAmbient`, of a declaration with `flags`. Every node of a declaration file has it.
fn is_ambient(hir: &File, flags: Flags) -> bool {
    flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration
}

/// `isInitializerStringOrNumberLiteralExpression`
fn is_string_or_number_literal_expression(hir: &File, e: ExprId) -> bool {
    !is_parenthesized(hir, e)
        && (is_string_or_numeric_literal_like(hir, e)
            || is_signed_numeric_literal(hir, e)
                && matches!(hir[e].kind, ExprKind::Unary { op, .. } if op == UnOp::Minus))
}

/// `checkGrammarForInvalidDynamicName`: a computed name that is neither a literal nor `a.b.c`.
/// Whether one that is `a.b.c` can be bound (`isLateBindableName`) makes no difference to it.
/// `name`: the start of the name.
fn is_invalid_dynamic_name(hir: &File, key: PropKey, name: u32) -> bool {
    let text = &hir.text[..];
    if text.get(name as usize) != Some(&b'[') {
        return false;
    }
    // An expression that starts with a parenthesis is neither.
    let literal = skip_trivia(text, name as usize + 1);
    if text.get(literal) == Some(&b'(') {
        return true;
    }
    match key {
        PropKey::Computed(e) => is_dynamic_name(hir, e) && !is_entity_name_expression(hir, e),
        // `["a" as T]`, `["a"!]` and `[0 satisfies T]` are stored as the literal, which is not the
        // whole name.
        PropKey::Name(_) => {
            let after = skip_trivia(text, token_end(text, literal, false));
            if matches!(text.get(literal), Some(b'"' | b'\'' | b'`')) {
                return text.get(after) != Some(&b']');
            }
            text.get(after) == Some(&b'!')
                || is_word_at(text, after, b"as")
                || is_word_at(text, after, b"satisfies")
        }
        PropKey::Private(_) | PropKey::None => false,
    }
}

/// `TypeFlagsEnumLike`: a member of an enum, or an enum.
fn is_enum_like(c: &mut Checker<'_, '_>, ty: TypeId) -> bool {
    match c.data(ty) {
        TypeData::EnumLit { .. } | TypeData::Enum { .. } => true,
        TypeData::Union(parts) => match c.data(parts[0]) {
            TypeData::EnumLit { member, .. } => c.enum_type_of_member(*member) == ty,
            _ => false,
        },
        _ => false,
    }
}

// ───────────────────────────── the text ─────────────────────────────

/// `BodyData().AsteriskToken` of the generator `f`: it precedes the name of a method, and follows
/// the `function` keyword, which only modifiers precede.
fn asterisk_token(hir: &File, f: &Func) -> Option<u32> {
    let text = &hir.text[..];
    if f.kind == FnKind::Method {
        return start_of_token_before(text, f.name_pos, b"*");
    }
    let mut at = f.start as usize;
    while !is_word_at(text, at, b"function") {
        let modifier = word_at(text, at);
        if modifier.is_empty() {
            return None;
        }
        at = skip_trivia(text, at + modifier.len());
    }
    let asterisk = skip_trivia(text, at + b"function".len());
    (text.get(asterisk) == Some(&b'*')).then_some(asterisk as u32)
}

/// The end of the name of a property or variable that starts at `start`: an identifier, a string, a
/// number, or brackets.
/// `None`: it is not recognized.
fn end_of_name(text: &[u8], start: usize) -> Option<usize> {
    match *text.get(start)? {
        b'[' => end_of_brackets(text, start),
        _ => Some(token_end(text, start, false)),
    }
}

/// The start of the `=` of the shorthand property `name = initializer`. A `?` or a `!` may follow the name.
fn equals_token_after_name(text: &[u8], name: u32) -> Option<u32> {
    let mut at = skip_trivia(text, end_of_name(text, name as usize)?);
    if matches!(text.get(at), Some(b'?' | b'!')) {
        at = skip_trivia(text, at + 1);
    }
    (text.get(at) == Some(&b'=')).then_some(at as u32)
}

/// `IsIterationStatement`
fn is_iteration_statement(
    hir: &hir::File,
    mut s: StmtId,
    look_in_labeled_statements: bool,
) -> bool {
    while look_in_labeled_statements && let StmtKind::Labeled { body, .. } = hir[s].kind {
        s = body;
    }
    hir.kind(hir.node(s)).is_iteration_statement()
}
