//! grammarchecks.go of TypeScript 7.0.2, as far as signatures, members, object literals and variables go. The walk (in_order.rs) and
//! `checkObjectLiteral` call these where checker.go does. Each says whether it reported, and who calls it goes on or not as there.
//!
//! A token is no node yet: where a `?`, `!`, `...`, `*` or `=` is, is read off the text next to a node, once it is known to be there.

use super::errors_grammar_modifiers::HasModifiers;
use super::errors_x_operators::language_version;
use super::errors_x_signatures::start_of_written_type;
use super::related::Place;
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

impl Checker<'_> {
    /// `grammarErrorOnNode`
    pub(super) fn grammar_error_on_node(
        &mut self,
        file: FileId,
        node: impl ToNode,
        code: u32,
        args: &[Arg<'_>],
    ) -> bool {
        let is_said = !has_parse_diagnostics(self.hir(file));
        if is_said {
            self.error(file, node, code, args);
        }
        is_said
    }

    /// `grammarErrorOnNode`, of the token `token` that comes right before `pos`.
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

    /// `grammarErrorOnNode`, of the `token` that comes right after `end`.
    fn grammar_error_on_token_after(
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

    /// The two of them, of a member of an object literal: 1162 1255. `start`: `Prop::postfix_token`.
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

    /// `checkGrammarModifiers`, as far as whether it reports goes. `check_grammar_modifiers` and `report_decorators` do the reporting.
    pub(super) fn has_grammar_error_in_modifiers(&self, file: FileId, node: HasModifiers) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return false;
        }
        let is_decorator_refused = |owner: DecoratorOwner| {
            !bound.refused_decorators.is_empty()
                && (hir.decorators.iter())
                    .any(|&(of, e)| of == owner && bound.refused_decorators.contains(&e))
        };
        matches!(node, HasModifiers::Member(m) if is_decorator_refused(DecoratorOwner::Member(m)))
            || self.grammar_error_in_modifiers(file, node).is_some()
    }

    /// `checkGrammarFunctionLikeDeclaration`
    pub(super) fn check_grammar_function_like_declaration(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> bool {
        let hir = self.hir(file);
        let has_modifier_error = match self.bound(file).fns[func.idx()].owner {
            FnOwner::Stmt(s) => {
                self.has_grammar_error_in_modifiers(file, HasModifiers::Statement(s))
            }
            FnOwner::Member(m) => {
                self.has_grammar_error_in_modifiers(file, HasModifiers::Member(m))
            }
            // Those of a member of an object literal are no list yet: the parser objects to them.
            _ => {
                !hir.early_errors.is_empty()
                    && !has_parse_diagnostics(hir)
                    && (hir[func].name.is_some()
                        || matches!(
                            hir[func].kind,
                            FnKind::Method | FnKind::Getter | FnKind::Setter
                        ))
                    && has_modifier_error(hir, hir[func].name_pos)
            }
        };
        has_modifier_error
            || self.check_grammar_type_parameter_list(file, func)
            || self.check_grammar_parameter_list(file, func)
            || self.check_grammar_arrow_function(file, func)
            || self.check_grammar_for_use_strict_simple_parameter_list(file, func)
    }

    /// `checkGrammarTypeParameterList`: `<>`. Before an arrow function the parser refuses it.
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
                // `checkGrammarForDisallowedTrailingComma`
                if f.kind != FnKind::Arrow
                    && hir.text.get(f.anchor as usize) == Some(&b'(')
                    && !hir.is_ambient(hir.node(p))
                    && let Some(close) = end_of_brackets(&hir.text, f.anchor as usize)
                {
                    self.grammar_error_on_token_before(file, close as u32 - 1, b",", 1013);
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
                // A `?` made from a `@param` tag is not written.
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
            let path = self.files().module(file).path.as_str();
            // Neither a constraint nor a trailing comma.
            if hir[first].constraint.is_none()
                && text.get(skip_trivia(text, hir[first].end as usize)) == Some(&b'>')
                && (path.ends_with(".mts") || path.ends_with(".cts"))
            {
                self.grammar_error_on_node(file, first, 7060, &[]);
            }
        }
        let arrow = f.anchor as usize;
        text[arrow.min(text.len())..].starts_with(b"=>")
            && text[skip_trivia_back(text, arrow)..arrow]
                .iter()
                .any(|b| matches!(b, b'\n' | b'\r'))
            && self.grammar_error_at((file, f.anchor, f.anchor + 2), 1200, &[])
    }

    /// `checkGrammarForUseStrictSimpleParameterList`, of what `IsFunctionLikeDeclaration` holds for.
    fn check_grammar_for_use_strict_simple_parameter_list(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        // `FindUseStrictPrologue` finds nothing in a file without a directive, which is nearly every file.
        let FnBody::Block(statements) = f.body else {
            return false;
        };
        if hir.directives.is_empty() {
            return false;
        }
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
        // `FindUseStrictPrologue`: the directives of the body come after the signature and before the first statement.
        let signature_end = hir[f.params.at(f.params.len() - 1)].loc.end;
        let first_statement = hir.ids(statements).next().map(|s| hir[s].start);
        let body = signature_end..first_statement.unwrap_or_else(|| self.end_of_fn(file, func));
        let is_use_strict = |at: u32| {
            let written = hir.text.get(at as usize..at as usize + 12);
            matches!(written, Some(b"\"use strict\"" | b"'use strict'"))
        };
        let Some(start) = (hir.directives.iter().map(|directive| directive.0))
            .find(|&at| body.contains(&at) && is_use_strict(at))
        else {
            return false;
        };
        // The statement, with its `;`.
        let semicolon = skip_trivia(&hir.text, start as usize + 12);
        let use_strict_directive = if hir.text.get(semicolon) == Some(&b';') {
            (file, start, semicolon as u32 + 1)
        } else {
            (file, start, start + 12)
        };
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

    /// `checkGrammarForGenerator`
    pub(super) fn check_grammar_for_generator(&mut self, file: FileId, func: FnId) -> bool {
        let f = &self.hir(file)[func];
        if !f.flags.contains(Flags::GENERATOR) {
            return false;
        }
        let code = if is_ambient(self.hir(file), f.flags) {
            1221
        } else if !has_body_node(f) {
            1222
        } else {
            return false;
        };
        self.grammar_error_on_token_before(file, f.name_pos, b"*", code)
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
            let postfix_token = match owner {
                FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                    crate::bind::Parent::Prop(p) => hir[p].postfix_token,
                    _ => 0,
                },
                _ => 0,
            };
            // In an object literal. Of any modifiers but a lone `async` the parser says 1184.
            if !has_no_modifier_but_async(&hir.text, name)
                || self
                    .check_grammar_for_invalid_postfix_token_in_object_literal(file, postfix_token)
            {
                return true;
            }
            if !has_body_node(f) {
                let end = self.end_of_fn(file, func);
                return self.grammar_error_at((file, end - 1, end), 1005, &[Arg::Text("{")]);
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
            if !is_ambient(hir, f.flags) && !is_in_type && !is_abstract {
                let end = self.end_of_fn(file, func);
                return self.grammar_error_at((file, end - 1, end), 1005, &[Arg::Text("{")]);
            }
        } else if is_abstract {
            return self.grammar_error_on_node(file, func, 1318, &[]);
        } else if is_in_type {
            // 1183, which is said when the tree is made.
            return true;
        }
        let name = hir.name(hir.node(func));
        let is_getter = f.kind == FnKind::Getter;
        if !f.type_params.is_empty() {
            return self.grammar_error_on_node(file, name, 1094, &[]);
        }
        // `doesAccessorHaveCorrectParameterCount`, `getAccessorThisParameter`. `this` is not among `params`.
        let has_this = f.this_param.is_some();
        let count = f.params.len() + usize::from(has_this);
        if !(has_this && count == if is_getter { 1 } else { 2 }) && count != usize::from(!is_getter)
        {
            let code = if is_getter { 1054 } else { 1049 };
            return self.grammar_error_on_node(file, name, code, &[]);
        }
        if is_getter {
            return false;
        }
        if f.ret.is_some() {
            return self.grammar_error_on_node(file, name, 1095, &[]);
        }
        // `GetSetAccessorValueParameter`
        let Some(parameter) = f.params.iter().next().map(|p| &hir[p]) else {
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

    /// `checkGrammarConstructorTypeParameters`. They are not kept: they come between the name and the `(`.
    pub(super) fn check_grammar_constructor_type_parameters(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> bool {
        let hir = self.hir(file);
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
        let start = start_of_written_type(&hir.text, hir[ret].pos);
        let end = self.end_of_type_node_from(file, ret, start);
        self.grammar_error_at((file, start, end), 1093, &[])
    }

    /// `checkGrammarProperty`
    pub(super) fn check_grammar_property(&mut self, file: FileId, m: MemberId) -> bool {
        let hir = self.hir(file);
        let (member, name, text) = (&hir[m], hir[m].name_pos, &hir.text[..]);
        // `[a in b]` was meant for a mapped type: 7061, which is said where those are looked at. `[(a in b)]` is a name like any other.
        if let PropKey::Computed(key) = member.key
            && matches!(hir[key].kind, ExprKind::Binary { op: BinOp::In, .. })
            && !is_parenthesized(hir, key)
        {
            return true;
        }
        let owner = self.bound(file).member_owner[m.idx()];
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

    /// `checkGrammarForInvalidDynamicName`, of the name `key` that starts at `name`.
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

    /// `checkAmbientInitializer`. `name`: where the variable is named, if it is one that goes by a plain name.
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

    /// `GetErrorRangeForNode`, of an initializer. `name`: where the variable it is the value of is named, if by a plain name
    /// (`getAssignedName`).
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
                // `grammarErrorOnNodeSkippedOnNoEmit`
                return !self.p.files.options.no_emit
                    && self.grammar_error_on_node(file, name, 1216, &[]);
            }
            PatKind::Object(properties) => properties.iter().map(|p| hir[p].value).collect(),
            PatKind::Array(elements) => elements.iter().map(|e| hir[e].pat).collect(),
            _ => return false,
        };
        // Of a pattern, only the first element that has a name is looked into.
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

    /// `checkGrammarObjectLiteralExpression`. The parser says 1171 and 1042, the lowering what is said of a number or a bigint for a name.
    pub(super) fn check_grammar_object_literal_expression(
        &mut self,
        file: FileId,
        node: ExprId,
        properties: Span<PropId>,
    ) -> bool {
        let hir = self.hir(file);
        // The text of the default library is not kept, and nothing is said of a JSON file.
        // `ImportAttributes` are kept as an object literal and are none.
        if has_parse_diagnostics(hir)
            || hir.text.is_empty()
            || hir.kind == FileKind::Json
            || hir.import_attributes.iter().any(|kept| kept.1 == node)
        {
            return false;
        }
        let in_destructuring = self.bound(file).get_assignment_target(hir, node).is_some();
        // Of names that are all written out and all different there is nothing to say.
        let mut written: SmallVec<[Atom; 16]> = SmallVec::new();
        let mut is_all_written = true;
        for prop in properties.iter().map(|p| &hir[p]) {
            match prop.key {
                _ if prop.kind == PropKind::Spread => {}
                PropKey::Name(name) | PropKey::Private(name) => written.push(name),
                PropKey::Computed(_) => is_all_written = false,
                PropKey::None => {}
            }
        }
        let has_repeated = match written.len() {
            n @ 0..=8 => (1..n).any(|i| written[..i].contains(&written[i])),
            _ => !number_repeated(&written).is_empty(),
        };
        let may_repeat =
            !in_destructuring && properties.len() > 1 && !(is_all_written && !has_repeated);
        // `lateBindMember`
        let container = self.bound(file).expr_symbol[node.idx()];
        if may_repeat && !is_all_written && container.is_some() {
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
            // The `=` of `{ a = 1 }`, which only a destructuring assignment can have.
            if !in_destructuring
                && prop.kind == PropKind::Shorthand
                && prop.value.is_some()
                && matches!(hir[prop.value].kind, ExprKind::Assign { op: None, .. })
                && let Some(start) = equals_token_after_name(&hir.text, prop.pos)
            {
                self.error_at((file, start, start + 1), 1312, &[]);
            }
            // Outside a class the key of `#a` is `PropKey::None`.
            if hir.text.get(prop.pos as usize) == Some(&b'#') {
                self.error_at(self.place_of_token(file, prop.pos), 18016, &[]);
            }
            // `checkGrammarForInvalidExclamationToken`, `checkGrammarForInvalidQuestionMark`
            if current_kind == PROPERTY_ASSIGNMENT {
                self.check_grammar_for_invalid_postfix_token_in_object_literal(
                    file,
                    prop.postfix_token,
                );
            }
            if !may_repeat {
                continue;
            }
            // `getEffectivePropertyNameForPropertyNameNode`
            let Some(effective_name) = self.member_name(file, prop.key) else {
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
                self.error_at((file, start, end), 2300, &[Arg::Text(&text)]);
            } else if current_kind & existing.1 & PROPERTY_ASSIGNMENT != 0 {
                self.error(file, name, 1117, &[]);
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

/// `checkGrammarForInvalidDynamicName`: a computed name that is neither a literal nor `a.b.c`. Whether one that is `a.b.c` can be
/// bound (`isLateBindableName`) makes no difference to it. `name`: where the name starts.
fn is_invalid_dynamic_name(hir: &File, key: PropKey, name: u32) -> bool {
    let text = &hir.text[..];
    if text.get(name as usize) != Some(&b'[') {
        return false;
    }
    // What starts with a parenthesis is neither.
    let literal = skip_trivia(text, name as usize + 1);
    if text.get(literal) == Some(&b'(') {
        return true;
    }
    match key {
        PropKey::Computed(e) => is_dynamic_name(hir, e) && !is_entity_name_expression(hir, e),
        // `["a" as T]`, `["a"!]` and `[0 satisfies T]` are kept as the literal, which is not all there is to the name.
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
fn is_enum_like(c: &mut Checker<'_>, ty: TypeId) -> bool {
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

/// Whether the parser objected to a modifier of what is named at `name`: something was said of a word before it, with nothing but
/// modifiers and keywords in between.
fn has_modifier_error(hir: &File, name: u32) -> bool {
    let text = &hir.text[..];
    hir.early_errors.iter().any(|&(at, _)| {
        let mut i = at as usize;
        if at >= name {
            return false;
        }
        loop {
            i = skip_trivia(text, i);
            if i >= name as usize {
                return i == name as usize;
            }
            if text.get(i) == Some(&b'*') {
                i += 1;
                continue;
            }
            let word = word_at(text, i);
            if !MODIFIERS_AND_KEYWORDS.contains(word) {
                return false;
            }
            i += word.len();
        }
    })
}

bun_core::comptime_string_set! {
    static MODIFIERS_AND_KEYWORDS = {
        b"public", b"private", b"protected", b"static", b"abstract", b"override", b"readonly", b"declare", b"async", b"accessor",
        b"export", b"default", b"function", b"get", b"set", b"const", b"in", b"out",
    };
}

/// Whether nothing but `async` and `*` comes before the name, at `name`, of a method of an object literal.
fn has_no_modifier_but_async(text: &[u8], name: u32) -> bool {
    let mut before = trim_trivia_end(&text[..(name as usize).min(text.len())]);
    if let Some(rest) = before.strip_suffix(b"*") {
        before = trim_trivia_end(rest);
    }
    if word_before(before, before.len()) == b"async" {
        before = trim_trivia_end(&before[..before.len() - 5]);
    }
    matches!(before.last(), Some(b'{' | b','))
}

/// Where the name of a property or a variable that starts at `start` ends: an identifier, a string, a number, or brackets.
/// `None`: it is not made out.
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
