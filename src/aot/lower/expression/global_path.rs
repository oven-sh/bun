#[cfg(test)]
mod tests;

use bun_sema::atom::Atom;
use bun_sema::hir::ExprId;

use super::{emit_locked_builtin, expect_resolved_path};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, SourceDialect};
use crate::ir::ValueId;
use crate::lower::FunctionLowering;
use crate::lower::member::{self, PropertyName};

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct GlobalPathMember {
    pub(in crate::lower) holder: Option<ValueId>,
    pub(in crate::lower) name: Atom,
}

pub(super) fn lower_global_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    path: &[Atom],
) -> ValueId {
    let resolved = lowering.file.builtins.of_expr(expression);
    match resolved {
        Some(Resolved::Builtin(builtin)) if builtin.locked_builtin().is_some() => {
            emit_locked_builtin(lowering, builtin.id)
        }
        Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => {
            let member = lower_global_path_holder(lowering, path);
            let value = emit_global_path_member(lowering, member.holder, member.name);
            expect_resolved_path(lowering, expression, value)
        }
    }
}

pub(in crate::lower) fn lower_global_path_holder(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    path: &[Atom],
) -> GlobalPathMember {
    let (&name, holders) = path.split_last().expect("a global path names a global");
    let mut holder = None;
    for &holder_name in holders {
        holder = Some(emit_global_path_member(lowering, holder, holder_name));
    }
    GlobalPathMember { holder, name }
}

// The functions of Bun's own modules are created in the scope of the global object, below the `let` and `const` bindings of scripts, so a script that declares `let process` does not shadow the global there.
fn sees_script_bindings(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> bool {
    match lowering.file.source.dialect() {
        SourceDialect::Program => true,
        SourceDialect::Runtime => false,
    }
}

pub(in crate::lower) fn emit_free_name_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: Atom,
    is_for_type_of: bool,
) -> ValueId {
    let key = lowering.file.atom_key(name);
    let is_free_name = sees_script_bindings(lowering);
    let global = lowering.builder.builtin(BuiltinId::GlobalThis);
    lowering.builder.prop_get(global, key, is_free_name, is_for_type_of)
}

pub(in crate::lower) fn emit_free_name_set(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: Atom,
    value: ValueId,
) {
    let key = lowering.file.atom_key(name);
    let mode = lowering.mode();
    let is_free_name = sees_script_bindings(lowering);
    let global = lowering.builder.builtin(BuiltinId::GlobalThis);
    lowering.file.fragment.note_write(key);
    lowering.builder.prop_set(global, key, mode, value, is_free_name);
}

pub(in crate::lower) fn emit_free_name_delete(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: Atom,
) -> ValueId {
    let key = lowering.file.atom_key(name);
    let mode = lowering.mode();
    let is_free_name = sees_script_bindings(lowering);
    let global = lowering.builder.builtin(BuiltinId::GlobalThis);
    lowering.builder.prop_delete(global, key, mode, is_free_name)
}

fn emit_global_path_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    holder: Option<ValueId>,
    name: Atom,
) -> ValueId {
    match holder {
        Some(holder) => {
            let key = lowering.file.atom_key(name);
            member::emit_get(lowering, holder, PropertyName::Constant(key))
        }
        None => emit_free_name_get(lowering, name, false),
    }
}
