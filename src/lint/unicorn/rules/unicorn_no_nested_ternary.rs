use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::unicorn::concat;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow nested ternary expressions.
pub struct NoNestedTernary;

const UNPARENTHESIZED_NESTED_TERNARY: Message = Message::new("", "Unexpected nested ternary expression without parentheses.");
const DEEPLY_NESTED_TERNARY: Message = Message::new("", "Unexpected deeply nested ternary expression.");

impl Rule for NoNestedTernary {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-nested-ternary", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoNestedTernary
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let conditional_around = |it: Expr<'a>| it.parent().as_expr().filter(|parent| parent.tag() == ExprTag::Cond);
        let Some(parent) = conditional_around(e) else {
            return;
        };
        let ExprKind::Cond { test, yes, no } = e.kind() else {
            return;
        };
        // The innermost is what is reported.
        if [test, yes, no].into_iter().any(|it| get_inner_expression(it).tag() == ExprTag::Cond) {
            return;
        }
        if conditional_around(parent).is_some() {
            cx.report(e, DEEPLY_NESTED_TERNARY);
        } else if !e.is_parenthesized() {
            cx.report(e, UNPARENTHESIZED_NESTED_TERNARY).fix(|fixer| fixer.replace(e, concat(&[b"(", e.text(), b")"])));
        }
    }
}
