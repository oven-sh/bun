use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// When spreading a ternary in an array, we can use both `[]` and `''` as fallbacks, but it's better to have consistent
/// types in both branches.
pub struct ConsistentEmptyArraySpread;

const CONSISTENT_EMPTY_ARRAY_SPREAD: Message =
    Message::new("", "Prefer consistent types when spreading a ternary in an array literal.");

impl Rule for ConsistentEmptyArraySpread {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "consistent-empty-array-spread", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ConsistentEmptyArraySpread
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Spread], |_, spread, cx| {
            let ExprKind::Spread(conditional) = spread.kind() else {
                return;
            };
            let ExprKind::Cond { yes, no, .. } = conditional.kind() else {
                return;
            };
            let alternate = get_inner_expression(no);
            let replacement = match (get_inner_expression(yes).kind(), alternate.kind()) {
                (ExprKind::Array(_), ExprKind::String(value)) if value.bytes().is_empty() => "[]",
                (ExprKind::String(_), ExprKind::Array(elements)) if elements.is_empty() => "''",
                _ => return,
            };
            let is_array = |it: Expr| it.tag() == ExprTag::Array && !it.is_assignment_target();
            if spread.parent().as_expr().is_some_and(is_array) {
                cx.report(conditional, CONSISTENT_EMPTY_ARRAY_SPREAD)
                    .suggest(CONSISTENT_EMPTY_ARRAY_SPREAD, |fixer| fixer.replace(alternate, replacement));
            }
        });
    }
}
