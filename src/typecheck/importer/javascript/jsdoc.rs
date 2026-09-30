// Where the JSDoc nodes that TypeScript 6.0.2 builds differ from the ones that internal/parser/jsdoc.go builds: the names that a producer maps while it makes the nodes, and the shapes that it gives them afterwards.
use super::tree::{
    children, list_member, name, node_member, set_node_member, tag_name, type_expression, type_node,
};
use crate::ast::{
    FileBuilder, Kind, MemberValue, ModifierListId, NodeFactory, NodeFlags, NodeId, NodeListId,
};
use crate::core::new_text_range;

// The kind of typescript-go for a kind name of TypeScript 6.0.2 that typescript-go does not have: None for a name that the two share and for a kind without a counterpart (JSDocFunctionType, JSDocNamepathType).
pub fn kind_of_typescript_kind(name: &[u8]) -> Option<Kind> {
    match name {
        b"JSDocTag" | b"JSDocAuthorTag" | b"JSDocClassTag" | b"JSDocEnumTag" => {
            Some(Kind::JSDocUnknownTag)
        }
        b"JSDocMemberName" => Some(Kind::QualifiedName),
        // `?` alone: `convert_jsdoc_shapes` gives the nullable type its missing type reference.
        b"JSDocUnknownType" => Some(Kind::JSDocNullableType),
        _ => None,
    }
}

// The member of ast.json that holds a property of a JSDoc node of TypeScript 6.0.2.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JsDocMember {
    // The member has the name of the property, with its first letter in upper case unless it is `name` or `modifiers`.
    Same,
    Renamed(&'static str),
    // typescript-go has no such member.
    Dropped,
}

// The member for a property of a JSDoc node, by the kind of typescript-go and the name of the property in TypeScript 6.0.2.
pub fn member_of_typescript_property(kind: Kind, property: &[u8]) -> JsDocMember {
    match (kind, property) {
        (Kind::JSDocAugmentsTag | Kind::JSDocImplementsTag, b"class") => {
            JsDocMember::Renamed("ClassName")
        }
        (Kind::JSDocTypedefTag | Kind::JSDocCallbackTag, b"fullName") => {
            JsDocMember::Renamed("name")
        }
        // The name of a typedef or callback tag is the innermost name of its full name.
        (Kind::JSDocTypedefTag | Kind::JSDocCallbackTag, b"name") => JsDocMember::Dropped,
        (Kind::JSDocSeeTag, b"name") => JsDocMember::Renamed("NameExpression"),
        (Kind::JSDocTypeLiteral, b"jsDocPropertyTags") => JsDocMember::Renamed("JSDocPropertyTags"),
        (Kind::TypeParameter, b"default") => JsDocMember::Renamed("DefaultType"),
        // typescript-go keeps no type expression of an enum tag: the tag is an unknown tag.
        (Kind::JSDocUnknownTag, b"typeExpression") => JsDocMember::Dropped,
        _ => JsDocMember::Same,
    }
}

// parseJSDocTypeNameWithNamespace: the dotted name of a typedef or callback tag is a chain of namespace declarations without modifiers, the inner ones nested.
fn convert_jsdoc_namespace(b: &mut FileBuilder, full_name: NodeId) {
    let mut declaration = full_name;
    let mut nested = false;
    while b.kind(declaration) == Kind::ModuleDeclaration {
        b.set_member(
            declaration,
            b"Keyword",
            MemberValue::Kind(Kind::NamespaceKeyword),
        );
        b.set_modifiers(declaration, ModifierListId::NIL);
        let flags = b.flags(declaration).without(NodeFlags::NESTED_NAMESPACE);
        b.set_flags(
            declaration,
            if nested {
                flags | NodeFlags::NESTED_NAMESPACE
            } else {
                flags
            },
        );
        nested = true;
        declaration = node_member(b, declaration, b"Body");
    }
}

// createMissingIdentifier of upstream's JSDoc parser: an empty identifier with the error flag, where the parser stands.
fn new_missing_identifier(b: &mut FileBuilder, context: NodeId, pos: i32) -> NodeId {
    let identifier = b.new_identifier(b"");
    b.set_loc(identifier, new_text_range(pos, pos));
    b.set_flags(
        identifier,
        b.flags(context) | NodeFlags::THIS_NODE_HAS_ERROR,
    );
    identifier
}

