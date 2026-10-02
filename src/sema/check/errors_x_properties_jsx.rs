//! The grammar of properties, of what is ambient, and of a few things next to them; and what JSX has to say beyond its attributes.
//!
//! * 1166, and 18006 1276 1169 1246 1170 1247: `checkGrammarProperty`, `checkGrammarForInvalidDynamicName`
//! * 1165 1168, and 1169 1170 of methods: `checkGrammarMethod`
//! * 1039 1254: `checkAmbientInitializer`
//! * 1255, and 1263 1264: `checkGrammarProperty`, `checkGrammarVariableDeclaration`; with 1162, `checkGrammarObjectLiteralExpression`
//!   and `checkGrammarMethod`
//! * 2501 1312 18016: `checkGrammarObjectLiteralExpression`
//! * 1079: `checkGrammarModifiers`
//! * 2207, and 2206: `checkGrammarTypeOnlyNamedImportsOrExports`
//! * 18007: `checkGrammarJsxExpression`
//! * 17000 17001, and 2639: `checkGrammarJsxElement`, `checkGrammarJsxName`
//! * 17019: `checkJSDocTypeIsInJsFile`
//! * 2609: `checkJsxExpression`
//! * 17016 17017: `checkJsxFragment`
//! * 2607: `getJsxPropsTypeFromClassType`
//! * 2608: `getNameFromJsxElementAttributesContainer`
//!
//! All of TypeScript 7.0.2's grammarchecks.go, checker.go and jsx.go. Where a token is that the syntax tree does not keep (`!`, `?`,
//! `declare`, `type`, a bracket, a brace) is read off the text.

use super::errors::Diagnostic;
use super::errors_jsx::jsx_name_end;
use super::errors_small::has_parameter_list_error;
use super::*;
use crate::atom::Interner;
use crate::bind::{ClassOwner, Decl, MemberOwner, Parent};
use crate::resolve::JsxEmit;

