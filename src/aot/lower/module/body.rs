use bun_sema::atom::known;
use bun_sema::bind::{Binding, Decl, ScopeId};
use bun_sema::check::compute_ecma_line_starts;
use bun_sema::hir::{ExprId, StmtId};
use bun_sema::program::FileId;

use core::mem::take;

use super::runtime_value::{emit_module_value, find_module_value};
use super::{ModuleRoots, file_scope};
use crate::ir::generated::{
    ColumnAdjustment, Function, FunctionFlags, FunctionKind, FunctionSyntax, ImportPhase,
    ModuleInstance, ModuleLink, SourcePositions,
};
use crate::ir::{FunctionId, FunctionKey, ModuleId, TypeTable, ValueId, VariableKey};
use crate::lower::fragment::ModuleFragment;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs, function, scope};
use crate::modules::{ExportBinding, ModuleKind, ModuleRef};

/// `firstLineOfEvaluatedStrings` of the engine.
const FIRST_LINE_OF_EVALUATED_STRINGS: u32 = 1 << 30;
/// `lineInEvaluatedStringBits` of the engine.
const LINE_IN_EVALUATED_STRING_BITS: u32 = 16;

pub(super) fn declare_module_body(file: &mut FileLowering<'_, '_, '_, '_>) -> ModuleRoots {
    commonjs::prepare(file);
    let kind = file.inputs.modules.kind(file.file);
    let key = FunctionKey::ModuleBody(file.file);
    let body = file.declare_function(key, |file| file.create_body_header(kind));
    let modules = file.inputs.modules;
    for export in modules.exports(file.file) {
        let fields_of_instance = modules.instance_layout(file.file);
        if let ExportBinding::Variable(symbol) = export.binding
            && symbol.file == file.file
            && fields_of_instance.is_none_or(|fields| fields.field_of_export(symbol.id).is_none())
        {
            file.ensure_variable(VariableKey::Symbol(symbol));
        }
    }
    for &callback in modules.inner_modules(file.file) {
        let module = ModuleRef::Inner {
            file: file.file,
            callback,
        };
        if !modules.is_left_out(module) {
            file.declare_inner_module_body(callback);
        }
    }
    file.declare_facade_body();
    file.declare_check_body();
    file.declare_instantiation();
    let data = match kind {
        ModuleKind::Data => file.declare_module_data(),
        ModuleKind::SourceText | ModuleKind::CommonJs | ModuleKind::RuntimeSource => None,
        ModuleKind::Runtime | ModuleKind::External => {
            unreachable!("a module of this kind has no file")
        }
    };
    ModuleRoots {
        body: Some(body),
        data,
    }
}

pub(in crate::lower) fn finish_body(
    mut lowering: FunctionLowering<'_, '_, '_, '_, '_>,
    scope: Option<ScopeId>,
) {
    if let Some(scope) = scope {
        lowering.leave_scope(scope);
    }
    let undefined = lowering.builder.undefined();
    lowering.emit_return(undefined, None);
    lowering.finish();
}

impl FileLowering<'_, '_, '_, '_> {
    fn create_body_header(&mut self, kind: ModuleKind) -> Function {
        let function_kind = match kind {
            ModuleKind::CommonJs => FunctionKind::CommonJsModule,
            ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => {
                FunctionKind::Module
            }
            ModuleKind::Runtime | ModuleKind::External => {
                unreachable!("a module of this kind has no file")
            }
        };
        let key = FunctionKey::ModuleBody(self.file);
        let mut header = function::create_header(self, key, function_kind, 0);
        if !self.hir.is_strict {
            header.flags |= FunctionFlags::IS_SLOPPY;
        }
        if self.inputs.modules.has_top_level_await(self.file) {
            header.flags |= FunctionFlags::IS_ASYNC;
        }
        if kind == ModuleKind::CommonJs {
            header.flags = header.flags.without(self.scopes.entry_flags(key));
        }
        if self.body_form() == commonjs::BodyForm::Wrapped {
            header.flags |= FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
        }
        if self.inputs.modules.may_run_as_original(self.file) {
            header.syntax |= FunctionSyntax::MAY_RUN_AS_ORIGINAL;
        }
        header
    }

