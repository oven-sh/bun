use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, MemberKey};

use crate::builtins::id::{BuiltinId, BuiltinName};
use crate::builtins::{BuiltinPath, Mutability, Resolved, table};
use crate::ir::generated::ImportPhase;
use crate::ir::{PropertyKeyId, StringId, ValueId, VariableKey};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs};
use crate::modules::{ImportBinding, ModuleRef, Shape, SyntheticExportId, View};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn get_import(&mut self, symbol: SymbolId) -> ValueId {
        let file = &mut *self.file;
        let binding = file.inputs.modules.import_binding(file.file, symbol);
        let local_name = file.bound.symbol(symbol).name;
        let name = file.intern_binding_name(Binding::Symbol(symbol), local_name);
        let path = file.builtins.of_symbol(symbol);
        emit_import_binding(self, binding, name, path)
    }

    pub(crate) fn emit_variable_read(&mut self, key: VariableKey, name: StringId) -> ValueId {
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        self.builder.check_initialized(value, name)
    }

    // A name of a library module is a variable that the loader fills.
    fn emit_synthetic_read(&mut self, export: SyntheticExportId, name: StringId) -> ValueId {
        let modules = self.file.inputs.modules;
        let synthetic = *modules.synthetic_export(export);
        match modules.shape(synthetic.module) {
            Shape::AsToday | Shape::EsModule => {
                return self.emit_variable_read(VariableKey::SyntheticExport(export), name);
            }
            Shape::Names | Shape::Value => {}
        }
        if modules.settled(synthetic.module, synthetic.name)
            && let Some(value) = self.read_imported_name(synthetic.module, synthetic.name)
        {
            return value;
        }
        self.emit_variable_read(VariableKey::Copy(export), name)
    }

    // ES modules see a CommonJS file through its face.
    fn emit_module_namespace(&mut self, module: ModuleRef, phase: ImportPhase) -> ValueId {
        let module = self.file.inputs.modules.face(module).unwrap_or(module);
        let module = self.file.fragment.declare_module(module);
        self.builder.module_namespace(module, phase)
    }

    pub(crate) fn emit_named_read(&mut self, object: ValueId, name: Atom) -> ValueId {
        let key = self.file.name_key(name);
        self.emit_get(object, PropertyName::Constant(key))
    }

    pub(super) fn emit_builtin_import(
        &mut self,
        id: BuiltinId,
        path: Option<BuiltinPath>,
    ) -> ValueId {
        match path.map(|path| (path.id, path.mutability)) {
            Some((locked, Mutability::AlwaysLocked))
                if table::is_legal_builtin_constant(locked) =>
            {
                self.builder.builtin(locked)
            }
            // A locked property that holds a function of the host, which has no entry of its own: `import { wrap } from "node:module"`.
            Some((_, Mutability::AlwaysLocked | Mutability::ChangesOnItsOwn)) => {
                self.emit_export_read(id)
            }
            Some((_, Mutability::ConstantUnlessWritten)) | None => {
                let value = self.emit_export_read(id);
                self.expect_builtin(value, table::canonical_id(id))
            }
        }
    }

    fn emit_export_read(&mut self, id: BuiltinId) -> ValueId {
        let entry = table::entry(id);
        match (entry.module, entry.holder) {
            (None, Some(holder)) => {
                let object = self.builder.builtin(holder);
                let key = self.file.text_key_of_name(entry.name);
                self.builder.prop_get(object, key, false, false)
            }
            (Some(_), Some(_) | None) | (None, None) => self.builder.builtin(id),
        }
    }

    // A module that is not in the program has no object.
    pub(crate) fn lower_namespace_receiver(&mut self, object: ExprId) -> ValueId {
        let file = &*self.file;
        let name = file.hir.skip_type_assertions(object);
        let binding = match file.bound.binding(name) {
            Binding::Symbol(symbol) if matches!(file.hir[name].kind, ExprKind::Ident(_)) => {
                file.inputs.modules.import_binding(file.file, symbol)
            }
            _ => ImportBinding::Local,
        };
        match binding {
            ImportBinding::Namespace { module, .. } if file.inputs.modules.is_left_out(module) => {
                self.builder.undefined()
            }
            // `const a = require("./m.mjs")`: `a` stands for what `import * as a` stands for, and so does the call itself in `require("./m.mjs").f()`, which the read of the member has evaluated.
            _ => match file.find_view(name) {
                Some(View::Namespace(module)) => {
                    self.emit_module_namespace(module, ImportPhase::Evaluation)
                }
                Some(View::Exports(_)) | None => self.lower_expression(object),
            },
        }
    }

    pub(crate) fn lower_namespace_member(&mut self, access: ExprId) -> Option<ValueId> {
        let file = &mut *self.file;
        let binding = file.inputs.modules.member_binding(file.file, access)?;
        let name = match file.hir.member_key(access) {
            Some((_, MemberKey::Name(name))) => file.intern_atom(name),
            Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => {
                debug_assert!(
                    false,
                    "module binding binds member accesses with a constant name"
                );
                return None;
            }
        };
        let path = match file.builtins.of_expr(access) {
            Some(Resolved::Builtin(path)) => Some(path),
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
        };
        let position = file.hir[access].pos;
        // Whoever reads `a.c` has read `a` first, which throws in the dead zone of `a`: before `const a = require(..)` has run.
        self.check_member_root(access);
        self.set_position(position);
        Some(emit_import_binding(self, binding, name, path))
    }
}

pub(super) fn emit_import_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
) -> ValueId {
    match binding {
        ImportBinding::Variable(symbol) => {
            lowering.emit_variable_read(VariableKey::Symbol(symbol), name)
        }
        ImportBinding::Synthetic(export) => lowering.emit_synthetic_read(export, name),
        ImportBinding::Namespace { module, phase } => lowering.emit_module_namespace(module, phase),
        ImportBinding::Builtin(id) => lowering.emit_builtin_import(id, path),
        ImportBinding::CapturedBuiltin { member, export } => {
            let value = lowering.emit_variable_read(VariableKey::SyntheticExport(export), name);
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
            lowering.emit_named_read(object, member_name)
        }
        ImportBinding::NamespaceRead {
            module,
            name: export_name,
        } => {
            let namespace = lowering.emit_module_namespace(module, ImportPhase::Evaluation);
            lowering.emit_named_read(namespace, export_name)
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

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn text_key_of_name(&mut self, name: BuiltinName) -> PropertyKeyId {
        debug_assert!(
            !table::is_symbol_name(name),
            "an export and a member of a module value have a text name"
        );
        let text = self.intern_bytes(table::text_of_name(name));
        self.text_key(text)
    }
}
