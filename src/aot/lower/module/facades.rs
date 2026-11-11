use super::finish_body;
use super::test_run_ways::{BoundBy, emit_behind_stations};
use crate::ir::generated::{FunctionFlags, FunctionKind};
use crate::ir::{BlockId, Edge, FunctionId, FunctionKey, TypeTable, VariableId, VariableKey};
use crate::lower::{FileLowering, FunctionLowering, commonjs, function};
use crate::modules::{
    ImportBinding, ModuleFailure, ModuleFailureKind, ModuleRef, SyntheticExportId,
};
use rustc_hash::FxHashSet;

fn declare_body(file: &mut FileLowering<'_, '_, '_, '_>, key: FunctionKey) {
    file.declare_function(key, |file| {
        let mut header = function::create_header(file, key, FunctionKind::Module, 0);
        header.flags |= FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
        header
    });
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn copy_name_off_object(
        &mut self,
        export: SyntheticExportId,
        copy: VariableId,
    ) -> Option<BlockId> {
        let modules = self.file.inputs.modules;
        let copied = *modules.synthetic_export(export);
        if !(modules.commonjs()).is_left_out_by_capture_of_executable(copied.module, copied.name) {
            return None;
        }
        let object = commonjs::emit_module_value(self, copied.module)?;
        let (found, missing) = (self.create_block(), self.create_block());
        let is_object = self.builder.type_test(object, TypeTable::OBJECT);
        self.go_on_if(is_object, true, missing);
        let name = self.file.intern_atom(copied.name);
        let name = self.builder.string(name);
        let has_name = self.emit_own_property_test(object, name);
        self.go_on_if(has_name, true, missing);
        let value = self.emit_named_read(object, copied.name);
        self.builder.put_module_variable(copy, value);
        self.jump(found);
        self.continue_in(missing);
        Some(found)
    }

    fn go_on_where_no_mock_answers(
        &mut self,
        export: SyntheticExportId,
        written: &ModuleFailure,
    ) -> BlockId {
        let (asks_mocks, fails, passed) = (
            self.create_block(),
            self.create_block(),
            self.create_block(),
        );
        let importer = ModuleRef::File(written.importer);
        let importer = self.file.fragment.declare_module(importer);
        let root = self.file.module_id();
        let is_linked = self.builder.is_linked_below(importer, root);
        (self.builder).branch(is_linked, Edge::to(asks_mocks), Edge::to(passed));
        self.continue_in(asks_mocks);
        let asked = match written.kind {
            ModuleFailureKind::ExportMayBeAbsent {
                exporter: ModuleRef::File(exporter),
                name,
                ..
            } => Some((exporter, name)),
            _ => None,
        };
        emit_behind_stations(
            self,
            ImportBinding::Synthetic(export),
            asked,
            Some(written.importer),
            BoundBy::Statement,
            &mut |lowering, _, _| lowering.builder.undefined(),
            &mut |lowering| {
                lowering.jump(fails);
                lowering.begin_unreachable_block();
                lowering.builder.undefined()
            },
        );
        self.jump(passed);
        self.continue_in(fails);
        passed
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn declare_facade_body(&mut self) {
        let modules = self.inputs.modules;
        if modules.facade(ModuleRef::File(self.file)).is_some() {
            declare_body(self, FunctionKey::FacadeBody(self.file));
        }
    }

    pub(super) fn declare_check_body(&mut self) {
        if !self.inputs.modules.checks_of(self.file).is_empty() {
            declare_body(self, FunctionKey::CheckBody(self.file));
        }
    }

    pub(crate) fn lower_facade_body(&mut self, function: FunctionId) {
        let modules = self.inputs.modules;
        let own_file = self.file;
        let mut lowering = FunctionLowering::begin(self, function);
        let module = lowering.file.module_id();
        let facade = ModuleRef::Facade(own_file);
        let facade = lowering.file.fragment.declare_module(facade);
        lowering
            .builder
            .evaluate_module(module, facade, true, false);
        for owner in modules.facade_dependencies(own_file) {
            let owner = ModuleRef::Facade(owner);
            let owner = lowering.file.fragment.declare_module(owner);
            lowering.builder.evaluate_module(owner, facade, true, false);
        }
        for &export in modules.commonjs().copies(own_file) {
            let copied = *modules.synthetic_export(export);
            if matches!(copied.module, ModuleRef::File(owner) if modules.commonjs().has_capturing_facade(owner))
                && !(modules.commonjs()).is_getter_that_no_loop_sees(copied.module, copied.name)
            {
                continue;
            }
            let Some(value) = lowering.read_name_at_link(copied.module, copied.name) else {
                continue;
            };
            let copy = lowering.file.ensure_variable(VariableKey::Copy(export));
            lowering.builder.put_module_variable(copy, value);
        }
        finish_body(lowering, None);
    }

    pub(crate) fn lower_check_body(&mut self, function: FunctionId) {
        let modules = self.inputs.modules;
        let own_file = self.file;
        let mut lowering = FunctionLowering::begin(self, function);
        let mut checked = FxHashSet::default();
        let mocks_may_answer = modules.reaches_mock(own_file);
        for &(export, failure) in modules.checks_of(own_file) {
            let written = modules.failure(failure);
            let importer = Some(ModuleRef::File(written.importer));
            let owner = Some(modules.synthetic_export(export).module);
            let mut linked = [importer, written.exporter(), owner].into_iter().flatten();
            if linked.any(|module| modules.is_left_out(module)) {
                continue;
            }
            if !checked.insert((export, mocks_may_answer.then_some(failure))) {
                continue;
            }
            let copy = lowering.file.ensure_variable(VariableKey::Copy(export));
            let value = lowering.builder.get_module_variable(copy);
            let split = lowering.split_on_type(value, TypeTable::ABSENT);
            lowering.builder.switch_to(split.taken);
            let found = lowering.copy_name_off_object(export, copy);
            let passed =
                mocks_may_answer.then(|| lowering.go_on_where_no_mock_answers(export, written));
            let failure = lowering.file.fragment.declare_module_failure(failure);
            lowering.builder.throw_module_failure(failure, false);
            lowering.builder.unreachable();
            lowering.builder.switch_to(split.not_taken);
            for next in [found, passed].into_iter().flatten() {
                lowering.jump(next);
                lowering.continue_in(next);
            }
        }
        finish_body(lowering, None);
    }
}
