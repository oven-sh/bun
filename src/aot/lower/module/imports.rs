use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, ImportId, MemberKey};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Sym};

use super::test_run_ways::{
    BoundBy, emit_behind_stations, find_way_to_declaration, find_what_binding_leads_to, has_station,
};
use crate::builtins::id::{BuiltinId, BuiltinName};
use crate::builtins::{BuiltinPath, Mutability, Resolved, RuntimeModule, table};
use crate::ir::generated::{ImportPhase, ModuleKind};
use crate::ir::{
    BlockId, Edge, LayoutKey, ModuleId, PropertyKeyId, StringId, TypeTable, ValueId, VariableKey,
};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs, scope};
use crate::modules::{
    ExportBinding, ImportBinding, ModuleGraph, ModuleRef, Shape, SiteAnswer, SyntheticExportId,
    View,
};

/// `word` is the namespace object of the mock, `exports` the object that holds the mock's exports. Code in `unmocked`
/// sees the module itself.
pub(super) struct MockSplit {
    pub word: ValueId,
    pub exports: ValueId,
    pub mocked: BlockId,
    pub unmocked: BlockId,
}

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

    pub(crate) fn emit_exported_variable_read(
        &mut self,
        symbol: Sym,
        name: StringId,
        path: Option<&[FileId]>,
    ) -> ValueId {
        let modules = self.file.inputs.modules;
        let exporter = modules.instance_layout(symbol.file);
        let Some(field) = exporter.and_then(|fields| fields.field_of_export(symbol.id)) else {
            return self.emit_variable_read(VariableKey::Symbol(symbol), name);
        };
        let path = path.filter(|_| modules.has_instances(self.file.file));
        let Some(path) = path else {
            return self.emit_current_variable_read(symbol, field, name);
        };
        let instance = self.emit_linked_instance(symbol.file, path);
        let key = LayoutKey::ModuleInstance(symbol.file);
        let layout = self.file.fragment.declare_layout(key);
        let value = self.builder.get_environment_field(instance, layout, field);
        self.builder.check_initialized(value, name)
    }

    /// Reads an exported variable of the latest instance of its file, which has none before it is loaded. The guard is
    /// undefined until then.
    fn emit_current_variable_read(&mut self, symbol: Sym, field: u32, name: StringId) -> ValueId {
        let guard = VariableKey::InstantiationState(symbol.file);
        let guard = self.file.ensure_variable(guard);
        let state = self.builder.get_module_variable(guard);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(state, TypeTable::UNDEFINED);
        self.builder.switch_to(split.taken);
        let absent = self.builder.absent();
        self.builder.write_variable(result, absent);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        let instance = self.emit_current_instance(symbol.file);
        let layout = LayoutKey::ModuleInstance(symbol.file);
        let layout = self.file.fragment.declare_layout(layout);
        let value = self.builder.get_environment_field(instance, layout, field);
        self.builder.write_variable(result, value);
        self.jump(join);
        self.continue_in(join);
        let value = self.builder.read_variable(result);
        self.builder.check_initialized(value, name)
    }

    /// The instance of `target` that the instance of this code is linked to: by its own link, or along `path`, the
    /// files from the one that the statement names to `target`.
    fn emit_linked_instance(&mut self, target: FileId, path: &[FileId]) -> ValueId {
        let own_instance = self.get_module_instance();
        if target == self.file.file {
            return own_instance;
        }
        let field = match path.last() {
            Some(&last) if last == target => self.file.ensure_link_along(path),
            _ => self.file.ensure_link_along(&[target]),
        };
        let own_layout = scope::instance_layout(self.file);
        self.builder
            .get_environment_field(own_instance, own_layout, field)
    }

    /// The namespace object of the instance of `target` that the instance of this code is linked to.
    pub(super) fn emit_linked_namespace(
        &mut self,
        target: FileId,
        phase: ImportPhase,
        path: &[FileId],
    ) -> ValueId {
        let modules = self.file.inputs.modules;
        let fields = modules.instance_layout(target);
        let field = fields
            .expect("the target has instances")
            .field_of_namespace(phase);
        let instance = self.emit_linked_instance(target, path);
        let layout = LayoutKey::ModuleInstance(target);
        let layout = self.file.fragment.declare_layout(layout);
        let created = self.builder.get_environment_field(instance, layout, field);
        let result = self.builder.create_variable(None);
        let (first_use, join) = (self.create_unlikely_block(), self.create_block());
        let split = self.split_on_type(created, TypeTable::ABSENT);
        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);
        self.builder.switch_to(split.taken);
        self.jump(first_use);
        self.continue_in(first_use);
        let module = self.file.fragment.declare_module(ModuleRef::File(target));
        let object = (self.builder).instance_namespace(instance, layout, module, phase);
        self.builder.write_variable(result, object);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    /// The `import.meta` of the instance of this code.
    pub(in crate::lower) fn emit_instance_import_meta(&mut self) -> ValueId {
        let field = self.file.ensure_import_meta_field();
        let instance = self.get_module_instance();
        let layout = scope::instance_layout(self.file);
        let created = self.builder.get_environment_field(instance, layout, field);
        let result = self.builder.create_variable(None);
        let (first_use, join) = (self.create_unlikely_block(), self.create_block());
        let split = self.split_on_type(created, TypeTable::ABSENT);
        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);
        self.builder.switch_to(split.taken);
        self.jump(first_use);
        self.continue_in(first_use);
        let module = self.file.module_id();
        let object = (self.builder).instance_import_meta(instance, layout, module);
        self.builder
            .put_environment_field(instance, layout, field, object);
        self.builder.write_variable(result, object);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    /// Splits on whether the instance of this code, or the instance at the end of `path`, sees a mock of `target`.
    pub(super) fn split_on_mock(
        &mut self,
        path: &[FileId],
        target: ModuleRef,
    ) -> Option<MockSplit> {
        let field = self.file.ensure_mock_word(path, target)?;
        let own_instance = self.get_module_instance();
        let own_layout = scope::instance_layout(self.file);
        let word = (self.builder).get_environment_field(own_instance, own_layout, field);
        let (mocked, unmocked) = (self.create_block(), self.create_block());
        let split = self.split_on_type(word, TypeTable::UNDEFINED);
        self.builder.switch_to(split.taken);
        self.jump(unmocked);
        self.builder.switch_to(split.not_taken);
        let word = split.not_taken_value;
        let exports = self.builder.linked_mock(word);
        let split = self.split_on_type(exports, TypeTable::UNDEFINED);
        self.builder.switch_to(split.taken);
        self.jump(unmocked);
        self.builder.switch_to(split.not_taken);
        self.jump(mocked);
        Some(MockSplit {
            word,
            exports: split.not_taken_value,
            mocked,
            unmocked,
        })
    }

    fn join_with_mock(
        &mut self,
        split: &MockSplit,
        read_without_mock: impl FnOnce(&mut Self) -> ValueId,
    ) -> ValueId {
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        self.continue_in(split.mocked);
        self.builder.write_variable(result, split.word);
        self.jump(join);
        self.continue_in(split.unmocked);
        let object = read_without_mock(self);
        self.builder.write_variable(result, object);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

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

    /// The namespace object of `module`, which the last one of `holders` requests.
    fn emit_namespace_below(
        &mut self,
        holders: &[FileId],
        module: ModuleRef,
        phase: ImportPhase,
    ) -> ValueId {
        let target = match module {
            ModuleRef::File(target) => Some(target),
            _ => None,
        };
        let path: Vec<FileId> = holders.iter().copied().chain(target).collect();
        self.emit_module_namespace(module, phase, &path)
    }

    /// `path` leads to a file, as for a variable that the file declares, and to the file that requests another module.
    fn emit_module_namespace(
        &mut self,
        module: ModuleRef,
        phase: ImportPhase,
        path: &[FileId],
    ) -> ValueId {
        if let ModuleRef::File(target) = module
            && self.file.inputs.modules.has_instances(self.file.file)
        {
            return self.emit_namespace_through_instance(target, phase, path);
        }
        if phase == ImportPhase::Evaluation
            && self.file.inputs.modules.is_absent_module(module)
            && let Some(object) = self.emit_absent_module_namespace(path, module)
        {
            return object;
        }
        if phase == ImportPhase::Evaluation
            && self.file.inputs.modules.is_made_by_mocks_alone(module)
        {
            return self.emit_current_mock_namespace(module);
        }
        let mocked = match module {
            ModuleRef::File(file) if phase == ImportPhase::Evaluation => {
                Some(file).filter(|&file| holds_mock_in_variable(self.file.inputs.modules, file))
            }
            _ => None,
        };
        let mocked_built_in = match module {
            ModuleRef::Runtime(built_in) if phase == ImportPhase::Evaluation => {
                let modules = self.file.inputs.modules;
                let reader = self.file.file;
                let is_code_of_bun =
                    modules.kind(reader) == ModuleKind::RuntimeSource || modules.is_library(reader);
                (!is_code_of_bun && modules.is_named_by_mock(module)).then_some(built_in)
            }
            _ => None,
        };
        let module = self.file.inputs.modules.facade(module).unwrap_or(module);
        let module = self.file.fragment.declare_module(module);
        if let Some(built_in) = mocked_built_in
            && self.file.inputs.modules.has_instances(self.file.file)
        {
            return self.emit_built_in_namespace(path, built_in);
        }
        if let Some(built_in) = mocked_built_in {
            let result = self.builder.create_variable(None);
            let join = self.create_block();
            let key = VariableKey::MockOfRuntimeModule(built_in);
            let variable = self.file.ensure_variable(key);
            let word = self.builder.get_module_variable(variable);
            let split = self.split_on_type(word, TypeTable::ABSENT);
            self.builder.switch_to(split.taken);
            let object = self.builder.module_namespace(module, phase, false, false);
            self.builder.write_variable(result, object);
            self.jump(join);
            self.builder.switch_to(split.not_taken);
            let importer = self.file.module_id();
            let object = self.builder.namespace_seen_by(module, importer, importer);
            self.builder.write_variable(result, object);
            self.jump(join);
            self.continue_in(join);
            return self.builder.read_variable(result);
        }
        let Some(mocked) = mocked else {
            return self.builder.module_namespace(module, phase, false, false);
        };
        let importer = self.file.module_id();
        self.emit_namespace_behind_mock(mocked, module, Some(importer))
    }

    fn emit_current_mock_namespace(&mut self, module: ModuleRef) -> ValueId {
        let ModuleRef::External { specifier, .. } = module else {
            unreachable!("only a module outside the program is made by mocks alone");
        };
        let id = self.file.fragment.declare_module(module);
        let referrer = self.file.module_id();
        let specifier = self.file.intern_atom(specifier);
        (self.builder).require_module(id, referrer, specifier, None, false)
    }

    /// The namespace object of the mock that the instance at the end of `holders` is linked to.
    fn emit_absent_module_namespace(
        &mut self,
        holders: &[FileId],
        module: ModuleRef,
    ) -> Option<ValueId> {
        if !self.file.inputs.modules.has_instances(self.file.file) {
            return None;
        }
        let field = self.file.ensure_mock_word(holders, module)?;
        let own_instance = self.get_module_instance();
        let own_layout = scope::instance_layout(self.file);
        let word = (self.builder).get_environment_field(own_instance, own_layout, field);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(word, TypeTable::UNDEFINED);
        self.builder.switch_to(split.not_taken);
        (self.builder).write_variable(result, split.not_taken_value);
        self.jump(join);
        self.builder.switch_to(split.taken);
        let object = match self.file.inputs.modules.is_made_by_mocks_alone(module) {
            true => self.emit_current_mock_namespace(module),
            false => {
                let id = self.file.fragment.declare_module(module);
                (self.builder).module_namespace(id, ImportPhase::Evaluation, false, false)
            }
        };
        self.builder.write_variable(result, object);
        self.jump(join);
        self.continue_in(join);
        Some(self.builder.read_variable(result))
    }

    /// The namespace object of a built-in module that a mock may name, as the instance at the end of `holders` sees it.
    pub(super) fn emit_built_in_namespace(
        &mut self,
        holders: &[FileId],
        built_in: RuntimeModule,
    ) -> ValueId {
        let target = ModuleRef::Runtime(built_in);
        let module = self.file.fragment.declare_module(target);
        let phase = ImportPhase::Evaluation;
        match self.split_on_mock(holders, target) {
            Some(mock) => self.join_with_mock(&mock, |lowering| {
                lowering
                    .builder
                    .module_namespace(module, phase, true, false)
            }),
            None => {
                let importer = self.file.module_id();
                self.builder.namespace_seen_by(module, importer, importer)
            }
        }
    }

    fn emit_namespace_through_instance(
        &mut self,
        target: FileId,
        phase: ImportPhase,
        path: &[FileId],
    ) -> ValueId {
        let modules = self.file.inputs.modules;
        let holders = path.split_last().map_or(&[][..], |(_, holders)| holders);
        let mock = match phase {
            ImportPhase::Evaluation => self.split_on_mock(holders, ModuleRef::File(target)),
            ImportPhase::Defer => None,
        };
        let sees_itself = mock.is_some();
        let read_without_mock = |lowering: &mut Self| {
            if modules.has_instances(target) {
                return lowering.emit_linked_namespace(target, phase, path);
            }
            let module = ModuleRef::File(target);
            let module = modules.facade(module).unwrap_or(module);
            let module = lowering.file.fragment.declare_module(module);
            (lowering.builder).module_namespace(module, phase, sees_itself, false)
        };
        match mock {
            Some(mock) => self.join_with_mock(&mock, read_without_mock),
            None => read_without_mock(self),
        }
    }

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
            let sees_mock = self.builder.sees_mock_of(target, importer, importer, false);
            let (of_mock, own) = (self.create_block(), self.create_block());
            (self.builder).branch(sees_mock, Edge::to(of_mock), Edge::to(own));
            self.continue_in(own);
            let object = self.builder.module_namespace(module, phase, true, false);
            self.builder.write_variable(result, object);
            self.jump(join);
            self.continue_in(of_mock);
        }
        let object = match importer {
            Some(importer) => self.builder.namespace_seen_by(module, importer, importer),
            None => self.builder.module_namespace(module, phase, false, true),
        };
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

    pub(crate) fn lower_namespace_receiver(&mut self, object: ExprId) -> ValueId {
        let file = &*self.file;
        let name = file.hir.skip_type_assertions(object);
        let binding = match file.bound.binding(name) {
            Binding::Symbol(symbol) if matches!(file.hir[name].kind, ExprKind::Ident(_)) => {
                file.inputs.modules.import_binding(file.file, symbol)
            }
            _ => (file.inputs.modules.member_binding(file.file, name))
                .filter(|binding| matches!(binding, ImportBinding::Namespace { .. }))
                .unwrap_or(ImportBinding::Local),
        };
        let is_member = !matches!(file.hir[name].kind, ExprKind::Ident(_));
        match binding {
            ImportBinding::Namespace { module, .. } if file.inputs.modules.is_left_out(module) => {
                self.builder.undefined()
            }
            ImportBinding::Namespace { module, phase } if is_member => {
                let holders = self.file.find_object_holders(object, module);
                self.emit_namespace_below(&holders, module, phase)
            }
            _ => match file.find_view(name) {
                Some(View::Namespace(module)) => {
                    let holders = self.file.find_object_holders(object, module);
                    self.emit_namespace_below(&holders, module, ImportPhase::Evaluation)
                }
                Some(View::Exports(_)) | None => self.lower_expression(object),
            },
        }
    }

    pub(crate) fn lower_namespace_member(&mut self, access: ExprId) -> Option<ValueId> {
        let file = &mut *self.file;
        let binding = file.inputs.modules.member_binding(file.file, access)?;
        let written_on = file.inputs.modules.find_module_accessed(file.file, access);
        let asked = match (written_on, file.hir.member_key(access)) {
            (Some(ModuleRef::File(module)), Some((_, MemberKey::Name(name)))) => {
                Some((module, name))
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
        let handed_on_by = self.find_file_that_hands_on_object(access);
        let holders = match (written_on, self.file.hir.member_key(access)) {
            (Some(module), Some((object, _))) => self.file.find_object_holders(object, module),
            _ => Vec::new(),
        };
        let asked = RequestedImport {
            request: asked,
            passed_by: handed_on_by,
            holders: &holders,
        };
        self.check_member_root(access);
        self.set_position(position);
        let modules = self.file.inputs.modules;
        let bound_by = match modules.is_member_of_import(self.file.file, access) {
            true => BoundBy::Statement,
            false => BoundBy::Call,
        };
        if let ImportBinding::Synthetic(export) = binding
            && !modules.synthetic_export(export).is_known_member
        {
            let read = ReadWithoutMock::SyntheticMember { export, access };
            return Some(emit_behind_mocks(self, binding, asked, bound_by, read));
        }
        let read = ReadWithoutMock::Binding { name, path };
        Some(emit_behind_mocks(self, binding, asked, bound_by, read))
    }

    fn find_file_that_hands_on_object(&self, access: ExprId) -> Option<FileId> {
        let file = &*self.file;
        let (object, _) = file.hir.member_key(access)?;
        let object = file.hir.skip_type_assertions(object);
        match (file.hir[object].kind, file.bound.binding(object)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => {
                Some(find_written_import(file, symbol)?.0)
            }
            _ => match file
                .inputs
                .modules
                .find_module_accessed(file.file, object)?
            {
                ModuleRef::File(holder) => Some(holder),
                _ => None,
            },
        }
    }
}

/// What a read of an imported name requests: the module that the statement names and the name there; the file that
/// exports the namespace object if the name is a member of one; and the files on the path to that object.
#[derive(Copy, Clone, Default)]
pub(super) struct RequestedImport<'a> {
    pub request: Option<(FileId, Atom)>,
    pub passed_by: Option<FileId>,
    pub holders: &'a [FileId],
}

