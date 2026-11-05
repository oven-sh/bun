use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, ImportId, MemberKey};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Sym};

use super::test_run_ways::{
    emit_behind_stations, find_way_to_declaration, find_what_binding_leads_to, has_station,
};
use crate::builtins::id::{BuiltinId, BuiltinName};
use crate::builtins::{BuiltinPath, Mutability, Resolved, table};
use crate::ir::generated::ImportPhase;
use crate::ir::{Edge, ModuleId, PropertyKeyId, StringId, TypeTable, ValueId, VariableKey};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs};
use crate::modules::{
    ExportBinding, ImportBinding, ModuleGraph, ModuleRef, Shape, SiteAnswer, SyntheticExportId,
    View,
};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn get_import(&mut self, symbol: SymbolId) -> ValueId {
        if let Some(constant) = self.file.find_data_variable_read(symbol) {
            return self.emit_constant(constant);
        }
        let file = &mut *self.file;
        let binding = file.inputs.modules.import_binding(file.file, symbol);
        if let ImportBinding::BuiltinMember { .. } = binding {
            let path = file.builtins.of_symbol(symbol);
            let variable = file.ensure_variable(file.imported_copy_key(symbol));
            let value = self.builder.get_module_variable(variable);
            return match path.map(|path| (path.id, path.mutability)) {
                Some((id, Mutability::AlwaysLocked | Mutability::ConstantUnlessWritten)) => {
                    self.expect_builtin(value, table::canonical_id(id))
                }
                Some((_, Mutability::ChangesOnItsOwn)) | None => value,
            };
        }
        let local_name = file.bound.symbol(symbol).name;
        let name = file.intern_binding_name(Binding::Symbol(symbol), local_name);
        let path = file.builtins.of_symbol(symbol);
        let asked = find_written_import(file, symbol);
        emit_import_binding_asked(self, binding, name, path, asked)
    }

    /// `import { a } from "bun"` runs as `var { a } = Bun` where the statement stands.
    pub(crate) fn lower_import(&mut self, import: ImportId) {
        let named = self.file.hir[import].named.iter().map(Decl::ImportSpec);
        let whole = [Decl::ImportNamespace(import), Decl::ImportDefault(import)];
        for declaration in whole.into_iter().chain(named) {
            let symbol = self.file.bound.declared_symbol(declaration);
            if symbol.is_none() {
                continue;
            }
            let key = self.file.imported_copy_key(symbol);
            let modules = self.file.inputs.modules;
            let value = match modules.import_binding(self.file.file, symbol) {
                ImportBinding::BuiltinMember { holder, name } => {
                    let object = self.builder.builtin(holder, false);
                    self.emit_named_read(object, name)
                }
                ImportBinding::Builtin(object) if self.file.is_exported_variable(key) => {
                    self.emit_builtin_import(object, None)
                }
                // A link reads every name that the statement imports from the object of a built-in module, whether or not anything uses the name.
                // It shows where the object lists a member from its first read on.
                ImportBinding::CapturedBuiltin { member, export }
                    if table::entry(member).is_added_at_first_read =>
                {
                    let variable = self
                        .file
                        .ensure_variable(VariableKey::SyntheticExport(export));
                    self.builder.get_module_variable(variable);
                    continue;
                }
                ImportBinding::Builtin(member) if table::entry(member).is_added_at_first_read => {
                    self.emit_export_read(member);
                    continue;
                }
                _ => continue,
            };
            let variable = self.file.ensure_variable(key);
            self.builder.put_module_variable(variable, value);
        }
    }

    pub(crate) fn emit_variable_read(&mut self, key: VariableKey, name: StringId) -> ValueId {
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        self.builder.check_initialized(value, name)
    }

    // A name of a library module is a variable that the loader fills. `Err`: the value itself.
    fn find_synthetic_variable(
        &mut self,
        export: SyntheticExportId,
    ) -> Result<VariableKey, ValueId> {
        let modules = self.file.inputs.modules;
        let synthetic = *modules.synthetic_export(export);
        match modules.shape(synthetic.module) {
            Shape::AsToday | Shape::EsModule => return Ok(VariableKey::SyntheticExport(export)),
            Shape::Names | Shape::Value => {}
        }
        if modules.settled(synthetic.module, synthetic.name)
            && let Some(value) = self.read_imported_name(synthetic.module, synthetic.name)
        {
            return Err(value);
        }
        Ok(VariableKey::Copy(export))
    }

    fn emit_synthetic_read(&mut self, export: SyntheticExportId, name: StringId) -> ValueId {
        let may_stay_empty = self.file.inputs.modules.commonjs().may_stay_empty(export);
        match self.find_synthetic_variable(export) {
            Ok(key) if may_stay_empty => self.emit_read_of_copy_that_may_stay_empty(key),
            Ok(key) => self.emit_variable_read(key, name),
            Err(value) => value,
        }
    }

    // `import { A } from "./a.cjs"; export { A }` in a TypeScript module that is linked without the export where the file lacks the name: `A` reads as `undefined` there.
    fn emit_read_of_copy_that_may_stay_empty(&mut self, key: VariableKey) -> ValueId {
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder.switch_to(split.taken);
        let undefined = self.builder.undefined();
        self.builder.write_variable(result, undefined);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    // Another module imports the name, so its variable stays empty where the module turns out to lack the name. The namespace object knows what `ns.x` finds then.
    fn emit_synthetic_member_read(&mut self, export: SyntheticExportId, access: ExprId) -> ValueId {
        let key = match self.find_synthetic_variable(export) {
            Ok(key) => key,
            Err(value) => return value,
        };
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder.switch_to(split.taken);
        let found = match self.file.hir.member_key(access) {
            Some((object, MemberKey::Name(name))) => {
                let namespace = self.lower_namespace_receiver(object);
                self.emit_named_read(namespace, name)
            }
            _ => self.builder.undefined(),
        };
        self.builder.write_variable(result, found);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    // ES modules see a CommonJS file through its face.
    fn emit_module_namespace(&mut self, module: ModuleRef, phase: ImportPhase) -> ValueId {
        // Whichever mock stands now answers: the run time is asked at each read, as for `require()`.
        if let ModuleRef::External { specifier, .. } = module
            && phase == ImportPhase::Evaluation
            && self.file.inputs.modules.is_made_by_mocks_alone(module)
        {
            let id = self.file.fragment.declare_module(module);
            let referrer = self.file.module_id();
            let specifier = self.file.intern_atom(specifier);
            return self.builder.require_module(id, referrer, specifier, false);
        }
        let mocked = match module {
            ModuleRef::File(file) if phase == ImportPhase::Evaluation => {
                Some(file).filter(|&file| holds_mock_in_variable(self.file.inputs.modules, file))
            }
            _ => None,
        };
        let module = self.file.inputs.modules.face(module).unwrap_or(module);
        let module = self.file.fragment.declare_module(module);
        let Some(mocked) = mocked else {
            return self.builder.module_namespace(module, phase, false, false);
        };
        // `bun test` leaves a module that has run as it is where `vi.doMock()` names it. Whoever was linked to it before keeps its object; whoever comes behind gets the object of the mock.
        let importer = self.file.module_id();
        self.emit_namespace_behind_mock(mocked, module, Some(importer))
    }

    /// `require("./m.mjs").name`: the module is asked for by name.
    pub(crate) fn emit_namespace_asked_by_name(&mut self, module: ModuleRef) -> ValueId {
        let mocked = match module {
            ModuleRef::File(file) => {
                Some(file).filter(|&file| holds_mock_in_variable(self.file.inputs.modules, file))
            }
            _ => None,
        };
        let module = self.file.fragment.declare_module(module);
        match mocked {
            Some(mocked) => self.emit_namespace_behind_mock(mocked, module, None),
            None => (self.builder).module_namespace(module, ImportPhase::Evaluation, false, false),
        }
    }

    /// `importer`: whose link decides. Without one what stands now answers.
    fn emit_namespace_behind_mock(
        &mut self,
        mocked: FileId,
        module: ModuleId,
        importer: Option<ModuleId>,
    ) -> ValueId {
        let phase = ImportPhase::Evaluation;
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let variable = self.file.ensure_variable(VariableKey::MockOf(mocked));
        let mock = self.builder.get_module_variable(variable);
        let split = self.split_on_type(mock, TypeTable::ABSENT);
        self.builder.switch_to(split.taken);
        let object = self.builder.module_namespace(module, phase, false, false);
        self.builder.write_variable(result, object);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        if let Some(importer) = importer {
            let target = (self.file.fragment).declare_module(ModuleRef::File(mocked));
            let sees_mock = self.builder.sees_mock_of(target, importer);
            let (of_mock, own) = (self.create_block(), self.create_block());
            (self.builder).branch(sees_mock, Edge::to(of_mock), Edge::to(own));
            self.continue_in(own);
            let object = self.builder.module_namespace(module, phase, true, false);
            self.builder.write_variable(result, object);
            self.jump(join);
            self.continue_in(of_mock);
        }
        let object = self.builder.module_namespace(module, phase, false, true);
        self.builder.write_variable(result, object);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
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
                self.builder.builtin(locked, false)
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
                let object = self.builder.builtin(holder, false);
                let key = self.file.text_key_of_name(entry.name);
                self.builder.prop_get(object, key, false, false)
            }
            (Some(_), Some(_) | None) | (None, None) => self.builder.builtin(id, false),
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
            // `require("./m.mjs").inner` where m.mjs has `export * as inner from ..`.
            _ => (file.inputs.modules.member_binding(file.file, name))
                .filter(|binding| matches!(binding, ImportBinding::Namespace { .. }))
                .unwrap_or(ImportBinding::Local),
        };
        let is_member = !matches!(file.hir[name].kind, ExprKind::Ident(_));
        match binding {
            ImportBinding::Namespace { module, .. } if file.inputs.modules.is_left_out(module) => {
                self.builder.undefined()
            }
            // The read of the member below it has evaluated what stands in front.
            ImportBinding::Namespace { module, phase } if is_member => {
                self.emit_module_namespace(module, phase)
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
        let asked = match file.hir.member_key(access) {
            Some((object, MemberKey::Name(name))) => {
                let object = file.hir.skip_type_assertions(object);
                let imported = match file.bound.binding(object) {
                    Binding::Symbol(symbol)
                        if matches!(file.hir[object].kind, ExprKind::Ident(_)) =>
                    {
                        match file.inputs.modules.import_binding(file.file, symbol) {
                            ImportBinding::Namespace { module, .. } => Some(module),
                            _ => None,
                        }
                    }
                    _ => None,
                };
                // `const a = require("./m.mjs")`: `a` stands for what `import * as a` stands for, and so does the call itself.
                let required = || match file.find_view(object) {
                    Some(View::Namespace(module)) => Some(module),
                    Some(View::Exports(_)) | None => None,
                };
                match imported.or_else(required) {
                    Some(ModuleRef::File(module)) => Some((module, name)),
                    _ => None,
                }
            }
            _ => None,
        };
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
        let modules = self.file.inputs.modules;
        if let ImportBinding::Synthetic(export) = binding
            && !modules.synthetic_export(export).is_known_member
        {
            let read = ReadWithoutMock::SyntheticMember { export, access };
            return Some(emit_behind_mocks(self, binding, None, read));
        }
        Some(emit_import_binding_asked(self, binding, name, path, asked))
    }
}

/// `VariableKey::MockOf`. A module of Bun's own code is mocked by its name, not as a file.
pub(super) fn holds_mock_in_variable(modules: &ModuleGraph, file: FileId) -> bool {
    modules.holds_mock_in_variable(file)
}

/// The module that the import statement of `symbol` names, and the name that it asks of the module.
fn find_written_import(
    file: &FileLowering<'_, '_, '_, '_>,
    symbol: SymbolId,
) -> Option<(FileId, Atom)> {
    let (import, name) = match *file.bound.symbol(symbol).decls {
        [Decl::ImportSpec(specifier)] => (file.hir[specifier].import, file.hir[specifier].imported),
        [Decl::ImportDefault(import)] => (import, known::default),
        _ => return None,
    };
    let site = ImportSiteKind::Import(import);
    match file.inputs.modules.find_site_answer(file.file, site)? {
        SiteAnswer::Module(ModuleRef::File(module)) => Some((module, name)),
        _ => None,
    }
}

pub(super) fn emit_import_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
) -> ValueId {
    emit_import_binding_asked(lowering, binding, name, path, None)
}

