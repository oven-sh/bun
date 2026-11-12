use bun_sema::atom::known;
use bun_sema::bind::{Binding, Decl, ScopeId};
use bun_sema::check::compute_ecma_line_starts;
use bun_sema::hir::{ExprId, StmtId};
use bun_sema::program::FileId;

use super::runtime_value::{emit_module_value, find_module_value};
use super::{ModuleRoots, file_scope};
use crate::ir::generated::{Function, FunctionFlags, FunctionKind};
use crate::ir::{FunctionId, FunctionKey, TypeTable, VariableKey};
use crate::lower::fragment::ModuleFragment;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs, function, scope};
use crate::modules::{ExportBinding, ModuleKind, ModuleRef};

pub(super) fn declare_module_body(file: &mut FileLowering<'_, '_, '_, '_>) -> ModuleRoots {
    commonjs::prepare(file);
    let kind = file.inputs.modules.kind(file.file);
    let key = FunctionKey::ModuleBody(file.file);
    let body = file.declare_function(key, |file| file.create_body_header(kind));
    let modules = file.inputs.modules;
    for export in modules.exports(file.file) {
        if let ExportBinding::Variable(symbol) = export.binding
            && symbol.file == file.file
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
    }

    pub(crate) fn lower_instantiation(&mut self, function: FunctionId) {
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
        let is_instantiated_ahead = self.inputs.modules.is_instantiated_ahead(self.file);
        let makes_scope_ahead = self.inputs.modules.makes_scope_ahead(self.file);
        let mut lowering = FunctionLowering::begin(self, function);
        if is_instantiated_ahead {
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

    pub(crate) fn finish_module(&mut self, roots: ModuleRoots) -> ModuleFragment {
        let is_placeholder = self.inputs.modules.is_placeholder(self.file);
        let text: &[u8] = match is_placeholder {
            true => &[],
            false => &self.hir.text,
        };
        let embeds_function_source = self.inputs.options.embeds_function_source && !is_placeholder;
        let erased_type_ranges = embeds_function_source.then(|| self.finish_function_sources());
        let mut positions = crate::emit::source_positions(text, compute_ecma_line_starts(text));
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