impl RequestedImport<'_> {
    fn by_statement(request: Option<(FileId, Atom)>) -> RequestedImport<'static> {
        RequestedImport {
            request,
            ..RequestedImport::default()
        }
    }

    /// The files from the one that the statement of `reader` names to `target`; none if they are not known. Only a reader
    /// with instances has links.
    pub(super) fn find_path_to(
        &self,
        modules: &ModuleGraph,
        reader: FileId,
        target: FileId,
    ) -> Vec<FileId> {
        let request = self.request.filter(|_| modules.has_instances(reader));
        let path = request.and_then(|(file, name)| modules.find_path_to_module(file, name, target));
        match path {
            Some(path) => [self.holders, &path].concat(),
            None => Vec::new(),
        }
    }

    /// The files from the one that the statement of `reader` names to `module`, or to the file that requests it if it is
    /// not a file of the program.
    fn find_path_to_namespace(
        &self,
        modules: &ModuleGraph,
        reader: FileId,
        module: ModuleRef,
    ) -> Vec<FileId> {
        if let ModuleRef::File(target) = module {
            return self.find_path_to(modules, reader, target);
        }
        let request = self.request.filter(|_| modules.has_instances(reader));
        let holders =
            request.and_then(|(file, name)| modules.find_module_holders(file, name, module));
        match holders {
            Some(rest) => [self.holders, &rest].concat(),
            None => Vec::new(),
        }
    }
}

