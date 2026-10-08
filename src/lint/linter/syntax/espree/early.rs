//! The early errors that hold whatever the configuration says. acorn checks them as it parses. TypeScript's parser leaves them
//! to the type checker.
//!
//! Code that runs has none of them, so what matters is that finding none is cheap: each check goes through the nodes of one
//! kind, of which there are few or none.

use super::Checks;
use crate::ast::{
    BinOp, Expr, ExprKind, ExprTag, FnKind, Func, Handle, KeyKind, Member, MemberKind, Node, Param,
    PatElem, PatKind, PatProp, Prop, PropKind, Stmt, StmtKind, StmtTag, UnOp, VarKind,
};
use crate::language::SourceType;
use crate::regex;
use crate::tokens::skip_trivia;
use bun_core::strings;
use bun_sema::bind::Parent;
use bun_sema::hir::{self, DiagnosticKind, Flags, ModifierKind};
use smallvec::SmallVec;

/// Patterns nest no deeper than the parser lets them. This bounds the recursion all the same.
const MAX_DEPTH: u32 = 256;

/// Whether the string that is written as `written` has half of a surrogate pair. It can only be written as an escape.
fn has_lone_surrogate(written: &[u8]) -> bool {
    let (mut at, mut is_after_high) = (0, false);
    while let Some(&byte) = written.get(at) {
        let (mut unit, mut len) = (None, 1);
        if byte == b'\\' {
            len = 2;
            if let Some([b'u', rest @ ..]) = written.get(at + 1..) {
                let digits = match rest {
                    [b'{', rest @ ..] => {
                        strings::index_of_char_usize(rest, b'}').map(|end| &rest[..end])
                    }
                    rest => rest.get(..4),
                };
                let Some(digits) = digits else {
                    return false;
                };
                unit = std::str::from_utf8(digits)
                    .ok()
                    .and_then(|it| u32::from_str_radix(it, 16).ok());
                len = 2 + digits.len() + if rest.starts_with(b"{") { 2 } else { 0 };
            }
        }
        let is_low = matches!(unit, Some(0xDC00..=0xDFFF));
        if is_after_high != is_low {
            return true;
        }
        is_after_high = matches!(unit, Some(0xD800..=0xDBFF));
        at += len;
    }
    is_after_high
}

impl<'a> Checks<'a> {
    pub(super) fn early_errors(&mut self) {
        self.decorators();
        self.assignment_targets();
        self.rest_elements();
        self.declarations();
        self.statement_positions();
        self.nested_module_syntax();
        self.deleted_private_fields();
        self.meta_properties();
        self.regular_expressions();
        self.functions();
        self.defaults_that_suspend();
        self.supers();
        self.private_names();
        self.jumps();
        self.labels();
        self.classes();
        self.operators();
        self.dynamic_imports();
        self.switches_and_throws();
        self.awaits();
        self.arrows();
        self.object_literals();
        self.names_in_quotes();
        self.async_before_of();
        if self.is_babel {
            self.sequences_in_jsx();
            self.decorators_before_default();
        }
        if self.is_whole {
            self.exports();
        }
    }

    /// `parseModuleExportName`: a name of an import or an export that is written as a string.
    fn names_in_quotes(&mut self) {
        let file = self.file;
        if !strings::contains(file.text(), b"\\u") {
            return;
        }
        let mut names: SmallVec<[crate::ast::Ident<'a>; 8]> = SmallVec::new();
        for it in file.body() {
            match it.kind() {
                StmtKind::Import(import) => {
                    names.extend(import.named().iter().map(|it| it.imported()))
                }
                StmtKind::ExportNamed(export) => {
                    names.extend(
                        export
                            .items()
                            .iter()
                            .flat_map(|it| [it.local(), it.exported()]),
                    );
                }
                StmtKind::ExportStar { alias, .. } => names.extend(alias),
                _ => {}
            }
        }
        for name in names {
            if name.is_string() && has_lone_surrogate(file.slice(name.span())) {
                self.fail(
                    name.start(),
                    "An export name cannot include a lone surrogate.",
                );
            }
        }
    }

    /// `for (async of a)`: it could be the start of `for (async of => {};;)`.
    fn async_before_of(&mut self) {
        for it in self.file.stmts_of_kind(StmtTag::ForOf) {
            let StmtKind::ForOf {
                left,
                expr,
                is_await: false,
                ..
            } = it.kind()
            else {
                continue;
            };
            if let StmtKind::Expr(target) = left.kind()
                && matches!(target.kind(), ExprKind::Ident(_))
                && !target.is_parenthesized()
                && self.token_at(target.span().start) == b"async"
            {
                let message = "The left-hand side of a for-of loop may not be 'async'.";
                match self.is_babel {
                    true => self.fail(target.span().start, message),
                    // acorn expects the `=>`.
                    false => self.unexpected(expr.outer_span().start),
                }
            }
        }
    }

    /// `<a>{b, c}</a>`, `<a b={c, d} />`, `<a {...b, c} />`, which acorn-jsx takes.
    fn sequences_in_jsx(&mut self) {
        let file = self.file;
        let is_sequence = |it: Expr<'a>| {
            matches!(
                it.kind(),
                ExprKind::Binary {
                    op: BinOp::Comma,
                    ..
                }
            ) && !it.is_parenthesized()
        };
        let message = "Sequence expressions cannot be directly nested inside JSX";
        for &(id, ..) in file.hir.jsx_expressions {
            let it = Expr::from_raw(file, id.0);
            if is_sequence(it) {
                self.fail(it.span().start, message);
            }
        }
        if file.hir.jsx.is_empty() {
            return;
        }
        for (i, raw) in file.hir.props.iter().enumerate() {
            let prop = Prop::from_raw(file, i as u32);
            if raw.kind == PropKind::Spread
                && prop.is_jsx_attribute()
                && let Some(value) = prop.value().filter(|it| is_sequence(*it))
            {
                self.fail(value.span().start, message);
            }
        }
    }

    /// `export @a default class {}`
    fn decorators_before_default(&mut self) {
        for it in self.file.body() {
            let export = match it.kind() {
                StmtKind::ExportDefault(_) => Some(it.span().start),
                _ if it.is_default_export() => it.export_span().map(|it| it.start),
                _ => None,
            };
            if let Some(export) = export.filter(|&at| self.token_at(at) == b"export")
                && self.token_at(self.after_token(export)).starts_with(b"@")
            {
                let message = "Leading decorators must be attached to a class declaration";
                self.fail(export, message);
            }
        }
    }

