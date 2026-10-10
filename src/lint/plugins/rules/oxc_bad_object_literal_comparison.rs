use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks for comparisons between object and array literals.
pub struct BadObjectLiteralComparison;

const OBJECT_COMPARISON: Message = Message::new("", "Unexpected object literal comparison.");
const ARRAY_COMPARISON: Message = Message::new("", "Unexpected array literal comparison.");

impl Rule for BadObjectLiteralComparison {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-object-literal-comparison", Kind::Problem);
    const ON: On = On::new().binaries(&[BinOp::EqEq, BinOp::NotEq, BinOp::EqEqEq, BinOp::NotEqEq]);
    no_state!();

    fn new(_: &Options) -> Self {
        BadObjectLiteralComparison
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let const_result = if matches!(op, BinOp::NotEq | BinOp::NotEqEq) { "true" } else { "false" };
        if is_empty_object_expression(left) || is_empty_object_expression(right) {
            cx.report(e, OBJECT_COMPARISON).data("const_result", const_result);
        }
        if is_empty_array_expression(left) || is_empty_array_expression(right) {
            cx.report(e, ARRAY_COMPARISON).data("const_result", const_result);
        }
    }
}

fn is_empty_object_expression(e: Expr) -> bool {
    e.tag() == ExprTag::Object && matches!(e.kind(), ExprKind::Object(properties) if properties.is_empty()) && !e.is_parenthesized()
}

fn is_empty_array_expression(e: Expr) -> bool {
    e.tag() == ExprTag::Array && matches!(e.kind(), ExprKind::Array(elements) if elements.is_empty()) && !e.is_parenthesized()
}
