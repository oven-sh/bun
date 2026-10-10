use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::no_negated_condition::{fix_conditional_expression, fix_if_statement};

/// Disallow negated conditions.
pub struct NoNegatedCondition;

const NO_NEGATED_CONDITION: Message = Message::new("", "Unexpected negated condition.");

impl Rule for NoNegatedCondition {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-negated-condition", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::If]).exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoNegatedCondition
    }

    fn stmt<'a>(&self, if_stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::If { test, yes: consequent, no: Some(alternate) } = if_stmt.kind()
            && alternate.tag() != StmtTag::If
            && is_negated_expression(test)
        {
            cx.report(test, NO_NEGATED_CONDITION).fix(|fixer| fix_if_statement(fixer, test, consequent, alternate));
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Cond { test, yes, no } = e.kind()
            && is_negated_expression(test)
        {
            cx.report(test, NO_NEGATED_CONDITION).fix(|fixer| fix_conditional_expression(fixer, e, test, yes, no));
        }
    }
}

/// `!a`, `a != b`, `a !== b`
fn is_negated_expression(expr: Expr) -> bool {
    matches!(
        expr.kind(),
        ExprKind::Unary { op: UnOp::Not, .. } | ExprKind::Binary { op: BinOp::NotEq | BinOp::NotEqEq, .. }
    )
}
