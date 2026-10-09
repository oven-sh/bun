use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::same_expression::is_same_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers use of `Math.min()` and `Math.max()` instead of ternary expressions when performing simple comparisons.
pub struct PreferMathMinMax;

const PREFER_MATH_MIN_MAX: Message =
    Message::new("", "Prefer `Math.min()` and `Math.max()` over ternaries for simple comparisons.");

/// A number, or `-a`, `typeof a` and the like.
fn is_number_or_unary(e: Expr) -> bool {
    match get_inner_expression(e).kind() {
        ExprKind::Number(_) => true,
        ExprKind::Unary { op, .. } => !matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
        _ => false,
    }
}

fn is_identifier(e: Expr) -> bool {
    get_inner_expression(e).tag() == ExprTag::Ident
}

/// For oxlint what is in parentheses is the same as nothing.
fn is_same<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    !left.is_parenthesized() && !right.is_parenthesized() && is_same_expression(left, right)
}

impl Rule for PreferMathMinMax {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-math-min-max", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferMathMinMax
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Cond], |_, e, cx| {
            let ExprKind::Cond { test, yes, no } = e.kind() else {
                return;
            };
            let ExprKind::Binary { op, left, right } = test.kind() else {
                return;
            };
            let is_less = match op {
                BinOp::Lt | BinOp::Le => true,
                BinOp::Gt | BinOp::Ge => false,
                _ => return,
            };
            let is_matched =
                is_number_or_unary(left) && is_identifier(right) || is_identifier(left) && is_number_or_unary(right);
            if !is_matched || test.is_parenthesized() {
                return;
            }
            let method = if is_same(left, yes) && is_same(right, no) {
                if is_less { "min" } else { "max" }
            } else if is_same(left, no) && is_same(right, yes) {
                if is_less { "max" } else { "min" }
            } else {
                return;
            };
            cx.report(e, PREFER_MATH_MIN_MAX).suggest(PREFER_MATH_MIN_MAX, |fixer| {
                let file = fixer.file();
                let (consequent, alternate) = (file.slice(yes.outer_span()), file.slice(no.outer_span()));
                fixer.replace(e, [&b"Math."[..], method.as_bytes(), b"(", consequent, b", ", alternate, b")"].concat())
            });
        });
    }
}
