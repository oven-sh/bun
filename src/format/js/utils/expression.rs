//! Walks down the left edge of an expression.

use crate::prelude::*;

/// The expression that `e` starts with, if any: the `a` in `a.b`, `a()`, `a + b`, `a = b`, `a ? b : c`, `a, b`, `a as
/// T`, `a!`, `a++`, `` a`b` ``. Prettier's `hasNakedLeftSide` and `getLeftSide`.
///
/// In ESTree the left side of an assignment and the operand of `++` aren't expressions. Check
/// [`ExpressionLeftSide::is_assignment_target`] to tell them apart.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ExpressionLeftSide<'a> {
    pub(crate) expr: Expr<'a>,
    /// It is, or is on the left edge of, the target of an assignment or `++`.
    pub(crate) is_assignment_target: bool,
}

impl<'a> From<Expr<'a>> for ExpressionLeftSide<'a> {
    fn from(expr: Expr<'a>) -> Self {
        ExpressionLeftSide {
            expr,
            is_assignment_target: false,
        }
    }
}

impl<'a> ExpressionLeftSide<'a> {
    /// The last expression down `expression`'s left edge that ESTree calls an `Expression`.
    pub(crate) fn leftmost(expression: Expr<'a>) -> Expr<'a> {
        ExpressionLeftSide::from(expression)
            .iter_expression()
            .last()
            .unwrap_or(expression)
    }

    pub(crate) fn left(self) -> Option<Self> {
        let expression = |expr| {
            Some(ExpressionLeftSide {
                expr,
                is_assignment_target: false,
            })
        };
        let target = |expr| {
            Some(ExpressionLeftSide {
                expr,
                is_assignment_target: true,
            })
        };
        if self.is_assignment_target {
            return match self.expr.kind() {
                ExprKind::As { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::NonNull(expr) => expression(expr),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => expression(obj),
                _ => None,
            };
        }
        match self.expr.kind() {
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => self.expr.sequence().first().copied().and_then(expression),
            ExprKind::Binary {
                op: BinOp::In,
                left,
                ..
            } if matches!(left.kind(), ExprKind::PrivateIdentifier(_)) => None,
            ExprKind::Binary { left, .. } => expression(left),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => expression(obj),
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) => expression(call.callee()),
            ExprKind::Cond { test, .. } => expression(test),
            ExprKind::As { .. } | ExprKind::AsConst(_)
                if self.expr.is_angle_bracket_assertion() =>
            {
                None
            }
            ExprKind::As { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr) => expression(expr),
            ExprKind::Assign { target: left, .. } => target(left),
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                operand,
            } => target(operand),
            _ => None,
        }
    }

    /// Itself, then what it starts with, and so on.
    pub(crate) fn iter(self) -> impl Iterator<Item = ExpressionLeftSide<'a>> {
        std::iter::successors(Some(self), |it| it.left())
    }

    /// The same without the assignment targets.
    pub(crate) fn iter_expression(self) -> impl Iterator<Item = Expr<'a>> {
        self.iter()
            .filter(|it| !it.is_assignment_target)
            .map(|it| it.expr)
    }
}
