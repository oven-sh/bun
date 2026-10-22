use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, MemberKey};

use crate::builtins::id::{BuiltinId, BuiltinName};
use crate::builtins::{BuiltinPath, Mutability, Resolved, table};
use crate::ir::generated::ImportPhase;
use crate::ir::{PropertyKeyId, StringId, ValueId, VariableKey};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, commonjs, expression, scope};
use crate::modules::{ImportBinding, ModuleRef, Shape, Site, SyntheticExportId, View};

pub(super) fn get_import(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
) -> ValueId {
    let file = &mut *lowering.file;
    let binding = file.inputs.modules.import_binding(file.file, symbol);
    let local_name = file.bound.symbol(symbol).name;
    let name = file.intern_atom(local_name);
    let path = file.builtins.of_symbol(symbol);
    emit_import_binding(lowering, binding, name, path)
}

pub(super) fn emit_import_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
) -> ValueId {
    match binding {
        ImportBinding::Variable(symbol) => {
            emit_variable_read(lowering, VariableKey::Symbol(symbol), name)
        }
        ImportBinding::Synthetic(export) => emit_synthetic_read(lowering, export, name),
        ImportBinding::Namespace { module, phase } => {
            emit_module_namespace(lowering, module, phase)
        }
        ImportBinding::Builtin(id) => emit_builtin_import(lowering, id, path),
        ImportBinding::CapturedBuiltin { member, export } => {
            let value = emit_variable_read(lowering, VariableKey::SyntheticExport(export), name);
            match path.map(|path| path.mutability) {
                Some(Mutability::ChangesOnItsOwn) => value,
                Some(Mutability::AlwaysLocked | Mutability::ConstantUnlessWritten) | None => {
                    lowering.expect_builtin(value, table::canonical_id(member))
                }
            }
        }
        ImportBinding::BuiltinMember {
            holder,
            name: member_name,
        } => {
            let object = lowering.builder.builtin(holder);
            emit_named_read(lowering, object, member_name)
        }
        ImportBinding::NamespaceRead {
            module,
            name: export_name,
        } => {
            let namespace = emit_module_namespace(lowering, module, ImportPhase::Evaluation);
            emit_named_read(lowering, namespace, export_name)
        }
        // Where the module has no object every use of the import is a member that is bound, and nothing looks at what it holds.
        ImportBinding::Exports { module } => match commonjs::emit_module_value(lowering, module) {
            Some(value) => value,
            None => lowering.builder.boolean(true),
        },
        ImportBinding::Unbound => lowering.builder.undefined(),
        ImportBinding::Unused | ImportBinding::Local => {
            debug_assert!(false, "no read reaches an import binding without storage");
            lowering.builder.undefined()
        }
    }
}

fn emit_variable_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: VariableKey,
    name: StringId,
) -> ValueId {
    let variable = scope::ensure_variable(lowering.file, key);
    let value = lowering.builder.get_module_variable(variable);
    lowering.builder.check_initialized(value, name)
}

// A name of a library module is a variable that the loader fills.
fn emit_synthetic_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    export: SyntheticExportId,
    name: StringId,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    let synthetic = *modules.synthetic_export(export);
    match modules.shape(synthetic.module) {
        Shape::AsToday | Shape::EsModule => {
            return emit_variable_read(lowering, VariableKey::SyntheticExport(export), name);
        }
        Shape::Names | Shape::Value => {}
    }
    if modules.settled(synthetic.module, synthetic.name)
        && let Some(value) = commonjs::read_imported_name(lowering, synthetic.module, synthetic.name)
    {
        return value;
    }
    emit_variable_read(lowering, VariableKey::Copy(export), name)
}

// ES modules see a CommonJS file through its face.
fn emit_module_namespace(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    phase: ImportPhase,
) -> ValueId {
    let module = lowering.file.inputs.modules.face(module).unwrap_or(module);
    let module = lowering.file.fragment.declare_module(module);
    lowering.builder.module_namespace(module, phase)
}

fn emit_named_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: Atom,
) -> ValueId {
    let key = member::name_key(lowering.file, name);
    member::emit_get(lowering, object, PropertyName::Constant(key))
}

