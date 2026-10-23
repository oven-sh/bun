use bun_sema::atom::known;
use bun_sema::bind::{Binding, Decl};
use bun_sema::check::compute_ecma_line_starts;
use bun_sema::hir::{ExprId, StmtId};

use super::runtime_value::{emit_module_value, find_module_value};
use super::{ModuleRoots, faces, file_scope, loads};
use crate::ir::generated::{Function, FunctionFlags, FunctionKind};
use crate::ir::{FunctionId, FunctionKey, VariableKey};
use crate::lower::fragment::ModuleFragment;
use crate::lower::member::PropertyName;
use crate::lower::{
    FileLowering, FunctionLowering, commonjs, control, data, expression, function, scope,
    statement, validate,
};
use crate::modules::{ExportBinding, ModuleKind};

pub(super) fn declare_module_body(file: &mut FileLowering<'_, '_, '_, '_>) -> ModuleRoots {
    commonjs::prepare(file);
    let kind = file.inputs.modules.kind(file.file);
    let key = FunctionKey::ModuleBody(file.file);
    let body = file.declare_function(key, |file| create_body_header(file, kind));
    ensure_exported_variables(file);
    // Link finds the bodies of the further modules of the file by their keys.
    let modules = file.inputs.modules;
    for &callback in modules.inner_modules(file.file) {
        commonjs::declare_inner_module_body(file, callback);
    }
    faces::declare_face_body(file);
    faces::declare_check_body(file);
    let data = match kind {
        ModuleKind::Data => data::declare_module_data(file),
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

fn create_body_header(file: &mut FileLowering<'_, '_, '_, '_>, kind: ModuleKind) -> Function {
    let function_kind = match kind {
        ModuleKind::CommonJs => FunctionKind::CommonJsModule,
        ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => {
            FunctionKind::Module
        }
        ModuleKind::Runtime | ModuleKind::External => {
            unreachable!("a module of this kind has no file")
        }
    };
    let key = FunctionKey::ModuleBody(file.file);
    let mut header = function::create_header(file, key, function_kind, 0);
    if !file.hir.is_strict {
        header.flags |= FunctionFlags::IS_SLOPPY;
    }
    if file.inputs.modules.has_top_level_await(file.file) {
        header.flags |= FunctionFlags::IS_ASYNC;
    }
    // Nobody passes the body anything.
    if kind == ModuleKind::CommonJs {
        header.flags = header.flags.without(file.scopes.entry_flags(key));
    }
    header
}

fn ensure_exported_variables(file: &mut FileLowering<'_, '_, '_, '_>) {
    let modules = file.inputs.modules;
    for export in modules.exports(file.file) {
        let ExportBinding::Variable(symbol) = export.binding else {
            continue;
        };
        if symbol.file == file.file {
            scope::ensure_variable(file, VariableKey::Symbol(symbol));
        }
    }
}

pub(crate) fn lower_module_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    validate::report_misused_compiler_functions(file);
    match file.inputs.modules.kind(file.file) {
        ModuleKind::SourceText | ModuleKind::Data => lower_es_module_body(file, function),
        ModuleKind::CommonJs => commonjs::lower_commonjs_body(file, function),
        ModuleKind::RuntimeSource => lower_runtime_module_body(file, function),
        ModuleKind::Runtime | ModuleKind::External => {
            unreachable!("a module of this kind has no file")
        }
    }
}

fn lower_es_module_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    let scope = file_scope(file);
    let load_failure = file.inputs.modules.load_failure(file.file);
    let mut lowering = FunctionLowering::begin(file, function);
    scope::enter_scope(&mut lowering, scope);
    if let Some(failure) = load_failure {
        loads::emit_module_failure(&mut lowering, failure);
    }
    commonjs::initialize_path_variables(&mut lowering);
    statement::lower_file_statements(&mut lowering);
    scope::leave_scope(&mut lowering, scope);
    let undefined = lowering.builder.undefined();
    control::emit_return(&mut lowering, undefined, None);
    lowering.finish();
}

fn lower_runtime_module_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    let module_value = find_module_value(file);
    let scope = file_scope(file);
    let body = file.hir.body;
    let mut lowering = FunctionLowering::begin(file, function);
    scope::enter_scope(&mut lowering, scope);
    statement::lower_statements(&mut lowering, body);
    let value = emit_module_value(&mut lowering, &module_value);
    scope::leave_scope(&mut lowering, scope);
    control::emit_return(&mut lowering, value, None);
    lowering.finish();
}

pub(crate) fn lower_export_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    expression: ExprId,
) {
    let name = PropertyName::Constant(lowering.file.atom_key(known::default));
    let value = expression::lower_named_evaluation(lowering, expression, name);
    let symbol = lowering
        .file
        .bound
        .declared_symbol(Decl::ExportExpr(statement));
    scope::initialize_binding(lowering, Binding::Symbol(symbol), known::default, value);
}

pub(crate) fn finish_module(
    file: &mut FileLowering<'_, '_, '_, '_>,
    roots: ModuleRoots,
) -> ModuleFragment {
    let text: &[u8] = &file.hir.text;
    let function_text = match file.inputs.options.embeds_function_text {
        true => match file.compiled.installed_text {
            Some(installed) => installed.text.to_vec(),
            None => file.type_ranges.remove_from(text),
        },
        false => Vec::new(),
    };
    let positions = match file.compiled.installed_text {
        Some(installed) => crate::emit::installed_source_positions(
            installed.text,
            &compute_ecma_line_starts(installed.text),
            installed.token_offsets,
        ),
        None => crate::emit::source_positions(text, compute_ecma_line_starts(text)),
    };
    ModuleFragment {
        body: roots.body,
        data: roots.data,
        positions,
        has_installed_positions: file.compiled.installed_text.is_some(),
        function_text,
    }
}
