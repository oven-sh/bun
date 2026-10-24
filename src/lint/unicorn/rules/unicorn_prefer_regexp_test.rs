use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::visible::{VisibleRegExp, is_visibly_string, visible_regexp};

/// Prefers `RegExp#test()` over `String#match()` and `String#exec()`.
pub struct PreferRegexpTest;

const PREFER_REGEXP_TEST: Message =
    Message::new("", "Prefer `RegExp#test()` over `String#match()` and `RegExp#exec()`.");

/// A literal that isn't a regular expression.
fn is_other_literal(e: Expr) -> bool {
    !e.is_parenthesized()
        && matches!(
            e.tag(),
            ExprTag::True | ExprTag::False | ExprTag::Null | ExprTag::Number | ExprTag::BigInt | ExprTag::String
        )
}

/// True if only `call`'s truthiness matters.
fn is_in_boolean_position(call: Expr) -> bool {
    if call.is_chain_root() {
        return false;
    }
    match call.parent() {
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::For { test, .. } => test == Some(call) && !call.is_parenthesized(),
            StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::If { .. } => true,
            _ => false,
        },
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Cond { test, .. } => test == call && !call.is_parenthesized(),
            ExprKind::Call(outer) => outer.callee().is_ident("Boolean") && !outer.callee().is_parenthesized(),
            ExprKind::Unary { op, .. } => !matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
            _ => false,
        },
        _ => false,
    }
}

impl Rule for PreferRegexpTest {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-regexp-test", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().method_calls(&["match", "exec"]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferRegexpTest
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions_any(&["match", "exec"]) { Self::ON } else { On::new() }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| it.args().len() == 1 && !it.is_optional()) else {
            return;
        };
        let Some(ExprKind::Dot { obj, name, .. }) = get_member_expr(call.callee()).map(Expr::kind) else {
            return;
        };
        let Some(argument) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
            return;
        };
        let is_match = match name.bytes() {
            b"match" => true,
            b"exec" => false,
            _ => return,
        };
        if is_other_literal(obj) || is_match && is_other_literal(argument) || !is_in_boolean_position(e) {
            return;
        }
        // oxlint assumes every `.exec` is `RegExp#exec` and every `.match` is `String#match`. But `database.exec(sql)`
        // is a different method, and `text.match("a")` passes a string, which has no `test`.
        let is_safe = || match is_match {
            // With the `g` flag, `test` resumes from `lastIndex` but `match` always starts at 0.
            true => visible_regexp(argument) == Some(VisibleRegExp::NotGlobal) && is_visibly_string(obj),
            false => visible_regexp(obj).is_some(),
        };
        cx.report(name, PREFER_REGEXP_TEST).fix_where_safe(is_safe, |fixer| {
            let mut fixes = vec![fixer.replace(name, "test")];
            if is_match {
                let (file, string, regexp) = (fixer.file(), obj.outer_span(), argument.outer_span());
                fixes.push(fixer.replace(regexp, file.slice(string)));
                fixes.push(fixer.replace(string, file.slice(regexp)));
            }
            fixes
        });
    }
}
