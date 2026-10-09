use bun_lint::prelude::*;

/// Disallow `null` comparisons without type-checking operators.
pub struct NoEqNull;

const UNEXPECTED: Message = Message::new("unexpected", "Use '===' to compare with null.");

impl Rule for NoEqNull {
    const META: Meta = Meta::eslint("no-eq-null", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoEqNull
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], |_, e, cx| {
            if let ExprKind::Binary {
                op: op @ (BinOp::EqEq | BinOp::NotEq),
                left,
                right,
            } = e.kind()
                && (right.tag() == ExprTag::Null || left.tag() == ExprTag::Null)
            {
                let report = cx.report(e, UNEXPECTED);
                // oxlint's fix takes the place of all that is between the operands.
                if cx.language().is_oxlint {
                    let operator = if op == BinOp::EqEq { " === " } else { " !== " };
                    report.data("suggested_operator", operator.trim()).fix_dangerously(|fixer| {
                        fixer.replace(left.outer_span().between(right.outer_span()), operator)
                    });
                }
            }
        });
    }
}
