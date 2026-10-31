//! `is_same_expression` and `is_same_member_expression` from oxlint's `utils/unicorn.rs`.
//!
//! **These functions ignore the parentheses around their two arguments.** In oxlint `(a)` doesn't equal anything, not
//! even `(a)`. So where an oxlint rule passes an expression without first calling `get_inner_expression()` or
//! `without_parentheses()` on it, the port has to check `!e.is_parenthesized()` first.

use crate::ast_util::{get_inner_expression, static_property_name_or_regex};
use bun_lint::prelude::*;
use smallvec::{SmallVec, smallvec};

/// Pairs that still have to be compared, ignoring the parentheses around each expression.
type Pending<'a> = SmallVec<[(Expr<'a>, Expr<'a>); 8]>;

/// True if the two expressions have kinds that can compare equal.
#[inline]
fn have_comparable_kinds(left: Expr, right: Expr) -> bool {
    let kind = |e: Expr| match e.tag() {
        ExprTag::Index => ExprTag::Dot,
        ExprTag::Template => ExprTag::String,
        tag => tag,
    };
    kind(left) == kind(right)
}

/// Compares two expressions to see if they are the same.
#[inline]
pub fn is_same_expression<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    have_comparable_kinds(left, right) && are_all_same(smallvec![(left, right)])
}

/// `is_same_expression(left.get_inner_expression(), right.get_inner_expression(), ctx)`
#[inline]
pub fn is_same_inner_expression<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    is_same_expression(get_inner_expression(left), get_inner_expression(right))
}

/// `left` and `right` must each be a `Dot` or an `Index`, whether or not oxlint wraps it in a `ChainExpression`.
pub fn is_same_member_expression<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    let mut pending = Pending::new();
    compare_member_expressions(left, right, &mut pending) && are_all_same(pending)
}

/// Iterative, because `a + a + ..` and `a.b.b ..` can be arbitrarily long.
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

/// True if `left` and `right` are the same, provided the pairs it adds to `pending` are too.
fn compare_expressions<'a>(left: Expr<'a>, right: Expr<'a>, pending: &mut Pending<'a>) -> bool {
    if !have_comparable_kinds(left, right) {
        return false;
    }
    if is_member_expression(left) && is_member_expression(right) {
        return compare_member_expressions(left, right, pending);
    }
    // A `ChainExpression` can only equal a member expression.
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
            // oxlint doesn't strip parentheses here, so a parenthesized substitution never matches.
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
            // The order of the flags doesn't matter.
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
        // oxlint doesn't strip parentheses from the objects, so a parenthesized object never matches.
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
        // `a[/b/]` equals `a["/b/"]`, which the name comparison above has already established.
        let is_regex = |e: Expr| e.tag() == ExprTag::Regex && !e.is_parenthesized();
        if name.is_none() || is_regex(left_index) == is_regex(right_index) {
            push_inner(pending, left_index, right_index);
        }
    }
    push_inner(pending, left_object, right_object);
    true
}
