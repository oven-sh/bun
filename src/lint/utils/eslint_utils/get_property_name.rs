//! `get-property-name.mjs`

use super::get_string_if_constant::get_string_if_constant;
use crate::ast::{ExprKind, Key, KeyKind, MemberKind, Node};
use crate::semantic::Scope;
use std::borrow::Cow;

/// The name that `key` stands for. `None` for `#a`, and for a computed key that is not constant.
pub fn property_name_of_key<'a>(key: Key<'a>, scope: Option<Scope<'a>>) -> Option<Cow<'a, [u8]>> {
    match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => Some(Cow::Borrowed(name.bytes())),
        KeyKind::Private(_) => None,
        KeyKind::Computed(e) => get_string_if_constant(e, scope),
    }
}

/// eslint-utils' `getPropertyName`: the name of the property that `node` accesses or defines.
/// `node` is a member access (an `Expr` that is a `Dot` or an `Index`), a `Prop`, a `PatProp` or a
/// `Member`. `None` for anything else, for a private name, for a spread, and for a computed name
/// that [`get_string_if_constant`] does not know.
///
/// With a `scope`, identifiers in a computed name are resolved.
pub fn get_property_name<'a>(
    node: impl Into<Node<'a>>,
    scope: Option<Scope<'a>>,
) -> Option<Cow<'a, [u8]>> {
    match node.into() {
        Node::Expr(e) => match e.kind() {
            ExprKind::Dot { name, .. } if name.bytes().starts_with(b"#") => None,
            ExprKind::Dot { name, .. } => Some(Cow::Borrowed(name.bytes())),
            ExprKind::Index { index, .. } => get_string_if_constant(index, scope),
            _ => None,
        },
        Node::Prop(prop) => property_name_of_key(prop.key()?, scope),
        Node::PatProp(prop) => property_name_of_key(prop.key()?, scope),
        Node::Member(member) if member.kind() == MemberKind::Constructor => {
            Some(Cow::Borrowed(b"constructor"))
        }
        Node::Member(member) => property_name_of_key(member.key()?, scope),
        _ => None,
    }
}
