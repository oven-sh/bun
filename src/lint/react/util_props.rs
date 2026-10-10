#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/props.js` of eslint-plugin-react.
//!
//! | upstream | here |
//! |---|---|
//! | `getTypeArguments(node)` | `call.type_args()`, `jsx.type_args()`, `TypeKind::Ref { args }` |
//! | `getSuperTypeArguments(node)` | `class.extends_args()` |
//!
//! What takes a `Node` is for a `Member`, a `Prop`, a `PatProp`, a `Dot` or an `Index`. As in
//! `util_ast`, who gets to a member access from above asks `is_chain_root()` first.

use crate::util_ast::{get_property_name, name_of_key};
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;

/// `astUtil.getPropertyName(node) === name`
fn is_named(node: Node<'_>, name: &str) -> bool {
    get_property_name(node).is_some_and(|it| it == name.as_bytes())
}

/// `node.key.name === name` of a `PropertyDefinition`.
fn is_field_named(member: Member<'_>, name: &str) -> bool {
    let key_name = member.key().and_then(name_of_key);
    key_name.is_some_and(|it| it == name.as_bytes()) && ast_utils::is_property_definition(member)
}

/// What upstream has "for Flow": a field `name` with a type annotation.
fn is_annotated_field(node: Node<'_>, name: &str) -> bool {
    matches!(node, Node::Member(member) if member.ty().is_some() && is_field_named(member, name))
}

/// `isPropTypesDeclaration`
pub(crate) fn is_prop_types_declaration(node: Node<'_>) -> bool {
    is_annotated_field(node, "props") || is_named(node, "propTypes")
}

/// `isContextTypesDeclaration`
pub(crate) fn is_context_types_declaration(node: Node<'_>) -> bool {
    is_annotated_field(node, "context") || is_named(node, "contextTypes")
}

/// `isContextTypeDeclaration`
pub(crate) fn is_context_type_declaration(node: Node<'_>) -> bool {
    is_named(node, "contextType")
}

/// `isChildContextTypesDeclaration`
pub(crate) fn is_child_context_types_declaration(node: Node<'_>) -> bool {
    is_named(node, "childContextTypes")
}

/// `isDefaultPropsDeclaration`
pub(crate) fn is_default_props_declaration(node: Node<'_>) -> bool {
    get_property_name(node).is_some_and(|it| it == b"defaultProps" || it == b"getDefaultProps")
}

/// `isDisplayNameDeclaration`, for a field or an expression. A key is no node:
/// [`is_display_name_key`]. Nor is the `b` of `a.b`: `name.name().is("displayName")`.
pub(crate) fn is_display_name_declaration(node: Node<'_>) -> bool {
    match node {
        Node::Member(member) => is_field_named(member, "displayName"),
        Node::Expr(e) => match e.kind() {
            ExprKind::Ident(name) => name.is("displayName") && !e.is_jsx_tag_name(),
            ExprKind::String(value) => value.is("displayName") && !e.is_jsx_text(),
            _ => false,
        },
        _ => false,
    }
}

/// `isDisplayNameDeclaration(node.key)`
pub(crate) fn is_display_name_key<'a>(file: &File<'a>, key: Key<'a>) -> bool {
    match key.kind() {
        KeyKind::Ident(name) => name.is("displayName") && !key.is_jsx(),
        KeyKind::String(value) => value.is("displayName"),
        // A `TemplateLiteral` is no `Literal`.
        KeyKind::ComputedString(value) => {
            value.is("displayName") && !file.slice(key.inner_span(file)).starts_with(b"`")
        }
        KeyKind::Computed(e) => is_display_name_declaration(Node::Expr(e)),
        KeyKind::Number(_) | KeyKind::ComputedNumber(_) | KeyKind::Private(_) => false,
    }
}

/// `isRequiredPropType`: also `a[isRequired]` and `a.#isRequired`.
pub(crate) fn is_required_prop_type(e: Expr<'_>) -> bool {
    is_member_called(e, "isRequired")
}
