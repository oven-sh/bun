mod alternatives;
mod call_sites;
mod changed_files;
mod encoders;
mod import_uses;
mod jsx;
mod macro_calls;
mod made_requires;
mod parameters;
mod scan;
mod statements;
#[cfg(all(test, not(miri)))]
mod tests;

pub use call_sites::{
    RequireCall, RequireCallForm, does_import_meta_resolve_ask_resolver,
    ends_in_call_that_reads_frame_of_caller, find_module_printed_as_require, find_require_call,
    is_linked_by_bundler, is_module_call_of_plugin, is_name_read_by_transpiler,
};
pub(crate) use call_sites::{
    call_site_arguments, call_site_kind, is_free_common_js, is_in_with_scope,
};
pub use changed_files::{
    TextsOfFile, find_texts_of_exports, write_from_other_folder, write_start_from_other_folder,
};
pub use encoders::{ENCODERS, Encoder};
pub use jsx::{
    AutomaticJsx, JsxCallee, JsxImport, JsxImportSet, JsxMode, KeyAttribute, find_key_attribute,
    has_static_children, is_ignored_key, jsx_callee, jsx_children,
};
pub use macro_calls::{macro_callee, macro_import_symbols};
pub use made_requires::{
    ExportedRequire, OwnRequire, find_exported_requires, find_holder_of_require_made_for_choice,
    find_own_require, find_result_expression, holds_import_meta_require,
    is_create_require_behind_get_builtin_module, is_made_require, is_require_made_for_own_file,
    may_require_get_members, may_still_be_undefined,
};
pub(crate) use made_requires::{
    find_imported_export, may_be_modified, names_own_file, settled_symbol,
};
pub use parameters::{find_values_of_parameter, find_values_passed_for, is_exported};
pub(crate) use scan::collect_import_sites;
pub(crate) use statements::is_runtime_import;

use crate::atom::{Atom, Interner};
use crate::bind::{Bound, SymbolId};
use crate::file_analysis::FileInputs;
use crate::fold::{Decisions, FoldError, FoldInputs};
use crate::hir::{ExportId, ExprId, File, ImportEqualsId, ImportId, StmtId};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ImportSiteKind {
    JsxRuntime,
    JsxPackage,
    Import(ImportId),
    ExportFrom(ExportId),
    ExportStar(StmtId),
    ImportEquals(ImportEqualsId),
    ImportCall(ExprId),
    Require(ExprId),
    RequireResolve(ExprId),
    ImportMetaRequire(ExprId),
    ImportMetaResolve(ExprId),
    GetBuiltinModule(ExprId),
    /// `mock.module(specifier, factory)` of the test runner, which also goes by `jest.mock` and `vi.mock`. It loads nothing.
    /// Also `build.module(specifier, factory)` in the `setup` of a plugin, which the loader keeps in the same table.
    MockModule(ExprId),
    ImportByTestRunner(ExprId),
    RequireByTestRunner(ExprId),
}

impl ImportSiteKind {
    pub fn call(self) -> Option<ExprId> {
        match self {
            ImportSiteKind::ImportCall(call)
            | ImportSiteKind::Require(call)
            | ImportSiteKind::RequireResolve(call)
            | ImportSiteKind::ImportMetaRequire(call)
            | ImportSiteKind::ImportMetaResolve(call)
            | ImportSiteKind::GetBuiltinModule(call)
            | ImportSiteKind::MockModule(call)
            | ImportSiteKind::ImportByTestRunner(call)
            | ImportSiteKind::RequireByTestRunner(call) => Some(call),
            _ => None,
        }
    }

    pub fn hands_type_to_loader(self) -> bool {
        matches!(
            self,
            ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportCall(_)
        )
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ImportSpecifier {
    Constant(Atom),
    Pattern {
        prefix: Atom,
        suffix: Atom,
    },
    /// One of a few, each of them a `Constant` or a `Pattern`: `FileAnalysis::alternatives_of`.
    OneOf(Alternatives),
    Unknown,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ChangedPath {
    pub operand: ExprId,
    pub path: ImportSpecifier,
    pub reaches_below: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportedFileChanger {
    pub export: Atom,
    pub place: u32,
    pub reaches_below: bool,
    pub start: Atom,
    pub end: Atom,
    pub starts_at_own_directory: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportedText {
    pub export: Atom,
    pub text: Atom,
    pub starts_at_own_directory: bool,
}

/// What a resolver answers for a name: `require.resolve` a path, `import.meta.resolve` a URL.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum ResolvedForm {
    Path,
    Url,
    /// A `URL` object whose `href` is that URL.
    UrlObject,
}

/// A range of `FileAnalysis::alternatives`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Alternatives {
    pub(crate) first: u32,
    pub(crate) count: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ImportSite {
    pub kind: ImportSiteKind,
    pub specifier: ImportSpecifier,
    pub specifier_node: ExprId,
    pub attributes: ExprId,
    pub consults_resolver: bool,
    pub is_host_value: bool,
}

pub(crate) struct ScanInputs<'a, 's> {
    pub hir: &'a File<'s>,
    pub bound: &'a Bound<'s>,
    pub decisions: &'a Decisions<'s>,
    pub fold: &'a FoldInputs<'s>,
    pub file: &'a FileInputs<'s>,
    pub atoms: &'a Interner<'s>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ResolvedFrom {
    File(Atom),
    PathFromOwnFolder(Atom),
}

pub(crate) struct ImportScan<'s> {
    pub sites: &'s [ImportSite],
    pub alternatives: &'s [ImportSpecifier],
    pub paths_from_own_directory: &'s [ExprId],
    pub answers_of_resolvers: &'s [(ExprId, ResolvedForm)],
    pub names_of_workers: &'s [(ExprId, ImportSpecifier)],
    pub paths_of_changed_files: &'s [ChangedPath],
    pub exported_file_changers: &'s [ExportedFileChanger],
    pub asked_of_other_files: &'s [(Atom, Atom)],
    pub asked_of_data_files: &'s [(Atom, Atom)],
    pub names_out_of_data_files: &'s [Atom],
    pub keys_stored_in_caches: &'s [(ExprId, ImportSpecifier)],
    pub first_call_site: u32,
    pub sites_by_kind: &'s [u32],
    pub jsx_imports: JsxImportSet,
    pub unused_import_symbols: &'s [SymbolId],
    pub imports_used_only_in_dead_code: &'s [SymbolId],
    pub imports_used_without_a_read: &'s [SymbolId],
    pub module_require_objects: &'s [ExprId],
    pub requires_of_other_files: &'s [(u32, ResolvedFrom)],
    pub pending_macro_calls: &'s [ExprId],
    pub first_runtime_import: Option<ImportId>,
    pub has_import_equals_require: bool,
    pub errors: &'s [FoldError],
}
