//! `isArrayMethodCallWithPredicate.ts`

use super::{get_constrained_type_at_location, has_room_on_the_stack};
use crate::ast::{Expr, ExprKind, Node};
use crate::types::tsutils::{intersection_constituents, union_constituents};
use crate::types::{NameOf, NodeFlags, SymbolFlags, SyntaxKind, TsNode, TsSymbol, TypeFlags};
use crate::utils::ts_utils;

/// TypeScript's `resolveEntityName` of an entity name expression that is a value: through aliases,
/// and into namespaces and enums only. Parentheses are nodes there.
fn resolve_entity_name<'a>(node: Expr<'a>) -> Option<TsSymbol<'a>> {
    if node.is_parenthesized() || !has_room_on_the_stack() {
        return None;
    }
    let symbol = match node.kind() {
        ExprKind::Ident(_) => node.ts_symbol()?,
        ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") => {
            if !resolve_entity_name(obj)?.has_flags(SymbolFlags::NAMESPACE) {
                return None;
            }
            NameOf(node).ts_symbol()?
        }
        _ => return None,
    };
    Some(symbol.skip_alias())
}

/// The checker's `isBlockScopedNameDeclaredBeforeUse`, for a use in the linted file: the
/// declaration is before it, or the use is in a function that the declaration is not in.
fn is_block_scoped_name_declared_before_use(declaration: TsNode<'_>, usage: Expr<'_>) -> bool {
    if !declaration.is_in_linted_file() {
        return true;
    }
    let declaration = declaration.span();
    declaration.start <= usage.span().start
        || Node::Expr(usage)
            .ancestors()
            .filter_map(Node::as_func)
            .any(|func| !func.span().contains(declaration))
}

/// The checker's `tryGetNameFromEntityNameExpression`, if the name is that of a string: of a
/// `const` or of an enum member, by the literal type that is declared, then by that of the
/// initializer.
fn try_get_name_from_entity_name_expression<'a>(node: Expr<'a>) -> Option<&'a [u8]> {
    let symbol = resolve_entity_name(node)?;
    let declaration = symbol.value_declaration()?;
    let is_constant_variable = symbol.has_flags(SymbolFlags::VARIABLE)
        && declaration
            .flags()
            .intersects(NodeFlags::CONST | NodeFlags::USING);
    if !is_constant_variable && !symbol.has_flags(SymbolFlags::ENUM_MEMBER) {
        return None;
    }
    if let Some(type_node) = declaration.type_node() {
        let ty = type_node.get_type_from_type_node();
        if ty.has_flags(TypeFlags::STRING_OR_NUMBER_LITERAL | TypeFlags::UNIQUE_ES_SYMBOL) {
            return ty.string_value();
        }
    }
    // Not a binding element: its initializer does not alone decide its type.
    let kind = declaration.kind();
    if !matches!(
        kind,
        SyntaxKind::VariableDeclaration | SyntaxKind::EnumMember
    ) || !is_block_scoped_name_declared_before_use(declaration, node)
    {
        return None;
    }
    match declaration.initializer() {
        Some(initializer) => initializer.get_type_at_location().string_value(),
        None if kind == SyntaxKind::EnumMember => Some(symbol.name()),
        None => None,
    }
}

/// The checker's `getAccessedPropertyName` of a `Dot` or an `Index`, if the name is that of a
/// string: after the dot the name, with the `#` of a private one, in the brackets a string, a
/// `const` or an enum member. Parentheses in the brackets leave it without a name.
fn get_accessed_property_name<'a>(access: Expr<'a>) -> Option<&'a [u8]> {
    match access.kind() {
        ExprKind::Dot { name, .. } => Some(name.bytes()),
        ExprKind::Index { index, .. } if !index.is_parenthesized() => match index.kind() {
            ExprKind::String(value) => Some(value.bytes()),
            ExprKind::Template(template) if template.exprs().is_empty() => {
                Some(template.cooked(0)?.bytes())
            }
            _ => try_get_name_from_entity_name_expression(index),
        },
        _ => None,
    }
}

/// Whether a constituent of the constrained type at `object` is an array or a tuple type.
fn is_array_or_tuple_type_at_location(object: Expr<'_>) -> bool {
    union_constituents(get_constrained_type_at_location(object))
        .iter()
        .flat_map(intersection_constituents)
        .any(|t| t.is_array_type() || t.is_tuple_type())
}

/// tsgolint's `IsArrayMethodCallWithPredicate`: the callee is an access expression itself, not one
/// in parentheses, and its name is what the checker's `getAccessedPropertyName` says.
fn is_array_method_call_with_predicate_of_tsgolint(node: Expr<'_>) -> bool {
    let Some(call) = node.as_call() else {
        return false;
    };
    let callee = call.callee();
    if callee.is_parenthesized() {
        return false;
    }
    let Some(object) = callee.object() else {
        return false;
    };
    matches!(
        get_accessed_property_name(callee),
        Some(
            b"every"
                | b"filter"
                | b"find"
                | b"findIndex"
                | b"findLast"
                | b"findLastIndex"
                | b"some"
        )
    ) && is_array_or_tuple_type_at_location(object)
}

/// `isArrayMethodCallWithPredicate(context, services, node)`: whether the call `node` calls
/// `every`, `filter`, `find`, `findIndex`, `findLast`, `findLastIndex` or `some` of an array or a
/// tuple.
///
/// With a configuration of oxlint it is tsgolint's `IsArrayMethodCallWithPredicate`.
pub fn is_array_method_call_with_predicate(node: Expr) -> bool {
    if node.file().language().is_oxlint {
        return is_array_method_call_with_predicate_of_tsgolint(node);
    }
    ts_utils::is_array_method_call_with_predicate(node, is_array_or_tuple_type_at_location)
}
