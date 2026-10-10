//! oxlint's `utils/node.rs`.

use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::{
    get_inner_expression, is_global_reference, is_global_turned_off, static_property_name,
};

/// `ident`: an identifier.
fn is_global_module_reference(ident: Expr) -> bool {
    ident.is_ident("module")
        && is_global_reference(ident)
        && !is_global_turned_off(ident.file(), "module")
}

/// `node`: what is assigned to. Parentheses around it do not count.
pub(crate) fn is_global_exports_assignment_target(node: Expr) -> bool {
    node.is_ident("exports")
        && is_global_reference(node)
        && !is_global_turned_off(node.file(), "exports")
}

/// `member_expr`: a `Dot` or an `Index`.
pub(crate) fn is_global_module_exports(member_expr: Expr) -> bool {
    static_property_name(member_expr).is_some_and(|name| name.is("exports"))
        && member_expr
            .object()
            .is_some_and(|object| is_global_module_reference(get_inner_expression(object)))
}

/// The `assign_expr.left.as_member_expression().is_some_and(is_global_module_exports)` of an assignment.
pub(crate) fn assigns_to_global_module_exports(assign_expr: Expr) -> bool {
    assign_expr.tag() == ExprTag::Assign && assign_expr.left().is_some_and(is_global_module_exports)
}
