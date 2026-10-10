use bun_lint::prelude::*;
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::types::{TypeFlags, tsutils};

/// Require unary negation to take a number.
pub struct NoUnsafeUnaryMinus;

const UNARY_MINUS: Message = Message::new(
    "unaryMinus",
    "Argument of unary negation should be assignable to number | bigint but is {{type}} instead.",
);

impl NoUnsafeUnaryMinus {
    fn check<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Unary { op: UnOp::Minus, operand } = node.kind() else {
            return;
        };
        let arg_type = get_constrained_type_at_location(operand);
        let allowed = TypeFlags::ANY | TypeFlags::NEVER | TypeFlags::BIG_INT_LIKE | TypeFlags::NUMBER_LIKE;
        if tsutils::union_constituents(arg_type).iter().any(|ty| !ty.has_flags(allowed)) {
            cx.report(node, UNARY_MINUS).data("type", arg_type.to_text());
        }
    }
}

impl Rule for NoUnsafeUnaryMinus {
    const META: Meta = Meta::typescript("no-unsafe-unary-minus", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Unary]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnsafeUnaryMinus
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(node, cx);
    }
}