// A mock that comes before the body of a file has run stands in place of the file. What it answers is the host's to say, at each read: which names it has, what
// a name that it leaves out reads as, whether the read throws. The host stores its object in a variable of the file, which is empty while no such mock stands.
pub(super) fn emit_import_binding_asked(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
    asked: Option<(FileId, Atom)>,
) -> ValueId {
    let read = ReadWithoutMock::Binding { name, path };
    emit_behind_mocks(lowering, binding, asked, read)
}

#[derive(Copy, Clone)]
enum ReadWithoutMock {
    Binding {
        name: StringId,
        path: Option<BuiltinPath>,
    },
    SyntheticMember {
        export: SyntheticExportId,
        access: ExprId,
    },
}

fn emit_read_without_mock(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    read: ReadWithoutMock,
) -> ValueId {
    match read {
        ReadWithoutMock::Binding { name, path } => {
            emit_unmocked_binding(lowering, binding, name, path)
        }
        ReadWithoutMock::SyntheticMember { export, access } => {
            lowering.emit_synthetic_member_read(export, access)
        }
    }
}

/// What a mock on the way of `binding` answers, and `read` where none stands.
fn emit_behind_mocks(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    asked: Option<(FileId, Atom)>,
    read: ReadWithoutMock,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    // `export * as inner from "./dep"`: which object of a file that may be mocked the file between hands on goes by the link of that file. The run time knows it.
    if let ImportBinding::Namespace {
        module: ModuleRef::File(target),
        phase: ImportPhase::Evaluation,
    } = binding
        && let Some((named, name)) = asked
        && named != target
        && holds_mock_in_variable(modules, target)
    {
        let holder = ModuleRef::File(named);
        let holder = lowering.emit_module_namespace(holder, ImportPhase::Evaluation);
        return lowering.emit_named_read(holder, name);
    }
    emit_behind_stations(lowering, binding, asked, &mut |lowering| {
        emit_read_without_mock(lowering, binding, read)
    })
}