    pub(crate) fn lower_module_body(&mut self, function: FunctionId) {
        if super::imports::holds_mock_in_variable(self.inputs.modules, self.file) {
            self.ensure_variable(VariableKey::MockOf(self.file));
        }
        let modules = self.inputs.modules;
        if modules.is_require_made_by_file_imported(self.file) {
            self.ensure_variable(VariableKey::RequiresMadeForOwnFile(self.file));
            self.ensure_variable(VariableKey::RequiresMadeForOtherFolders(self.file));
        }
        match self.inputs.modules.kind(self.file) {
            ModuleKind::SourceText | ModuleKind::Data => self.lower_es_module_body(function),
            ModuleKind::CommonJs => self.lower_commonjs_body(function),
            ModuleKind::RuntimeSource => self.lower_runtime_module_body(function),
            ModuleKind::Runtime | ModuleKind::External => {
                unreachable!("a module of this kind has no file")
            }
        }
    }

    fn declare_instantiation(&mut self) {
        if !self.inputs.modules.is_instantiated_ahead(self.file) {
            return;
        }
        let key = FunctionKey::Instantiation(self.file);
        self.declare_function(key, |file| {
            let mut header = function::create_header(file, key, FunctionKind::Plain, 0);
            header.flags |= FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
            header
        });
        if self.inputs.modules.has_instances(self.file) {
            self.ensure_variable(VariableKey::InstanceAllocator(self.file));
            self.ensure_variable(VariableKey::HasSeveralInstances(self.file));
        }
    }

    fn lower_instance_allocation(&mut self, function: FunctionId) {
        let scope = file_scope(self);
        let mut lowering = FunctionLowering::begin(self, function);
        let instance = lowering.emit_instance_allocation();
        lowering.scopes.allocated_instance = Some(instance);
        lowering.enter_scope_made_by(scope, scope::MakerOfScope::Instantiation);
        lowering.store_environment_made_ahead(scope);
        finish_body(lowering, Some(scope));
    }

    pub(super) fn lower_empty_instance_allocation(&mut self, function: FunctionId) {
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.emit_instance_allocation();
        finish_body(lowering, None);
    }

    pub(crate) fn lower_instantiation(&mut self, function: FunctionId) {
        if self.inputs.modules.has_instances(self.file) {
            return self.lower_instance_allocation(function);
        }
        let scope = file_scope(self);
        let modules = self.inputs.modules;
        let own_file = self.file;
        let mut lowering = FunctionLowering::begin(self, function);
        let state = VariableKey::InstantiationState(own_file);
        let state = lowering.file.ensure_variable(state);
        let is_made = lowering.builder.get_module_variable(state);
        let split = lowering.split_on_type(is_made, TypeTable::UNDEFINED);
        lowering.builder.switch_to(split.not_taken);
        let undefined = lowering.builder.undefined();
        lowering.emit_return(undefined, None);
        lowering.builder.switch_to(split.taken);
        let is_taken = lowering.builder.boolean(false);
        lowering.builder.put_module_variable(state, is_taken);
        let makes_scope = modules.makes_scope_ahead(own_file);
        if makes_scope {
            lowering.enter_scope_made_by(scope, scope::MakerOfScope::Instantiation);
            lowering.store_environment_made_ahead(scope);
        }
        let mut requested: Vec<FileId> = Vec::new();
        for request in modules.requests_of(ModuleRef::File(own_file)) {
            if let ModuleRef::File(target) = request.target
                && target != own_file
                && modules.is_instantiated_ahead(target)
                && !modules.has_instances(target)
                && !modules.is_left_out(request.target)
                && !requested.contains(&target)
            {
                requested.push(target);
            }
        }
        for target in requested {
            let target = FunctionKey::Instantiation(target);
            let target = lowering.file.reference_function(target);
            lowering.builder.call_direct(target, &[]);
        }
        finish_body(lowering, makes_scope.then_some(scope));
    }

