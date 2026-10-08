//! What several kinds of nodes are formatted with.

pub(crate) mod array;
pub(crate) mod assignment_like;
pub(crate) mod call_expression;
pub(crate) mod conditional;
pub(crate) mod experimental_ternary;
pub(crate) mod expression;
pub(crate) mod format_node_without_trailing_comments;
pub(crate) mod jsx;
pub(crate) mod member_chain;
pub(crate) mod number;
pub(crate) mod object;
pub(crate) mod operators;
pub(crate) mod statement_body;
pub(crate) mod string;
pub(crate) mod suppressed;
pub(crate) mod typecast;
pub(crate) mod typescript;

use crate::prelude::*;

/// `connect(a, b, c)(d)`: `call` is the callee of a call that has fewer arguments, but some.
#[inline]
pub(crate) fn is_long_curried_call(call: Expr<'_>) -> bool {
    call.call().is_some_and(|call| call.args().len() > 1)
        && matches!(call.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call && is_long_curried_callee(call, parent))
}

/// `parent`: the call that `call` is in. The whole of an optional chain is in a `ChainExpression`.
fn is_long_curried_callee<'a>(call: Expr<'a>, parent: Expr<'a>) -> bool {
    let (Some(this), Some(parent)) = (call.call(), parent.call()) else {
        return false;
    };
    parent.callee() == call
        && !is_chain_root(call)
        && this.args().len() > parent.args().len()
        && !parent.args().is_empty()
}