pub(super) fn holds_mock_in_variable(modules: &ModuleGraph, file: FileId) -> bool {
    modules.holds_mock_in_variable(file)
}

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

pub(super) fn emit_import_binding_asked(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
    asked: Option<(FileId, Atom)>,
) -> ValueId {
    let read = ReadWithoutMock::Binding { name, path };
    let asked = RequestedImport::by_statement(asked);
    emit_behind_mocks(lowering, binding, asked, BoundBy::Statement, read)
}

pub(super) fn emit_binding_asked_by_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    asked: Option<(FileId, Atom)>,
) -> ValueId {
    let read = ReadWithoutMock::Binding { name, path: None };
    let asked = RequestedImport::by_statement(asked);
    emit_behind_mocks(lowering, binding, asked, BoundBy::Call, read)
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
    asked: RequestedImport<'_>,
    bound_by: BoundBy,
    read: ReadWithoutMock,
) -> ValueId {
    match read {
        ReadWithoutMock::Binding { name, path } => {
            emit_unmocked_binding(lowering, binding, asked, bound_by, name, path)
        }
        ReadWithoutMock::SyntheticMember { export, access } => {
            lowering.emit_synthetic_member_read(export, access)
        }
    }
}

fn emit_behind_mocks(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    asked: RequestedImport<'_>,
    bound_by: BoundBy,
    read: ReadWithoutMock,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    if let ImportBinding::Namespace {
        module: ModuleRef::File(target),
        phase: ImportPhase::Evaluation,
    } = binding
        && let Some((named, name)) = asked.request
        && named != target
        && holds_mock_in_variable(modules, target)
    {
        let path = [asked.holders, &[named]].concat();
        let holder = ModuleRef::File(named);
        let holder = lowering.emit_module_namespace(holder, ImportPhase::Evaluation, &path);
        return lowering.emit_named_read(holder, name);
    }
    emit_behind_stations(
        lowering,
        binding,
        asked,
        bound_by,
        &mut |lowering, object, name| lowering.emit_named_read(object, name),
        &mut |lowering| emit_read_without_mock(lowering, binding, asked, bound_by, read),
    )
}