impl Checker<'_> {
    pub(super) fn check_x_properties_jsx(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        // The text of the default library is not kept.
        if hir.text.is_empty() || hir.kind == FileKind::Json {
            return;
        }
        let index = self.exprs_by_kind(file);
        let bound = self.bound(file);
        let elements: Vec<(ExprId, JsxId)> = index
            .of(ExprTag::Jsx)
            .iter()
            .filter_map(|&e| match hir[e].kind {
                ExprKind::Jsx(j) if !matches!(bound.expr_parent[e.idx()], Parent::None) => {
                    Some((e, j))
                }
                _ => None,
            })
            .collect();
        // A declaration file has no JSX.
        if hir.kind != FileKind::Declaration {
            self.check_jsx_spread_children(file, &elements, out);
            self.check_jsx_fragment_factories(file, &elements, out);
            self.check_jsx_class_props_property(file, &elements, out);
            self.check_jsx_name_containers(file, out);
        }
        // `grammarErrorOnNode` and the like: nothing is said of the grammar of a file that does not parse.
        if has_parse_diagnostics(hir) {
            return;
        }
        self.check_grammar_of_property_declarations(file, out);
        self.check_grammar_of_method_names(file, out);
        self.check_grammar_of_ambient_or_definite_variables(file, out);
        self.check_grammar_of_object_literals(file, &index, out);
        self.check_declare_on_imports(file, out);
        self.check_type_modifier_in_type_only_clauses(file, out);
        self.check_commas_in_jsx_expressions(file, &elements, out);
        self.check_grammar_jsx_element(file, &elements, out);
        self.check_nullable_rest_elements(file, out);
    }

    // ───────────────────────────── properties ─────────────────────────────

    /// `checkPropertyDeclaration`, as far as grammar goes.
    fn check_grammar_of_property_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut said = Vec::new();
        for i in 0..hir.members.len() {
            let owner = bound.member_owner[i];
            if hir.members[i].kind != MemberKind::Property || owner == MemberOwner::None {
                continue;
            }
            let m = MemberId(i as u32);
            let name = start_of_member_name(hir, m);
            self.check_grammar_of_property(file, m, owner, name, &mut said);
            // `checkGrammarModifiers` comes first, and what it objects to is all that is said.
            if !said.is_empty() && !are_modifiers_refused(hir, bound, m, name, out) {
                out.append(&mut said);
            }
            said.clear();
        }
    }

    /// `checkGrammarProperty`. `name`: where the name starts.
    fn check_grammar_of_property(
        &mut self,
        file: FileId,
        m: MemberId,
        owner: MemberOwner,
        name: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let member = &hir[m];
        let text = &hir.text[..];
        // `[a in b]` was meant for a mapped type: 7061, which is said where those are looked at. `[(a in b)]` is a name like any other.
        if let PropKey::Computed(key) = member.key
            && matches!(hir[key].kind, ExprKind::Binary { op: BinOp::In, .. })
            && !is_all_in_parentheses(text, name)
        {
            return;
        }
        let is_dynamic = is_invalid_dynamic_name(hir, &self.files().atoms, member.key, name);
        match owner {
            MemberOwner::Class(_) => {
                if member.key == PropKey::Name(known::constructor)
                    && matches!(text.get(name as usize), Some(b'"' | b'\''))
                {
                    out.push(Diagnostic {
                        start: name,
                        code: 18006,
                    });
                    return;
                }
                if is_dynamic {
                    out.push(Diagnostic {
                        start: name,
                        code: 1166,
                    });
                    self.note(name, self.end_of_bracket_at(file, name), 1166, Vec::new());
                    return;
                }
                if member.flags.contains(Flags::ACCESSOR | Flags::OPTIONAL)
                    && let Some(start) = postfix_token(text, name, b'?')
                {
                    out.push(Diagnostic { start, code: 1276 });
                    return;
                }
            }
            MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_) => {
                let is_interface = matches!(owner, MemberOwner::Interface(_));
                if is_dynamic {
                    let code = if is_interface { 1169 } else { 1170 };
                    out.push(Diagnostic { start: name, code });
                    self.note(name, self.end_of_bracket_at(file, name), code, Vec::new());
                    return;
                }
                if member.init.is_some() {
                    let start = self.start_of_error_on_initializer(file, member.init, None);
                    let code = if is_interface { 1246 } else { 1247 };
                    out.push(Diagnostic { start, code });
                    let end = self.end_of_error_on_initializer(file, member.init, start);
                    self.note(start, end, code, Vec::new());
                    return;
                }
            }
            MemberOwner::None => return,
        }
        // `NodeFlagsAmbient` is on every node of a declaration file.
        let is_ambient = member.flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration;
        if is_ambient {
            self.check_initializer_in_ambient_context(
                file,
                member.init,
                member.ty.is_some(),
                member.flags.contains(Flags::READONLY),
                None,
                out,
            );
        }
        if matches!(owner, MemberOwner::Class(_)) && member.flags.contains(Flags::DEFINITE) {
            let code = if member.init.is_some() {
                1263
            } else if member.ty.is_none() {
                1264
            } else if is_ambient || member.flags.intersects(Flags::STATIC | Flags::ABSTRACT) {
                1255
            } else {
                return;
            };
            if let Some(start) = postfix_token(text, name, b'!') {
                out.push(Diagnostic { start, code });
            }
        }
    }

    /// `checkGrammarMethod`, of the name of a method: 1165 1168, 1169 1170.
    fn check_grammar_of_method_names(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.members.len() {
            let member = &hir.members[i];
            if member.kind != MemberKind::Method || member.func.is_none() {
                continue;
            }
            let func = &hir[member.func];
            let is_ambient =
                member.flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration;
            let has_body = !matches!(func.body, FnBody::None)
                || func
                    .flags
                    .intersects(Flags::BODY_DROPPED | Flags::MISSING_BODY);
            let code = match bound.member_owner[i] {
                MemberOwner::Class(_) if is_ambient => 1165,
                MemberOwner::Class(_) if !has_body => 1168,
                MemberOwner::Class(_) | MemberOwner::None => continue,
                MemberOwner::Interface(_) => 1169,
                MemberOwner::TypeLiteral(_) => 1170,
            };
            let m = MemberId(i as u32);
            let name = start_of_member_name(hir, m);
            if !is_invalid_dynamic_name(hir, &self.files().atoms, member.key, name) {
                continue;
            }
            // `checkGrammarFunctionLikeDeclaration` comes first, then `checkGrammarForGenerator`: 1221 1222.
            if are_modifiers_refused(hir, bound, m, name, out)
                || has_empty_type_parameter_list(hir, func)
                || has_parameter_list_error(hir, func)
                || matches!(code, 1165 | 1168) && func.flags.contains(Flags::GENERATOR)
            {
                continue;
            }
            out.push(Diagnostic { start: name, code });
            self.note(name, self.end_of_bracket_at(file, name), code, Vec::new());
        }
    }

    // ───────────────────────────── what is ambient ─────────────────────────────

    /// `checkAmbientInitializer`. `name`: where the variable is named, if it is one that goes by a plain name.
    fn check_initializer_in_ambient_context(
        &mut self,
        file: FileId,
        init: ExprId,
        has_type: bool,
        is_const_or_readonly: bool,
        name: Option<u32>,
        out: &mut Vec<Diagnostic>,
    ) {
        if init.is_none() {
            return;
        }
        let start = self.start_of_error_on_initializer(file, init, name);
        if !is_const_or_readonly || has_type {
            out.push(Diagnostic { start, code: 1039 });
            let end = self.end_of_error_on_initializer(file, init, start);
            self.note(start, end, 1039, Vec::new());
            return;
        }
        let written = self.start_of(file, init);
        let in_parentheses = before_parentheses(&self.hir(file).text, written) != written;
        if self.is_literal_or_enum_reference(file, init, in_parentheses) == Some(false) {
            out.push(Diagnostic { start, code: 1254 });
            let end = self.end_of_error_on_initializer(file, init, start);
            self.note(start, end, 1254, Vec::new());
        }
    }

    /// What `checkAmbientInitializer` calls `isInvalidInitializer`, the other way round. `None`: it cannot be told.
    /// `in_parentheses`: it starts with parentheses that the syntax tree has no record of.
    fn is_literal_or_enum_reference(
        &mut self,
        file: FileId,
        e: ExprId,
        in_parentheses: bool,
    ) -> Option<bool> {
        let hir = self.hir(file);
        if is_parenthesized(hir, e) {
            return Some(false);
        }
        match hir[e].kind {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False => Some(!in_parentheses),
            ExprKind::Template { exprs, .. } => Some(exprs.is_empty() && !in_parentheses),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => Some(
                !in_parentheses
                    && matches!(hir[operand].kind, ExprKind::Number(_) | ExprKind::BigInt(_))
                    && !is_leaf_in_parentheses(hir, operand),
            ),
            // `isInitializerSimpleLiteralEnumReference`
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                if let ExprKind::Index { obj, index, .. } = hir[e].kind
                    && !(is_string_or_number_literal_expression(hir, index)
                        && is_entity_name_expression(hir, &self.files().atoms, obj))
                {
                    return Some(false);
                }
                // An access that starts with such parentheses is said to be where they open, one that is all in them where it starts
                // itself. `(a).b` is as good as `a.b`, and `(a)` no entity name.
                if in_parentheses
                    && (matches!(hir[e].kind, ExprKind::Index { .. })
                        || before_parentheses(&hir.text, hir[e].pos) != hir[e].pos)
                {
                    return Some(false);
                }
                let ty = self.type_of_expr(file, e);
                if !self.is_known(ty) || self.is_uncertain(file, e) {
                    return None;
                }
                Some(is_enum_like(self, ty))
            }
            _ => Some(false),
        }
    }

    /// `GetErrorRangeForNode`, of an initializer: where an error about the whole of `e` starts. `name`: where the variable it
    /// is the value of is named, if by a plain name (`GetAssignedName`).
    fn start_of_error_on_initializer(&self, file: FileId, e: ExprId, name: Option<u32>) -> u32 {
        let hir = self.hir(file);
        if !is_parenthesized(hir, e) {
            match hir[e].kind {
                ExprKind::Fn(f) if hir[f].kind == FnKind::Expr => {
                    if hir[f].name.is_some() {
                        return hir[f].name_pos;
                    }
                    if let Some(name) = name {
                        return name;
                    }
                }
                ExprKind::Class(c) if hir[c].name.is_some() => return hir[c].name_pos,
                // The keyword.
                ExprKind::Satisfies { ty, .. } => {
                    let before = trim_trivia_end(upto(
                        &hir.text,
                        before_parentheses(&hir.text, hir[ty].pos),
                    ));
                    if ends_with_word(before, b"satisfies") {
                        return before.len() as u32 - 9;
                    }
                }
                _ => {}
            }
        }
        before_parentheses(&hir.text, self.start_of(file, e))
    }

    /// Where the error about `e` that `start_of_error_on_initializer` puts at `start` ends.
    fn end_of_error_on_initializer(&self, file: FileId, e: ExprId, start: u32) -> u32 {
        if start == self.error_start_of(file, e) {
            self.error_end_of(file, e)
        } else {
            self.end_of_expr_from(file, e, start)
        }
    }

    /// `checkGrammarVariableDeclaration`, of the variables that are ambient or say `!`: 1039 1254, 1263 1264 1255.
    fn check_grammar_of_ambient_or_definite_variables(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `NodeFlagsAmbient` is on every node of a declaration file.
        let is_declaration_file = hir.kind == FileKind::Declaration;
        for i in 0..hir.var_decls.len() {
            let d = &hir.var_decls[i];
            let statement = bound.var_stmt[i];
            if !(is_declaration_file || d.flags.intersects(Flags::AMBIENT | Flags::DEFINITE))
                || statement.is_none()
                || !matches!(hir[statement].kind, StmtKind::Var(_))
            {
                continue;
            }
            let name = match hir[d.pat].kind {
                PatKind::Ident(_) => Some(hir[d.pat].pos),
                _ => None,
            };
            // 1492 is said, and that is all.
            if name.is_none() && matches!(d.kind, VarKind::Using | VarKind::AwaitUsing) {
                continue;
            }
            let is_const_like = matches!(
                d.kind,
                VarKind::Const | VarKind::Using | VarKind::AwaitUsing
            );
            let around = match bound.stmt_parent[statement.idx()] {
                Parent::Stmt(s) if s.is_some() => Some(hir[s].kind),
                _ => None,
            };
            let is_in_loop_head = matches!(around, Some(StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) if left == statement);
            let is_ambient = is_declaration_file || d.flags.contains(Flags::AMBIENT);
            if !is_in_loop_head {
                if is_ambient {
                    self.check_initializer_in_ambient_context(
                        file,
                        d.init,
                        d.ty.is_some(),
                        is_const_like,
                        name,
                        out,
                    );
                } else if d.init.is_none() && (name.is_none() || is_const_like) {
                    // 1182 or 1155 is said, and that is all.
                    continue;
                }
            }
            if !d.flags.contains(Flags::DEFINITE) {
                continue;
            }
            let is_variable_statement = !is_in_loop_head
                && !matches!(around, Some(StmtKind::For { init, .. }) if init == statement);
            let code = if d.init.is_some() {
                1263
            } else if d.ty.is_none() {
                1264
            } else if is_ambient || !is_variable_statement {
                1255
            } else {
                continue;
            };
            if let Some(name) = name
                && let Some(start) = postfix_token(&hir.text, name, b'!')
            {
                out.push(Diagnostic { start, code });
            }
        }
    }

    // ───────────────────────────── object literals ─────────────────────────────

    /// `checkGrammarObjectLiteralExpression` is part of `checkObjectLiteral`: it is said of the object literals that are looked at as
    /// expressions. One that is assigned to is taken apart instead (`checkDestructuringAssignment`), and only looked at as an
    /// expression if somebody asks for its type.
    fn check_grammar_of_object_literals(
        &mut self,
        file: FileId,
        index: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_part_of_the_file = |e: ExprId| !matches!(bound.expr_parent[e.idx()], Parent::None);
        for &e in index.of(ExprTag::Object) {
            if is_part_of_the_file(e) && !is_assignment_target(hir, bound, e) {
                self.check_grammar_of_object_literal(file, e, false, out);
            }
        }
        // `checkBinaryLikeExpression`
        for &e in index.of(ExprTag::Assign) {
            let ExprKind::Assign { op, target, value } = hir[e].kind else {
                continue;
            };
            if !is_part_of_the_file(e) {
                continue;
            }
            let is_pattern = op.is_none()
                && !is_parenthesized(hir, target)
                && matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_));
            if !is_pattern {
                self.check_assignment_target_as_expression(file, target, out);
                continue;
            }
            self.check_assignment_pattern(file, target, out);
            // `getContextualTypeForAssignmentExpression`: what is assigned is expected to be what the target is.
            if self.asks_for_its_contextual_type(file, value) {
                self.check_assignment_target_as_expression(file, target, out);
            }
        }
        for &e in index.of(ExprTag::Unary) {
            if let ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } = hir[e].kind
                && is_part_of_the_file(e)
            {
                self.check_assignment_target_as_expression(file, operand, out);
            }
        }
        // `checkForInStatement`, `checkForOfStatement`
        for (i, s) in hir.stmts.iter().enumerate() {
            let (left, is_for_in) = match s.kind {
                StmtKind::ForIn { left, .. } => (left, true),
                StmtKind::ForOf { left, .. } => (left, false),
                _ => continue,
            };
            let StmtKind::Expr(target) = hir[left].kind else {
                continue;
            };
            if matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            if is_for_in {
                self.check_assignment_target_as_expression(file, target, out);
            } else {
                self.check_assignment_pattern(file, target, out);
            }
        }
    }

    /// `checkExpression`, of (part of) what is assigned to: the object literals it gets to.
    fn check_assignment_target_as_expression(
        &self,
        file: FileId,
        e: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Object(props) => {
                self.check_grammar_of_object_literal(file, e, true, out);
                for p in props.iter() {
                    if matches!(hir[p].kind, PropKind::Init | PropKind::Spread)
                        && hir[p].value.is_some()
                    {
                        self.check_assignment_target_as_expression(file, hir[p].value, out);
                    }
                }
            }
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    self.check_assignment_target_as_expression(file, item, out);
                }
            }
            ExprKind::Spread(x) | ExprKind::NonNull(x) => {
                self.check_assignment_target_as_expression(file, x, out)
            }
            // An assignment in there is one of its own.
            _ => {}
        }
    }

    /// `checkDestructuringAssignment`: a literal is taken apart, and anything else, a literal in parentheses too, is an expression
    /// (`checkReferenceAssignment`).
    fn check_assignment_pattern(&self, file: FileId, e: ExprId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if is_parenthesized(hir, e) {
            return self.check_assignment_target_as_expression(file, e, out);
        }
        match hir[e].kind {
            // With a default: an assignment of its own.
            ExprKind::Assign { op: None, .. } => {}
            ExprKind::Object(props) => {
                for (i, p) in props.iter().enumerate() {
                    // A rest that is not the last is refused, and not gone into.
                    let goes_on = match hir[p].kind {
                        PropKind::Init => true,
                        PropKind::Spread => i + 1 == props.len(),
                        _ => false,
                    };
                    if goes_on && hir[p].value.is_some() {
                        self.check_assignment_pattern(file, hir[p].value, out);
                    }
                }
            }
            ExprKind::Array(items) => {
                for (i, item) in hir.ids(items).enumerate() {
                    match hir[item].kind {
                        ExprKind::Missing => {}
                        ExprKind::Spread(rest) => {
                            let has_default =
                                matches!(hir[rest].kind, ExprKind::Assign { op: None, .. })
                                    && !is_parenthesized(hir, rest);
                            if i + 1 == items.len() && !has_default {
                                self.check_assignment_pattern(file, rest, out);
                            }
                        }
                        _ => self.check_assignment_pattern(file, item, out),
                    }
                }
            }
            _ => self.check_assignment_target_as_expression(file, e, out),
        }
    }

    /// Whether working out the type of `e` asks what `e` is expected to be (`getContextualType`), by itself or on behalf of a part
    /// that is expected to be what the whole is. Left out: `yield`, a name whose type is generic with a union for a constraint
    /// (`hasContextualTypeWithNoGenericTypes`), and calls of what is overloaded, where it depends on which signatures are tried.
    fn asks_for_its_contextual_type(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) => true,
            ExprKind::Template { exprs, .. } => !exprs.is_empty(),
            ExprKind::Cond { yes, no, .. } => {
                self.asks_for_its_contextual_type(file, yes)
                    || self.asks_for_its_contextual_type(file, no)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.asks_for_its_contextual_type(file, left)
                    || self.asks_for_its_contextual_type(file, right)
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Comma,
                right,
                ..
            } => self.asks_for_its_contextual_type(file, right),
            ExprKind::NonNull(x) | ExprKind::Await(x) | ExprKind::AsConst(x) => {
                self.asks_for_its_contextual_type(file, x)
            }
            // `inferTypeArguments`: what is expected of the result says something about the type arguments.
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c)
                if hir[c].type_args.is_empty() =>
            {
                let callee = self.type_of_expr(file, hir[c].callee);
                let sigs = self.signatures(callee, matches!(hir[e].kind, ExprKind::New(_)));
                let [only] = sigs[..] else { return false };
                !self.sig_type_params(only).is_empty()
            }
            _ => false,
        }
    }

    /// `checkGrammarObjectLiteralExpression`: 2501 1312 18016, and 1255 1162, which `checkGrammarMethod` says of methods. Left out: nothing
    /// more is said of a method that `checkGrammarFunctionLikeDeclaration` objects to.
    fn check_grammar_of_object_literal(
        &self,
        file: FileId,
        e: ExprId,
        in_destructuring: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let text = &hir.text[..];
        let ExprKind::Object(props) = hir[e].kind else {
            return;
        };
        for (i, p) in props.iter().enumerate() {
            let prop = &hir[p];
            // 1312 at the `=` of `{ a = 1 }`, which only a destructuring assignment can have.
            let equals = if !in_destructuring
                && prop.kind == PropKind::Shorthand
                && prop.value.is_some()
                && matches!(hir[prop.value].kind, ExprKind::Assign { op: None, .. })
            {
                equals_token_after_name(text, prop.pos)
            } else {
                None
            };
            // 18016. Outside a class the key of `#a` is `PropKey::None`.
            let has_private_name =
                prop.kind != PropKind::Spread && text.get(prop.pos as usize) == Some(&b'#');
            // 1118 or 1119 for an earlier property ends the check.
            if (equals.is_some() || has_private_name)
                && (in_destructuring || !has_clashing_names(hir, props.iter().take(i)))
            {
                if let Some(start) = equals {
                    out.push(Diagnostic { start, code: 1312 });
                }
                if has_private_name {
                    out.push(Diagnostic {
                        start: prop.pos,
                        code: 18016,
                    });
                }
            }
            match prop.kind {
                // A rest property cannot be destructured any further.
                PropKind::Spread => {
                    if in_destructuring
                        && prop.value.is_some()
                        && matches!(
                            hir[prop.value].kind,
                            ExprKind::Array(_) | ExprKind::Object(_)
                        )
                    {
                        let start = self.start_of(file, prop.value);
                        out.push(Diagnostic { start, code: 2501 });
                        self.note(start, self.end_of_expr(file, prop.value), 2501, Vec::new());
                        return;
                    }
                }
                PropKind::Init | PropKind::Shorthand | PropKind::Method => {
                    if !matches!(prop.key, PropKey::Name(_))
                        && text.get(prop.pos as usize) != Some(&b'[')
                    {
                        continue;
                    }
                    let Some(end) = end_of_name(text, prop.pos as usize) else {
                        continue;
                    };
                    let at = skip_trivia(text, end);
                    let code = match text.get(at) {
                        Some(b'!') => 1255,
                        Some(b'?') => 1162,
                        _ => continue,
                    };
                    let is_said = if prop.kind == PropKind::Method {
                        // 1184 of any modifiers but a lone `async`, and that is all.
                        has_no_modifier_but_async(text, prop.pos)
                    } else {
                        // 1118 or 1119 of a property before this one, and the rest is not looked at.
                        in_destructuring || !has_clashing_names(hir, props.iter().take(i))
                    };
                    if is_said {
                        out.push(Diagnostic {
                            start: at as u32,
                            code,
                        });
                    }
                }
                PropKind::Getter | PropKind::Setter => {}
            }
        }
    }

    // ───────────────────────────── imports and exports ─────────────────────────────

    /// The end of `checkGrammarModifiers`, of an import: 1079.
    fn check_declare_on_imports(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.imports.is_empty() && hir.import_equals.is_empty() {
            return;
        }
        let text = &hir.text[..];
        for (i, s) in hir.stmts.iter().enumerate() {
            if !matches!(s.kind, StmtKind::Import(_) | StmtKind::ImportEquals(_)) {
                continue;
            }
            // `checkGrammarModuleElementContext`: anywhere else it is out of place, and that is all that is said.
            let in_ambient_block = match bound.stmt_parent[i] {
                Parent::File => false,
                Parent::Module(m) => hir[m].flags.contains(Flags::AMBIENT),
                _ => continue,
            };
            // The statement may be said to start after its modifiers. A modifier is on the line of what follows it.
            let mut first = (s.pos as usize).min(text.len());
            let line = text[..first]
                .iter()
                .rposition(|&c| c == b'\n')
                .map_or(0, |i| i + 1);
            loop {
                let before = trim_trivia_end(&text[line..first]);
                let length = if ends_with_word(before, b"declare") {
                    7
                } else if ends_with_word(before, b"export") {
                    6
                } else {
                    break;
                };
                first = line + before.len() - length;
            }
            let (mut at, mut has_export, mut last_declare) = (first, false, None);
            let is_refused = loop {
                at = skip_trivia(text, at);
                if starts_with_word(text, at, b"export") {
                    // 1030, 1029
                    if has_export || last_declare.is_some() {
                        break true;
                    }
                    has_export = true;
                    at += 6;
                } else if starts_with_word(text, at, b"declare") {
                    // 1030, 1038
                    if last_declare.is_some() || in_ambient_block {
                        break true;
                    }
                    last_declare = Some(at as u32);
                    at += 7;
                } else {
                    break false;
                }
            };
            if let (false, Some(start)) = (is_refused, last_declare) {
                out.push(Diagnostic { start, code: 1079 });
            }
        }
    }

    /// `checkGrammarTypeOnlyNamedImportsOrExports`: `type` on the statement and again on a name in it. Said of the first.
    fn check_type_modifier_in_type_only_clauses(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.import_specs.iter().any(|s| s.type_only)
            && !hir.export_specs.iter().any(|s| s.type_only)
        {
            return;
        }
        for (i, s) in hir.stmts.iter().enumerate() {
            let (first_name, code) = match s.kind {
                // `checkGrammarModuleElementContext`
                StmtKind::ExportNamed(x)
                    if hir[x].type_only
                        && matches!(bound.stmt_parent[i], Parent::File | Parent::Module(_)) =>
                {
                    (
                        hir[x]
                            .items
                            .iter()
                            .find(|&item| hir[item].type_only)
                            .map(|item| hir[item].local_pos),
                        2207,
                    )
                }
                // With a default import as well it is 1363. In a namespace other things are said first.
                StmtKind::Import(x)
                    if hir[x].type_only
                        && hir[x].default.is_none()
                        && matches!(bound.stmt_parent[i], Parent::File) =>
                {
                    (
                        hir[x]
                            .named
                            .iter()
                            .find(|&item| hir[item].type_only)
                            .map(|item| hir[item].imported_pos),
                        2206,
                    )
                }
                _ => continue,
            };
            let Some(first_name) = first_name else {
                continue;
            };
            let before = trim_trivia_end(upto(&hir.text, first_name));
            if ends_with_word(before, b"type") {
                out.push(Diagnostic {
                    start: before.len() as u32 - 4,
                    code,
                });
            }
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// `checkJSDocTypeIsInJsFile`, where the syntax tree keeps a `?` after a type that makes nothing optional: `[...T?]`.
    fn check_nullable_rest_elements(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, node) in hir.types.iter().enumerate() {
            let TypeNodeKind::Tuple(elems) = node.kind else {
                continue;
            };
            if bound.type_scope[i].is_none() {
                continue;
            }
            for elem in elems.iter() {
                let elem = &hir[elem];
                if !(elem.rest && elem.optional && elem.name.is_none() && elem.ty.is_some()) {
                    continue;
                }
                // In `A | B?`, `keyof T?` and the like the `?` goes with the last operand only.
                if !matches!(
                    hir[elem.ty].kind,
                    TypeNodeKind::Keyword(_)
                        | TypeNodeKind::Ref { .. }
                        | TypeNodeKind::StringLit(_)
                        | TypeNodeKind::NumberLit(_)
                        | TypeNodeKind::BigIntLit { .. }
                        | TypeNodeKind::BoolLit(_)
                        | TypeNodeKind::Template { .. }
                        | TypeNodeKind::Array(_)
                        | TypeNodeKind::Tuple(_)
                        | TypeNodeKind::Object(_)
                        | TypeNodeKind::Mapped(_)
                        | TypeNodeKind::IndexedAccess { .. }
                        | TypeNodeKind::Typeof { .. }
                        | TypeNodeKind::Import { .. }
                ) {
                    continue;
                }
                let start = before_parentheses(&hir.text, hir[elem.ty].pos);
                if trim_trivia_end(upto(&hir.text, start)).ends_with(b"...") {
                    out.push(Diagnostic { start, code: 17019 });
                    let ty = elem.ty;
                    let end_of_type = self.end_of_type_node_from(file, ty, start);
                    let question = skip_trivia(&hir.text, end_of_type as usize);
                    let end = if hir.text.get(question) == Some(&b'?') {
                        question as u32 + 1
                    } else {
                        0
                    };
                    self.explain_to(start, end, 17019, |c| {
                        // `getNullableType`
                        let mut meant = c.type_from_node(file, ty);
                        if meant != TypeId::NEVER && meant != TypeId::VOID {
                            meant = c.union(&[meant, TypeId::UNDEFINED]);
                        }
                        vec!["?".to_owned(), c.type_to_string(meant)]
                    });
                }
            }
        }
    }

    // ───────────────────────────── JSX ─────────────────────────────

    /// `checkGrammarJsxElement`: 2639 for the tag name, then 17001 for a repeated attribute name or 17000 for `name={}`. The attribute
    /// loop stops at its first error. The call to `checkGrammarTypeArguments` is not ported here.
    fn check_grammar_jsx_element(
        &self,
        file: FileId,
        elements: &[(ExprId, JsxId)],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        // `GetJSXTransformEnabled`
        let is_transform_enabled = matches!(
            self.p.files.options.jsx,
            JsxEmit::React | JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
        );
        let mut seen: Vec<PropKey> = Vec::new();
        for &(_, j) in elements {
            let jsx = &hir[j];
            // A fragment is not an opening-like element.
            if jsx.tag.is_none() {
                continue;
            }
            // `checkGrammarJsxName`: a namespaced name `a:b` is lowered to a string. `IsIntrinsicJsxName` tests the namespace.
            if is_transform_enabled && let ExprKind::String(name) = hir[jsx.tag].kind {
                let name = self.files().atoms.bytes(name);
                if let Some(colon) = name.iter().position(|&c| c == b':')
                    && !(name[0].is_ascii_lowercase() || name[..colon].contains(&b'-'))
                {
                    let start = hir[jsx.tag].pos;
                    out.push(Diagnostic { start, code: 2639 });
                    self.note(start, jsx_name_end(&hir.text, start), 2639, Vec::new());
                }
            }
            seen.clear();
            for p in jsx.attrs.iter() {
                let attr = &hir[p];
                if attr.kind == PropKind::Spread {
                    continue;
                }
                if seen.contains(&attr.key) {
                    out.push(Diagnostic {
                        start: attr.pos,
                        code: 17001,
                    });
                    self.note(
                        attr.pos,
                        self.end_of_jsx_attr_name(file, p),
                        17001,
                        Vec::new(),
                    );
                    break;
                }
                seen.push(attr.key);
                // The parser places the `Missing` of `name={}` at the `{`.
                if attr.value.is_some() && matches!(hir[attr.value].kind, ExprKind::Missing) {
                    let start = hir[attr.value].pos;
                    out.push(Diagnostic { start, code: 17000 });
                    self.note(
                        start,
                        self.end_of_bracket_at(file, start),
                        17000,
                        Vec::new(),
                    );
                    break;
                }
            }
        }
    }

    /// `checkGrammarJsxExpression`: 18007, of what is written in braces as the value of an attribute or as a child.
    fn check_commas_in_jsx_expressions(
        &self,
        file: FileId,
        elements: &[(ExprId, JsxId)],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut check = |x: ExprId| {
            if x.is_some()
                && matches!(
                    hir[x].kind,
                    ExprKind::Binary {
                        op: BinOp::Comma,
                        ..
                    }
                )
                && !is_parenthesized(hir, x)
            {
                let start = self.start_of(file, x);
                out.push(Diagnostic { start, code: 18007 });
                self.note(start, self.end_of_expr(file, x), 18007, Vec::new());
            }
        };
        for &(_, j) in elements {
            for p in hir[j].attrs.iter() {
                if hir[p].kind != PropKind::Spread {
                    check(hir[p].value);
                }
            }
            for child in hir.ids(hir[j].children) {
                check(match hir[child].kind {
                    ExprKind::Spread(x) => x,
                    _ => child,
                });
            }
        }
    }

    /// `checkJsxExpression`: 2609, a spread child must have an array type. A tuple type is not one. `t != c.anyType`: the error type
    /// is reported too.
    fn check_jsx_spread_children(
        &mut self,
        file: FileId,
        elements: &[(ExprId, JsxId)],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        for &(_, j) in elements {
            for child in hir.ids(hir[j].children) {
                let ExprKind::Spread(spread) = hir[child].kind else {
                    continue;
                };
                let ty = self.type_of_expr(file, spread);
                if !self.is_known(ty)
                    || self.is_uncertain(file, spread)
                    || ty == TypeId::ANY
                    || self.is_array(ty)
                {
                    continue;
                }
                // The error span is the whole `{...e}`.
                let before = trim_trivia_end(upto(&hir.text, self.start_of(file, spread)));
                let Some(before) = before.strip_suffix(b"...") else {
                    continue;
                };
                let before = trim_trivia_end(before);
                if before.ends_with(b"{") {
                    let start = before.len() as u32 - 1;
                    out.push(Diagnostic { start, code: 2609 });
                    self.note(start, self.end_of_bracket_at(file, start), 2609, Vec::new());
                }
            }
        }
    }

    /// `checkJsxFragment`: 17016 17017, whoever says what makes elements has to say what makes fragments.
    fn check_jsx_fragment_factories(
        &self,
        file: FileId,
        elements: &[(ExprId, JsxId)],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let options = &self.p.files.options;
        if !elements.iter().any(|&(_, j)| hir[j].tag.is_none()) {
            return;
        }
        // `GetJSXTransformEnabled`
        if !matches!(
            options.jsx,
            JsxEmit::React | JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
        ) || !options.jsx_fragment_factory.is_empty()
            || options.jsx_factory.is_empty() && !has_pragma(&hir.text, b"jsx")
            || has_pragma(&hir.text, b"jsxfrag")
        {
            return;
        }
        let code = if options.jsx_factory.is_empty() {
            17017
        } else {
            17016
        };
        for &(e, j) in elements {
            if hir[j].tag.is_none() {
                out.push(Diagnostic {
                    start: hir[e].pos,
                    code,
                });
                self.note(
                    hir[e].pos,
                    self.end_inside_parentheses(file, e),
                    code,
                    Vec::new(),
                );
            }
        }
    }

    /// `getJsxPropsTypeFromClassType`: 2607, `JSX.ElementAttributesProperty` names the property of an instance that says what the
    /// attributes are, and the instances of the component have no such property. It is said of each signature that is tried: here
    /// of the first, which always is.
    fn check_jsx_class_props_property(
        &mut self,
        file: FileId,
        elements: &[(ExprId, JsxId)],
        out: &mut Vec<Diagnostic>,
    ) {
        if elements.is_empty() {
            return;
        }
        let hir = self.hir(file);
        // `getJsxElementPropertiesName`
        let Some(container) = self.jsx_type(file, known::ElementAttributesProperty) else {
            return;
        };
        let Some(members) = self.members(container) else {
            return;
        };
        let [only] = &members.shape().props[..] else {
            return;
        };
        let name = only.name;
        for &(e, j) in elements {
            let jsx = &hir[j];
            if jsx.tag.is_none()
                || jsx.attrs.is_empty()
                || matches!(hir[jsx.tag].kind, ExprKind::String(_))
            {
                continue;
            }
            let component = self.type_of_expr(file, jsx.tag);
            if !self.is_known(component)
                || self.is_any(component)
                || self.is_union(component)
                || self.is_uncertain(file, jsx.tag)
            {
                continue;
            }
            // `getJsxReferenceKind`
            let (sigs, construct) = self.jsx_signatures(component);
            if !construct {
                continue;
            }
            let candidates = self.reorder_candidates(&sigs);
            let Some(&first) = candidates.first() else {
                continue;
            };
            let instance = self.sig_return(first);
            if self.instance_lacks_property(instance, name) == Some(true) {
                out.push(Diagnostic {
                    start: hir[e].pos,
                    code: 2607,
                });
                let end = self.end_of_jsx_opening(file, e, j);
                self.explain_to(hir[e].pos, end, 2607, |c| vec![c.atom_text(name)]);
            }
        }
    }

    /// Whether `getTypeOfPropertyOfType(ty, name)` finds nothing. An index signature is no property. `None`: it cannot be told.
    fn instance_lacks_property(&mut self, ty: TypeId, name: Atom) -> Option<bool> {
        let ty = self.force(ty);
        if !self.is_known(ty) {
            return None;
        }
        if self.is_any(ty) {
            return Some(false);
        }
        let ty = self.reduced(ty);
        let apparent = self.apparent_type(ty);
        if !self.is_known(apparent) {
            return None;
        }
        if self.is_any(apparent) {
            return Some(false);
        }
        // `createUnionOrIntersectionProperty`: whether the union has what only some of them have depends on what the others are.
        if let TypeData::Union(parts) = self.data(apparent) {
            let (mut has, mut lacks) = (false, false);
            for &part in parts.iter() {
                if self.instance_lacks_property(part, name)? {
                    lacks = true;
                } else {
                    has = true;
                }
            }
            return if has && lacks { None } else { Some(lacks) };
        }
        if !self.is_all_it_inherits_known(apparent, 0) {
            return None;
        }
        match self.members(apparent) {
            Some(members) => Some(self.property_of_type(&members, name).is_none()),
            None => Some(true),
        }
    }

    /// Whether everything `ty` extends could be found out, so that what is not among its members is not there. To extend `any`
    /// adds no property.
    fn is_all_it_inherits_known(&mut self, ty: TypeId, depth: u32) -> bool {
        match self.data(ty) {
            TypeData::Ref { target, .. } => {
                let target = *target;
                if depth > 16 {
                    return false;
                }
                for (file, decl) in self.files().decls(target) {
                    let hir = self.hir(file);
                    match decl {
                        Decl::Class(c) if hir[c].extends.is_some() => {
                            let base = self.type_of_expr(file, hir[c].extends);
                            if !self.is_known(base)
                                || !self.has_any_flag(base) && self.base_types(target).is_empty()
                            {
                                return false;
                            }
                        }
                        Decl::Interface(i) => {
                            for node in hir.ids(hir[i].extends) {
                                let base = self.type_from_node(file, node);
                                if !self.is_known(base) {
                                    return false;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                let bases = self.base_types(target);
                bases
                    .iter()
                    .all(|&base| self.is_all_it_inherits_known(base, depth + 1))
            }
            TypeData::Intersection(parts) => parts
                .iter()
                .all(|&part| self.is_all_it_inherits_known(part, depth + 1)),
            _ => true,
        }
    }

    /// `getNameFromJsxElementAttributesContainer`: 2608, `JSX.ElementAttributesProperty` and `JSX.ElementChildrenAttribute` name one
    /// property each. It is said where the first declaration is, once an element somewhere has the name looked up.
    fn check_jsx_name_containers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        for container in [
            known::ElementAttributesProperty,
            known::ElementChildrenAttribute,
        ] {
            let is_declared_here = hir.interfaces.iter().any(|i| i.name == container)
                || hir.aliases.iter().any(|a| a.name == container)
                || hir.classes.iter().any(|c| c.name == container);
            if !is_declared_here {
                continue;
            }
            for user in (0..self.files().modules.len() as u32).map(FileId) {
                if self.hir(user).jsx.is_empty() {
                    continue;
                }
                let Some(start) = self.overfull_jsx_container(file, user, container) else {
                    continue;
                };
                if self.looks_up_jsx_container(user, container) {
                    out.push(Diagnostic { start, code: 2608 });
                    break;
                }
            }
        }
    }

    /// Where `JSX.<container>`, as the file `user` sees it, is first declared, if that is in `file` and it has several properties.
    fn overfull_jsx_container(
        &mut self,
        file: FileId,
        user: FileId,
        container: Atom,
    ) -> Option<u32> {
        let namespace = self.jsx_namespace(user)?;
        let symbol = self.files().namespace_member(namespace, container)?;
        if !self.files().flags(symbol).intersects(SymFlags::TYPE) {
            return None;
        }
        let (declared_in, decl) = self.files().decls(symbol).first().copied()?;
        if declared_in != file {
            return None;
        }
        let hir = self.hir(file);
        let start = match decl {
            Decl::Interface(i) => hir[i].name_pos,
            Decl::Alias(a) => hir[a].name_pos,
            Decl::Class(c) => hir[c].name_pos,
            _ => return None,
        };
        let ty = self.declared_type(symbol);
        (self.members(ty)?.shape().props.len() > 1).then_some(start)
    }

    /// Whether an element in `user` has the name in `JSX.<container>` looked up: `createJsxAttributesTypeFromAttributesProperty` wants
    /// that of the children for every element, `getJsxPropsTypeFromClassType` that of the attributes for a component that is
    /// made with `new`. Left out: a fragment, which has the name of the children looked up too if what makes fragments
    /// (`getJSXFragmentType`) can be called.
    fn looks_up_jsx_container(&mut self, user: FileId, container: Atom) -> bool {
        let (hir, bound) = (self.hir(user), self.bound(user));
        let of_children = container == known::ElementChildrenAttribute;
        // `getJsxElementChildrenPropertyName`: it is `children` then, whatever is declared.
        if of_children
            && matches!(
                self.p.files.options.jsx,
                JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
            )
        {
            return false;
        }
        for (_, j) in jsx_elements(hir, bound) {
            let tag = hir[j].tag;
            if tag.is_none() {
                continue;
            }
            if of_children {
                return true;
            }
            if matches!(hir[tag].kind, ExprKind::String(_)) {
                continue;
            }
            let component = self.type_of_expr(user, tag);
            if self.is_known(component)
                && !self.is_any(component)
                && self.jsx_signatures(component).1
            {
                return true;
            }
        }
        false
    }
}

// ───────────────────────────── the syntax tree ─────────────────────────────

/// `hasParseDiagnostics`. What the parser objected to and went on from is kept with what tsgo's binder and checker say of syntax.
/// They are told apart by the code: these are the ones only parser.go and scanner.go give, and 1003 and 1005, which are only ever
/// noted for what the parser expected and did not find. Where type syntax was given up on it cannot be told.
fn has_parse_diagnostics(hir: &File) -> bool {
    hir.has_parse_diagnostics
        || hir.has_errors
        || hir.syntax_errors > 0
        || hir.early_errors.iter().any(|&(_, code)| {
            matches!(
                code,
                1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1084 | 1109 | 1121 | 1124..=1132 | 1134 | 1135 | 1137..=1140
                    | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1209 | 1260 | 1351..=1353 | 1357 | 1381 | 1382
                    | 1385..=1390 | 1434..=1443 | 1472 | 1477 | 1478 | 1487..=1490 | 2754 | 2809 | 2819 | 6188 | 6189 | 17002
                    | 17006..=17008 | 17014 | 17015 | 17021 | 18009 | 18026 | 18029 | 18030
            )
        })
}

/// The JSX elements and fragments that are part of the file.
fn jsx_elements(hir: &File, bound: &Bound) -> Vec<(ExprId, JsxId)> {
    if hir.jsx.is_empty() {
        return Vec::new();
    }
    (0..hir.exprs.len())
        .filter_map(|i| match hir.exprs[i].kind {
            ExprKind::Jsx(j) if !matches!(bound.expr_parent[i], Parent::None) => {
                Some((ExprId(i as u32), j))
            }
            _ => None,
        })
        .collect()
}

/// Whether `e` is written in parentheses, as far as the syntax tree keeps track.
fn is_parenthesized(hir: &File, e: ExprId) -> bool {
    hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok()
}

/// The same of a literal that is the operand of a sign or is written in brackets: a `(` right before it can be nothing but its own.
fn is_leaf_in_parentheses(hir: &File, e: ExprId) -> bool {
    is_parenthesized(hir, e) || trim_trivia_end(upto(&hir.text, hir[e].pos)).ends_with(b"(")
}

/// `IsStringOrNumericLiteralLike`
fn is_string_or_numeric_literal_like(hir: &File, e: ExprId) -> bool {
    match hir[e].kind {
        ExprKind::String(_) | ExprKind::Number(_) => true,
        ExprKind::Template { exprs, .. } => exprs.is_empty(),
        _ => false,
    }
}

/// `IsSignedNumericLiteral`
fn is_signed_numeric_literal(hir: &File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Unary { op: UnOp::Plus | UnOp::Minus, operand }
        if matches!(hir[operand].kind, ExprKind::Number(_)) && !is_leaf_in_parentheses(hir, operand))
}

/// `isInitializerStringOrNumberLiteralExpression`, of what is written in brackets.
fn is_string_or_number_literal_expression(hir: &File, e: ExprId) -> bool {
    !is_leaf_in_parentheses(hir, e)
        && (is_string_or_numeric_literal_like(hir, e)
            || matches!(hir[e].kind, ExprKind::Unary { op: UnOp::Minus, operand }
                if matches!(hir[operand].kind, ExprKind::Number(_)) && !is_leaf_in_parentheses(hir, operand)))
}

/// `IsEntityNameExpression`: `a`, `a.b.c`.
fn is_entity_name_expression(hir: &File, atoms: &Interner, mut e: ExprId) -> bool {
    loop {
        if is_parenthesized(hir, e) {
            return false;
        }
        match hir[e].kind {
            ExprKind::Ident(_) => return true,
            ExprKind::Dot { obj, name, .. } if !atoms.bytes(name).starts_with(b"#") => e = obj,
            _ => return false,
        }
    }
}

/// `checkGrammarForInvalidDynamicName`: a computed name that is neither a literal nor `a.b.c`. Whether one that is `a.b.c` can be
/// bound (`isLateBindableName`) makes no difference to it. `name`: where the name starts.
fn is_invalid_dynamic_name(hir: &File, atoms: &Interner, key: PropKey, name: u32) -> bool {
    let text = &hir.text[..];
    if text.get(name as usize) != Some(&b'[') {
        return false;
    }
    // What starts with a parenthesis is neither.
    if starts_with_parenthesis(text, name) {
        return true;
    }
    match key {
        // Nothing is said of what the syntax tree has nothing for.
        PropKey::Computed(e) if matches!(hir[e].kind, ExprKind::Missing) => false,
        PropKey::Computed(e) => {
            !is_string_or_numeric_literal_like(hir, e)
                && !is_signed_numeric_literal(hir, e)
                && !is_entity_name_expression(hir, atoms, e)
        }
        // `["a" as T]`, `["a"!]` and `[0 satisfies T]` are kept as the literal, which is not all there is to the name.
        PropKey::Name(_) => {
            let literal = skip_trivia(text, name as usize + 1);
            if matches!(text.get(literal), Some(b'"' | b'\'' | b'`')) {
                return end_of_quoted(text, literal)
                    .is_some_and(|end| text.get(skip_trivia(text, end)) != Some(&b']'));
            }
            // Where a number ends is not always made out.
            end_of_name(text, literal).is_some_and(|end| {
                let after = skip_trivia(text, end);
                text.get(after) == Some(&b'!')
                    || starts_with_word(text, after, b"as")
                    || starts_with_word(text, after, b"satisfies")
            })
        }
        PropKey::Private(_) | PropKey::None => false,
    }
}

/// `IsAssignmentTarget`
fn is_assignment_target(hir: &File, bound: &Bound, mut node: ExprId) -> bool {
    loop {
        match bound.expr_parent[node.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Assign { target, .. } => return target == node,
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    ..
                } => return true,
                ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::NonNull(_) => node = parent,
                _ => return false,
            },
            Parent::Prop(p) => {
                let owner = bound.prop_owner[p.idx()];
                if owner.is_none()
                    || !matches!(hir[owner].kind, ExprKind::Object(_))
                    || !matches!(
                        hir[p].kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Spread
                    )
                {
                    return false;
                }
                node = owner;
            }
            Parent::Stmt(s) if s.is_some() => {
                return matches!(bound.stmt_parent[s.idx()], Parent::Stmt(l) if l.is_some()
                    && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s));
            }
            _ => return false,
        }
    }
}