fn emit_unmocked_binding(
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
            let object = lowering.builder.builtin(holder, false);
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
    /// Whether a mock may stand on the way from the import to what declares it. What a read gives is then the mock's to say, whatever the declaration holds.
    pub(in crate::lower) fn may_be_answered_by_mock(&self, symbol: SymbolId) -> bool {
        let modules = self.inputs.modules;
        let asked = find_written_import(self, symbol);
        let end = find_what_binding_leads_to(modules, modules.import_binding(self.file, symbol));
        let mut starts = asked.into_iter().chain(end);
        starts.any(|start| has_station(&find_way_to_declaration(modules, Some(self.file), start)))
    }

    pub(in crate::lower) fn imported_copy_key(&self, symbol: SymbolId) -> VariableKey {
        VariableKey::Symbol(Sym {
            file: self.file,
            id: symbol,
        })
    }

    pub(in crate::lower) fn is_exported_variable(&self, key: VariableKey) -> bool {
        let mut exports = self.inputs.modules.exports(self.file).iter();
        exports.any(|export| match export.binding {
            ExportBinding::Variable(symbol) => VariableKey::Symbol(symbol) == key,
            _ => false,
        })
    }

    pub(in crate::lower) fn text_key_of_name(&mut self, name: BuiltinName) -> PropertyKeyId {
        debug_assert!(
            !table::is_symbol_name(name),
            "an export and a member of a module value have a text name"
        );
        let text = self.intern_bytes(table::text_of_name(name));
        self.text_key(text)
    }
}