    fn next_is(&self, after: u32, byte: u8) -> Option<u32> {
        let at = skip_trivia(self.file.text(), after);
        (self.file.text().get(at as usize) == Some(&byte)).then_some(at)
    }

    /// acorn has no decorators.
    fn decorators(&mut self) {
        let is_decorator = |it: &&hir::Modifier| matches!(it.kind, ModifierKind::Decorator(_));
        if let Some(first) = self
            .file
            .hir
            .modifiers
            .iter()
            .filter(is_decorator)
            .map(|it| it.pos)
            .min()
        {
            self.unexpected_character(first);
        }
    }

    // ───────────────────────────── what is assigned to ─────────────────────────────

    fn assignment_targets(&mut self) {
        let file = self.file;
        for it in file.exprs_of_kind(ExprTag::Assign) {
            let ExprKind::Assign { op, target, .. } = it.kind() else {
                continue;
            };
            // A default in a pattern is looked at with the pattern.
            if it.is_assignment_target() {
                continue;
            }
            self.when_read_to(target.outer_span().end, |checks| match op {
                // `a?.b = c` is a proposal that Prettier has Babel accept.
                _ if checks.is_babel && target.is_in_optional_chain() => {}
                None => checks.to_assignable(target, 0),
                Some(_) => checks.check_simple_target(target),
            });
        }
        for it in file.exprs_of_kind(ExprTag::Unary) {
            if let ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } = it.kind()
            {
                self.when_read_to(operand.outer_span().end, |checks| {
                    checks.check_simple_target(operand)
                });
            }
        }
        for tag in [StmtTag::ForIn, StmtTag::ForOf] {
            for it in file.stmts_of_kind(tag) {
                let (StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) = it.kind()
                else {
                    continue;
                };
                if let StmtKind::Expr(target) = left.kind() {
                    self.when_read_to(target.outer_span().end, |checks| {
                        checks.to_assignable(target, 0)
                    });
                }
            }
        }
    }

    /// `checkLValSimple`
    fn check_simple_target(&mut self, target: Expr<'a>) {
        let start = target.span().start;
        match target.kind() {
            ExprKind::Ident(_) => {}
            ExprKind::Dot { .. } | ExprKind::Index { .. } if !target.is_in_optional_chain() => {}
            _ if target.is_in_optional_chain() => {
                self.fail(start, "Optional chaining cannot appear in left-hand side")
            }
            _ => self.fail(start, "Assigning to rvalue"),
        }
    }

    /// `toAssignable`
    fn to_assignable(&mut self, target: Expr<'a>, depth: u32) {
        if depth > MAX_DEPTH {
            return;
        }
        let is_simple = matches!(
            target.kind(),
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
        );
        match target.kind() {
            // `parenthesizedAssign`: of a pattern, and in a pattern of all that is not a name or a member.
            ExprKind::Object(_) | ExprKind::Array(_) if target.is_parenthesized() => {
                self.fail(target.outer_span().start, "Assigning to rvalue");
            }
            _ if depth > 0 && !is_simple && target.is_parenthesized() => {
                self.fail(target.outer_span().start, "Assigning to rvalue");
            }
            // A default only in a pattern.
            ExprKind::Assign { .. } if depth == 0 => {
                self.fail(target.span().start, "Assigning to rvalue")
            }
            ExprKind::Object(props) => {
                for prop in props {
                    let Some(value) = prop.value() else {
                        continue;
                    };
                    match prop.kind() {
                        PropKind::Getter | PropKind::Setter => {
                            let key = prop
                                .key()
                                .map_or_else(|| prop.span().start, |it| it.span(self.file).start);
                            self.fail(key, "Object pattern can't contain getter or setter");
                        }
                        PropKind::Method => {
                            let function = prop.func().map_or_else(
                                || value.span().start,
                                |it| it.span_from_params().start,
                            );
                            self.fail(function, "Assigning to rvalue");
                        }
                        PropKind::Spread => {
                            self.to_assignable(value, depth + 1);
                            if matches!(value.kind(), ExprKind::Object(_) | ExprKind::Array(_)) {
                                self.fail(value.span().start, "Unexpected token");
                            }
                            if !self.is_babel {
                                self.comma_after_rest(value.outer_span().end);
                            }
                        }
                        PropKind::Init | PropKind::Shorthand => {
                            self.to_assignable(value, depth + 1)
                        }
                    }
                }
            }
            ExprKind::Array(elements) => {
                for element in elements.iter().filter(|it| !it.is_missing()) {
                    self.to_assignable(element, depth + 1);
                }
            }
            ExprKind::Spread(argument) => {
                self.to_assignable(argument, depth + 1);
                if matches!(argument.kind(), ExprKind::Assign { .. }) {
                    self.fail(
                        argument.span().start,
                        "Rest elements cannot have a default value",
                    );
                }
                // Babel recovers from it in what it has parsed as an expression.
                if !self.is_babel {
                    self.comma_after_rest(target.outer_span().end);
                }
            }
            ExprKind::Assign {
                op, target: left, ..
            } => {
                if op.is_some() {
                    self.fail(
                        left.span().end,
                        "Only '=' operator can be used for specifying default value.",
                    );
                }
                self.to_assignable(left, depth + 1);
            }
            _ => self.check_simple_target(target),
        }
    }

    fn comma_after_rest(&mut self, end: u32) {
        if let Some(comma) = self.next_is(end, b',') {
            // Babel recovers from a comma that nothing follows.
            let next = self.file.text().get(self.after_token(comma) as usize);
            if !self.is_babel || !matches!(next, Some(b']' | b'}' | b')')) {
                self.fail(comma, "Comma is not permitted after the rest element");
            }
        }
    }

    /// `...a` in a pattern that declares, and as a parameter.
    fn rest_elements(&mut self) {
        let file = self.file;
        let rest = |checks: &mut Self, default: Option<Expr<'a>>, end: u32| {
            if let Some(default) = default {
                let equals = checks.before_token(default.outer_span().start);
                match checks.is_babel {
                    true => checks.fail(equals, "Rest elements cannot have a default value"),
                    false => checks.unexpected(equals),
                }
            }
            checks.comma_after_rest(end);
        };
        for (i, raw) in file
            .hir
            .pat_elems
            .iter()
            .enumerate()
            .filter(|it| it.1.is_rest)
        {
            let it = PatElem::from_raw(file, i as u32);
            let Some(pat) = it
                .pat()
                .filter(|pat| file.pat_in_tree(pat.id().idx()).is_some())
            else {
                continue;
            };
            // acorn parses the parameters of an arrow function as an expression first.
            let arrow = Node::Pat(pat)
                .ancestors()
                .find_map(Node::as_func)
                .filter(|it| it.kind() == FnKind::Arrow);
            let is_parameter = Node::Pat(pat)
                .ancestors()
                .take_while(|it| !matches!(it, Node::Func(_)))
                .any(|it| matches!(it, Node::Param(_)));
            match arrow.filter(|_| is_parameter && it.default().is_some()) {
                Some(arrow) => {
                    let noticed = arrow.arrow_span().map_or(raw.end, |it| it.start);
                    self.when_read_to(noticed, |checks| {
                        checks.fail(
                            pat.span().start,
                            "Rest elements cannot have a default value",
                        )
                    });
                }
                // Babel recovers from what is wrong with `...` in the parameters of an arrow function.
                None if self.is_babel && is_parameter && arrow.is_some() => {}
                None => rest(self, it.default(), raw.end),
            }
        }
        for (i, raw) in file
            .hir
            .pat_props
            .iter()
            .enumerate()
            .filter(|it| it.1.is_rest)
        {
            let it = PatProp::from_raw(file, i as u32);
            if file.pat_in_tree(it.value().id().idx()).is_none() {
                continue;
            }
            // Only a name can follow.
            if !matches!(it.value().kind(), PatKind::Ident(_)) {
                self.unexpected(it.value().span().start);
            }
            rest(self, it.default(), raw.end);
        }
        for (i, _) in file
            .hir
            .params
            .iter()
            .enumerate()
            .filter(|it| it.1.flags.contains(Flags::REST))
        {
            let it = Param::from_raw(file, i as u32);
            if it.is_in_tree() {
                rest(self, it.default(), it.span().end);
            }
        }
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// `parseVar`, `parseForStatement`
    fn declarations(&mut self) {
        let (file, hir, bound) = (self.file, &self.file.hir, &self.file.bound);
        for (i, raw) in hir.var_decls.iter().enumerate() {
            let is_pattern = || {
                matches!(
                    hir.pats.get(raw.pat.idx()).map(|it| it.kind),
                    Some(hir::PatKind::Object(_) | hir::PatKind::Array(_))
                )
            };
            if raw.init.is_some()
                || raw.kind == VarKind::Let && !is_pattern()
                || raw.kind == VarKind::Var && !is_pattern()
            {
                continue;
            }
            let Some(list) = bound.var_stmt.get(i).and_then(|it| Stmt::some(file, *it)) else {
                continue;
            };
            // Not the parameter of a `catch`, and not what a `for`-`in` or a `for`-`of` declares.
            let is_in_loop_head = match list.parent() {
                Node::Stmt(parent) => match parent.kind() {
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left == list,
                    _ => false,
                },
                _ => false,
            };
            if !matches!(list.kind(), StmtKind::Var(_))
                || is_in_loop_head
                || file.is_in_jsdoc(raw.loc.end)
            {
                continue;
            }
            match raw.kind {
                VarKind::Const => self.unexpected(raw.loc.end),
                VarKind::Using => {
                    self.fail(raw.loc.end, "Missing initializer in using declaration")
                }
                VarKind::AwaitUsing => self.fail(
                    raw.loc.end,
                    "Missing initializer in await using declaration",
                ),
                _ => self.fail(
                    raw.loc.end,
                    "Complex binding patterns require an initialization value",
                ),
            }
        }
        for it in file.stmts_of_kind(StmtTag::Var) {
            let StmtKind::Var(list) = it.kind() else {
                continue;
            };
            if list.is_empty() {
                self.unexpected(self.after_token(it.span().start));
            }
            if matches!(
                list.first().map(|it| it.var_kind()),
                Some(VarKind::Using | VarKind::AwaitUsing)
            ) {
                self.using_declaration(it);
            }
        }
        for tag in [StmtTag::ForIn, StmtTag::ForOf] {
            for it in file.stmts_of_kind(tag) {
                let (StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) = it.kind()
                else {
                    continue;
                };
                let StmtKind::Var(list) = left.kind() else {
                    continue;
                };
                let (Some(first), 1) = (list.first(), list.len()) else {
                    // It takes it for the head of a `for`, in which a `;` follows.
                    self.unexpected(left.span().end);
                    continue;
                };
                // Allowed again since ES2017.
                let is_allowed = tag == StmtTag::ForIn
                    && file.language().ecma_version >= 2017
                    && first.var_kind() == VarKind::Var
                    && matches!(first.pat().kind(), PatKind::Ident(_))
                    && !self.is_strict(Node::Stmt(it));
                if first.init().is_some() && !is_allowed {
                    let name = if tag == StmtTag::ForIn {
                        "for-in"
                    } else {
                        "for-of"
                    };
                    let message = [
                        name,
                        " loop variable declaration may not have an initializer",
                    ]
                    .concat();
                    self.when_read_to(left.span().end, |checks| {
                        checks.fail(left.span().start, message)
                    });
                }
            }
        }
    }

    /// `allowUsing`, and what `using` can declare.
    fn using_declaration(&mut self, it: Stmt<'a>) {
        let (file, start) = (self.file, it.span().start);
        let is_at_top_of_script = matches!(it.parent(), Node::File(_))
            && file.language().source_type == SourceType::Script;
        if is_at_top_of_script || matches!(it.parent(), Node::Case(_)) {
            let message = "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement";
            self.fail(start, message);
        }
        if let Node::Stmt(parent) = it.parent()
            && matches!(parent.kind(), StmtKind::ForIn { left, .. } if left == it)
        {
            self.fail(
                skip_trivia(file.text(), it.span().end),
                "Using declaration is not allowed in for-in loops",
            );
        }
        let StmtKind::Var(list) = it.kind() else {
            return;
        };
        for pattern in list
            .iter()
            .map(|it| it.pat())
            .filter(|it| !matches!(it.kind(), PatKind::Ident(_)))
        {
            match self.is_babel {
                true => self.fail(
                    pattern.span().start,
                    "Using declaration cannot have destructuring patterns",
                ),
                false => self.unexpected(pattern.span().start),
            }
        }
    }

    /// `parseStatement` with a `context`: what cannot be the body of an `if`, a loop, a `with` or a label.
    fn statement_positions(&mut self) {
        let file = self.file;
        for tag in [StmtTag::Var, StmtTag::Fn, StmtTag::Class] {
            for it in file.stmts_of_kind(tag) {
                let Node::Stmt(parent) = it.parent() else {
                    continue;
                };
                let is_body = match parent.kind() {
                    StmtKind::If { yes, no, .. } => yes == it || no == Some(it),
                    StmtKind::For { body, .. }
                    | StmtKind::ForIn { body, .. }
                    | StmtKind::ForOf { body, .. }
                    | StmtKind::While { body, .. }
                    | StmtKind::DoWhile { body, .. }
                    | StmtKind::With { body, .. }
                    | StmtKind::Labeled { body, .. } => body == it,
                    _ => false,
                };
                if is_body {
                    self.declaration_as_body(it, parent);
                }
            }
        }
    }

    fn declaration_as_body(&mut self, it: Stmt<'a>, parent: Stmt<'a>) {
        let start = it.span().start;
        let is_lexical = match it.kind() {
            StmtKind::Var(list) => {
                matches!(
                    list.first().map(|it| it.var_kind()),
                    Some(VarKind::Let | VarKind::Const)
                )
            }
            StmtKind::Class(_) => true,
            _ => false,
        };
        if self.is_babel && is_lexical {
            let message = "Lexical declaration cannot appear in a single-statement context";
            return self.fail(start, message);
        }
        if self.is_babel {
            // Where else a function cannot be is an error of strict mode for it, or one of sloppy mode.
            if matches!(it.kind(), StmtKind::Fn(func) if func.is_async()) {
                let message =
                    "Async functions can only be declared at the top level or inside a block";
                self.fail(start, message);
            }
            return;
        }
        match it.kind() {
            StmtKind::Var(list) => match list.first().map(|it| it.var_kind()) {
                Some(VarKind::Var) | None => {}
                // `let` is a name there, unless a `[` follows.
                Some(VarKind::Let) => {
                    let next = self.after_token(start);
                    match self.token_at(next) {
                        b"[" => self.unexpected(start),
                        _ => self.unexpected(next),
                    }
                }
                Some(VarKind::Const) => self.unexpected(start),
                Some(_) => self.fail(
                    start,
                    "Using declaration is not allowed in single-statement positions",
                ),
            },
            StmtKind::Class(_) => self.unexpected(start),
            StmtKind::Fn(func) => {
                // After `if (a)` and after a label that is not itself such a body, in sloppy mode.
                let is_allowed = !func.is_async()
                    && !self.is_strict(Node::Stmt(parent))
                    && match parent.kind() {
                        StmtKind::If { .. } => true,
                        StmtKind::Labeled { .. } => {
                            let mut outer = parent;
                            loop {
                                match outer.parent() {
                                    Node::Stmt(next)
                                        if matches!(next.kind(), StmtKind::Labeled { .. }) =>
                                    {
                                        outer = next
                                    }
                                    Node::Stmt(next) => {
                                        break matches!(
                                            next.kind(),
                                            StmtKind::Block(_) | StmtKind::Switch { .. }
                                        );
                                    }
                                    _ => break true,
                                }
                            }
                        }
                        _ => false,
                    };
                if !is_allowed {
                    self.unexpected(start);
                } else if func.is_generator() {
                    self.unexpected(self.after_token(start));
                }
            }
            _ => {}
        }
    }

    fn nested_module_syntax(&mut self) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        for (i, raw) in hir.stmts.iter().enumerate() {
            let is_export = |it: &hir::Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
            let is_module_syntax = matches!(
                raw.kind,
                hir::StmtKind::Import(_)
                    | hir::StmtKind::ExportNamed(_)
                    | hir::StmtKind::ExportStar { .. }
                    | hir::StmtKind::ExportDefault(_)
            ) || !raw.modifiers.is_empty()
                && hir
                    .modifiers
                    .get(raw.modifiers.range())
                    .unwrap_or_default()
                    .iter()
                    .any(is_export);
            let is_nested = !matches!(
                bound.stmt_parent.get(i),
                None | Some(Parent::None | Parent::File)
            );
            if is_module_syntax && is_nested && !self.file.is_in_jsdoc(raw.start) {
                self.fail(
                    raw.start,
                    "'import' and 'export' may only appear at the top level",
                );
            }
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `isPrivateFieldAccess`
    fn deleted_private_fields(&mut self) {
        for it in self.file.exprs_of_kind(ExprTag::Unary) {
            let ExprKind::Unary {
                op: UnOp::Delete,
                operand,
            } = it.kind()
            else {
                continue;
            };
            // Babel does not look into parentheses, which Prettier has it keep.
            if matches!(operand.kind(), ExprKind::Dot { name, .. } if name.bytes().starts_with(b"#"))
                && !(self.is_babel && operand.is_parenthesized())
            {
                self.when_read_to(it.span().end, |checks| {
                    checks.fail(it.span().start, "Private fields can not be deleted")
                });
            }
        }
    }

    /// `import.meta` and `new.target` are all that acorn knows.
    fn meta_properties(&mut self) {
        let file = self.file;
        let of_import = "The only valid meta property for import is 'import.meta'";
        let of_new = "The only valid meta property for new is 'new.target'";
        for it in file.exprs_of_kind(ExprTag::ImportCall) {
            let name = self.after_token(self.after_token(it.span().start));
            // Proposals that Prettier has Babel accept, as they are written in the proposal.
            let is_refused = match self.is_babel {
                true => {
                    it.import_call_phase().is_some()
                        && !matches!(self.token_at(name), b"defer" | b"source")
                }
                false => it.is_deferred_import_call(),
            };
            if is_refused {
                self.fail(name, of_import);
            }
        }
        // `import defer * as a from "a"`: `defer` is the name of the default import.
        for raw in file.hir.imports.iter().filter(|it| it.is_deferred) {
            if !self.is_babel {
                self.unexpected(self.after_token(raw.clause_start));
                continue;
            }
            // `import defer * as a from "a"`, `import source a from "a"`
            let (has_default, has_namespace) = (!raw.default.is_none(), !raw.namespace.is_none());
            let is_valid = match self.token_at(raw.clause_start) {
                b"source" => has_default && !has_namespace,
                _ => has_namespace && !has_default,
            };
            if !is_valid || raw.has_named_imports {
                self.fail(raw.clause_start, "Only `import defer * as x` is valid");
            }
        }
        for it in file
            .hir
            .diagnostics
            .iter()
            .filter(|it| it.kind == DiagnosticKind::Grammar)
        {
            // At the name.
            let name = match it.code {
                17012 | 18061 => it.start,
                1005 if it.args.first().is_some_and(|it| **it == *b"(") => {
                    self.before_token(it.start)
                }
                _ => continue,
            };
            let keyword = self.before_token(self.before_token(name));
            // The parser compares what is written. The diagnostic has the name.
            let is_meta = it.code == 17012 && it.args.first().is_some_and(|it| **it == *b"meta");
            match self.token_at(keyword) {
                b"import" if is_meta && !self.is_babel => {
                    self.fail(keyword, "'import.meta' must not contain escaped characters");
                }
                b"import" => self.fail(name, of_import),
                b"new" => self.fail(name, of_new),
                _ => {}
            }
        }
        for it in file.exprs_of_kind(ExprTag::NewTarget) {
            // acorn throws the first of its three complaints about one `new.target`, wherever the others are.
            let name = self.after_token(self.after_token(it.span().start));
            let is_target = matches!(
                it.try_raw().map(|it| it.kind),
                Some(hir::ExprKind::NewTarget(name)) if file.name(name).bytes() == b"target"
            );
            if !is_target || self.is_babel && self.token_at(name) != b"target" {
                self.fail(name, of_new);
                continue;
            }
            if self.token_at(name) != b"target" {
                self.fail(
                    it.span().start,
                    "'new.target' must not contain escaped characters",
                );
                continue;
            }
            // In a function that is not an arrow function, in the initializer of a field, in a static block.
            let is_allowed = Node::Expr(it).ancestors().any(|it| match it {
                Node::Func(func) => func.kind() != FnKind::Arrow,
                Node::Member(member) => member.kind() == MemberKind::Property,
                _ => false,
            });
            // For acorn the top level of a CommonJS file is a function.
            if !is_allowed && file.language().source_type != SourceType::CommonJs {
                self.fail(
                    it.span().start,
                    "'new.target' can only be used in functions and class static block",
                );
            }
        }
    }

    /// `validateRegExpFlags`, `validateRegExpPattern`
    fn regular_expressions(&mut self) {
        for it in self.file.exprs_of_kind(ExprTag::Regex) {
            let ExprKind::Regex(literal) = it.kind() else {
                continue;
            };
            let (pattern, flags, at) = (literal.pattern(), literal.flags(), it.span().start + 1);
            let is_valid = |flag: &u8| strings::contains_char(b"dgimsuvy", *flag);
            if !flags.iter().all(is_valid) {
                self.fail(at, "Invalid regular expression flag");
            } else if flags
                .iter()
                .enumerate()
                .any(|(i, flag)| flags[i + 1..].iter().any(|it| it == flag))
            {
                self.fail(at, "Duplicate regular expression flag");
            } else if strings::contains_char(flags, b'u') && strings::contains_char(flags, b'v') {
                self.fail(at, "Invalid regular expression flag");
            } else if let Err(error) = regex::validate_pattern(
                pattern,
                regex::Mode::of_flags(flags),
                regex::Options::default(),
                &mut regex::Ignore,
            ) {
                // Where regexpp has other words than acorn.
                let reason = match error.reason() {
                    reason if reason.starts_with("Duplicated flag") => {
                        "Duplicate regular expression modifiers"
                    }
                    "Invalid empty flags" => "Invalid regular expression modifiers",
                    reason => reason,
                };
                let message = [
                    b"Invalid regular expression: /",
                    pattern,
                    b"/: ",
                    reason.as_bytes(),
                ]
                .concat();
                self.fail(at, message);
            }
        }
    }

    /// `??` beside `&&` or `||`, a template after an optional chain.
    fn operators(&mut self) {
        let file = self.file;
        for it in file.exprs_of_kind(ExprTag::Binary) {
            let ExprKind::Binary { op, left, right } = it.kind() else {
                continue;
            };
            if !matches!(op, BinOp::Nullish | BinOp::And | BinOp::Or) {
                continue;
            }
            let is_mixed = |operand: Expr<'a>| match operand.kind() {
                ExprKind::Binary { op: inner, .. } if !operand.is_parenthesized() => {
                    (op == BinOp::Nullish) != (inner == BinOp::Nullish)
                        && matches!(inner, BinOp::Nullish | BinOp::And | BinOp::Or)
                }
                _ => false,
            };
            // It is noticed at the second operator.
            if is_mixed(left) {
                if let Some(operator) = it.operator_span() {
                    self.fail(operator.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
                }
            } else if is_mixed(right)
                && let Some(operator) = right.operator_span()
            {
                self.fail(operator.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
            }
        }
        for it in file.exprs_of_kind(ExprTag::TaggedTemplate) {
            let ExprKind::TaggedTemplate(call) = it.kind() else {
                continue;
            };
            let tag = call.callee();
            let has_question_dot =
                self.token_at(skip_trivia(file.text(), tag.outer_span().end)) == b"?.";
            if has_question_dot {
                let template = self.after_token(skip_trivia(file.text(), tag.outer_span().end));
                self.fail(
                    template,
                    "Optional chaining cannot appear in the tag of tagged template expressions",
                );
            } else if tag.is_in_optional_chain() && !tag.is_parenthesized() {
                let template = skip_trivia(file.text(), tag.outer_span().end);
                self.fail(
                    template,
                    "Optional chaining cannot appear in the tag of tagged template expressions",
                );
            }
        }
    }

    /// `parseDynamicImport`
    fn dynamic_imports(&mut self) {
        for it in self.file.exprs_of_kind(ExprTag::ImportCall) {
            let ExprKind::ImportCall { args } = it.kind() else {
                continue;
            };
            // Not after `new`, which acorn-jsx forgets.
            if (self.is_babel || !self.file.language().jsx) && !it.is_parenthesized() {
                let mut callee = it;
                // Babel only looks at what follows `new`.
                while !self.is_babel
                    && let Node::Expr(outer) = callee.parent()
                    && matches!(
                        outer.kind(),
                        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == callee
                    )
                    && !outer.is_parenthesized()
                {
                    callee = outer;
                }
                if let Node::Expr(outer) = callee.parent()
                    && matches!(outer.kind(), ExprKind::New(call) if call.callee() == callee)
                {
                    match self.is_babel {
                        true => self.fail(it.span().start, "Cannot use new with import"),
                        false => self.unexpected(self.after_token(it.span().start)),
                    }
                }
            }
            if it.is_deferred_import_call() && !self.is_babel {
                continue;
            }
            let written: SmallVec<[Expr<'a>; 4]> =
                args.iter().filter(|it| !it.is_missing()).collect();
            if written.is_empty() {
                // At the `)`.
                self.unexpected(self.after_token(self.after_token(it.span().start)));
            }
            if self.is_babel && !matches!(written.len(), 1 | 2) {
                self.fail(
                    it.span().start,
                    "`import()` requires exactly one or two arguments",
                );
            }
            if let Some(spread) = written
                .iter()
                .take(2)
                .find(|it| matches!(it.kind(), ExprKind::Spread(_)))
            {
                match self.is_babel {
                    true => self.fail(spread.span().start, "`...` is not allowed in `import()`"),
                    false => self.unexpected(spread.span().start),
                }
            }
            if let Some(third) = written.get(2) {
                self.unexpected(third.outer_span().start);
            }
        }
    }

    fn switches_and_throws(&mut self) {
        let file = self.file;
        for it in file.stmts_of_kind(StmtTag::Switch) {
            let StmtKind::Switch { cases, .. } = it.kind() else {
                continue;
            };
            if let Some(second) = cases.iter().filter(|it| it.is_default()).nth(1) {
                self.fail(second.span().start, "Multiple default clauses");
            }
        }
        for it in file.stmts_of_kind(StmtTag::Throw) {
            if matches!(it.kind(), StmtKind::Throw(thrown) if thrown.is_missing()) {
                self.fail(
                    it.span().start + "throw".len() as u32,
                    "Illegal newline after throw",
                );
            }
        }
    }

    // ───────────────────────────── functions ─────────────────────────────

    fn functions(&mut self) {
        let file = self.file;
        for it in file.funcs() {
            let params = it.params();
            let wrong = match it.kind() {
                FnKind::Getter if !params.is_empty() => {
                    Some((it.span_from_params().start, "getter should have no params"))
                }
                FnKind::Setter if params.len() != 1 => Some((
                    it.span_from_params().start,
                    "setter should have exactly one param",
                )),
                FnKind::Setter => (params.first().filter(|it| it.is_rest()))
                    .map(|it| (it.span().start, "Setter cannot use rest params")),
                _ => None,
            };
            if let Some((at, message)) = wrong {
                self.when_read_to(it.span().end, |checks| checks.fail(at, message));
            }
            let is_simple = |it: Param<'a>| {
                it.default().is_none()
                    && !it.is_rest()
                    && matches!(it.pat().kind(), PatKind::Ident(_))
            };
            // An error since ES2016.
            if params.iter().all(is_simple) || file.language().ecma_version < 2016 {
                continue;
            }
            let has_directive = it.body_statements().is_some_and(|body| {
                body.iter()
                    .map_while(Stmt::directive)
                    .any(|it| it == b"use strict")
            });
            if has_directive {
                let message =
                    "Illegal 'use strict' directive in function with non-simple parameter list";
                let body = it.body_span().map_or(0, |it| it.start);
                self.when_read_to(body, |checks| checks.fail(it.estree_span().start, message));
            }
        }
    }

    /// `checkYieldAwaitInDefaultParams`
    fn defaults_that_suspend(&mut self) {
        for (tag, message) in [
            (ExprTag::Yield, "Yield expression cannot be a default value"),
            (ExprTag::Await, "Await expression cannot be a default value"),
        ] {
            for it in self.file.exprs_of_kind(tag) {
                let first = Node::Expr(it)
                    .ancestors()
                    .find(|it| matches!(it, Node::Param(_) | Node::Func(_)));
                if matches!(first, Some(Node::Param(_))) {
                    self.fail(it.span().start, message);
                }
            }
        }
    }

    /// What `this` and `super` belong to: `currentThisScope`.
    pub(super) fn this_scope(node: Node<'a>) -> Option<Node<'a>> {
        let mut inside = node;
        for it in node.ancestors() {
            match it {
                Node::Func(func) if func.kind() != FnKind::Arrow => return Some(it),
                // The initializer of a field, not its name.
                Node::Member(member) if member.kind() == MemberKind::Property => {
                    if member.init().map(Node::Expr) == Some(inside) {
                        return Some(it);
                    }
                }
                _ => {}
            }
            inside = it;
        }
        None
    }

    fn supers(&mut self) {
        for it in self.file.exprs_of_kind(ExprTag::Super) {
            let start = it.span().start;
            let scope = Self::this_scope(Node::Expr(it));
            let allows_super = match scope {
                Some(Node::Func(func)) => matches!(
                    func.kind(),
                    FnKind::Method
                        | FnKind::Getter
                        | FnKind::Setter
                        | FnKind::Constructor
                        | FnKind::StaticBlock
                ),
                Some(_) => true,
                None => false,
            };
            if !allows_super {
                match self.is_babel && scope.is_some() {
                    // At the top level Prettier has Babel allow it.
                    true => self.fail(start, "super() call outside constructor of a subclass"),
                    false => self.fail(start, "'super' keyword outside a method"),
                }
                continue;
            }
            let is_called = matches!(it.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::Call(call) if call.callee() == it));
            let is_in_constructor_of_subclass = match scope {
                Some(Node::Func(func)) if func.kind() == FnKind::Constructor => {
                    match func.owner() {
                        Node::Member(member) => {
                            member.is_constructor()
                                && matches!(member.parent(), Node::Class(class) if class.extends().is_some())
                        }
                        _ => false,
                    }
                }
                _ => false,
            };
            if is_called && !is_in_constructor_of_subclass {
                self.fail(start, "super() call outside constructor of a subclass");
            }
        }
    }

    // ───────────────────────────── classes ─────────────────────────────

    /// A `#a` has to be declared by a class around it.
    fn private_names(&mut self) {
        let file = self.file;
        if !strings::contains_char(file.text(), b'#') {
            return;
        }
        let is_declared = |node: Node<'a>, name: &[u8]| {
            let mut inside = node;
            node.ancestors().any(|it| {
                let from = std::mem::replace(&mut inside, it);
                match it {
                    // What a class extends is outside of it.
                    Node::Class(class) if class.extends().map(Node::Expr) != Some(from) => class.members().iter().any(
                        |member| matches!(member.key().map(|it| it.kind()), Some(KeyKind::Private(declared)) if declared.bytes() == name),
                    ),
                    _ => false,
                }
            })
        };
        let undeclared = |name: &[u8]| {
            [
                b"Private field '",
                name,
                b"' must be declared in an enclosing class",
            ]
            .concat()
        };
        for it in file.exprs_of_kind(ExprTag::Dot) {
            let ExprKind::Dot { name, .. } = it.kind() else {
                continue;
            };
            if !name.bytes().starts_with(b"#") {
                continue;
            }
            if matches!(it.kind(), ExprKind::Dot { obj, .. } if matches!(obj.kind(), ExprKind::Super))
            {
                match self.is_babel {
                    true => self.fail(name.start(), "Private fields can't be accessed on super"),
                    false => self.unexpected(name.start()),
                }
            } else if !is_declared(Node::Expr(it), name.bytes()) {
                // Noticed at the end of the outermost class.
                let outermost = Node::Expr(it)
                    .ancestors()
                    .filter(|it| matches!(it, Node::Class(_)))
                    .last();
                let noticed = outermost.map_or(0, |it| it.span().end);
                self.when_read_to(noticed, |checks| {
                    checks.fail(name.start(), undeclared(name.bytes()))
                });
            }
        }
        for it in file.exprs_of_kind(ExprTag::PrivateIdentifier) {
            let ExprKind::PrivateIdentifier(name) = it.kind() else {
                continue;
            };
            // Only the left operand of `in` can be one.
            let is_left_of_in = matches!(it.parent(), Node::Expr(parent)
                if matches!(parent.kind(), ExprKind::Binary { op: BinOp::In, left, .. } if left == it));
            if !is_left_of_in {
                self.unexpected(it.span().start);
            } else if !is_declared(Node::Expr(it), name.bytes()) {
                self.fail(it.span().start, undeclared(name.bytes()));
            }
        }
    }

    /// `parseClass`, `parseClassElement`
    fn classes(&mut self) {
        let file = self.file;
        for class in file.classes() {
            let mut has_constructor = false;
            // The private names so far, each with the accessor that another can complete.
            let mut private: SmallVec<[(&'a [u8], Option<(bool, MemberKind)>); 8]> =
                SmallVec::new();
            for member in class.members() {
                self.class_element(member);
                if member.is_constructor() && member.func().is_some_and(Func::has_body) {
                    if has_constructor {
                        self.fail(
                            member.span().start,
                            "Duplicate constructor in the same class",
                        );
                    }
                    has_constructor = true;
                }
                let Some((key, KeyKind::Private(name))) = member.key().map(|it| (it, it.kind()))
                else {
                    continue;
                };
                let half = matches!(member.kind(), MemberKind::Getter | MemberKind::Setter)
                    .then(|| (member.is_static(), member.kind()));
                match private.iter_mut().find(|it| it.0 == name.bytes()) {
                    None => private.push((name.bytes(), half)),
                    Some(seen) => {
                        let completes = matches!((seen.1, half), (Some(a), Some(b)) if a.0 == b.0 && a.1 != b.1);
                        seen.1 = None;
                        if !completes {
                            let message = [
                                b"Identifier '",
                                name.bytes(),
                                b"' has already been declared",
                            ]
                            .concat();
                            self.fail(key.span(file).start, message);
                        }
                    }
                }
            }
        }
    }

    fn class_element(&mut self, member: Member<'a>) {
        let Some(key) = member.key() else {
            // A constructor.
            let (Some(keyword), Some(func)) = (member.constructor_keyword(), member.func()) else {
                return;
            };
            if member.is_constructor() && func.is_generator() {
                self.fail(keyword.start(), "Constructor can't be a generator");
            } else if member.is_constructor() && func.is_async() {
                self.fail(keyword.start(), "Constructor can't be an async method");
            }
            return;
        };
        let start = key.span(self.file).start;
        // `checkKeyName`
        let is_named = |name: &str| matches!(key.kind(), KeyKind::Ident(it) | KeyKind::String(it) if it.is(name));
        let is_field = member.kind() == MemberKind::Property;
        if matches!(key.kind(), KeyKind::Private(name) if name.is("#constructor")) {
            self.fail(start, "Classes can't have an element named '#constructor'");
        } else if is_field && is_named("constructor") {
            self.fail(start, "Classes can't have a field named 'constructor'");
        } else if is_field && member.is_static() && is_named("prototype") {
            self.fail(start, "Classes can't have a static field named 'prototype'");
        } else if !is_field && member.is_static() && is_named("prototype") {
            self.fail(
                start,
                "Classes may not have a static property named prototype",
            );
        } else if member.is_static() || !is_named("constructor") {
            // Not a constructor.
        } else if matches!(member.kind(), MemberKind::Getter | MemberKind::Setter) {
            self.fail(start, "Constructor can't have get/set modifier");
        } else if member.func().is_some_and(Func::is_generator) {
            self.fail(start, "Constructor can't be a generator");
        } else if member.func().is_some_and(Func::is_async) {
            self.fail(start, "Constructor can't be an async method");
        }
    }

    // ───────────────────────────── more about expressions ─────────────────────────────

    /// `canAwait`. Where it cannot, `await` is a name.
    fn awaits(&mut self) {
        let file = self.file;
        for it in file.exprs_of_kind(ExprTag::Await) {
            let ExprKind::Await(operand) = it.kind() else {
                continue;
            };
            let mut inside = Node::Expr(it);
            let around = Node::Expr(it).ancestors().find(|&outer| {
                let from = std::mem::replace(&mut inside, outer);
                match outer {
                    Node::Func(_) => true,
                    Node::Member(member) => member.init().map(Node::Expr) == Some(from),
                    _ => false,
                }
            });
            let is_module = file.language().source_type == SourceType::Module;
            let start = it.span().start;
            match around {
                Some(Node::Func(func)) if func.is_async() => {}
                Some(Node::Func(func)) if func.kind() == FnKind::StaticBlock => {
                    self.fail(
                        start,
                        "Cannot use await in class static initialization block",
                    );
                }
                None if is_module => {}
                _ if is_module => self.fail(
                    start,
                    "Cannot use keyword 'await' outside an async function",
                ),
                // After a name these go on with the expression.
                _ if matches!(
                    self.token_at(operand.outer_span().start).first(),
                    Some(b'(' | b'[' | b'/' | b'+' | b'-' | b'`')
                ) => {}
                _ => self.unexpected(operand.outer_span().start),
            }
        }
    }

    /// No line break before `=>`.
    fn arrows(&mut self) {
        let file = self.file;
        for it in file.funcs().filter(|it| it.kind() == FnKind::Arrow) {
            let Some(arrow) = it.arrow_span() else {
                continue;
            };
            let before = file.end_of_token_before(arrow.start);
            if strings::index_of_any(
                file.slice(crate::span::Span::new(before, arrow.start)),
                b"\n\r",
            )
            .is_none()
            {
                continue;
            }
            if self.is_babel {
                self.fail(arrow.start, "No line break is allowed before '=>'");
                continue;
            }
            // Without parameters there is nothing that the parentheses could be instead.
            match it.params().is_empty() && it.open_paren().is_some() {
                true => self.unexpected(before.saturating_sub(1)),
                false => self.unexpected(arrow.start),
            }
        }
    }

    fn object_literals(&mut self) {
        let file = self.file;
        let may_have_proto = strings::contains(file.text(), b"__proto__");
        for (i, raw) in file.hir.props.iter().enumerate() {
            let is_default = raw.kind == PropKind::Shorthand
                && matches!(
                    file.hir.exprs.get(raw.value.idx()).map(|it| it.kind),
                    Some(hir::ExprKind::Assign { .. })
                );
            let is_private = matches!(raw.key, hir::PropKey::Private(_));
            if !is_default && !is_private && !(may_have_proto && raw.kind == PropKind::Init) {
                continue;
            }
            let prop = Prop::from_raw(file, i as u32);
            let Node::Expr(object) = prop.parent() else {
                continue;
            };
            if !prop.is_in_tree() || prop.is_jsx_attribute() {
                continue;
            }
            if is_private {
                self.unexpected(raw.pos);
            }
            // `{ a = 1 }` is a pattern only.
            if is_default
                && let Some(ExprKind::Assign { target, .. }) = prop.value().map(|it| it.kind())
                && !object.is_assignment_target()
            {
                let equals = skip_trivia(file.text(), target.span().end);
                let message =
                    "Shorthand property assignments are valid only in destructuring patterns";
                self.when_read_to(object.outer_span().end, |checks| {
                    checks.fail(equals, message)
                });
            }
            let is_proto = |it: Prop<'a>| {
                it.kind() == PropKind::Init
                    && matches!(it.key().map(|it| it.kind()), Some(KeyKind::Ident(name) | KeyKind::String(name)) if name.is("__proto__"))
            };
            if may_have_proto && is_proto(prop) && !object.is_assignment_target() {
                let ExprKind::Object(props) = object.kind() else {
                    continue;
                };
                if props.iter().take_while(|it| *it != prop).any(is_proto) {
                    self.when_read_to(object.outer_span().end, |checks| {
                        checks.fail(raw.pos, "Redefinition of __proto__ property")
                    });
                }
            }
        }
        for (i, raw) in file.hir.pat_props.iter().enumerate() {
            if matches!(raw.key, hir::PropKey::Private(_))
                && file
                    .pat_in_tree(PatProp::from_raw(file, i as u32).value().id().idx())
                    .is_some()
            {
                self.unexpected(raw.key_pos);
            }
        }
        // acorn has no `accessor`: it is the name of a field.
        for raw in file
            .hir
            .members
            .iter()
            .filter(|it| it.flags.contains(Flags::ACCESSOR))
        {
            self.unexpected(raw.name_pos);
        }
    }

    /// `checkExport`, `checkLocalExport`
    fn exports(&mut self) {
        let file = self.file;
        if file.language().source_type != SourceType::Module {
            return;
        }
        let mut exported: Vec<(&'a [u8], u32)> = Vec::new();
        for it in file.body() {
            match it.kind() {
                StmtKind::ExportDefault(_) => {
                    exported.push((&b"default"[..], self.after_token(it.span().start)))
                }
                StmtKind::ExportStar {
                    alias: Some(alias), ..
                } => exported.push((alias.bytes(), alias.start())),
                StmtKind::ExportNamed(export) => {
                    for item in export.items() {
                        exported.push((item.exported().bytes(), item.exported().start()));
                        let local = item.local();
                        if export.has_from() {
                            continue;
                        }
                        if local.is_string() {
                            let message = "A string literal cannot be used as an exported binding without `from`.";
                            self.when_read_to(it.span().end, |checks| {
                                checks.fail(local.start(), message)
                            });
                        } else if !self.is_babel
                            && file.top_level_scope().get_name(local.name()).is_none()
                        {
                            let message =
                                [b"Export '", local.bytes(), b"' is not defined"].concat();
                            self.when_read_to(file.text().len() as u32, |checks| {
                                checks.fail(local.start(), message)
                            });
                        }
                    }
                }
                _ if !it.is_exported() => {}
                _ if it.is_default_export() => exported.push((
                    &b"default"[..],
                    self.after_token(it.export_span().map_or(0, |it| it.start)),
                )),
                StmtKind::Var(list) => {
                    for declaration in list {
                        declaration.pat().for_each_binding(&mut |it| {
                            if let PatKind::Ident(name) = it.kind() {
                                exported.push((name.bytes(), it.span().start));
                            }
                        });
                    }
                }
                StmtKind::Fn(func) => {
                    exported.extend(func.name().map(|it| (it.bytes(), it.start())))
                }
                StmtKind::Class(class) => {
                    exported.extend(class.name().map(|it| (it.bytes(), it.start())))
                }
                _ => {}
            }
        }
        exported.sort_unstable();
        for (first, second) in exported.iter().zip(exported.iter().skip(1)) {
            if first.0 == second.0 {
                self.fail(second.1, [b"Duplicate export '", second.0, b"'"].concat());
            }
        }
    }

    // ───────────────────────────── `break`, `continue`, labels ─────────────────────────────

    /// `parseBreakContinueStatement`
    fn jumps(&mut self) {
        let file = self.file;
        for (tag, is_break) in [(StmtTag::Break, true), (StmtTag::Continue, false)] {
            for it in file.stmts_of_kind(tag) {
                let label = it.label().map(|it| it.name());
                let mut has_target = false;
                for outer in Node::Stmt(it).ancestors() {
                    let statement = match outer {
                        Node::Func(_) => break,
                        Node::Stmt(statement) => statement,
                        _ => continue,
                    };
                    has_target = match (statement.kind(), label) {
                        (StmtKind::Labeled { label: name, body }, Some(label)) if name == label => {
                            // `continue` wants a loop, under this label and others.
                            let mut body = body;
                            while let StmtKind::Labeled { body: inner, .. } = body.kind() {
                                body = inner;
                            }
                            is_break || body.is_loop()
                        }
                        (StmtKind::Switch { .. }, None) => is_break,
                        (_, None) => statement.is_loop(),
                        _ => false,
                    };
                    if has_target {
                        break;
                    }
                }
                if !has_target {
                    self.fail(
                        it.span().start,
                        if is_break {
                            "Unsyntactic break"
                        } else {
                            "Unsyntactic continue"
                        },
                    );
                }
            }
        }
    }

    fn labels(&mut self) {
        for it in self.file.stmts_of_kind(StmtTag::Labeled) {
            let StmtKind::Labeled { label, .. } = it.kind() else {
                continue;
            };
            let is_repeated = (Node::Stmt(it).ancestors())
                .take_while(|it| !matches!(it, Node::Func(_)))
                .any(|it| matches!(it, Node::Stmt(outer) if matches!(outer.kind(), StmtKind::Labeled { label: name, .. } if name == label)));
            if is_repeated {
                self.fail(
                    it.span().start,
                    [b"Label '", label.bytes(), b"' is already declared"].concat(),
                );
            }
        }
    }
}
