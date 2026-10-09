use crate::unicorn::{may_have_side_effects, pad_fix_with_token_boundary};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce the use of `Math.trunc` instead of bitwise operators.
pub struct PreferMathTrunc;

const PREFER_MATH_TRUNC: Message = Message::new("", "Prefer `Math.trunc()` over instead of `{{bad_op}} 0`.");

const OPERATORS: [BinOp; 4] = [BinOp::BitOr, BinOp::Shr, BinOp::Shl, BinOp::BitXor];

fn is_zero(e: Expr) -> bool {
    !e.is_parenthesized() && matches!(e.kind(), ExprKind::Number(n) if n == 0.0)
}

/// The `a` of `~a`.
fn bitwise_not_argument(e: Expr<'_>) -> Option<Expr<'_>> {
    e.operand().filter(|_| e.unary_op() == Some(UnOp::BitNot))
}

/// `is_assignment`: `x |= 0` becomes `x = Math.trunc(x)`. Otherwise `x | 0` and `~~x` become `Math.trunc(x)`.
fn report<'a>(e: Expr<'a>, bad_op: &'static str, argument: Span, is_assignment: bool, cx: &Cx<'a, PreferMathTrunc>) {
    cx.report(e, PREFER_MATH_TRUNC).data("bad_op", bad_op).suggest(PREFER_MATH_TRUNC, |fixer| {
        if is_assignment && e.left().is_none_or(target_may_have_side_effects) {
            return None;
        }
        let argument = fixer.file().slice(argument);
        let mut replacement = match is_assignment {
            true => [argument, b" = Math.trunc(", argument, b")"].concat(),
            false => [&b"Math.trunc("[..], argument, b")"].concat(),
        };
        pad_fix_with_token_boundary(fixer.file().text(), e.span(), &mut replacement);
        Some(fixer.replace(e, replacement))
    });
}

/// Whether finding out what is assigned to can have side effects, so that it must not be written twice.
fn target_may_have_side_effects(target: Expr) -> bool {
    match target.kind() {
        ExprKind::Ident(_) => false,
        ExprKind::Dot { obj, .. } => may_have_side_effects(obj),
        ExprKind::Index { obj, index, .. } => may_have_side_effects(obj) || may_have_side_effects(index),
        _ => true,
    }
}

impl Rule for PreferMathTrunc {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-math-trunc", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferMathTrunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.unaries([UnOp::BitNot], |_, e, cx| {
            if let Some(inner) = e.operand().filter(|it| !it.is_parenthesized())
                && let Some(argument) = bitwise_not_argument(inner)
                && (argument.is_parenthesized() || bitwise_not_argument(argument).is_none())
            {
                report(e, "~", argument.outer_span(), false, cx);
            }
        });
        on.binaries(OPERATORS, |_, e, cx| {
            if let ExprKind::Binary { op, left, right } = e.kind()
                && is_zero(right)
            {
                let bad_op = match op {
                    BinOp::BitOr => "|",
                    BinOp::Shr => ">>",
                    BinOp::Shl => "<<",
                    _ => "^",
                };
                report(e, bad_op, left.outer_span(), false, cx);
            }
        });
        on.exprs([ExprTag::Assign], |_, e, cx| {
            if let ExprKind::Assign { op: Some(op), target, value } = e.kind()
                && is_zero(value)
            {
                let bad_op = match op {
                    BinOp::BitOr => "|=",
                    BinOp::Shr => ">>=",
                    BinOp::Shl => "<<=",
                    BinOp::BitXor => "^=",
                    _ => return,
                };
                report(e, bad_op, target.span(), true, cx);
            }
        });
    }
}
