//! `lib/util/props.js` of eslint-plugin-react.
//!
//! | upstream | here |
//! |---|---|
//! | `getTypeArguments(node)` | `call.type_args()`, `jsx.type_args()`, `TypeKind::Ref { args }` |
//! | `getSuperTypeArguments(node)` | `class.extends_args()` |
//!
//! Functions that take a `Node` expect a `Member`, `Prop`, `PatProp`, `Dot` or `Index`. As in
//! `util_ast`, callers that reach a member access from its parent have to check `is_chain_root()`
//! first.

use crate::util_ast::{get_property_name, name_of_key};
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;

/// `astUtil.getPropertyName(node) === name`
fn is_named(node: Node<'_>, name: &str) -> bool {
    get_property_name(node).is_some_and(|it| it == name.as_bytes())
}

/// `node.key.name === name`, for a `PropertyDefinition`.
fn is_field_named(member: Member<'_>, name: &str) -> bool {
    let key_name = member.key().and_then(name_of_key);
    key_name.is_some_and(|it| it == name.as_bytes()) && ast_utils::is_property_definition(member)
}

/// Upstream's "for Flow" case: a field `name` with a type annotation.
fn is_annotated_field(node: Node<'_>, name: &str) -> bool {
    matches!(node, Node::Member(member) if member.ty().is_some() && is_field_named(member, name))
}

pub(crate) fn is_prop_types_declaration(node: Node<'_>) -> bool {
    is_annotated_field(node, "props") || is_named(node, "propTypes")
}

pub(crate) fn is_context_types_declaration(node: Node<'_>) -> bool {
    is_annotated_field(node, "context") || is_named(node, "contextTypes")
}

pub(crate) fn is_context_type_declaration(node: Node<'_>) -> bool {
    is_named(node, "contextType")
}

pub(crate) fn is_child_context_types_declaration(node: Node<'_>) -> bool {
    is_named(node, "childContextTypes")
}

pub(crate) fn is_default_props_declaration(node: Node<'_>) -> bool {
    get_property_name(node).is_some_and(|it| it == b"defaultProps" || it == b"getDefaultProps")
}

/// `isDisplayNameDeclaration`, for a field or an expression. A key isn't a node, so use
/// [`is_display_name_key`]. Neither is the `b` in `a.b`, so use `name.name().is("displayName")`.
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
        // A `TemplateLiteral` isn't a `Literal`.
        KeyKind::ComputedString(value) => {
            value.is("displayName") && !file.slice(key.inner_span(file)).starts_with(b"`")
        }
        KeyKind::Computed(e) => is_display_name_declaration(Node::Expr(e)),
        KeyKind::Number(_) | KeyKind::ComputedNumber(_) | KeyKind::Private(_) => false,
    }
}

/// `isRequiredPropType`. Also matches `a[isRequired]` and `a.#isRequired`.
pub(crate) fn is_required_prop_type(e: Expr<'_>) -> bool {
    is_member_called(e, "isRequired")
}
