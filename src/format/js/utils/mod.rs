//! What several kinds of nodes are formatted with.

pub(crate) mod array;
pub(crate) mod assignment_like;
pub(crate) mod call_expression;
pub(crate) mod conditional;
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
pub(crate) fn is_long_curried_call(call: Expr<'_>) -> bool {
    let (Some(this), AstNodes::CallExpression(parent)) = (call.call(), call.as_chain_element().parent()) else {
        return false;
    };
    parent.call().is_some_and(|parent| {
        parent.callee() == call && this.args().len() > parent.args().len() && !parent.args().is_empty()
    })
}
