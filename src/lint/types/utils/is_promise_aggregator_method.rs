//! `isPromiseAggregatorMethod.ts`

use super::{get_constrained_type_at_location, has_room_on_the_stack, is_promise_constructor_like};
use crate::ast::{Expr, ExprKind, Node};
use crate::types::{NameOf, NodeFlags, SymbolFlags, SyntaxKind, TsNode, TsSymbol};
use crate::utils::ts_utils;

/// TypeScript's `resolveEntityName` of an entity name expression that is a value: through aliases,
/// and into namespaces and enums only.
fn resolve_entity_name(node: Expr<'_>) -> Option<TsSymbol<'_>> {
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

/// The checker's `isBlockScopedNameDeclaredBeforeUse`, for a use in the linted file: the declaration
/// is before it, or the use is in a function that the declaration is not in.
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
/// constant or of a member of an enum, the literal type that is declared, or else that of the
/// initializer. A variable of a binding pattern has no name.
fn try_get_name_from_entity_name_expression<'a>(node: Expr<'a>) -> Option<&'a [u8]> {
    let symbol = resolve_entity_name(node)?;
    let declaration = symbol.value_declaration()?;
    let is_constant_variable = declaration.kind() == SyntaxKind::VariableDeclaration
        && declaration
            .flags()
            .intersects(NodeFlags::CONST.union(NodeFlags::USING));
    if !is_constant_variable && !symbol.has_flags(SymbolFlags::ENUM_MEMBER) {
        return None;
    }
    let declared = declaration
        .type_node()
        .and_then(|it| it.get_type_from_type_node().string_value());
    if declared.is_some() {
        return declared;
    }
    if !is_block_scoped_name_declared_before_use(declaration, node) {
        return None;
    }
    match declaration.initializer() {
        Some(initializer) => initializer.get_type_at_location().string_value(),
        None if declaration.kind() == SyntaxKind::EnumMember => Some(declaration.name()?.text()),
        None => None,
    }
}

/// The checker's `tryGetElementAccessExpressionName`, if the name is that of a string: the key is a
/// string, or the name of a constant or of a member of an enum. A key in parentheses has no name.
fn try_get_element_access_expression_name<'a>(index: Expr<'a>) -> Option<&'a [u8]> {
    if index.is_parenthesized() {
        return None;
    }
    match index.kind() {
        ExprKind::String(value) => Some(value.bytes()),
        ExprKind::Template(template) if template.exprs().is_empty() => {
            Some(template.cooked(0)?.bytes())
        }
        ExprKind::Ident(_) | ExprKind::Dot { .. } => {
            try_get_name_from_entity_name_expression(index)
        }
        _ => None,
    }
}

/// tsgolint's `isPromiseAggregatorMethod`: the callee is taken out of its parentheses, also where
/// they end an optional chain, and the name of the method is the checker's `getAccessedPropertyName`.
fn is_promise_aggregator_method_of_tsgolint(node: Expr) -> bool {
    let ExprKind::Call(call) = node.kind() else {
        return false;
    };
    let (object, name) = match call.callee().kind() {
        ExprKind::Dot { obj, name, .. } => (obj, Some(name.bytes())),
        ExprKind::Index { obj, index, .. } => (obj, try_get_element_access_expression_name(index)),
        _ => return false,
    };
    matches!(name, Some(b"all" | b"allSettled" | b"race" | b"any"))
        && is_promise_constructor_like(get_constrained_type_at_location(object))
}

/// `isPromiseAggregatorMethod(context, services, node)`: whether the call `node` calls `all`,
/// `allSettled`, `race` or `any` of the `Promise` constructor.
pub fn is_promise_aggregator_method(node: Expr) -> bool {
    if node.file().language().is_oxlint {
        return is_promise_aggregator_method_of_tsgolint(node);
    }
    ts_utils::is_promise_aggregator_method(node, |object| {
        is_promise_constructor_like(get_constrained_type_at_location(object))
    })
}
