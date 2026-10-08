use bun_lint::prelude::*;

/// Disallow comparisons where both sides are exactly the same.
pub struct NoSelfCompare;

const COMPARING_TO_SELF: Message =
    Message::new("comparingToSelf", "Comparing to itself is potentially pointless.");

impl Rule for NoSelfCompare {
    const META: Meta = Meta::eslint("no-self-compare", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSelfCompare
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], |_, e, cx| {
            let ExprKind::Binary { op, left, right } = e.kind() else {
                return;
            };
            let is_comparison = matches!(
                op,
                BinOp::EqEqEq
                    | BinOp::EqEq
                    | BinOp::NotEqEq
                    | BinOp::NotEq
                    | BinOp::Gt
                    | BinOp::Lt
                    | BinOp::Ge
                    | BinOp::Le
            );
            // The same tokens are the same kind of expression.
            if is_comparison && left.tag() == right.tag() && ast_utils::equal_tokens(cx.file(), left, right) {
                cx.report(e, COMPARING_TO_SELF);
            }
        });
    }
}
