use bun_lint::prelude::*;

/// Disallow using the `delete` operator on computed key expressions.
pub struct NoDynamicDelete;

const DYNAMIC_DELETE: Message =
    Message::new("dynamicDelete", "Do not delete dynamically computed property keys.");

fn is_acceptable_index_expression(property: Expr) -> bool {
    match property.kind() {
        ExprKind::Number(_) | ExprKind::String(_) => true,
        ExprKind::Unary { op: UnOp::Minus, operand } => matches!(operand.kind(), ExprKind::Number(_)),
        _ => false,
    }
}

/// What oxlint accepts: also a template, with substitutions or not, and what is asserted to have a type. Not `-(1)`.
fn oxlint_is_acceptable_index_expression(property: Expr) -> bool {
    let property = property.skip_type_wrappers();
    match property.kind() {
        ExprKind::Number(_) | ExprKind::String(_) | ExprKind::Template(_) => true,
        ExprKind::Unary { op: UnOp::Minus, operand } => operand.tag() == ExprTag::Number && !operand.is_parenthesized(),
        _ => false,
    }
}

impl Rule for NoDynamicDelete {
    const META: Meta = Meta::typescript("no-dynamic-delete", Kind::Suggestion).presets(Presets::STRICT);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDynamicDelete
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Unary], |_, expr, cx| {
            let ExprKind::Unary { op: UnOp::Delete, operand } = expr.kind() else {
                return;
            };
            let ExprKind::Index { index, .. } = operand.kind() else {
                return;
            };
            // ESLint has a `ChainExpression` around `a?.[b]`.
            let is_acceptable = match cx.language().is_oxlint {
                // It does not look into parentheses: `delete (a[b])`.
                true => operand.is_parenthesized() || oxlint_is_acceptable_index_expression(index),
                false => is_acceptable_index_expression(index),
            };
            if operand.is_in_optional_chain() || is_acceptable {
                return;
            }
            // oxlint points at the `delete`.
            cx.report(if cx.language().is_oxlint { expr } else { index }, DYNAMIC_DELETE);
        });
    }
}
