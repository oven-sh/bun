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

/// The unit of a file that cannot be compiled: whoever loads the file gets a SyntaxError with `message`.
/// The other files are lowered as if this one were sound, so the unit defines whatever they may name of it.
/// `None`: as `lower_file`.
pub fn lower_file_that_throws(
    inputs: &LoweringInputs<'_>,
    checker: &mut Checker<'_, '_>,
    file: FileId,
    message: &[u8],
) -> Option<LoweredFile> {
    let mut task = take_task_state(checker);
    let lowered = checker.with_queries(file, &inputs.query_inputs(), |queries| {
        // The checker may have refused the tree.
        queries.answer_nothing_from_now_on();
        lower_with_queries(inputs, queries, file, &mut task, |lowering, function| {
            lower_function_of_throwing_file(lowering, function, message);
        })
    });
    put_back_task_state(checker, task);
    let mut lowered = lowered?;
    // `declare_module_body` has named the value that a file of data exports by default. This file exports nothing: every load of it has to run the body.
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
        // Both are made from the graph of modules and read nothing of the tree. The face evaluates the file first, so it throws what the body throws.
        FunctionKey::FaceBody(_) => file.lower_face_body(function),
        FunctionKey::CheckBody(_) => file.lower_check_body(function),
        // The link of a graph throws nothing for the text of a file: its body does, ahead of every other body of the graph (`end_loads_at_modules_that_throw`).
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

// A file that imports this one in a cycle can call a function declaration before the body of the module runs, so no function here is unreachable.
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
    // The parser can leave a function that nothing refers to, and the binder gives such a function no scope.
    file.bound.fns[function.idx()].scope.is_some()
        && !matches!(file.hir[function].body, FnBody::None)
        && !file.decisions().is_dead_function(function)
}

// The function whose header `create_header` reads for the header of what is written in `scope`.
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

// `create_header` reads the header of the enclosing function, so the outermost function is declared first.
// What encloses live code need not be live: `function f(a = () => 1);` has no body.
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

// A key that is named and not defined stops the link, and a function is named wherever it is written: by the type of a variable that holds it,
// by the layout of what it constructs, by the guard of a helper, by the signature of an overload.
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

// The type of a variable that holds a class names the constructor.
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

// `declare_module_body` has defined the variable of each export of an ES module. No store follows: what has a dead zone stays in it.
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

// `define_remaining_layouts` defines each class, each constructor function, and each container that the file has named.
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
