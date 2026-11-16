#[cfg(test)]
mod tests;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::Binding;
use bun_sema::hir::{ExprId, ExprKind};

use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, SourceDialect};
use crate::diagnostic_codes::Code;
use crate::ir::ValueId;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct GlobalPathMember {
    pub(in crate::lower) holder: Option<ValueId>,
    pub(in crate::lower) name: Atom,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn binding_of_defined_root(&self, expression: ExprId) -> Binding {
        match self.hir[expression].kind {
            ExprKind::Ident(_) => self.bound.binding(expression),
            _ => self.bound.runtime.binding_of_defined_path(expression),
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_global_path(&mut self, expression: ExprId, path: &[Atom]) -> ValueId {
        match self.file.builtins.of_pure_expr(expression) {
            Some(Resolved::Builtin(builtin)) if builtin.locked_builtin().is_some() => {
                self.emit_locked_builtin(builtin.id)
            }
            Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_))
            | None => {
                let member = self.lower_global_path_holder(expression, path);
                let value = match member.holder {
                    Some(_) => self.emit_global_path_member(member.holder, member.name),
                    None => self.get_root_of_global_path(expression, member.name),
                };
                self.expect_resolved_path(expression, value)
            }
        }
    }

    pub(in crate::lower) fn lower_global_path_holder(
        &mut self,
        expression: ExprId,
        path: &[Atom],
    ) -> GlobalPathMember {
        let (&name, holders) = path.split_last().expect("a global path names a global");
        let mut holder = None;
        for &holder_name in holders {
            holder = Some(match holder {
                Some(_) => self.emit_global_path_member(holder, holder_name),
                None => self.get_root_of_global_path(expression, holder_name),
            });
        }
        GlobalPathMember { holder, name }
    }

    pub(in crate::lower) fn get_root_of_global_path(
        &mut self,
        expression: ExprId,
        name: Atom,
    ) -> ValueId {
        match self.file.binding_of_defined_root(expression) {
            Binding::Free => self.emit_free_name_get(name, false),
            binding => self.get_binding_without_expression(binding, name),
        }
    }

    fn sees_script_bindings(&self) -> bool {
        match self.file.source.dialect() {
            SourceDialect::Program => true,
            SourceDialect::Runtime => false,
        }
    }

    pub(in crate::lower) fn emit_free_name_get(
        &mut self,
        name: Atom,
        is_for_type_of: bool,
    ) -> ValueId {
        if !is_for_type_of {
            self.report_global_without_support(name);
        }
        let key = self.file.atom_key(name);
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.builder
            .prop_get(global, key, is_free_name, is_for_type_of)
    }

    fn report_global_without_support(&mut self, name: Atom) {
        if name == known::ShadowRealm && self.sees_script_bindings() {
            let span = self.file.span_at(self.position());
            self.file
                .diagnostics
                .report(Code::ShadowRealmIsAbsent, span, &[]);
        }
    }

    pub(in crate::lower) fn emit_free_name_set(&mut self, name: Atom, value: ValueId) {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.file.fragment.note_write(key);
        self.builder
            .prop_set(global, key, mode, value, None, is_free_name);
    }

    pub(in crate::lower) fn emit_free_name_delete(&mut self, name: Atom) -> ValueId {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.builder.prop_delete(global, key, mode, is_free_name)
    }

    fn emit_global_path_member(&mut self, holder: Option<ValueId>, name: Atom) -> ValueId {
        match holder {
            Some(holder) => {
                let key = self.file.atom_key(name);
                self.emit_get(holder, PropertyName::Constant(key))
            }
            None => self.emit_free_name_get(name, false),
        }
    }
}
