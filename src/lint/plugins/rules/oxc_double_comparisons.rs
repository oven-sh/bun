use bun_lint_oxlint::codegen::Codegen;
use bun_lint_oxlint::same_expression::is_same_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule checks for double comparisons in logical expressions.
pub struct DoubleComparisons;

const DOUBLE_COMPARISONS: Message = Message::new("", "Unexpected double comparisons.");
const SIMPLIFY: Message =
    Message::new("", "This logical expression can be simplified. Try using the `{{operator}}` operator instead.");

impl Rule for DoubleComparisons {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "double-comparisons", Kind::Problem).has_suggestions();
    const ON: On = On::new().binaries(&[BinOp::Or, BinOp::And]);
    no_state!();

    fn new(_: &Options) -> Self {
        DoubleComparisons
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let Some((rkind, rlhs, rrhs)) = as_comparison(right) else {
            return;
        };
        // In `a || b || c` what is before `c` is the `b`.
        let left_bin_expr = if left.binary_op() == Some(op) && !left.is_parenthesized() { left.right() } else { Some(left) };
        let Some(left_bin_expr) = left_bin_expr else {
            return;
        };
        let Some((lkind, llhs, lrhs)) = as_comparison(left_bin_expr) else {
            return;
        };
        let rhs_operator = if is_same(llhs, rlhs) && is_same(lrhs, rrhs) {
            rkind
        } else if is_same(llhs, rrhs) && is_same(lrhs, rlhs) {
            compare_inverse_operator(rkind)
        } else {
            return;
        };
        let new_op = match (op, lkind, rhs_operator) {
            (BinOp::Or, BinOp::EqEq | BinOp::EqEqEq, BinOp::Lt) | (BinOp::Or, BinOp::Lt, BinOp::EqEq | BinOp::EqEqEq) => "<=",
            (BinOp::Or, BinOp::EqEq | BinOp::EqEqEq, BinOp::Gt) | (BinOp::Or, BinOp::Gt, BinOp::EqEq | BinOp::EqEqEq) => ">=",
            (BinOp::Or, BinOp::Lt, BinOp::Gt) | (BinOp::Or, BinOp::Gt, BinOp::Lt) => "!=",
            (BinOp::And, BinOp::Le, BinOp::Ge) | (BinOp::And, BinOp::Ge, BinOp::Le) => "==",
            _ => return,
        };
        let span = left_bin_expr.span().to(right.span());
        let report = cx.report(span, DOUBLE_COMPARISONS).data("operator", new_op);
        report.suggest_with(SIMPLIFY, &[("operator", new_op.as_bytes())], |fixer| {
            let mut codegen = Codegen::default();
            codegen.print_expression(llhs);
            codegen.code.push(b' ');
            codegen.code.extend_from_slice(new_op.as_bytes());
            codegen.code.push(b' ');
            codegen.print_expression(lrhs);
            fixer.replace(span, codegen.code)
        });
    }
}

/// The operator and the operands, if it is one of the comparisons that the rule is about and is not in parentheses.
fn as_comparison(e: Expr<'_>) -> Option<(BinOp, Expr<'_>, Expr<'_>)> {
    match e.kind() {
        ExprKind::Binary { op: op @ (BinOp::EqEq | BinOp::EqEqEq | BinOp::Lt | BinOp::Gt | BinOp::Le | BinOp::Ge), left, right }
            if !e.is_parenthesized() =>
        {
            Some((op, left, right))
        }
        _ => None,
    }
}

fn is_same<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    !left.is_parenthesized() && !right.is_parenthesized() && is_same_expression(left, right)
}

fn compare_inverse_operator(op: BinOp) -> BinOp {
    match op {
        BinOp::Lt => BinOp::Gt,
        BinOp::Le => BinOp::Ge,
        BinOp::Gt => BinOp::Lt,
        BinOp::Ge => BinOp::Le,
        _ => op,
    }
}
