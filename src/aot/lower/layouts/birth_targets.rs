use bun_sema::bind::Parent;
use bun_sema::hir::{ExprId, ExprKind};

use super::object_types::object_type_layout;
use crate::builtins::returns_first_argument;
use crate::ir::LayoutId;
use crate::lower::{CheckerTypeId, FileLowering};

// The expression around `expression` whose value is the same object: a type assertion, or a call of a built-in function that returns its first argument.
fn find_passage(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Option<ExprId> {
    let Parent::Expr(parent) = file.bound.parent_of_expr(expression) else {
        return None;
    };
    let hir = file.hir;
    if hir.type_assertion_operand(parent) == Some(expression) {
        return Some(parent);
    }
    let ExprKind::Call(call) = hir[parent].kind else {
        return None;
    };
    let call = hir[call];
    if hir.ids(call.args).next() != Some(expression) {
        return None;
    }
    let builtin = file.builtins.builtin_of_expression(hir.skip_type_assertions(call.callee))?;
    returns_first_argument(builtin).then_some(parent)
}

fn find_asserted_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<(LayoutId, CheckerTypeId)> {
    let (ExprKind::As { .. } | ExprKind::Satisfies { .. }) = file.hir[expression].kind else {
        return None;
    };
    let ty = file.queries.expression_type(expression).ok()?;
    Some((object_type_layout(file, ty)?, ty))
}

// `Object.assign({ ...defaults }, given) as unknown as Options` makes an `Options`: the literal is where the object is born, and the first declared type on its way
// out says where its members lie. Without one the type of the last call does: that of `Object.assign({}, a, b)` has the names of `a` and of `b`.
// It decides a placement alone: what the object holds is what the program stores.
pub(super) fn find_target_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> Option<(LayoutId, CheckerTypeId)> {
    let mut outer = find_passage(file, literal)?;
    loop {
        if let Some(found) = find_asserted_layout(file, outer) {
            return Some(found);
        }
        match find_passage(file, outer) {
            Some(next) => outer = next,
            None => break,
        }
    }
    if let Ok(Some(ty)) = file.queries.contextual_type(outer)
        && let Some(layout) = object_type_layout(file, ty)
    {
        return Some((layout, ty));
    }
    let ty = file.queries.expression_type(outer).ok()?;
    Some((object_type_layout(file, ty)?, ty))
}
