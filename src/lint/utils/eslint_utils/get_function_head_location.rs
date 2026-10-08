//! `get-function-head-location.mjs`

use super::token_predicate::is_opening_paren_token;
use crate::ast::{Expr, Flags, Func, KeyKind, Member, Node};
use crate::span::Span;

/// Whether `member` is a `PropertyDefinition` of ESTree, and `e` is its value or its computed key,
/// which makes it the parent of `e`. A decorator has a node of its own there.
fn is_value_or_key_of<'a>(e: Expr<'a>, member: Member<'a>) -> bool {
    !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
        && (member.init() == Some(e)
            || matches!(member.key().map(|key| key.kind()), Some(KeyKind::Computed(key)) if key == e))
}

/// Upstream's `getOpeningParenOfParams`: the first `(` after the name, or in a function without a
/// name. That is one in the type parameters, if they have one.
fn opening_paren(func: Func<'_>) -> Option<u32> {
    let paren = func.open_paren()?;
    let Some(first) = func.type_params().first() else {
        return Some(paren);
    };
    let type_params = Span::new(first.span().start, paren);
    Some(func.file().tokens_in(type_params).find(is_opening_paren_token).map_or(paren, |token| token.start()))
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
            Node::Prop(prop) if !prop.is_jsx_attribute() => prop.span().start,
            Node::Member(member) if is_value_or_key_of(e, member) => member.span().start,
            _ => e.span().start,
        },
        Node::Stmt(statement) => statement.span_without_export().start,
        owner => owner.span().start,
    };
    Span::new(start, opening_paren(func).unwrap_or(start))
}
