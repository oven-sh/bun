use bun_lint::prelude::*;

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
            if let StmtKind::If { test, no: Some(no), .. } = stmt.kind()
                && no.tag() != StmtTag::If
                && is_negated(test)
            {
                // oxlint points at the test.
                cx.report(if cx.language().is_oxlint { test.span() } else { stmt.span() }, UNEXPECTED_NEGATED);
            }
        });
        on.exprs([ExprTag::Cond], |_, e, cx| {
            if let ExprKind::Cond { test, .. } = e.kind()
                && is_negated(test)
            {
                cx.report(if cx.language().is_oxlint { test } else { e }, UNEXPECTED_NEGATED);
            }
        });
    }
}