pub(super) fn emit_builtin_import(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    id: BuiltinId,
    path: Option<BuiltinPath>,
) -> ValueId {
    match path {
        Some(BuiltinPath {
            id: locked,
            mutability: Mutability::AlwaysLocked,
        }) if table::is_legal_builtin_constant(locked) => lowering.builder.builtin(locked),
        // A locked property that holds a function of the host, which has no entry of its own: `import { wrap } from "node:module"`.
        Some(BuiltinPath {
            mutability: Mutability::AlwaysLocked,
            ..
        }) => emit_export_read(lowering, id),
        Some(BuiltinPath {
            mutability: Mutability::ConstantUnlessWritten,
            ..
        })
        | None => {
            let value = emit_export_read(lowering, id);
            lowering.expect_builtin(value, table::canonical_id(id))
        }
        Some(BuiltinPath {
            mutability: Mutability::ChangesOnItsOwn,
            ..
        }) => emit_export_read(lowering, id),
    }
}

fn emit_export_read(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, id: BuiltinId) -> ValueId {
    let entry = table::entry(id);
    match (entry.module, entry.holder) {
        (None, Some(holder)) => {
            let object = lowering.builder.builtin(holder);
            let key = text_key_of_name(lowering.file, entry.name);
            lowering.builder.prop_get(object, key, false, false)
        }
        (Some(_), Some(_) | None) | (None, None) => lowering.builder.builtin(id),
    }
}

fn text_key_of_name(file: &mut FileLowering<'_, '_, '_, '_>, name: BuiltinName) -> PropertyKeyId {
    debug_assert!(!table::is_symbol_name(name), "an export has a text name");
    let text = file.intern_bytes(table::text_of_name(name));
    file.text_key(text)
}

// A module that is not in the program has no object.
pub(super) fn lower_namespace_receiver(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ExprId,
) -> ValueId {
    let file = &*lowering.file;
    let name = file.hir.skip_type_assertions(object);
    let binding = match file.bound.binding(name) {
        Binding::Symbol(symbol) if matches!(file.hir[name].kind, ExprKind::Ident(_)) => {
            file.inputs.modules.import_binding(file.file, symbol)
        }
        _ => ImportBinding::Local,
    };
    match binding {
        ImportBinding::Namespace { module, .. } if file.inputs.modules.is_left_out(module) => {
            lowering.builder.undefined()
        }
        _ => match find_required_namespace(file, name) {
            Some(module) => emit_module_namespace(lowering, module, ImportPhase::Evaluation),
            None => expression::lower_expression(lowering, object),
        },
    }
}

// `const a = require("./m.mjs")`: `a` stands for what `import * as a` stands for, and so does the call itself in `require("./m.mjs").f()`, which the read of the member has evaluated.
fn find_required_namespace(
    file: &FileLowering<'_, '_, '_, '_>,
    name: ExprId,
) -> Option<ModuleRef> {
    if let ExprKind::Call(_) = file.hir[name].kind {
        return match file.inputs.modules.site(file.file, name)? {
            Site::Evaluate { target, .. } => {
                (file.inputs.modules.shape(target) == Shape::EsModule).then_some(target)
            }
            Site::AsToday => None,
        };
    }
    let holder = match file.bound.binding(name) {
        Binding::Symbol(holder) if matches!(file.hir[name].kind, ExprKind::Ident(_)) => holder,
        _ => return None,
    };
    match file.inputs.modules.holder(file.file, holder)? {
        View::Namespace(module) => Some(module),
        View::Exports(_) => None,
    }
}

pub(super) fn lower_namespace_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    let file = &mut *lowering.file;
    let binding = file.inputs.modules.member_binding(file.file, access)?;
    let name = match file.hir.member_key(access) {
        Some((_, MemberKey::Name(name))) => file.intern_atom(name),
        Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => {
            debug_assert!(false, "module binding binds member accesses with a constant name");
            return None;
        }
    };
    let path = match file.builtins.of_expr(access) {
        Some(Resolved::Builtin(path)) => Some(path),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    };
    let position = file.hir[access].pos;
    // Whoever reads `a.c` has read `a` first, which throws in the dead zone of `a`: before `const a = require(..)` has run.
    commonjs::check_member_root(lowering, access);
    lowering.set_position(position);
    Some(emit_import_binding(lowering, binding, name, path))
}
