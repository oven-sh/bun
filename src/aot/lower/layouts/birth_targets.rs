use bun_sema::bind::Parent;
use bun_sema::check::aot::{ObjectMemberKind, ObjectOrigin};
use bun_sema::hir::{ExprId, ExprKind, PropKind};

use crate::builtins::id::BuiltinId;
use crate::builtins::table;
use crate::ir::LayoutId;
use crate::lower::{CheckerTypeId, FileLowering};

fn returns_first_argument(builtin: BuiltinId) -> bool {
    matches!(
        table::canonical_id(builtin),
        BuiltinId::ObjectAssign
            | BuiltinId::ObjectDefineProperties
            | BuiltinId::ObjectDefineProperty
            | BuiltinId::ObjectFreeze
            | BuiltinId::ObjectPreventExtensions
            | BuiltinId::ObjectSeal
            | BuiltinId::ObjectSetPrototypeOf
    )
}

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
        let ty = match self.hir[expression].kind {
            ExprKind::As { .. } => self.queries.expression_type(expression).ok()?,
            ExprKind::Satisfies { expr: operand, .. } => {
                self.queries.contextual_type(operand).ok()??
            }
            _ => return None,
        };
        self.object_type_layout(ty)
    }

    fn lists_accessors_of_another_literal(&mut self, ty: CheckerTypeId, literal: ExprId) -> bool {
        let own = ObjectOrigin::ObjectLiteral {
            file: self.file,
            expression: literal,
        };
        self.queries.object_origin(ty) != own && self.lists_accessors(ty)
    }

    fn lists_accessors(&mut self, ty: CheckerTypeId) -> bool {
        self.queries.listed_members(ty).is_ok_and(|listed| {
            listed.iter().any(|member| {
                matches!(
                    member.kind,
                    ObjectMemberKind::Getter
                        | ObjectMemberKind::Setter
                        | ObjectMemberKind::GetterAndSetter
                )
            })
        })
    }

    fn declares_accessors(&self, literal: ExprId) -> bool {
        let ExprKind::Object(properties) = self.hir[literal].kind else {
            return false;
        };
        properties
            .iter()
            .any(|property| matches!(self.hir[property].kind, PropKind::Getter | PropKind::Setter))
    }

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
        // `Object.assign({}, source)` has the type of the source, whose accessors it reads.
        if self.lists_accessors_of_another_literal(ty, literal) {
            return None;
        }
        // `Object.freeze({ get next() { .. } })` has a type that lists values, as the copies of it hold.
        if self.declares_accessors(literal) && !self.lists_accessors(ty) {
            return None;
        }
        self.object_type_layout(ty)
    }
}
