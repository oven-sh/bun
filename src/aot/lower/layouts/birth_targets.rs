use bun_sema::bind::Parent;
use bun_sema::hir::{ExprId, ExprKind};

use crate::builtins::returns_first_argument;
use crate::ir::LayoutId;
use crate::lower::{CheckerTypeId, FileLowering};

impl FileLowering<'_, '_, '_, '_> {
    // The expression around `expression` whose value is the same object: a type assertion, or a call of a built-in function that returns its first argument.
    fn find_passage(&self, expression: ExprId) -> Option<ExprId> {
        let Parent::Expr(parent) = self.bound.parent_of_expr(expression) else {
            return None;
        };
        let hir = self.hir;
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
        let builtin = self
            .builtins
            .builtin_of_expression(hir.skip_type_assertions(call.callee))?;
        returns_first_argument(builtin).then_some(parent)
    }

    fn find_asserted_layout(&mut self, expression: ExprId) -> Option<(LayoutId, CheckerTypeId)> {
        let (ExprKind::As { .. } | ExprKind::Satisfies { .. }) = self.hir[expression].kind else {
            return None;
        };
        let ty = self.queries.expression_type(expression).ok()?;
        Some((self.object_type_layout(ty)?, ty))
    }

    // `Object.assign({ ...defaults }, given) as unknown as Options` makes an `Options`: the literal is where the object is born, and the first declared type on its way out says where its members lie.
    pub(super) fn find_target_layout(
        &mut self,
        literal: ExprId,
    ) -> Option<(LayoutId, CheckerTypeId)> {
        let mut outer = self.find_passage(literal)?;
        loop {
            if let Some(found) = self.find_asserted_layout(outer) {
                return Some(found);
            }
            match self.find_passage(outer) {
                Some(next) => outer = next,
                None => break,
            }
        }
        if let Ok(Some(ty)) = self.queries.contextual_type(outer)
            && let Some(layout) = self.object_type_layout(ty)
        {
            return Some((layout, ty));
        }
        let ty = self.queries.expression_type(outer).ok()?;
        Some((self.object_type_layout(ty)?, ty))
    }
}
