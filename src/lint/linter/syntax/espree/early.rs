//! The early errors that hold whatever the configuration says. acorn checks them as it parses. TypeScript's parser leaves them
//! to the type checker.
//!
//! Code that runs has none of them, so what matters is that finding none is cheap: each check goes through the nodes of one
//! kind, of which there are few or none.

use super::{Checks, Tops};
use crate::ast::{
    BinOp, Chain, Class, Expr, ExprKind, ExprTag, FnKind, Func, Handle, KeyKind, Member,
    MemberKind, Node, Param, PatElem, PatKind, PatProp, Prop, PropKind, Stmt, StmtKind, StmtTag,
    UnOp, VarKind,
};
use crate::language::SourceType;
use crate::linter::syntax::oxc::{closest, private_name_as_operand};
use crate::linter::syntax::{Stage, SyntaxError};
use crate::regex;
use crate::tokens::skip_trivia;
use crate::types::IdMap;
use crate::utils::ancestor_memo::AncestorMemo;
use bun_core::strings;
use bun_sema::bind::Parent;
use bun_sema::hir::{self, DiagnosticKind, Flags, ModifierKind, rare};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::hash_map::Entry;

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

impl<'a> Checks<'a, '_> {
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
        self.defaults_that_suspend(false);
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

    /// Those of [`Checks::early_errors`] of which it is known that OXC has them, and has them for the same code. It knows
    /// decorators, `accessor` and `import defer`, and it lets much pass that acorn does not.
    pub(super) fn early_errors_of_oxc(&mut self) {
        // Where only the parser counts, what only the other pass reports is not looked for.
        let all = !self.only_parser;
        let file = self.file;
        let (kinds, counts) = (file.bound.expr_kinds, file.bound.expr_kind_counts);
        let are_counted = kinds.len() == file.hir.exprs.len();
        let has_none = |tag: ExprTag| are_counted && counts.get(2 * tag as usize) == Some(&0);
        self.early_errors_of_oxc_parser();
        if !self.is_oxfmt && !has_none(ExprTag::Regex) {
            self.regular_expressions();
        }
        if all {
            self.defaults_that_suspend(true);
            self.suspensions_in_static_blocks();
            self.jumps();
            self.labels();
        }
        // Nearly no file has any of what the rest looks for, and nothing in a declaration file runs.
        // The other bits are for other checks.
        let bits = (0x00ff & !rare::SUSPENDS_IN_PARAMETERS) | rare::NEW_TARGET;
        let has_nothing_rare = !file.has_rare_syntax(bits)
            && (!all || has_none(ExprTag::Super))
            && file.hir.diagnostics.is_empty()
            && !file.mentions("__proto__");
        if has_nothing_rare || file.is_declaration_file() {
            return;
        }
        if all {
            self.strict_mode();
            self.octals_in_strict_code();
            self.deleted_private_fields();
            self.supers();
        }
        self.statement_positions();
        self.new_targets();
        self.functions();
        self.private_names();
        self.classes();
        self.object_literals();
    }

    /// Those of them that its parser reports, not the pass that builds the scopes.
    fn early_errors_of_oxc_parser(&mut self) {
        // In TypeScript a variable can be only declared.
        if self.file.is_javascript() {
            self.declarations();
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
        // Nearly all are a name or a member, about which there is nothing to say wherever they are.
        let is_plain = |target: Expr<'a>| match target.tag() {
            ExprTag::Ident => true,
            ExprTag::Dot | ExprTag::Index => target.chain() == Chain::No,
            _ => false,
        };
        for it in self.exprs_of(ExprTag::Assign) {
            let Some((op, target, _)) = it.as_assign() else {
                continue;
            };
            // A default in a pattern is looked at with the pattern.
            if is_plain(target) || it.is_assignment_target() {
                continue;
            }
            self.when_read_to(target.outer_span().end, |checks| match op {
                // `a?.b = c` is a proposal that Prettier has Babel accept.
                _ if checks.is_babel && target.is_in_optional_chain() => {}
                None => checks.to_assignable(target, 0),
                Some(_) => checks.check_simple_target(target),
            });
        }
        for it in self.exprs_of(ExprTag::Unary) {
            if let Some((UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand)) =
                it.as_unary()
                && !is_plain(operand)
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
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
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
        let mut functions: AncestorMemo<'a, Func<'a>> = AncestorMemo::default();
        let mut parameters: AncestorMemo<'a, bool> = AncestorMemo::default();
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
            let arrow = functions
                .find(Node::Pat(pat), |_, parent| parent.as_func())
                .filter(|it| it.kind() == FnKind::Arrow);
            let is_parameter = parameters.find(Node::Pat(pat), |_, parent| match parent {
                Node::Param(_) => Some(true),
                Node::Func(_) => Some(false),
                _ => None,
            }) == Some(true);
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
        if self.lacks(rare::ODD_DECLARATION | rare::ODD_LOOP_HEAD) {
            return;
        }
        let (file, hir, bound) = (self.file, &self.file.hir, &self.file.bound);
        for (i, raw) in hir.var_decls.iter().enumerate() {
            let is_pattern = || {
                matches!(
                    hir.pats.get(raw.pat.idx()).map(|it| it.kind),
                    Some(hir::PatKind::Object(_) | hir::PatKind::Array(_))
                )
            };
            // For oxc see `declarations_without_initializer`.
            if self.is_oxc
                || raw.init.is_some()
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
            let Some(list) = it.as_var() else {
                continue;
            };
            // For oxc see `declaration_list`, here and below.
            if list.is_empty() && !self.is_oxc {
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
                    if !self.is_oxc {
                        self.unexpected(left.span().end);
                    }
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
                    let stage = match tag == StmtTag::ForIn && first.var_kind() != VarKind::Var {
                        true => Stage::Parser,
                        false => Stage::Semantic,
                    };
                    match self.is_oxc {
                        true => self.report(SyntaxError::of_oxc(left.span(), message).stage(stage)),
                        false => self.when_read_to(left.span().end, |checks| {
                            checks.fail(left.span().start, message)
                        }),
                    }
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
        if self.lacks(rare::DECLARATION_AS_BODY) {
            return;
        }
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
                    let between = self.file.slice(crate::span::Span::new(start, next));
                    match self.token_at(next) {
                        b"[" => self.lexical_as_body(it),
                        // A semicolon is inserted after the name. TypeScript's parser reads a declaration.
                        _ if strings::contains_js_line_break(between) => {}
                        _ if self.is_oxc => {
                            let after = start + "let".len() as u32;
                            self.report(SyntaxError::semicolon_after(after));
                        }
                        _ => self.unexpected(next),
                    }
                }
                Some(VarKind::Const) => self.lexical_as_body(it),
                Some(_) if self.is_oxc => self.lexical_as_body(it),
                Some(_) => self.fail(
                    start,
                    "Using declaration is not allowed in single-statement positions",
                ),
            },
            StmtKind::Class(class) if self.is_oxc => {
                let head = crate::span::Span::new(start, class.body_span().start);
                self.report(
                    SyntaxError::of_oxc(head, "Invalid class declaration")
                        .help("Classes can only be declared at top level or inside a block")
                        .stage(Stage::Parser),
                );
            }
            StmtKind::Class(_) => self.unexpected(start),
            StmtKind::Fn(func) if self.is_oxc && (func.is_async() || func.is_generator()) => {
                let end = func.close_paren().map_or(start, |it| it + 1);
                let message = match func.is_async() {
                    true => {
                        "Async functions can only be declared at the top level or inside a block"
                    }
                    false => "Generators can only be declared at the top level or inside a block",
                };
                let head = crate::span::Span::new(start, end);
                self.report(SyntaxError::of_oxc(head, message).stage(Stage::Parser));
            }
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
                if !is_allowed && self.is_oxc {
                    let help = match self.is_strict(Node::Stmt(parent)) {
                        true => {
                            "In strict mode code, functions can only be declared at top level or inside a block"
                        }
                        false => {
                            "In non-strict mode code, functions can only be declared at top level, inside a block, or as the body of an if statement"
                        }
                    };
                    self.report(
                        SyntaxError::of_oxc(it.span(), "Invalid function declaration").help(help),
                    );
                } else if !is_allowed {
                    self.unexpected(start);
                } else if func.is_generator() {
                    self.unexpected(self.after_token(start));
                }
            }
            _ => {}
        }
    }

    /// `let [a] = b`, `const a = 1` or `using a = b` as a body.
    fn lexical_as_body(&mut self, it: Stmt<'a>) {
        if !self.is_oxc {
            return self.unexpected(it.span().start);
        }
        let message = match it.flags().contains(Flags::AMBIENT) {
            true => "Declaration cannot appear in a single-statement context",
            false => "Lexical declaration cannot appear in a single-statement context",
        };
        self.report(
            SyntaxError::of_oxc(it.span(), message)
                .help("Wrap this declaration in a block statement")
                .stage(Stage::Parser),
        );
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
        if self.lacks(rare::DELETES_A_NAME) {
            return;
        }
        for it in self.exprs_of(ExprTag::Unary) {
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
                if let (true, ExprKind::Dot { name, .. }) = (self.is_oxc, operand.kind()) {
                    let is_chained = matches!(
                        operand.try_raw().map(|it| it.kind),
                        Some(hir::ExprKind::Dot { chain, .. }) if chain != hir::Chain::No
                    );
                    let label = match is_chained {
                        true => name.span(),
                        false => operand.span(),
                    };
                    let message =
                        "The operand of a 'delete' operator cannot be a private identifier.";
                    self.report(SyntaxError::of_oxc(label, message));
                    continue;
                }
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
        for it in self.exprs_of(ExprTag::ImportCall) {
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
        self.new_targets();
    }

    fn new_targets(&mut self) {
        let file = self.file;
        if self.lacks(rare::NEW_TARGET) {
            return;
        }
        let of_new = "The only valid meta property for new is 'new.target'";
        for it in self.exprs_of(ExprTag::NewTarget) {
            // acorn throws the first of its three complaints about one `new.target`, wherever the others are.
            let name = self.after_token(self.after_token(it.span().start));
            let is_target = matches!(
                it.try_raw().map(|it| it.kind),
                Some(hir::ExprKind::NewTarget(name)) if file.name(name).bytes() == b"target"
            );
            if !is_target && self.is_oxc {
                let message = "The only valid meta property for new is new.target";
                self.report(SyntaxError::of_oxc(it.span(), message).stage(Stage::Fatal));
                continue;
            }
            if !is_target || self.is_babel && self.token_at(name) != b"target" {
                self.fail(name, of_new);
                continue;
            }
            if self.token_at(name) != b"target" && self.is_oxc {
                let message = "Keywords cannot contain escape characters";
                let name = self.token_span(name);
                self.report(SyntaxError::of_oxc(name, message).stage(Stage::Parser));
                continue;
            }
            if self.token_at(name) != b"target" {
                self.fail(
                    it.span().start,
                    "'new.target' must not contain escaped characters",
                );
                continue;
            }
            // `allowNewDotTarget`: in a function that is not an arrow function, in the initializer of a field, in a static block.
            let is_allowed = Self::this_scope(&mut self.tops, Node::Expr(it)).is_some();
            // The top level of a CommonJS file is a function.
            if !is_allowed && self.source_type() != SourceType::CommonJs && self.is_oxc {
                let help = "new.target is only allowed in constructors, functions, and class field initializers";
                self.report(
                    SyntaxError::of_oxc(it.span(), "Unexpected new.target expression")
                        .help(help)
                        .stage(Stage::Parser),
                );
            } else if !is_allowed && self.source_type() != SourceType::CommonJs {
                self.fail(
                    it.span().start,
                    "'new.target' can only be used in functions and class static block",
                );
            }
        }
    }

    /// `validateRegExpFlags`, `validateRegExpPattern`
    fn regular_expressions(&mut self) {
        for it in self.exprs_of(ExprTag::Regex) {
            let ExprKind::Regex(literal) = it.kind() else {
                continue;
            };
            let (pattern, flags, at) = (literal.pattern(), literal.flags(), it.span().start + 1);
            if self.is_oxc {
                self.regular_expression_of_oxc(it.span(), pattern, flags);
                continue;
            }
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

    /// What oxc says about the regular expression at `literal`. Its lexer reads the flags, and what that reports is printed
    /// before all that the parser reports.
    fn regular_expression_of_oxc(
        &mut self,
        literal: crate::span::Span,
        pattern: &[u8],
        flags: &[u8],
    ) {
        use crate::span::Span;
        // One without an end has no flags: see `oxc::of_typescript`.
        let has_no_end = |it: &hir::Diagnostic| it.code == 1161 && it.start == literal.start;
        if self.file.hir.diagnostics.iter().any(has_no_end) {
            return;
        }
        let first_flag = literal.end - flags.len() as u32;
        let before = self.all.len();
        for (i, flag) in flags.iter().enumerate() {
            let at = first_flag + i as u32;
            if !flag.is_ascii() {
                return self.report(SyntaxError::semicolon_after(at));
            }
            let (message, help) = if !strings::contains_char(b"gimsuydv", *flag) {
                let message = format!(
                    "Unexpected flag {} in regular expression literal",
                    *flag as char
                );
                (message, "The allowed flags are `gimsuydv`")
            } else if strings::contains_char(&flags[..i], *flag) {
                let message = format!(
                    "Flag {} is mentioned twice in regular expression literal",
                    *flag as char
                );
                (message, "Remove the duplicated flag here")
            } else {
                continue;
            };
            self.report(
                SyntaxError::of_oxc(Span::new(at, at + 1), message)
                    .help(help)
                    .stage(Stage::Parser)
                    .noticed_at(0),
            );
        }
        if self.all.len() > before {
            return self
                .report(SyntaxError::of_oxc(literal, "Unexpected token").stage(Stage::Fatal));
        }
        let both = strings::index_of_char_usize(flags, b'u')
            .zip(strings::index_of_char_usize(flags, b'v'));
        if let Some((u, v)) = both {
            let second = first_flag + u.max(v) as u32;
            self.report(
                SyntaxError::of_oxc(
                    Span::new(second, second + 1),
                    "Invalid regular expression: Invalid unicode flags combination `u` and `v`",
                )
                .help("The `v` flag is a superset of `u`. Use only either of them")
                .stage(Stage::Parser)
                .noticed_at(literal.end),
            );
            let message =
                "The 'u' and 'v' regular expression flags cannot be enabled at the same time";
            return self.report(
                SyntaxError::of_oxc(literal, message)
                    .code(1502)
                    .help("v flag enables additional syntax over u flag")
                    .stage(Stage::Parser)
                    .noticed_at(literal.end),
            );
        }
        let validated = regex::validate_pattern(
            pattern,
            regex::Mode::of_flags(flags),
            regex::Options::default(),
            &mut regex::Ignore,
        );
        // It takes some of what is refused here.
        let Some(said) = validated.err().and_then(|it| it.oxc) else {
            return;
        };
        let start = literal.start + 1;
        let message = format!("Invalid regular expression: {}", said.message);
        let marked = Span::new(start + said.start, start + said.end);
        let mut error = SyntaxError::of_oxc(marked, message)
            .help(said.help)
            .stage(Stage::Parser);
        if let Some(also) = said.also {
            error = error.and(Span::new(start + also.0, start + also.1), "");
        }
        self.report(error);
    }

    /// `??` beside `&&` or `||`, a template after an optional chain.
    fn operators(&mut self) {
        let file = self.file;
        for it in self.exprs_of(ExprTag::Binary) {
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
        for it in self.exprs_of(ExprTag::TaggedTemplate) {
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
        for it in self.exprs_of(ExprTag::ImportCall) {
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
        let may_have_directive =
            !self.lacks(rare::DIRECTIVE_IN_FUNCTION) && file.mentions("use strict");
        if !may_have_directive && self.lacks(rare::ODD_ACCESSOR) {
            return;
        }
        for it in file.funcs() {
            if !may_have_directive && !matches!(it.kind(), FnKind::Getter | FnKind::Setter) {
                continue;
            }
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
            if self.is_oxc
                && wrong.is_some()
                && let Some(list) = it.params_span()
            {
                self.report(
                    match (it.kind(), params.len()) {
                        (FnKind::Getter, _) => {
                            let message = "A 'get' accessor must not have any formal parameters.";
                            SyntaxError::of_oxc(list, message).help("Remove these parameters here")
                        }
                        (_, 1) => {
                            let rest = params.first().map_or(list, |it| it.span());
                            SyntaxError::of_oxc(
                                rest,
                                "A 'set' accessor cannot have rest parameter.",
                            )
                        }
                        (_, count) => {
                            let message = "A 'set' accessor must have exactly one parameter.";
                            SyntaxError::of_oxc(list, message)
                                .code(1049)
                                .help(match count {
                                    0 => "Add a parameter here",
                                    _ => "Remove parameters except the first one here",
                                })
                        }
                    }
                    .stage(Stage::Parser),
                );
            } else if let Some((at, message)) = wrong {
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
            let directive = it.body_statements().and_then(|body| {
                body.iter()
                    .take_while(|it| it.directive().is_some())
                    .find(|it| it.directive() == Some(b"use strict"))
            });
            let has_directive = directive.is_some();
            let message =
                "Illegal 'use strict' directive in function with non-simple parameter list";
            if let (true, Some(directive)) = (self.is_oxc, directive) {
                let help = "Wrap this function with an IIFE with a 'use strict' directive that returns this function";
                self.report(SyntaxError::of_oxc(directive.span(), message).help(help));
            } else if has_directive {
                let body = it.body_span().map_or(0, |it| it.start);
                self.when_read_to(body, |checks| checks.fail(it.estree_span().start, message));
            }
        }
    }

    /// `checkYieldAwaitInDefaultParams`. `of_oxc`: in oxc's words. It labels the whole expression, and has the error for a
    /// computed key in a parameter's type too.
    fn defaults_that_suspend(&mut self, of_oxc: bool) {
        if self.lacks(rare::SUSPENDS_IN_PARAMETERS) {
            return;
        }
        let words = [
            (ExprTag::Yield, "Yield", "yield"),
            (ExprTag::Await, "Await", "await"),
        ];
        for (tag, of_acorn, word) in words {
            for it in self.exprs_of(tag) {
                // For oxc neither `this` nor the key of an index signature is a formal parameter, and a signature in a type does
                // not end the parameter that the type is of.
                let first = self.tops.outward(Node::Expr(it)).find(|&it| match it {
                    Node::Param(param) => {
                        let function = param.func();
                        !(of_oxc
                            && function.is_some_and(|it| {
                                it.kind() == FnKind::IndexSignature
                                    || it.this_param() == Some(param)
                            }))
                    }
                    // Within a type nothing else is without a body.
                    Node::Func(function) => !of_oxc || function.has_body(),
                    _ => false,
                });
                if !matches!(first, Some(Node::Param(_))) {
                    continue;
                }
                let span = it.span();
                match of_oxc {
                    true => {
                        let message = format!("{word} expression not allowed in formal parameter");
                        self.report(SyntaxError::of_oxc(span, message.clone()).says(message));
                    }
                    false => {
                        let message = format!("{of_acorn} expression cannot be a default value");
                        self.fail(span.start, message);
                    }
                }
            }
        }
    }

    /// For oxc: `await` and `await using` in a static block. A function in the block starts anew.
    fn suspensions_in_static_blocks(&mut self) {
        if self.lacks(rare::SUSPENDS_IN_STATIC_BLOCK) {
            return;
        }
        // A signature in a type starts nothing.
        let is_signature = |it: &Func| match it.kind() {
            FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => true,
            // Of an interface or a type literal. A class has them without a body too.
            FnKind::Method | FnKind::Getter | FnKind::Setter => {
                let mut around = Node::Func(*it).ancestors();
                !it.has_body()
                    && !matches!(
                        around.find(|it| !matches!(it, Node::Member(_))),
                        Some(Node::Class(_))
                    )
            }
            _ => false,
        };
        let is_in_block = |node: Node<'a>| {
            let mut function = node.enclosing_function();
            while let Some(signature) = function.filter(is_signature) {
                function = Node::Func(signature).enclosing_function();
            }
            function.is_some_and(|it| it.kind() == FnKind::StaticBlock)
        };
        for it in self.exprs_of(ExprTag::Await) {
            if is_in_block(Node::Expr(it)) {
                let start = it.span().start;
                let keyword = crate::span::Span::new(start, start + 5);
                let message = "Cannot use await in class static initialization block";
                // oxc says it when it has the operand.
                self.report(SyntaxError::of_oxc(keyword, message).noticed_at(it.span().end));
            }
        }
        for it in self.file.stmts_of_kind(StmtTag::Var) {
            let first = it.as_var().and_then(|it| it.first());
            if first.is_some_and(|it| it.var_kind() == VarKind::AwaitUsing)
                && is_in_block(Node::Stmt(it))
            {
                let message = b"Cannot use 'await using' in class static initialization block";
                self.fail_for(it.span(), message.to_vec());
            }
        }
    }

    /// What `this` and `super` belong to: `currentThisScope`.
    pub(super) fn this_scope(tops: &mut Tops<'a>, node: Node<'a>) -> Option<Node<'a>> {
        let mut inside = node;
        for it in tops.outward(node) {
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
        for it in self.exprs_of(ExprTag::Super) {
            let start = it.span().start;
            let scope = Self::this_scope(&mut self.tops, Node::Expr(it));
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
            let call = match it.parent() {
                Node::Expr(parent) if matches!(parent.kind(), ExprKind::Call(call) if call.callee() == it) => {
                    Some(parent)
                }
                _ => None,
            };
            let outside_constructor = "Super calls are not permitted outside constructors or in nested functions inside constructors.";
            if !allows_super && self.is_oxc {
                self.report(match call {
                    Some(call) => SyntaxError::of_oxc(call.span(), outside_constructor).code(2337),
                    None => SyntaxError::of_oxc(
                        it.span(),
                        "'super' can only be referenced in members of derived classes or object literal expressions.",
                    ),
                });
                continue;
            }
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
            let class_of_constructor = match scope {
                Some(Node::Func(func)) if func.kind() == FnKind::Constructor => {
                    match func.owner().parent() {
                        Node::Class(class) => Some(class),
                        _ => None,
                    }
                }
                _ => None,
            };
            if let (true, Some(call), false) = (self.is_oxc, call, is_in_constructor_of_subclass) {
                self.report(match class_of_constructor {
                    Some(class) => {
                        let message = "'super' can only be referenced in a derived class.";
                        SyntaxError::of_oxc(it.span(), message)
                            .and(class.estree_span(), "class does not have `extends`")
                            .help("either remove this super, or extend the class")
                            .noticed_at(start)
                    }
                    None => SyntaxError::of_oxc(call.span(), outside_constructor).code(2337),
                });
            } else if is_called && !is_in_constructor_of_subclass {
                self.fail(start, "super() call outside constructor of a subclass");
            }
        }
    }

    // ───────────────────────────── classes ─────────────────────────────

    /// A `#a` has to be declared by a class around it.
    fn private_names(&mut self) {
        let file = self.file;
        let is_oxc = self.is_oxc;
        if self.lacks(rare::ODD_PRIVATE_NAME) || !strings::contains_char(file.text(), b'#') {
            return;
        }
        // The private names of a class are collected once: there can be as many of them as there are uses.
        let mut names_of: IdMap<Class<'a>, FxHashSet<&'a [u8]>> = IdMap::default();
        let mut is_declared = |tops: &mut Tops<'a>, node: Node<'a>, name: &[u8]| {
            let mut inside = node;
            tops.outward(node).any(|it| {
                let from = std::mem::replace(&mut inside, it);
                match it {
                    // What a class extends is outside of it. For oxc its decorators are, too.
                    Node::Class(class)
                        if match is_oxc {
                            true => matches!(from, Node::Member(_)),
                            false => class.extends().map(Node::Expr) != Some(from),
                        } =>
                    {
                        let private = |member: Member<'a>| match member.key().map(|it| it.kind()) {
                            Some(KeyKind::Private(declared)) => Some(declared.bytes()),
                            _ => None,
                        };
                        names_of
                            .get_or_insert_with(class, || {
                                class.members().iter().filter_map(private).collect()
                            })
                            .contains(name)
                    }
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
        for it in self.exprs_of(ExprTag::Dot) {
            let ExprKind::Dot { name, .. } = it.kind() else {
                continue;
            };
            if !name.bytes().starts_with(b"#") {
                continue;
            }
            if matches!(it.kind(), ExprKind::Dot { obj, .. } if matches!(obj.kind(), ExprKind::Super))
            {
                match (self.is_babel, self.is_oxc) {
                    (true, _) => {
                        self.fail(name.start(), "Private fields can't be accessed on super")
                    }
                    (_, true) => {
                        let message = "Private fields cannot be accessed on super";
                        self.report(SyntaxError::of_oxc(it.span(), message).stage(Stage::Parser));
                    }
                    _ => self.unexpected(name.start()),
                }
            } else if !is_declared(&mut self.tops, Node::Expr(it), name.bytes()) {
                // Noticed at the end of the outermost class.
                let mut inside = Node::Expr(it);
                let outermost = (self.tops.outward(Node::Expr(it)))
                    .filter(|&outer| {
                        let from = std::mem::replace(&mut inside, outer);
                        // oxc: what a class extends and its decorators are outside of it.
                        matches!(outer, Node::Class(_))
                            && (!is_oxc || matches!(from, Node::Member(_)))
                    })
                    .last();
                if self.is_oxc && outermost.is_none() {
                    let message = [
                        b"Private identifier '",
                        name.bytes(),
                        b"' is not allowed outside class bodies",
                    ];
                    self.report(SyntaxError::of_oxc(name.span(), message.concat()));
                    continue;
                }
                if self.is_oxc {
                    let error = SyntaxError::of_oxc(name.span(), undeclared(name.bytes()));
                    let help = self.private_name_like(Node::Expr(it), name.bytes());
                    self.report(error.help(help));
                    continue;
                }
                let noticed = outermost.map_or(0, |it| it.span().end);
                self.when_read_to(noticed, |checks| {
                    checks.fail(name.start(), undeclared(name.bytes()))
                });
            }
        }
        for it in self.exprs_of(ExprTag::PrivateIdentifier) {
            let ExprKind::PrivateIdentifier(name) = it.kind() else {
                continue;
            };
            if is_oxc && let Some(error) = private_name_as_operand(file, it.span()) {
                self.report(error);
                continue;
            }
            // Only the left operand of `in` can be one.
            let is_left_of_in = matches!(it.parent(), Node::Expr(parent)
                if matches!(parent.kind(), ExprKind::Binary { op: BinOp::In, left, .. } if left == it));
            if !is_left_of_in {
                self.unexpected(it.span().start);
            } else if !is_declared(&mut self.tops, Node::Expr(it), name.bytes()) {
                let mut inside = Node::Expr(it);
                let is_in_class_body = self.tops.outward(Node::Expr(it)).any(|outer| {
                    let from = std::mem::replace(&mut inside, outer);
                    matches!(outer, Node::Class(_)) && matches!(from, Node::Member(_))
                });
                if is_oxc && !is_in_class_body {
                    let message = [
                        b"Private identifier '",
                        name.bytes(),
                        b"' is not allowed outside class bodies",
                    ];
                    self.report(SyntaxError::of_oxc(it.span(), message.concat()));
                    continue;
                }
                if is_oxc {
                    let error = SyntaxError::of_oxc(it.span(), undeclared(name.bytes()));
                    let help = self.private_name_like(Node::Expr(it), name.bytes());
                    self.report(error.help(help));
                    continue;
                }
                self.fail(it.span().start, undeclared(name.bytes()));
            }
        }
    }

    /// For oxc: "Did you mean '#a'?", if a class around `node` declares a private name that is nearly `name`. Of two that are as
    /// near it is the one of the inner class, and in a class the first.
    fn private_name_like(&mut self, node: Node<'a>, name: &[u8]) -> String {
        let mut inside = node;
        let classes = self.tops.outward(node).filter_map(|outer| {
            let from = std::mem::replace(&mut inside, outer);
            match (outer, from) {
                (Node::Class(class), Node::Member(_)) => Some(class),
                _ => None,
            }
        });
        let declared = classes.flat_map(|class| {
            class
                .members()
                .iter()
                .filter_map(|member| match member.key().map(|it| it.kind()) {
                    Some(KeyKind::Private(declared)) => Some(declared.bytes()),
                    _ => None,
                })
        });
        match closest(name, declared) {
            Some(it) => format!("Did you mean '{}'?", bstr::BStr::new(it)),
            None => String::new(),
        }
    }

    /// `parseClass`, `parseClassElement`
    fn classes(&mut self) {
        let file = self.file;
        if self.lacks(rare::NOTABLE_CLASS_MEMBER) {
            return;
        }
        // The private names of the class so far, each with the accessor that another can complete.
        let mut private: FxHashMap<&'a [u8], Option<(bool, MemberKind)>> = FxHashMap::default();
        // For oxc: where each is declared first, and whether that is static.
        let mut first_private: FxHashMap<&'a [u8], (crate::span::Span, bool)> =
            FxHashMap::default();
        // oxc lets what is only declared be called `prototype`, and be there twice: `declare class A { static prototype: A }`.
        let is_oxc = self.is_oxc;
        let is_only_declared = |flags: Flags| is_oxc && flags.contains(Flags::AMBIENT);
        for class in file.classes() {
            let is_class_declared = is_only_declared(class.flags());
            let mut has_constructor = false;
            let mut constructors = 0;
            let mut first_constructor = crate::span::Span::default();
            private.clear();
            first_private.clear();
            for member in class.members() {
                let is_declared = is_class_declared || is_only_declared(member.flags());
                self.as_parser(|checks| checks.class_element(member, is_declared));
                if is_declared {
                    continue;
                }
                if member.is_constructor() && member.func().is_some_and(Func::has_body) {
                    let name = member.try_raw().map_or(0, |it| it.name_pos);
                    constructors += 1;
                    match (is_oxc, constructors) {
                        (true, 1) => first_constructor = self.token_span(name),
                        (true, 2) => {
                            let message = "Multiple constructor implementations are not allowed.";
                            let again = self.token_span(name);
                            self.report(
                                SyntaxError::of_oxc(first_constructor, message)
                                    .says("constructor has already been declared here")
                                    .and(again, "it cannot be redeclared here"),
                            );
                        }
                        _ => {}
                    }
                    if has_constructor && !is_oxc {
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
                // An overload in TypeScript: `#m(): void; #m() {}`.
                if member.func().is_some_and(|it| !it.has_body()) {
                    continue;
                }
                let half = matches!(member.kind(), MemberKind::Getter | MemberKind::Setter)
                    .then(|| (member.is_static(), member.kind()));
                match private.entry(name.bytes()) {
                    Entry::Vacant(place) => {
                        place.insert(half);
                        first_private.insert(name.bytes(), (key.span(file), member.is_static()));
                    }
                    Entry::Occupied(mut seen) => {
                        let completes = matches!((*seen.get(), half), (Some(a), Some(b)) if a.0 == b.0 && a.1 != b.1);
                        seen.insert(None);
                        let first = first_private.get(name.bytes()).copied();
                        if let (true, false, Some((first, was_static))) = (is_oxc, completes, first)
                        {
                            let again = key.span(file);
                            let mut error =
                                self.redeclared("Identifier", name.bytes(), first, again);
                            if was_static != member.is_static() && !file.is_javascript() {
                                error.message = [
                                    b"Duplicate identifier `",
                                    name.bytes(),
                                    b"`. Static and instance elements cannot share the same private name.",
                                ]
                                .concat();
                                error = error.code(2804);
                            }
                            self.report(error.noticed_at(u32::MAX));
                        } else if !completes {
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

    /// `is_declared`: for oxc, it is only declared.
    fn class_element(&mut self, member: Member<'a>, is_declared: bool) {
        let Some(key) = member.key() else {
            // A constructor.
            let (Some(keyword), Some(func)) = (member.constructor_keyword(), member.func()) else {
                return;
            };
            if is_declared {
                return;
            }
            if member.is_constructor() && self.is_oxc {
                if func.is_async() {
                    self.fail(keyword.start(), "Constructor can't be an async method");
                }
                if func.is_generator() {
                    self.fail(keyword.start(), "Constructor can't be a generator");
                }
            } else if member.is_constructor() && func.is_generator() {
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
        // oxc looks at the name of an `accessor` only if it is private.
        let is_passed_over = self.is_oxc && member.flags().contains(Flags::ACCESSOR);
        if matches!(key.kind(), KeyKind::Private(name) if name.is("#constructor")) {
            self.fail(start, "Classes can't have an element named '#constructor'");
        } else if is_passed_over || is_declared && !(is_field && is_named("constructor")) {
            // Nothing is said about its name.
        } else if is_field && is_named("constructor") {
            self.fail(start, "Classes can't have a field named 'constructor'");
        } else if self.is_oxc && member.is_static() && is_named("prototype") {
            self.fail(
                start,
                "Classes may not have a static property named 'prototype'",
            );
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
        } else if self.is_oxc {
            // It has both to say about `async *constructor() {}`.
            if member.func().is_some_and(Func::is_async) {
                self.fail(start, "Constructor can't be an async method");
            }
            if member.func().is_some_and(Func::is_generator) {
                self.fail(start, "Constructor can't be a generator");
            }
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
        for it in self.exprs_of(ExprTag::Await) {
            let ExprKind::Await(operand) = it.kind() else {
                continue;
            };
            let mut inside = Node::Expr(it);
            let around = self.tops.outward(Node::Expr(it)).find(|&outer| {
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
                file.slice(crate::span::Span::before(before, arrow)),
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
        let proto = file.find_name("__proto__");
        let proto = proto.map(|it| hir::PropKey::Name(it.atom()));
        let may_have_proto = proto.is_some();
        // The rest is about private names as keys, which the parser of oxc stumbles over, and `accessor`, which it knows.
        if !may_have_proto && self.lacks(rare::DEFAULT_IN_OBJECT | rare::ODD_PRIVATE_NAME) {
            return;
        }
        // Outside a class the parser forgets a key that is a private name.
        let is_oxc = self.is_oxc;
        let is_private_name = |at: u32| is_oxc && file.text().get(at as usize) == Some(&b'#');
        let private_key = |at: u32, name: &[u8]| {
            let message = [
                b"Private identifier '",
                name,
                b"' is not allowed in property names",
            ];
            let key = crate::span::Span::new(at, at + name.len() as u32);
            SyntaxError::of_oxc(key, message.concat()).stage(Stage::Parser)
        };
        for (i, raw) in file.hir.props.iter().enumerate() {
            let is_default = raw.kind == PropKind::Shorthand
                && matches!(
                    file.hir.exprs.get(raw.value.idx()).map(|it| it.kind),
                    Some(hir::ExprKind::Assign { .. })
                );
            let is_private =
                matches!(raw.key, hir::PropKey::Private(_)) || is_private_name(raw.pos);
            let may_be_proto = raw.kind == PropKind::Init && Some(raw.key) == proto;
            if !is_default && !is_private && !may_be_proto {
                continue;
            }
            let prop = Prop::from_raw(file, i as u32);
            let Node::Expr(object) = prop.parent() else {
                continue;
            };
            if !prop.is_in_tree() || prop.is_jsx_attribute() {
                continue;
            }
            if is_private && self.is_oxc {
                let error = private_key(raw.pos, self.token_at(raw.pos));
                self.report(error);
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
                if let (true, Some(value)) = (self.is_oxc, prop.value()) {
                    let help = "Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern.";
                    self.report(
                        SyntaxError::of_oxc(value.span(), "Invalid assignment in object literal")
                            .help(help)
                            .stage(Stage::Parser)
                            .noticed_at(u32::MAX),
                    );
                    continue;
                }
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
                let before = props.iter().take_while(|it| *it != prop);
                let mut before = before.filter(|it| is_proto(*it));
                // oxc holds each against the one before it.
                let first = match self.is_oxc {
                    true => before.last(),
                    false => before.next(),
                };
                let keys =
                    first.and_then(|it| Some((it.key()?.span(file), prop.key()?.span(file))));
                if let (true, Some((first, again))) = (self.is_oxc, keys) {
                    let error = self.redeclared("Identifier", b"__proto__", first, again);
                    self.report(error);
                } else if first.is_some() {
                    self.when_read_to(object.outer_span().end, |checks| {
                        checks.fail(raw.pos, "Redefinition of __proto__ property")
                    });
                }
            }
        }
        for (i, raw) in file.hir.pat_props.iter().enumerate() {
            if (matches!(raw.key, hir::PropKey::Private(_)) || is_private_name(raw.key_pos))
                && file
                    .pat_in_tree(PatProp::from_raw(file, i as u32).value().id().idx())
                    .is_some()
            {
                match self.is_oxc {
                    true => {
                        let error = private_key(raw.key_pos, self.token_at(raw.key_pos));
                        self.report(error);
                    }
                    false => self.unexpected(raw.key_pos),
                }
            }
        }
        // acorn has no `accessor`: it is the name of a field.
        let has_accessors = self.is_oxc;
        for raw in file
            .hir
            .members
            .iter()
            .filter(|it| it.flags.contains(Flags::ACCESSOR) && !has_accessors)
        {
            self.unexpected(raw.name_pos);
        }
    }

    /// `checkExport`, `checkLocalExport`
    fn exports(&mut self) {
        let file = self.file;
        // To Prettier a file is a module, also one that `bun fmt` could only parse as a script.
        if !self.is_babel && file.language().source_type != SourceType::Module {
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
        crate::utils::sort::sort_unstable(&mut exported);
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
        if self.lacks(rare::ODD_JUMP) {
            return;
        }
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
                if !has_target && self.is_oxc {
                    self.jump_of_oxc(it, is_break);
                } else if !has_target {
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

    /// A `break` or a `continue` without a target, in the words of oxc.
    fn jump_of_oxc(&mut self, it: Stmt<'a>, is_break: bool) {
        let Some(label) = it.label() else {
            let (message, help) = match is_break {
                true => (
                    "Illegal break statement",
                    "A `break` statement can only be used within an enclosing iteration or switch statement.",
                ),
                false => (
                    "Illegal continue statement: no surrounding iteration statement",
                    "A `continue` statement can only be used within an enclosing `for`, `while` or `do while` ",
                ),
            };
            return self.report(SyntaxError::of_oxc(it.span(), message).help(help));
        };
        let mut crosses_function = false;
        let target = Node::Stmt(it).ancestors().find_map(|outer| match outer {
            Node::Func(_) => {
                crosses_function = true;
                None
            }
            Node::Stmt(outer) => outer
                .label()
                .filter(|it| outer.tag() == StmtTag::Labeled && it.name() == label.name()),
            _ => None,
        });
        self.report(match target {
            None => SyntaxError::of_oxc(label.span(), "Use of undefined label"),
            Some(_) if crosses_function => {
                SyntaxError::of_oxc(label.span(), "Jump target cannot cross function boundary.")
            }
            Some(target) => SyntaxError::of_oxc(
                target.span(),
                "A `continue` statement can only jump to a label of an enclosing `for`, `while` or `do while` statement.",
            )
            .says("This is an non-iteration statement")
            .and(label.span(), "for this label"),
        });
    }

    fn labels(&mut self) {
        if self.lacks(rare::ODD_JUMP) {
            return;
        }
        for it in self.file.stmts_of_kind(StmtTag::Labeled) {
            let StmtKind::Labeled { label, .. } = it.kind() else {
                continue;
            };
            let first = (Node::Stmt(it).ancestors())
                .take_while(|it| !matches!(it, Node::Func(_)))
                .find(|it| matches!(it, Node::Stmt(outer) if matches!(outer.kind(), StmtKind::Labeled { label: name, .. } if name == label)));
            let is_repeated = first.is_some();
            if let (true, Some(first)) = (self.is_oxc, first) {
                let (first, again) = (
                    self.token_span(first.span().start),
                    self.token_span(it.span().start),
                );
                let error = self.redeclared("Label", label.bytes(), first, again);
                self.report(error);
            } else if is_repeated {
                self.fail(
                    it.span().start,
                    [b"Label '", label.bytes(), b"' is already declared"].concat(),
                );
            }
        }
    }
}
