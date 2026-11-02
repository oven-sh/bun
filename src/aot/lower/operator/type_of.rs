use bun_sema::fold::{Decision, NamedPath};
use bun_sema::hir::{ExprId, ExprKind};

use crate::builtins::{Mutability, Resolved};
use crate::ir::ValueId;
use crate::lower::expression::DefineStop;
use crate::lower::{FileLowering, FunctionLowering};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_typeof_operand(&mut self, operand: ExprId) -> ValueId {
        let hir = self.file.hir;
        let target = self.file.skip_type_syntax(operand);
        if self.file.is_always_resolvable(target) {
            return self.lower_expression(operand);
        }
        let value = match self.file.decisions().decision(target) {
            Decision::GlobalPath(&[name]) => {
                self.set_position(hir[target].pos);
                let value = self.emit_free_name_get(name, true);
                self.expect_resolved_path(target, value)
            }
            Decision::NamedPath(named) if named.names.len() == 1 => {
                self.lower_named_typeof_operand(target, named)
            }
            Decision::Unknown => {
                if !matches!(hir[target].kind, ExprKind::Ident(_)) {
                    return self.lower_expression(operand);
                }
                self.set_position(hir[target].pos);
                self.lower_identifier_for_typeof(target)
            }
            _ => return self.lower_expression(operand),
        };
        self.convert_through_assertions(operand, value)
    }

    // The operand of `typeof` where a define gives `target` one name.
    fn lower_named_typeof_operand(&mut self, target: ExprId, named: &NamedPath<'_>) -> ValueId {
        let stop = self.find_define_stop(target, named, DefineStop::TypeOf);
        if stop.is_some() {
            self.report_define_without_support(target, named, DefineStop::TypeOf);
            return self.builder.undefined();
        }
        let hir = self.file.hir;
        self.set_position(hir[target].pos);
        let is_name = matches!(hir[target].kind, ExprKind::Ident(_));
        self.get_define_head_for_typeof(&named.head, is_name)
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn is_always_resolvable(&self, target: ExprId) -> bool {
        match self.builtins.of_pure_expr(target) {
            Some(Resolved::Builtin(path)) => match path.mutability {
                Mutability::AlwaysLocked => true,
                Mutability::ConstantUnlessWritten | Mutability::ChangesOnItsOwn => false,
            },
            Some(Resolved::Intrinsic(_)) => true,
            Some(Resolved::DynamicGlobal(_)) | None => false,
        }
    }
}
