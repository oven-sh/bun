//! `get-function-head-location.mjs`

use crate::ast::{Expr, Func, KeyKind, Member, Node};
use crate::span::Span;

/// Whether `e` is the value or the computed key of `member`, which makes `member` its parent in
/// ESTree. A decorator has a node of its own there.
fn is_value_or_key_of<'a>(e: Expr<'a>, member: Member<'a>) -> bool {
    member.init() == Some(e)
        || matches!(member.key().map(|key| key.kind()), Some(KeyKind::Computed(key)) if key == e)
}

/// eslint-utils' `getFunctionHeadLocation`: what to report for a function.
///
/// - An arrow function: the `=>`.
/// - A method, an accessor, or a function that is the value of a property of an object or of a
///   class: from the start of the property to the `(` of the parameters.
/// - Any other function: from its start to the `(` of the parameters.
pub fn get_function_head_location(func: Func<'_>) -> Span {
    if let Some(arrow) = func.arrow_span() {
        return arrow;
    }
    let start = match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) => prop.span().start,
            Node::Member(member) if is_value_or_key_of(e, member) => member.span().start,
            _ => e.span().start,
        },
        Node::Stmt(statement) => statement.span_without_export().start,
        owner => owner.span().start,
    };
    Span::new(start, func.open_paren().unwrap_or(start))
}
