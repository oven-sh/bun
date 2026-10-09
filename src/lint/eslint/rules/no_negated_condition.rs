use bun_lint::prelude::*;
use bun_lint_oxlint::no_negated_condition::{fix_conditional_expression, fix_if_statement};

/// Disallow negated conditions.
pub struct NoNegatedCondition;

const UNEXPECTED_NEGATED: Message = Message::new("unexpectedNegated", "Unexpected negated condition.");

/// ESLint's `isNegatedIf`
fn is_negated(test: Expr) -> bool {
    matches!(
        test.kind(),
        ExprKind::Unary { op: UnOp::Not, .. } | ExprKind::Binary { op: BinOp::NotEq | BinOp::NotEqEq, .. }
    )
}

impl Rule for NoNegatedCondition {
    const META: Meta = Meta::eslint("no-negated-condition", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNegatedCondition
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], |_, stmt, cx| {
            if let StmtKind::If { test, yes, no: Some(no) } = stmt.kind()
                && no.tag() != StmtTag::If
                && is_negated(test)
            {
                // oxlint points at the test, and has a fix.
                match cx.language().is_oxlint {
                    true => cx.report(test, UNEXPECTED_NEGATED).fix(|fixer| fix_if_statement(fixer, test, yes, no)),
                    false => cx.report(stmt, UNEXPECTED_NEGATED),
                };
            }
        });
        on.exprs([ExprTag::Cond], |_, e, cx| {
            if let ExprKind::Cond { test, yes, no } = e.kind()
                && is_negated(test)
            {
                match cx.language().is_oxlint {
                    true => (cx.report(test, UNEXPECTED_NEGATED))
                        .fix(|fixer| fix_conditional_expression(fixer, e, test, yes, no)),
                    false => cx.report(e, UNEXPECTED_NEGATED),
                };
            }
        });
    }
}
