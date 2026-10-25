use bun_sema::atom::known;
use bun_sema::bind::{Binding, Decl, ScopeId};
use bun_sema::check::compute_ecma_line_starts;
use bun_sema::hir::{ExprId, StmtId};

use super::runtime_value::{emit_module_value, find_module_value};
use super::{ModuleRoots, file_scope};
use crate::ir::generated::{Function, FunctionFlags, FunctionKind};
use crate::ir::{FunctionId, FunctionKey, VariableKey};
use crate::lower::fragment::ModuleFragment;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, commonjs, function, scope};
use crate::modules::{ExportBinding, ModuleKind};

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
    // Link finds the bodies of the further modules of the file by their keys.
    let modules = file.inputs.modules;
    for &callback in modules.inner_modules(file.file) {
        file.declare_inner_module_body(callback);
    }
    file.declare_face_body();
    file.declare_check_body();
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
                unreachable!("a module of this kind has no self")
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
        // Nobody passes the body anything.
        if kind == ModuleKind::CommonJs {
            header.flags = header.flags.without(self.scopes.entry_flags(key));
        }
        header
    }

    pub(crate) fn lower_module_body(&mut self, function: FunctionId) {
        match self.inputs.modules.kind(self.file) {
            ModuleKind::SourceText | ModuleKind::Data => self.lower_es_module_body(function),
            ModuleKind::CommonJs => self.lower_commonjs_body(function),
            ModuleKind::RuntimeSource => self.lower_runtime_module_body(function),
            ModuleKind::Runtime | ModuleKind::External => {
                unreachable!("a module of this kind has no self")
            }
        }
    }

    fn lower_es_module_body(&mut self, function: FunctionId) {
        let scope = file_scope(self);
        let load_failure = self.inputs.modules.load_failure(self.file);
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.enter_scope(scope);
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
        let text: &[u8] = &self.hir.text;
        let function_text = match self.inputs.options.embeds_function_text {
            true => self.type_ranges.remove_from(text),
            false => Vec::new(),
        };
        ModuleFragment {
            body: roots.body,
            data: roots.data,
            positions: crate::emit::source_positions(text, compute_ecma_line_starts(text)),
            function_text,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_export_default(&mut self, statement: StmtId, expression: ExprId) {
        let name = PropertyName::Constant(self.file.atom_key(known::default));
        let value = self.lower_named_evaluation(expression, name);
        let symbol = self.file.bound.declared_symbol(Decl::ExportExpr(statement));
        scope::initialize_binding(self, Binding::Symbol(symbol), known::default, value);
    }
}
