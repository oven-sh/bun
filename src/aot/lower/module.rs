mod body;
mod faces;
mod imports;
mod left_out;
mod library;
mod library_functions;
mod loads;
mod runtime_value;

use bun_sema::bind::{Decl, Parent, ScopeId, ScopeKind, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{self, ExprId, FnId, ImportEqualsId, StmtId};
use bun_sema::program::{FileId, Files};
use core::ops::Range;
use rustc_hash::{FxHashMap, FxHashSet};

use super::commonjs::{self, CommonJsState};
use super::context::{FileInputs, SourceKind};
use super::data::DataState;
use super::fragment::ModuleFragment;
use super::validate::ValidationState;
use super::{FileLowering, FunctionLowering};
use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::{BuiltinId, RuntimeFunction};
use crate::ir::{BlockId, DataId, FunctionId, StringId, ValueId};
use crate::load::Sources;
use crate::modules::ImportBinding;

pub use left_out::LeftOutDeclarations;
pub(in crate::lower) use library::LibraryFunctionForm;

#[derive(Default)]
pub(crate) struct ModuleState {
    pub(in crate::lower) data: DataState,
    pub(in crate::lower) validation: ValidationState,
    pub(in crate::lower) commonjs: CommonJsState,
}

#[derive(Default, Clone)]
pub struct LibraryFunctions {
    linked_functions: FxHashMap<RuntimeFunction, FunctionRef>,
    left_out_functions: FxHashSet<FunctionRef>,
    left_out_declarations: LeftOutDeclarations,
}

impl LibraryFunctions {
    pub fn compute(
        files: &Files<'_>,
        file_inputs: &[Option<FileInputs<'_>>],
        sources: &Sources,
    ) -> LibraryFunctions {
        LibraryFunctions {
            linked_functions: library_functions::collect_linked_functions(
                files,
                file_inputs,
                sources,
            ),
            left_out_functions: FxHashSet::default(),
            left_out_declarations: LeftOutDeclarations::default(),
        }
    }

    /// Nothing that the program can run names these functions at the top of their files.
    pub fn leave_out(&mut self, functions: FxHashSet<FunctionRef>) {
        self.left_out_functions = functions;
    }

    pub(crate) fn is_left_out(&self, function: FunctionRef) -> bool {
        self.left_out_functions.contains(&function)
    }

    /// Nothing that the program can run names what these declare at the top of their files, and nobody can tell whether they were evaluated.
    pub fn leave_out_declarations(&mut self, declarations: LeftOutDeclarations) {
        self.left_out_declarations = declarations;
    }

    pub(crate) fn left_out_declarations(&self) -> &LeftOutDeclarations {
        &self.left_out_declarations
    }

    pub(crate) fn find(&self, function: RuntimeFunction) -> Option<FunctionRef> {
        self.linked_functions.get(&function).copied()
    }
}

#[derive(Copy, Clone, Default, Debug)]
pub(crate) struct ModuleRoots {
    body: Option<FunctionId>,
    data: Option<DataId>,
}

/// The functions at the top of a file of library functions, each with the positions it is written between.
pub fn collect_library_functions(
    files: &Files<'_>,
    file: FileId,
    builtins: &ResolvedBuiltins,
) -> Vec<(FnId, Range<u32>)> {
    library::collect_library_functions(files, file, builtins)
}

pub(in crate::lower) fn file_scope(file: &FileLowering<'_, '_, '_, '_>) -> ScopeId {
    let scope = file.bound.scope_of_declaration(file.hir, Decl::File);
    debug_assert!(matches!(
        file.bound.scopes[scope.idx()].kind,
        ScopeKind::File
    ));
    scope
}

pub(in crate::lower) fn is_moved_to_file_start(
    file: &FileLowering<'_, '_, '_, '_>,
    statement: StmtId,
) -> bool {
    file.source == SourceKind::Program
        && file.bound.parent_of_stmt(statement) == Parent::File
        && hir::is_moved_to_file_start(file.hir, statement)
}

pub(in crate::lower) fn library_function_form(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> Option<LibraryFunctionForm> {
    match file.source {
        SourceKind::Program | SourceKind::RuntimeModule(_) => None,
        SourceKind::RuntimeFunctions => library::library_function_form(file, function),
    }
}

pub(crate) fn declare_module_roots(file: &mut FileLowering<'_, '_, '_, '_>) -> ModuleRoots {
    match file.source {
        SourceKind::Program | SourceKind::RuntimeModule(_) => body::declare_module_body(file),
        SourceKind::RuntimeFunctions => {
            library::declare_library_functions(file);
            ModuleRoots::default()
        }
    }
}

pub(crate) fn lower_module_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    body::lower_module_body(file, function);
}

pub(crate) fn lower_face_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    faces::lower_face_body(file, function);
}

pub(crate) fn lower_check_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    faces::lower_check_body(file, function);
}

pub(crate) fn finish_module(
    file: &mut FileLowering<'_, '_, '_, '_>,
    roots: ModuleRoots,
) -> ModuleFragment {
    body::finish_module(file, roots)
}

pub(crate) fn get_import(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
) -> ValueId {
    imports::get_import(lowering, symbol)
}

pub(crate) fn emit_import_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
) -> ValueId {
    imports::emit_import_binding(lowering, binding, name, None)
}

pub(crate) fn lower_namespace_receiver(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ExprId,
) -> ValueId {
    imports::lower_namespace_receiver(lowering, object)
}

pub(crate) fn lower_namespace_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    imports::lower_namespace_member(lowering, access)
}

pub(crate) fn lower_import_meta(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    commonjs::emit_module_builtin(lowering, BuiltinId::ImportMeta)
}

pub(crate) fn lower_import_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> ValueId {
    loads::lower_import_call(lowering, call)
}

pub(crate) fn try_lower_module_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    chain_exit: Option<BlockId>,
) -> Option<ValueId> {
    loads::try_lower_module_call(lowering, call, chain_exit)
}

pub(crate) fn lower_import_equals_require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: ImportEqualsId,
) -> Option<ValueId> {
    loads::lower_import_equals_require(lowering, declaration)
}

pub(crate) fn lower_export_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    expression: ExprId,
) {
    body::lower_export_default(lowering, statement, expression);
}