fn emit_unmocked_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    asked: RequestedImport<'_>,
    bound_by: BoundBy,
    name: StringId,
    path: Option<BuiltinPath>,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    let reader = lowering.file.file;
    match binding {
        ImportBinding::Variable(symbol) => {
            let files = match bound_by {
                BoundBy::Statement => Some(asked.find_path_to(modules, reader, symbol.file)),
                BoundBy::Call => None,
            };
            lowering.emit_exported_variable_read(symbol, name, files.as_deref())
        }
        ImportBinding::Synthetic(export) => lowering.emit_synthetic_read(export, name),
        ImportBinding::Namespace { module, phase } => {
            let files = asked.find_path_to_namespace(modules, reader, module);
            lowering.emit_module_namespace(module, phase, &files)
        }
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
            let files = asked.find_path_to_namespace(modules, reader, module);
            let phase = ImportPhase::Evaluation;
            let namespace = lowering.emit_module_namespace(module, phase, &files);
            lowering.emit_named_read(namespace, export_name)
        }
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
    /// The files by which a statement reaches the request of `module`, whose namespace object `object` evaluates to. None
    /// are needed if the file itself requests it.
    fn find_object_holders(&self, object: ExprId, module: ModuleRef) -> Vec<FileId> {
        let modules = self.inputs.modules;
        if !modules.has_instances(self.file) {
            return Vec::new();
        }
        let object = self.hir.skip_type_assertions(object);
        let holders = match (self.hir[object].kind, self.bound.binding(object)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => find_written_import(self, symbol)
                .and_then(|(file, name)| modules.find_module_holders(file, name, module)),
            _ => match (
                modules.find_module_accessed(self.file, object),
                self.hir.member_key(object),
            ) {
                (Some(ModuleRef::File(holder)), Some((outer, MemberKey::Name(name)))) => {
                    let outer = self.find_object_holders(outer, ModuleRef::File(holder));
                    let rest = modules.find_module_holders(holder, name, module);
                    rest.map(|rest| [outer, rest].concat())
                }
                _ => None,
            },
        };
        holders.unwrap_or_default()
    }

    pub(in crate::lower) fn may_be_answered_by_mock(&self, symbol: SymbolId) -> bool {
        let modules = self.inputs.modules;
        let asked = find_written_import(self, symbol);
        let end = find_what_binding_leads_to(modules, modules.import_binding(self.file, symbol));
        let mut starts = asked.into_iter().chain(end);
        let kept = &mut *self.modules.kept_between_ways.borrow_mut();
        starts.any(|start| {
            has_station(&find_way_to_declaration(
                modules,
                Some(&mut *kept),
                Some(self.file),
                start,
            ))
        })
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