/// Whether `checkGrammarObjectLiteralExpression` gives up on one of `props`, which come first in an object literal: two accessors of
/// a kind go by one name (1118), or an accessor or a method and something else (1119). Only the names that are written count here.
fn has_clashing_names(hir: &File, props: impl Iterator<Item = PropId>) -> bool {
    // `DeclarationMeaning`
    const GET: u8 = 1;
    const SET: u8 = 2;
    const ACCESSOR: u8 = GET | SET;
    const PROPERTY: u8 = 4;
    const METHOD: u8 = 8;
    let mut seen: Vec<(Atom, u8)> = Vec::new();
    for p in props {
        let current = match hir[p].kind {
            PropKind::Init | PropKind::Shorthand => PROPERTY,
            PropKind::Method => METHOD,
            PropKind::Getter => GET,
            PropKind::Setter => SET,
            PropKind::Spread => continue,
        };
        let Some(name) = hir[p].key.name() else {
            continue;
        };
        match seen.iter().position(|s| s.0 == name) {
            None => seen.push((name, current)),
            Some(at) => {
                let existing = seen[at].1;
                if current & ACCESSOR != 0
                    && existing & ACCESSOR != 0
                    && existing != ACCESSOR
                    && current != existing
                {
                    seen[at].1 = ACCESSOR;
                } else if current != existing || current & ACCESSOR != 0 {
                    return true;
                }
                // Of two properties or two methods 1117 or 2300 is said, and it goes on.
            }
        }
    }
    false
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

/// Whether `checkGrammarModifiers` objected to the decorators or the modifiers of the member `m`, whose name starts at `name`.
/// `said`: what has been said of the file so far, what the parser noticed included.
fn are_modifiers_refused(
    hir: &File,
    bound: &Bound,
    m: MemberId,
    name: u32,
    said: &[Diagnostic],
) -> bool {
    if hir.decorators.iter().any(|&(owner, e)| {
        owner == DecoratorOwner::Member(m) && bound.refused_decorators.contains(&e)
    }) {
        return true;
    }
    let (mut start, mut says_declare_or_abstract) = (name, false);
    loop {
        let so_far = upto(&hir.text, start);
        let before = trim_trivia_end(so_far);
        let word = before
            .iter()
            .rposition(|&c| !is_identifier_part(c))
            .map_or(0, |i| i + 1);
        // `nextTokenCanFollowModifier`: all but `static` are on the line of what follows them.
        if &before[word..] != b"static" && so_far[before.len()..].contains(&b'\n') {
            break;
        }
        match &before[word..] {
            // 1248, which is said of the name.
            b"const" => return true,
            b"declare" | b"abstract" => says_declare_or_abstract = true,
            b"public" | b"private" | b"protected" | b"static" | b"readonly" | b"override"
            | b"accessor" | b"async" | b"export" | b"default" | b"in" | b"out" => {}
            _ => break,
        }
        start = word as u32;
    }
    // `NodeCanBeDecorated`, once more: the members that are read from the text a second time come without their decorators.
    if let MemberOwner::Class(class) = bound.member_owner[m.idx()] {
        let can_be_decorated = if hir.legacy_decorators {
            matches!(bound.class_owner[class.idx()], ClassOwner::Stmt(_))
                && !matches!(hir[m].key, PropKey::Private(_))
        } else {
            !says_declare_or_abstract
        };
        if !can_be_decorated && ends_with_decorator(trim_trivia_end(upto(&hir.text, start))) {
            return true;
        }
    }
    said.iter().any(|d| (start..name).contains(&d.start))
}

/// `checkGrammarTypeParameterList`: 1098, `<>` before the parameters of `func`.
fn has_empty_type_parameter_list(hir: &File, func: &Func) -> bool {
    func.type_params.is_empty()
        && trim_trivia_end(upto(&hir.text, func.anchor))
            .strip_suffix(b">")
            .is_some_and(|before| trim_trivia_end(before).ends_with(b"<"))
}

// ───────────────────────────── the text ─────────────────────────────

fn upto(text: &[u8], pos: u32) -> &[u8] {
    &text[..(pos as usize).min(text.len())]
}

/// `extractPragmas`, whether it finds the pragma `name`, which is given in lower case. Only the `/* */` comments before the first token
/// count, of each line only the first `@word`, and something has to follow it on the line.
fn has_pragma(text: &[u8], name: &[u8]) -> bool {
    let end_of_line = |text: &[u8]| text.iter().position(|&c| c == b'\n').unwrap_or(text.len());
    let mut rest = if text.starts_with(b"#!") {
        &text[end_of_line(text)..]
    } else {
        text
    };
    loop {
        rest = rest.trim_ascii_start();
        if rest.starts_with(b"//") {
            rest = &rest[end_of_line(rest)..];
            continue;
        }
        if !rest.starts_with(b"/*") {
            return false;
        }
        let Some(length) = rest[2..].windows(2).position(|w| w == b"*/") else {
            return false;
        };
        for line in rest[2..2 + length].split(|&c| c == b'\n' || c == b'\r') {
            let mut from = 0;
            while let Some(found) = line[from..].iter().position(|&c| c == b'@') {
                let at = from + found + 1;
                let word = line[at..]
                    .split(|&c| c == b' ' || c == b'\t')
                    .next()
                    .unwrap_or_default();
                // An `@` on its own is passed over.
                if word.is_empty() {
                    from = at;
                    continue;
                }
                if word.eq_ignore_ascii_case(name)
                    && !line[at + word.len()..].trim_ascii().is_empty()
                {
                    return true;
                }
                break;
            }
        }
        rest = &rest[length + 4..];
    }
}

/// Whether `text` ends with a decorator: `@a.b`, `@a.b(..)`, `@(..)`.
fn ends_with_decorator(mut text: &[u8]) -> bool {
    if text.ends_with(b")") {
        let mut depth = 0u32;
        let open = text.iter().rposition(|&c| {
            match c {
                b')' => depth += 1,
                b'(' => depth -= 1,
                _ => {}
            }
            depth == 0
        });
        let Some(open) = open else { return false };
        text = trim_trivia_end(&text[..open]);
    }
    let name = text
        .iter()
        .rposition(|&c| !(is_identifier_part(c) || c == b'.'))
        .map_or(0, |i| i + 1);
    name > 0 && text[name - 1] == b'@'
}

/// Whether nothing but `async` and `*` comes before the name, at `name`, of a method of an object literal.
fn has_no_modifier_but_async(text: &[u8], name: u32) -> bool {
    let mut before = trim_trivia_end(upto(text, name));
    if let Some(rest) = before.strip_suffix(b"*") {
        before = trim_trivia_end(rest);
    }
    if ends_with_word(before, b"async") {
        before = trim_trivia_end(&before[..before.len() - 5]);
    }
    matches!(before.last(), Some(b'{' | b','))
}

fn ends_with_word(text: &[u8], word: &[u8]) -> bool {
    text.strip_suffix(word)
        .is_some_and(|before| !before.last().is_some_and(|&c| is_identifier_part(c)))
}

fn starts_with_word(text: &[u8], at: usize, word: &[u8]) -> bool {
    text.get(at..).is_some_and(|rest| {
        rest.starts_with(word) && !rest.get(word.len()).is_some_and(|&c| is_identifier_part(c))
    })
}

/// `pos`, or where the parentheses that open right before it do. For what a `(` before it can be nothing but its own.
fn before_parentheses(text: &[u8], pos: u32) -> u32 {
    let mut start = pos;
    loop {
        let before = trim_trivia_end(upto(text, start));
        if !before.ends_with(b"(") {
            return start;
        }
        start = before.len() as u32 - 1;
    }
}

/// Whether what is in the brackets that open at `bracket` starts with a parenthesis.
fn starts_with_parenthesis(text: &[u8], bracket: u32) -> bool {
    text.get(skip_trivia(text, bracket as usize + 1)) == Some(&b'(')
}

/// Whether all that is in the brackets that open at `bracket` is in one pair of parentheses.
fn is_all_in_parentheses(text: &[u8], bracket: u32) -> bool {
    let open = skip_trivia(text, bracket as usize + 1);
    text.get(open) == Some(&b'(')
        && end_of_brackets(text, open)
            .is_some_and(|end| text.get(skip_trivia(text, end)) == Some(&b']'))
}

/// Whether an identifier is written at `pos` and what follows it closes no parenthesis: no parenthesis opens right before it then.
/// A comment after it hides what follows.
fn is_word_outside_parentheses(text: &[u8], pos: u32) -> bool {
    let rest = &text[(pos as usize).min(text.len())..];
    let length = rest
        .iter()
        .position(|&c| !is_identifier_part(c))
        .unwrap_or(rest.len());
    length > 0
        && !rest[0].is_ascii_digit()
        && !matches!(
            rest[length..].trim_ascii_start().first(),
            None | Some(b')' | b'/')
        )
}

/// Where the name of the member `m` starts. That of a computed name is its bracket, where the member may be said to be where the
/// expression in the brackets is: between the two there are only parentheses, type assertions and comments.
pub(super) fn start_of_member_name(hir: &File, m: MemberId) -> u32 {
    let text = &hir.text[..];
    let pos = hir[m].pos;
    if text.get(pos as usize) == Some(&b'[') {
        return pos;
    }
    if !matches!(hir[m].key, PropKey::Computed(_)) {
        // `[("a")]`
        if is_word_outside_parentheses(text, pos) {
            return pos;
        }
        let start = before_parentheses(text, pos);
        if start == pos {
            return pos;
        }
        let before = trim_trivia_end(upto(text, start));
        return if before.ends_with(b"[") {
            before.len() as u32 - 1
        } else {
            pos
        };
    }
    let mut depth = 0u32;
    let mut i = (pos as usize).min(text.len());
    while i > 0 {
        i -= 1;
        match text[i] {
            b')' | b']' | b'}' => depth += 1,
            b'[' if depth == 0 => return i as u32,
            b'{' | b';' if depth == 0 => break,
            b'(' if depth == 0 => {}
            b'(' | b'[' | b'{' => depth -= 1,
            _ => {}
        }
    }
    pos
}

/// Past the string or the template that starts at `start`.
fn end_of_quoted(text: &[u8], start: usize) -> Option<usize> {
    let quote = *text.get(start)?;
    let mut i = start + 1;
    loop {
        match *text.get(i)? {
            b'\\' => i += 2,
            c if c == quote => return Some(i + 1),
            _ => i += 1,
        }
    }
}

/// Past the bracket that closes the one at `open`.
pub(super) fn end_of_brackets(text: &[u8], open: usize) -> Option<usize> {
    let (mut depth, mut i) = (0u32, open);
    loop {
        match *text.get(i)? {
            b'[' | b'(' | b'{' => depth += 1,
            b']' | b')' | b'}' => {
                if depth <= 1 {
                    return Some(i + 1);
                }
                depth -= 1;
            }
            b'"' | b'\'' | b'`' => {
                i = end_of_quoted(text, i)?;
                continue;
            }
            b'/' if matches!(text.get(i + 1), Some(b'/' | b'*')) => {
                i = skip_trivia(text, i);
                continue;
            }
            _ => {}
        }
        i += 1;
    }
}

/// Where the name of a property or a variable that starts at `start` ends: an identifier, a string, a number, or brackets.
/// `None`: it is not made out.
fn end_of_name(text: &[u8], start: usize) -> Option<usize> {
    match *text.get(start)? {
        b'"' | b'\'' => end_of_quoted(text, start),
        b'[' => end_of_brackets(text, start),
        _ => {
            let rest = &text[start..];
            let length = rest
                .iter()
                .position(|&c| !(is_identifier_part(c) || c == b'#' || c == b'.'))
                .unwrap_or(rest.len());
            (length > 0).then_some(start + length)
        }
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

/// Where the `token` is that comes right after the name that starts at `name`, if it does.
fn postfix_token(text: &[u8], name: u32, token: u8) -> Option<u32> {
    let at = skip_trivia(text, end_of_name(text, name as usize)?);
    (text.get(at) == Some(&token)).then_some(at as u32)
}
