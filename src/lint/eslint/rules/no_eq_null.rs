use bun_lint::prelude::*;

/// Disallow `null` comparisons without type-checking operators.
pub struct NoEqNull;

const UNEXPECTED: Message = Message::new("unexpected", "Use '===' to compare with null.");

impl Rule for NoEqNull {
    const META: Meta = Meta::eslint("no-eq-null", Kind::Suggestion);
    const ON: On = On::new().binaries(&[BinOp::EqEq, BinOp::NotEq]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoEqNull
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let (Some(op @ (BinOp::EqEq | BinOp::NotEq)), Some(left), Some(right)) = (e.binary_op(), e.left(), e.right())
            // For oxc `(null)` is no `null`.
            && [left, right]
                .iter()
                .any(|it| it.tag() == ExprTag::Null && !(cx.language().is_oxlint && it.is_parenthesized()))
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
    }
}
