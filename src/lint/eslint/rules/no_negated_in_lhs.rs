use bun_lint::prelude::*;

/// Disallow negating the left operand in `in` expressions.
pub struct NoNegatedInLhs;

const NEGATED_LHS: Message =
    Message::new("negatedLHS", "The 'in' expression's left operand is negated.");

impl Rule for NoNegatedInLhs {
    const META: Meta = Meta::eslint("no-negated-in-lhs", Kind::Problem).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Binary]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoNegatedInLhs
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Binary { op: BinOp::In, left, .. } = e.kind()
            && matches!(left.kind(), ExprKind::Unary { op: UnOp::Not, .. })
        {
            cx.report(e, NEGATED_LHS);
        }
    }
}
