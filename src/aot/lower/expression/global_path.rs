#[cfg(test)]
mod tests;

use bun_sema::atom::Atom;
use bun_sema::hir::ExprId;

use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, SourceDialect};
use crate::ir::ValueId;
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct GlobalPathMember {
    pub(in crate::lower) holder: Option<ValueId>,
    pub(in crate::lower) name: Atom,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_global_path(&mut self, expression: ExprId, path: &[Atom]) -> ValueId {
        match self.file.builtins.of_expr(expression) {
            Some(Resolved::Builtin(builtin)) if builtin.locked_builtin().is_some() => {
                self.emit_locked_builtin(builtin.id)
            }
            Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_))
            | None => {
                let member = self.lower_global_path_holder(path);
                let value = self.emit_global_path_member(member.holder, member.name);
                self.expect_resolved_path(expression, value)
            }
        }
    }

    pub(in crate::lower) fn lower_global_path_holder(&mut self, path: &[Atom]) -> GlobalPathMember {
        let (&name, holders) = path.split_last().expect("a global path names a global");
        let mut holder = None;
        for &holder_name in holders {
            holder = Some(self.emit_global_path_member(holder, holder_name));
        }
        GlobalPathMember { holder, name }
    }

    // The functions of Bun's own modules are created in the scope of the global object, below the `let` and `const` bindings of scripts, so a script that declares `let process` does not shadow the global there.
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
        let key = self.file.atom_key(name);
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis);
        self.builder
            .prop_get(global, key, is_free_name, is_for_type_of)
    }

    pub(in crate::lower) fn emit_free_name_set(&mut self, name: Atom, value: ValueId) {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis);
        self.file.fragment.note_write(key);
        self.builder
            .prop_set(global, key, mode, value, is_free_name);
    }

    pub(in crate::lower) fn emit_free_name_delete(&mut self, name: Atom) -> ValueId {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis);
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
