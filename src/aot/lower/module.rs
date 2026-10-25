mod body;
mod faces;
mod imports;
mod left_out;
mod library;
mod library_functions;
mod loads;
mod runtime_value;

use bun_sema::bind::{Decl, Parent, ScopeId, ScopeKind};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{self, StmtId};
use bun_sema::program::Files;
use rustc_hash::{FxHashMap, FxHashSet};

use super::commonjs::CommonJsState;
use super::context::{FileInputs, SourceKind};
use super::data::DataState;
use super::{FileLowering, FunctionLowering};
use crate::builtins::id::{BuiltinId, RuntimeFunction};
use crate::ir::{DataId, FunctionId, StringId, ValueId};
use crate::load::Sources;
use crate::modules::ImportBinding;

pub(in crate::lower) use self::body::finish_body;
pub(crate) use self::loads::lower_import_call;
pub use left_out::LeftOutDeclarations;
pub use library::collect_library_functions;
pub(in crate::lower) use library::{LibraryFunctionForm, library_function_form};

#[derive(Default)]
pub(crate) struct ModuleState {
    pub(in crate::lower) data: DataState,
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
        let linked = library_functions::collect_linked_functions(files, file_inputs, sources);
        LibraryFunctions {
            linked_functions: linked,
            ..LibraryFunctions::default()
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

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn declare_module_roots(&mut self) -> ModuleRoots {
        match self.source {
            SourceKind::Program | SourceKind::RuntimeModule(_) => body::declare_module_body(self),
            SourceKind::RuntimeFunctions => {
                library::declare_library_functions(self);
                ModuleRoots::default()
            }
        }
    }
}

pub(crate) fn emit_import_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
) -> ValueId {
    imports::emit_import_binding(lowering, binding, name, None)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_import_meta(&mut self) -> ValueId {
        self.emit_module_builtin(BuiltinId::ImportMeta)
    }
}
