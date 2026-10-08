use bun_lint::prelude::*;

/// Disallow negating the left operand in `in` expressions.
pub struct NoNegatedInLhs;

const NEGATED_LHS: Message =
    Message::new("negatedLHS", "The 'in' expression's left operand is negated.");

impl Rule for NoNegatedInLhs {
    const META: Meta = Meta::eslint("no-negated-in-lhs", Kind::Problem).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNegatedInLhs
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], |_, e, cx| {
            if let ExprKind::Binary { op: BinOp::In, left, .. } = e.kind()
                && matches!(left.kind(), ExprKind::Unary { op: UnOp::Not, .. })
            {
                cx.report(e, NEGATED_LHS);
            }
        });
    }
}
