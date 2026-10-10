//! `is_same_expression` and `is_same_member_expression` of oxlint's `utils/unicorn.rs`.
//!
//! **The parentheses around the two expressions that they are called with do not count here.** For oxlint `(a)` is the same as
//! nothing, not even as `(a)`. So where a rule of oxlint passes an expression on which it has called neither
//! `get_inner_expression()` nor `without_parentheses()`, the rule tests `!e.is_parenthesized()` first.

use crate::ast_util::{get_inner_expression, static_property_name_or_regex};
use bun_lint::prelude::*;
use smallvec::{SmallVec, smallvec};

/// Pairs that are still to be compared, each without the parentheses around it.
type Pending<'a> = SmallVec<[(Expr<'a>, Expr<'a>); 8]>;

/// Compares two expressions to see if they are the same.
pub fn is_same_expression<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    are_all_same(smallvec![(left, right)])
}

/// `is_same_expression(left.get_inner_expression(), right.get_inner_expression(), ctx)`
pub fn is_same_inner_expression<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    are_all_same(smallvec![(
        get_inner_expression(left),
        get_inner_expression(right)
    )])
}

/// `left`, `right`: a `Dot` or an `Index`, whether oxlint has a `ChainExpression` around it or not.
pub fn is_same_member_expression<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    let mut pending = Pending::new();
    compare_member_expressions(left, right, &mut pending) && are_all_same(pending)
}

/// Not by recursion: `a + a + ..` and `a.b.b ..` are as long as one likes.
fn are_all_same(mut pending: Pending<'_>) -> bool {
    while let Some((left, right)) = pending.pop() {
        if !compare_expressions(left, right, &mut pending) {
            return false;
        }
    }
    true
}

fn push_inner<'a>(pending: &mut Pending<'a>, left: Expr<'a>, right: Expr<'a>) {
    pending.push((get_inner_expression(left), get_inner_expression(right)));
}

fn is_member_expression(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index)
}

/// Whether `left` and `right` are the same but for what is added to `pending`.
fn compare_expressions<'a>(left: Expr<'a>, right: Expr<'a>, pending: &mut Pending<'a>) -> bool {
    if is_member_expression(left) && is_member_expression(right) {
        return compare_member_expressions(left, right, pending);
    }
    // A `ChainExpression` is the same as nothing but a member expression.
    if left.is_chain_root() || right.is_chain_root() {
        return false;
    }
    match (left.kind(), right.kind()) {
        (ExprKind::Super, ExprKind::Super)
        | (ExprKind::This, ExprKind::This)
        | (ExprKind::Null, ExprKind::Null)
        | (ExprKind::True, ExprKind::True)
        | (ExprKind::False, ExprKind::False) => true,
        (ExprKind::Ident(left), ExprKind::Ident(right))
        | (ExprKind::String(left), ExprKind::String(right)) => left == right,
        (ExprKind::String(string), ExprKind::Template(template))
        | (ExprKind::Template(template), ExprKind::String(string)) => {
            template.as_static() == Some(string)
        }
        (ExprKind::Template(left), ExprKind::Template(right)) => {
            let count = left.quasi_count();
            if count != right.quasi_count() || (0..count).any(|i| left.raw(i) != right.raw(i)) {
                return false;
            }
            // These are compared as they are.
            if left
                .exprs()
                .iter()
                .chain(right.exprs())
                .any(Expr::is_parenthesized)
            {
                return false;
            }
            pending.extend(left.exprs().iter().zip(right.exprs()));
            true
        }
        (ExprKind::Number(_), ExprKind::Number(_)) => left.text() == right.text(),
        (ExprKind::Regex(left), ExprKind::Regex(right)) => {
            // In whatever order.
            let flags = |flags: &[u8]| {
                flags
                    .iter()
                    .fold(0u32, |all, flag| all | (1 << (flag & 31)))
            };
            left.pattern() == right.pattern() && flags(left.flags()) == flags(right.flags())
        }
        (
            ExprKind::Binary {
                op: left_op,
                left: left_left,
                right: left_right,
            },
            ExprKind::Binary {
                op: right_op,
                left: right_left,
                right: right_right,
            },
        ) => {
            if left_op != right_op || left_op == BinOp::Comma {
                return false;
            }
            push_inner(pending, left_left, right_left);
            push_inner(pending, left_right, right_right);
            true
        }
        (
            ExprKind::Unary {
                op: left_op,
                operand: left,
            },
            ExprKind::Unary {
                op: right_op,
                operand: right,
            },
        ) => {
            if left_op != right_op
                || matches!(
                    left_op,
                    UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                )
            {
                return false;
            }
            push_inner(pending, left, right);
            true
        }
        _ => false,
    }
}

fn compare_member_expressions<'a>(
    left: Expr<'a>,
    right: Expr<'a>,
    pending: &mut Pending<'a>,
) -> bool {
    let (Some(left_object), Some(right_object)) = (left.object(), right.object()) else {
        return false;
    };
    let name = static_property_name_or_regex(left);
    if name != static_property_name_or_regex(right) {
        return false;
    }
    if name.is_none() && left.is_private_member() && right.is_private_member() {
        // The objects are compared as they are.
        if left.member_name().map(Ident::name) != right.member_name().map(Ident::name)
            || left_object.is_parenthesized()
            || right_object.is_parenthesized()
        {
            return false;
        }
        pending.push((left_object, right_object));
        return true;
    }
    if left.is_private_member() || right.is_private_member() {
        return false;
    }
    if let (Some(left_index), Some(right_index)) = (left.index(), right.index()) {
        // `a[/b/]` is `a["/b/"]`, which the names have told.
        let is_regex = |e: Expr| e.tag() == ExprTag::Regex && !e.is_parenthesized();
        if name.is_none() || is_regex(left_index) == is_regex(right_index) {
            push_inner(pending, left_index, right_index);
        }
    }
    push_inner(pending, left_object, right_object);
    true
}