// Where upstream's parser stands when a typedef or callback tag has no name: at the next tag of the comment when one follows, which skipWhitespaceOrAsterisk reaches, else at the end of what the parser read last.
fn missing_name_pos(b: &FileBuilder, tag: NodeId, type_expression: NodeId) -> i32 {
    let after_tag_name = b.loc(tag_name(b, tag)).end();
    if b.kind(tag) == Kind::JSDocCallbackTag {
        let tag_end = b.loc(tag).end();
        let parameters = list_member(b, type_expression, b"Parameters");
        let next = b.list_loc(parameters).pos();
        return if !parameters.is_nil() && next < tag_end {
            next
        } else {
            after_tag_name
        };
    }
    match b.kind(type_expression) {
        Kind::Unknown => after_tag_name,
        Kind::JSDocTypeLiteral => {
            let property_tags = list_member(b, type_expression, b"JSDocPropertyTags");
            match b.list_nodes(property_tags).first() {
                Some(first) => b.loc(*first).pos(),
                None => b.loc(type_expression).end(),
            }
        }
        _ => b.loc(type_expression).end(),
    }
}

// The shape that upstream's parser gives one node where TypeScript gives another.
fn convert_node(b: &mut FileBuilder, node: NodeId) {
    match b.kind(node) {
        Kind::JSDocTypedefTag | Kind::JSDocCallbackTag => {
            let type_expression = type_expression(b, node);
            if name(b, node).is_nil() {
                let pos = missing_name_pos(b, node, type_expression);
                let missing = new_missing_identifier(b, node, pos);
                set_node_member(b, node, b"name", missing);
            }
            convert_jsdoc_namespace(b, name(b, node));
            if b.kind(node) == Kind::JSDocCallbackTag {
                // The signature of a callback tag starts where its parameters start.
                let parameters = list_member(b, type_expression, b"Parameters");
                if !type_expression.is_nil() && !parameters.is_nil() {
                    let loc = b
                        .loc(type_expression)
                        .with_pos(b.list_loc(parameters).pos());
                    b.set_loc(type_expression, loc);
                }
            } else if b.kind(type_expression) == Kind::JSDocTypeLiteral {
                // The type literal of a typedef tag starts at its first property tag.
                let property_tags = list_member(b, type_expression, b"JSDocPropertyTags");
                if let Some(first) = b.list_nodes(property_tags).first().copied() {
                    let loc = b.loc(type_expression).with_pos(b.loc(first).pos());
                    b.set_loc(type_expression, loc);
                }
            }
        }
        Kind::JSDocTemplateTag => {
            // The list of the type parameters of a template tag has no range.
            let type_parameters = list_member(b, node, b"TypeParameters");
            if !type_parameters.is_nil() {
                b.set_list_loc(type_parameters, new_text_range(0, 0));
            }
        }
        Kind::JSDocNullableType => {
            // `?` alone is the nullable type of a missing type reference.
            if type_node(b, node).is_nil() {
                let end = b.loc(node).end();
                let missing = new_missing_identifier(b, node, end);
                let reference = b.new_type_reference_node(missing, NodeListId::NIL);
                b.set_loc(reference, new_text_range(end, end));
                b.set_flags(reference, b.flags(node));
                set_node_member(b, node, b"Type", reference);
            }
        }
        _ => {}
    }
}

// True when the comment holds a deprecated tag: what Parser.hasDeprecatedTag is after the comment is parsed.
fn has_deprecated_tag(b: &FileBuilder, js_doc: NodeId) -> bool {
    let mut pending = vec![js_doc];
    while let Some(node) = pending.pop() {
        if b.kind(node) == Kind::JSDocDeprecatedTag {
            return true;
        }
        children(b, node, &mut pending);
    }
    false
}

// Gives the JSDoc nodes of a JavaScript file the shapes of upstream's parser and its hosts the flags of withJSDoc: a host has HasJSDoc when a comment is attached to it and PossiblyContainsDeprecatedTag when one of its comments has a deprecated tag. It changes nothing in a tree that has these shapes already.
pub fn convert_jsdoc_shapes(b: &mut FileBuilder, source_file: NodeId) {
    let mut jsdoc_of = vec![NodeListId::NIL; b.node_count() as usize + 1];
    for (host, list) in b.jsdoc_attachments() {
        if let Some(slot) = jsdoc_of.get_mut(host.0 as usize) {
            *slot = *list;
        }
    }
    let host_flags = NodeFlags::HAS_JSDOC | NodeFlags::POSSIBLY_CONTAINS_DEPRECATED_TAG;
    let mut pending = vec![source_file];
    while let Some(node) = pending.pop() {
        convert_node(b, node);
        let comments = jsdoc_of
            .get(node.0 as usize)
            .copied()
            .unwrap_or(NodeListId::NIL);
        let comments = b.list_nodes(comments);
        let mut flags = b.flags(node).without(host_flags);
        if !comments.is_empty() {
            flags |= NodeFlags::HAS_JSDOC;
            if comments.iter().any(|js_doc| has_deprecated_tag(b, *js_doc)) {
                flags |= NodeFlags::POSSIBLY_CONTAINS_DEPRECATED_TAG;
            }
        }
        pending.extend_from_slice(comments);
        if flags != b.flags(node) {
            b.set_flags(node, flags);
        }
        children(b, node, &mut pending);
    }
}
