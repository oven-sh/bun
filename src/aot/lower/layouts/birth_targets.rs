use bun_sema::bind::Parent;
use bun_sema::hir::{ExprId, ExprKind};

use crate::builtins::returns_first_argument;
use crate::ir::LayoutId;
use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
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
        let callee = hir.skip_type_assertions(call.callee);
        let builtin = self.builtins.builtin_of_expression(callee)?;
        returns_first_argument(builtin).then_some(parent)
    }

    fn find_asserted_layout(&mut self, expression: ExprId) -> Option<LayoutId> {
        let (ExprKind::As { .. } | ExprKind::Satisfies { .. }) = self.hir[expression].kind else {
            return None;
        };
        let ty = self.queries.expression_type(expression).ok()?;
        self.object_type_layout(ty)
    }

    // `Object.assign({ ...defaults }, given) as unknown as Options` makes an `Options`: the literal is where the object is born, and the first declared type on its way out says where its members lie.
    pub(super) fn find_target_layout(&mut self, literal: ExprId) -> Option<LayoutId> {
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
            return Some(layout);
        }
        let ty = self.queries.expression_type(outer).ok()?;
        self.object_type_layout(ty)
    }
}
