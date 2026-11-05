use core::mem::replace;

use bun_sema::bind::{ClassOwner, CodeUnit, ScopeId, SymbolId};
use bun_sema::check::Checker;
use bun_sema::hir::{ClassId, Flags, FnBody, FnId};
use bun_sema::program::{FileId, Sym};
use smallvec::{SmallVec, smallvec};

use super::file_scope;
use super::imports::holds_mock_in_variable;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::FunctionKind;
use crate::ir::{FunctionId, FunctionKey, VariableKey};
use crate::lower::call::Arguments;
use crate::lower::function_types::find_explicit_constructor;
use crate::lower::layouts::class_position;
use crate::lower::scope::BindingRef;
use crate::lower::tables::{put_back_task_state, take_task_state};
use crate::lower::{
    FileLowering, FunctionLowering, LoweredFile, LoweringInputs, function, lower_with_queries,
};
use crate::modules::{ExportBinding, ModuleKind, ModuleRef, Shape};

pub fn lower_file_that_throws(
    inputs: &LoweringInputs<'_>,
    checker: &mut Checker<'_, '_>,
    file: FileId,
    message: &[u8],
) -> Option<LoweredFile> {
    let mut task = take_task_state(checker);
    let lowered = checker.with_queries(file, &inputs.query_inputs(), |queries| {
        queries.answer_nothing_from_now_on();
        lower_with_queries(inputs, queries, file, &mut task, |lowering, function| {
            lower_function_of_throwing_file(lowering, function, message);
        })
    });
    put_back_task_state(checker, task);
    let mut lowered = lowered?;
    lowered.fragment.module.data = None;
    lowered.fragment.module.throws_at_load = true;
    Some(lowered)
}

fn lower_function_of_throwing_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    message: &[u8],
) {
    match file.function_key(function) {
        FunctionKey::ModuleBody(_) => {
            declare_what_other_files_may_name(file);
            lower_function_that_throws(file, function, message);
        }
        FunctionKey::FaceBody(_) => file.lower_face_body(function),
        FunctionKey::CheckBody(_) => file.lower_check_body(function),
        FunctionKey::Instantiation(_) => {
            super::finish_body(FunctionLowering::begin(file, function), None);
        }
        FunctionKey::WrappedModuleBody(_)
        | FunctionKey::Source(_)
        | FunctionKey::ImplicitConstructor(_)
        | FunctionKey::InstanceInitializer(_)
        | FunctionKey::StaticInitializer(_)
        | FunctionKey::AccessorGetter { .. }
        | FunctionKey::AccessorSetter { .. }
        | FunctionKey::PrivateNameTest { .. } => {
            lower_function_that_throws(file, function, message);
        }
        FunctionKey::Signature(_) | FunctionKey::ClassSignature(_) => {
            unreachable!("a signature has no body")
        }
    }
}

fn lower_function_that_throws(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    message: &[u8],
) {
    let message = file.intern_bytes(message);
    let mut lowering = FunctionLowering::begin(file, function);
    lowering.emit_coroutine_start();
    let constructor = lowering.emit_builtin_itself(BuiltinId::SyntaxError);
    let message = lowering.builder.string(message);
    let arguments = Arguments::Values(smallvec![message]);
    let error = lowering.emit_construct(constructor, arguments, None);
    lowering.builder.throw(error);
    lowering.finish();
}

fn declare_what_other_files_may_name(file: &mut FileLowering<'_, '_, '_, '_>) {
    let mut is_declared = vec![false; file.hir.fns.len()];
    declare_written_functions(file, &mut is_declared);
    declare_constructors(file, &mut is_declared);
    define_variables_that_other_files_read(file);
    name_exported_containers(file);
}

