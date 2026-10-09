use bun_lint::prelude::*;
use bun_lint::types::utils::{EnumComparisons, get_enum_key_for_literal, get_enum_literals};
use bun_lint::types::{Literal, Type};
use bun_lint::utils::eslint_utils::{StaticValue, get_static_value};

/// Disallow comparing an enum value with a non-enum value.
pub struct NoUnsafeEnumComparison;

const MISMATCHED_CASE: Message = Message::new(
    "mismatchedCase",
    "The case statement does not have a shared enum type with the switch predicate.",
);
const MISMATCHED_CONDITION: Message = Message::new(
    "mismatchedCondition",
    "The two values in this comparison do not have a shared enum type.",
);
const REPLACE_VALUE_WITH_ENUM: Message =
    Message::new("replaceValueWithEnum", "Replace with an enum value comparison.");

/// How the member of the enum `enum_type` that has the static value of `value` is written.
fn enum_key_of_value<'a>(enum_type: Type<'a>, value: Expr<'a>) -> Option<Vec<u8>> {
    let value = get_static_value(value, None)?;
    let literal = match &value {
        StaticValue::String(text) => Literal::String(text),
        StaticValue::Number(number) => Literal::Number(*number),
        _ => return None,
    };
    get_enum_key_for_literal(&get_enum_literals(enum_type), literal)
}

impl Rule for NoUnsafeEnumComparison {
    const META: Meta = Meta::typescript("no-unsafe-enum-comparison", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = EnumComparisons<'a>;

    fn new(_: &Options) -> Self {
        NoUnsafeEnumComparison
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> EnumComparisons<'a> {
        on.exprs([ExprTag::Binary], |_, node, cx| {
            let ExprKind::Binary {
                op:
                    BinOp::Lt
                    | BinOp::Le
                    | BinOp::Gt
                    | BinOp::Ge
                    | BinOp::EqEq
                    | BinOp::NotEq
                    | BinOp::EqEqEq
                    | BinOp::NotEqEq,
                left,
                right,
            } = node.kind()
            else {
                return;
            };
            let (left_type, right_type) = (left.ty(), right.ty());
            if !cx.state.is_mismatched(left_type, right_type) {
                return;
            }
            cx.report(node, MISMATCHED_CONDITION).suggest(REPLACE_VALUE_WITH_ENUM, |fixer| {
                // `Fruit.Apple === 'apple'` to `Fruit.Apple === Fruit.Apple`, or the same for the
                // left side.
                if let Some(left_enum_key) = enum_key_of_value(left_type, right) {
                    return Some(fixer.replace(right, left_enum_key));
                }
                let right_enum_key = enum_key_of_value(right_type, left)?;
                Some(fixer.replace(left, right_enum_key))
            });
        });

        on.cases(|_, node, cx| {
            let Some(test) = node.test() else {
                return;
            };
            let Node::Stmt(parent) = node.parent() else {
                return;
            };
            let StmtKind::Switch { expr: discriminant, .. } = parent.kind() else {
                return;
            };
            if cx.state.is_mismatched(discriminant.ty(), test.ty()) {
                // oxlint points at what the `switch` compares.
                let place = if cx.language().is_oxlint { discriminant.outer_span() } else { node.span() };
                cx.report(place, MISMATCHED_CASE).comments_apply_at(node.span());
            }
        });
        EnumComparisons::default()
    }
}