    fn lower_es_module_body(&mut self, function: FunctionId) {
        let scope = file_scope(self);
        let load_failure = self.inputs.modules.load_failure(self.file);
        let makes_scope_ahead = self.inputs.modules.makes_scope_ahead(self.file);
        let has_instances = self.inputs.modules.has_instances(self.file);
        let is_in_rerun_component = self.inputs.modules.is_in_rerun_component(self.file);
        let own_file = self.file;
        let awaits = self.inputs.modules.has_top_level_await(own_file);
        let mut lowering = FunctionLowering::begin(self, function);
        if has_instances && (is_in_rerun_component || awaits) {
            // A body that only returns is not called, and a cycle that may run again calls every body.
            let instance = lowering.emit_current_instance(own_file);
            // While the body awaits, another instance may become the current one.
            lowering.scopes.allocated_instance = awaits.then_some(instance);
        } else if is_in_rerun_component {
            lowering.emit_instantiation_of_own_file();
        }
        lowering.enter_scope_made_by(
            scope,
            match makes_scope_ahead {
                true => scope::MakerOfScope::AheadOfBody,
                false => scope::MakerOfScope::Here,
            },
        );
        if let Some(failure) = load_failure {
            lowering.emit_module_failure(failure, false);
        }
        lowering.initialize_path_variables();
        lowering.lower_file_statements();
        finish_body(lowering, Some(scope));
    }

    fn lower_runtime_module_body(&mut self, function: FunctionId) {
        let module_value = find_module_value(self);
        let scope = file_scope(self);
        let body = self.hir.body;
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.enter_scope(scope);
        lowering.lower_statements(body);
        let value = emit_module_value(&mut lowering, &module_value);
        lowering.leave_scope(scope);
        lowering.emit_return(value, None);
        lowering.finish();
    }

    fn add_instance_records(&mut self) {
        let modules = self.inputs.modules;
        let Some(fields) = modules.instance_layout(self.file) else {
            return;
        };
        let module = self.module_id();
        let layout = scope::instance_layout(self);
        let resolved = take(&mut self.resolved_fields);
        self.fragment.add_module_instance(ModuleInstance {
            module,
            layout,
            namespace_field: fields.field_of_namespace(ImportPhase::Evaluation),
            deferred_namespace_field: fields.field_of_namespace(ImportPhase::Defer),
        });
        let link_of = |target: ModuleRef| match target {
            ModuleRef::File(file) => fields.field_of_link(file),
            _ => None,
        };
        let linked = fields.links().iter().copied().map(ModuleRef::File);
        let mocked_alone = fields.mocks().iter().copied();
        let mocked_alone = mocked_alone.filter(|&target| link_of(target).is_none());
        for target in linked.chain(mocked_alone) {
            let link = ModuleLink {
                module,
                target: self.fragment.declare_module(target),
                link: link_of(target),
                mock: fields.field_of_mock(target),
                ..ModuleLink::default()
            };
            self.fragment.add_module_link(link);
        }
        let reexports = fields.reexports().iter();
        let reexports = reexports.filter_map(|&path| Some((path, fields.field_of_reexport(path)?)));
        for (path, field) in reexports.chain(resolved.links) {
            let target = modules.path_step(path).target;
            let (files, rest) = modules.split_path(path);
            let link = ModuleLink {
                module,
                target: self.fragment.declare_module(ModuleRef::File(target)),
                link: Some(field),
                path: self.declare_path(&files),
                rest,
                ..ModuleLink::default()
            };
            self.fragment.add_module_link(link);
        }
        for (holders, target, field) in resolved.words {
            let link = ModuleLink {
                module,
                target: self.fragment.declare_module(target),
                mock: Some(field),
                path: self.declare_path(&holders),
                ..ModuleLink::default()
            };
            self.fragment.add_module_link(link);
        }
    }

    fn declare_path(&mut self, path: &[FileId]) -> Vec<ModuleId> {
        let files = path.iter().copied().map(ModuleRef::File);
        files
            .map(|file| self.fragment.declare_module(file))
            .collect()
    }