fn is_live_function(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> bool {
    file.bound.fns[function.idx()].scope.is_some()
        && !matches!(file.hir[function].body, FnBody::None)
        && !file.decisions().is_dead_function(function)
}

fn find_function_around(file: &FileLowering<'_, '_, '_, '_>, mut scope: ScopeId) -> Option<FnId> {
    let bound = file.bound;
    loop {
        match bound.code_unit(scope) {
            CodeUnit::File => return None,
            CodeUnit::Function(enclosing) => return Some(enclosing),
            CodeUnit::FieldInitializer(member) => {
                scope = bound.class_scope[bound.member_class(member)?.idx()];
            }
        }
    }
}

fn declare_with_enclosing_functions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    is_declared: &mut [bool],
    innermost: Option<FnId>,
) {
    let bound = file.bound;
    let mut innermost_first: SmallVec<[FnId; 8]> = SmallVec::new();
    let mut next = innermost;
    while let Some(function) = next
        && !replace(&mut is_declared[function.idx()], true)
    {
        innermost_first.push(function);
        let top = bound.fns[function.idx()].scope;
        next = find_function_around(file, bound.scopes[top.idx()].parent);
    }
    for function in innermost_first.into_iter().rev() {
        function::declare_source_function(file, function, None);
    }
}

fn declare_written_functions(file: &mut FileLowering<'_, '_, '_, '_>, is_declared: &mut [bool]) {
    for function in (0..is_declared.len() as u32).map(FnId) {
        if is_live_function(file, function) {
            declare_with_enclosing_functions(file, is_declared, Some(function));
        }
    }
}

fn is_dead_class(file: &FileLowering<'_, '_, '_, '_>, class: ClassId) -> bool {
    let decisions = file.decisions();
    match file.bound.class_owner[class.idx()] {
        ClassOwner::Expr(expression) => decisions.is_dead_expr(expression),
        ClassOwner::Stmt(statement) => decisions.is_dead_stmt(statement),
    }
}

fn declare_constructors(file: &mut FileLowering<'_, '_, '_, '_>, is_declared: &mut [bool]) {
    let (hir, bound) = (file.hir, file.bound);
    for class in (0..hir.classes.len() as u32).map(ClassId) {
        let is_ambient = hir[class].flags.contains(Flags::AMBIENT);
        let scope = bound.class_scope[class.idx()];
        if is_ambient || scope.is_none() || is_dead_class(file, class) {
            continue;
        }
        let reference = file.own_class(class);
        if let Some(written) = find_explicit_constructor(file, reference) {
            declare_with_enclosing_functions(file, is_declared, Some(written.function));
            continue;
        }
        let enclosing = find_function_around(file, scope);
        declare_with_enclosing_functions(file, is_declared, enclosing);
        let key = FunctionKey::ImplicitConstructor(reference);
        file.declare_function(key, |file| {
            let position = class_position(&file.hir[class]);
            let kind = FunctionKind::BaseConstructor;
            let mut header = function::create_header(file, key, kind, position);
            file.finish_constructor_header(class, None, &mut header);
            header
        });
    }
}

fn define_variables_that_other_files_read(file: &mut FileLowering<'_, '_, '_, '_>) {
    let (modules, own_file) = (file.inputs.modules, file.file);
    if holds_mock_in_variable(modules, own_file) {
        file.ensure_variable(VariableKey::MockOf(own_file));
    }
    if modules.kind(own_file) != ModuleKind::CommonJs {
        return;
    }
    match modules.shape(ModuleRef::File(own_file)) {
        Shape::Value | Shape::AsToday => {
            file.ensure_variable(VariableKey::ModuleExports(own_file));
            file.module_exports_layout(own_file);
        }
        Shape::EsModule | Shape::Names => {}
    }
    let scope = file_scope(file);
    let bindings: SmallVec<[BindingRef; 16]> = SmallVec::from_slice(file.scopes.bindings(scope));
    for binding in bindings {
        if let BindingRef::Symbol(id) = binding
            && modules.commonjs().is_exported_binding(own_file, id)
        {
            file.ensure_variable(VariableKey::Symbol(Sym { file: own_file, id }));
        }
    }
}

fn makes_container(file: &FileLowering<'_, '_, '_, '_>, symbol: SymbolId) -> bool {
    let (hir, bound) = (file.hir, file.bound);
    let mut declarations = bound.symbol(symbol).decls.iter();
    declarations.any(|&declaration| bound.makes_container_object(hir, declaration))
}

fn name_exported_containers(file: &mut FileLowering<'_, '_, '_, '_>) {
    let modules = file.inputs.modules;
    for export in modules.exports(file.file) {
        if let ExportBinding::Variable(symbol) = export.binding
            && symbol.file == file.file
            && makes_container(file, symbol.id)
        {
            file.container_layout(symbol.id);
        }
    }
}
