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

/// True if oxlint accepts it. That includes a template, with or without substitutions, and a type assertion, but not
/// `-(1)`.
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
    const ON: On = On::new().unaries(&[UnOp::Delete]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDynamicDelete
    }

    fn unary<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((_, operand)) = expr.as_unary() else {
            return;
        };
        let Some(index) = operand.index() else {
            return;
        };
        // ESLint has a `ChainExpression` around `a?.[b]`.
        let is_acceptable = match cx.language().is_oxlint {
            // It doesn't look inside parentheses: `delete (a[b])`.
            true => operand.is_parenthesized() || oxlint_is_acceptable_index_expression(index),
            false => is_acceptable_index_expression(index),
        };
        if operand.is_in_optional_chain() || is_acceptable {
            return;
        }
        // oxlint points at the `delete`.
        cx.report(if cx.language().is_oxlint { expr } else { index }, DYNAMIC_DELETE);
    }
}