    /// The engine counts the lines of each string that the program evaluates on its own.
    fn add_positions_in_known_evaluations(&self, positions: &mut SourcePositions) {
        let hir = self.hir;
        for (index, evaluation) in hir.known_evaluations.iter().enumerate() {
            let text = &hir.text[evaluation.start as usize..evaluation.end as usize];
            let first_line =
                FIRST_LINE_OF_EVALUATED_STRINGS + ((index as u32) << LINE_IN_EVALUATED_STRING_BITS);
            let own = crate::emit::source_positions(text, compute_ecma_line_starts(text));
            let lines = own.line_starts.iter().enumerate();
            let starts = lines.map(|(line, &offset)| ColumnAdjustment {
                offset,
                line: line as u32,
                column: 0,
            });
            let mut adjustments: Vec<ColumnAdjustment> = starts.collect();
            adjustments.extend(own.column_adjustments);
            adjustments.sort_by_key(|it| it.offset);
            let moved = adjustments.into_iter().map(|it| ColumnAdjustment {
                offset: it.offset + evaluation.start,
                line: it.line + first_line,
                column: it.column,
            });
            positions.column_adjustments.extend(moved);
        }
    }

    pub(crate) fn finish_module(&mut self, roots: ModuleRoots) -> ModuleFragment {
        self.add_instance_records();
        let is_placeholder = self.inputs.modules.is_placeholder(self.file);
        let text: &[u8] = match is_placeholder {
            true => &[],
            false => &self.hir.text[..self.hir.written_text_end() as usize],
        };
        let embeds_function_source = self.inputs.options.embeds_function_source && !is_placeholder;
        let erased_type_ranges = embeds_function_source.then(|| self.finish_function_sources());
        let mut positions = crate::emit::source_positions(text, compute_ecma_line_starts(text));
        if !is_placeholder {
            self.add_positions_in_known_evaluations(&mut positions);
        }
        (positions.quoted_sources, positions.quoted_source_text) = self.take_quoted_sources();
        ModuleFragment {
            body: roots.body,
            data: roots.data,
            positions,
            erased_type_ranges,
            throws_at_load: false,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_instance_allocation(&mut self) -> ValueId {
        let own_file = self.file.file;
        let guard = VariableKey::InstantiationState(own_file);
        let guard = self.file.ensure_variable(guard);
        let layout = scope::instance_layout(self.file);
        let instance = self.builder.new_object(layout, &[], None, &[]);
        let variable = VariableKey::InstanceOf(own_file);
        let variable = self.file.ensure_variable(variable);
        self.builder.put_module_variable(variable, instance);
        let is_current = self.builder.boolean(true);
        self.builder.put_module_variable(guard, is_current);
        instance
    }

    pub(in crate::lower) fn emit_current_instance(&mut self, file: FileId) -> ValueId {
        let variable = self.file.ensure_variable(VariableKey::InstanceOf(file));
        self.builder.get_module_variable(variable)
    }

    fn emit_instantiation_of_own_file(&mut self) {
        let own_file = self.file.file;
        let state = self
            .file
            .ensure_variable(VariableKey::InstantiationState(own_file));
        let is_taken = self.builder.get_module_variable(state);
        let (makes, takes) = (self.create_block(), self.create_block());
        let split = self.split_on_type(is_taken, TypeTable::UNDEFINED);
        self.builder.switch_to(split.taken);
        self.jump(makes);
        self.builder.switch_to(split.not_taken);
        let split = self.split_on_truthiness(split.not_taken_value);
        self.builder.switch_to(split.not_taken);
        self.jump(takes);
        self.builder.switch_to(split.taken);
        let undefined = self.builder.undefined();
        self.builder.put_module_variable(state, undefined);
        self.jump(makes);
        self.continue_in(makes);
        let function = self
            .file
            .reference_function(FunctionKey::Instantiation(own_file));
        self.builder.call_direct(function, &[]);
        self.jump(takes);
        self.continue_in(takes);
        let is_taken = self.builder.boolean(true);
        self.builder.put_module_variable(state, is_taken);
    }

    pub(crate) fn lower_export_default(&mut self, statement: StmtId, expression: ExprId) {
        let value = match self.file.default_export_name() {
            Some(name) => {
                let key = self.file.text_key(name);
                self.lower_named_evaluation(expression, PropertyName::Constant(key))
            }
            None => self.lower_expression(expression),
        };
        let symbol = self.file.bound.declared_symbol(Decl::ExportExpr(statement));
        scope::initialize_binding(self, Binding::Symbol(symbol), known::default, value);
    }
}
