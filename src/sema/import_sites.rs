mod alternatives;
mod call_sites;
mod changed_files;
mod encoders;
mod exported_paths;
mod import_uses;
mod jsx;
mod macro_calls;
mod made_requires;
mod named_paths;
mod parameters;
mod scan;
mod statements;
#[cfg(all(test, not(miri)))]
mod tests;
mod touched_exports;
mod wrapper_variables;
mod written_arms;

pub use call_sites::{
    RequireCall, RequireCallForm, WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY,
    does_import_meta_resolve_ask_resolver, ends_in_call_that_reads_frame_of_caller,
    find_heritage_constructed, find_heritage_of_super_call, find_module_printed_as_require,
    find_require_call, is_linked_by_bundler, is_module_call_of_plugin, is_name_read_by_transpiler,
    is_name_written_out, may_spell_word_that_mock_looks_for, names_word_that_mock_looks_for,
};
pub(crate) use call_sites::{
    call_site_arguments, call_site_kind, is_free_common_js, is_in_with_scope, is_process,
    may_construct_worker,
};
pub use call_sites::{is_load_found_late, is_site_of_handed_url};
pub use changed_files::{
    TextsOfFile, find_texts_of_exports, write_from_other_folder, write_start_from_other_folder,
};
pub use encoders::{ENCODERS, Encoder};
pub use exported_paths::ExportedPath;
pub use import_uses::find_imports_of_unused_names;
pub use jsx::{
    AutomaticJsx, JsxCallee, JsxImport, JsxImportSet, JsxMode, KeyAttribute, find_key_attribute,
    has_static_children, is_ignored_key, jsx_callee, jsx_children,
};
pub use macro_calls::{macro_callee, macro_import_symbols};
pub use made_requires::{
    ExportedRequire, OwnRequire, answers_with_require, find_base_that_a_call_made_of_own_file,
    find_exported_requires, find_holder_of_require_made_for_choice,
    find_made_requires_that_go_out_of_sight, find_other_values_of_own_require, find_own_require,
    find_result_expression, gives_first_argument_to_own_require, holds_import_meta_require,
    is_call_of_create_require, is_create_require_behind_get_builtin_module,
    is_create_require_called_through_call, is_made_require, is_require_made_for_own_file,
    may_be_modified, may_call_have_made_base_of_require, may_call_have_made_path,
    may_require_get_members, may_still_be_undefined,
};
pub(crate) use made_requires::{OtherUse, find_imported_export, names_own_file, settled_symbol};
pub use parameters::{
    ExportedNames, find_names_exported_for, find_parameter_named, find_values_of_parameter,
    find_values_passed_for, is_exported,
};
pub(crate) use scan::collect_import_sites;
pub(crate) use statements::is_runtime_import;
pub use statements::{SitesByName, find_sites_by_name, find_statement_sites};
pub(crate) use touched_exports::{
    is_module_that_reaches_modules, reaches_modules_unnamed, touches_export,
};
pub use wrapper_variables::{reads_what_wrapper_hands_in, redeclares_what_wrapper_hands_in};
pub use written_arms::{
    find_names_folded_by_transpiler, find_names_read_by_transpiler, find_written_arms,
};

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
    MockModule(ExprId),
    ImportByTestRunner(ExprId),
    RequireByTestRunner(ExprId),
}

impl ImportSiteKind {
    pub fn loads_module(self) -> bool {
        !matches!(
            self,
            ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::MockModule(_)
        )
    }

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
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ImportSpecifier {
    Constant(Atom),
    Pattern { prefix: Atom, suffix: Atom },
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

/// `function` reads `path` relative to the module whose `import.meta.url` is passed as argument `place`, or as `property` of that argument.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CallerRelativeRead {
    pub function: SymbolId,
    pub place: u32,
    pub property: Option<Atom>,
    pub path: Atom,
    /// `FileAnalysis::path_queries`.
    pub is_query: bool,
}

/// A path that the file names relative to its own folder, whoever reads it: `load(path.join(__dirname, "a.txt"))`, `load("a.txt", import.meta.url)`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct NamedPath {
    pub operand: ExprId,
    /// The function that is called with it.
    pub callee: Option<ExprId>,
    pub path: Atom,
    /// A function of an installed package is called with it: `express.static(path.join(__dirname, "public"))`.
    pub is_passed_to_package: bool,
    /// Another program gets it, or is it, or it is found on the disk alone: `spawn("python3", [path.join(__dirname, "a.py")])`.
    pub is_needed_on_disk: bool,
    /// A process starts in it.
    pub becomes_working_folder: bool,
}

/// A call that passes the module's own URL: `function(import.meta.url)` or `function({ property: import.meta.url })`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct OwnUrlArgument {
    pub argument: ExprId,
    pub function: SymbolId,
    pub place: u32,
    pub property: Option<Atom>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportedText {
    pub export: Atom,
    pub text: Atom,
    pub starts_at_own_directory: bool,
}

pub const WHERE_FILE_LIES: &[u8] = b"\0\0";

pub(crate) fn write_question_where_file_lies(call: ExprId) -> Vec<u8> {
    [WHERE_FILE_LIES, call.idx().to_string().as_bytes()].concat()
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum ResolvedForm {
    Path,
    Url,
    UrlObject,
}

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

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct WorkerName {
    pub argument: ExprId,
    pub name: ImportSpecifier,
    /// Code out of sight of the analysis could change it: code that gets `import.meta`, an instance or a class.
    pub is_on_trust: bool,
}

pub(crate) struct ImportScan<'s> {
    pub sites: &'s [ImportSite],
    pub alternatives: &'s [ImportSpecifier],
    pub paths_from_own_directory: &'s [ExprId],
    pub answers_of_resolvers: &'s [(ExprId, ResolvedForm)],
    pub names_of_workers: &'s [WorkerName],
    pub paths_of_changed_files: &'s [ChangedPath],
    pub module_relative_reads: &'s [(ExprId, Atom)],
    pub module_relative_patterns: &'s [(ExprId, Atom, Atom)],
    pub caller_relative_reads: &'s [CallerRelativeRead],
    pub unknown_path_reads: &'s [ExprId],
    pub path_queries: &'s [ExprId],
    pub path_listings: &'s [ExprId],
    pub folders_entered: &'s [(ExprId, Atom)],
    pub reads_below_working_folder: &'s [(ExprId, Atom)],
    pub named_paths: &'s [NamedPath],
    pub paths_created: &'s [Atom],
    pub reading_functions: &'s [SymbolId],
    /// What leads to the file's own folder and is passed to a function, as in `find(__dirname)`, each with the function, or is handed on otherwise, as in `{ cwd: __dirname }`. Not the operand of a read that is known, the text that such a read gives, or what a started process is passed.
    pub own_folder_arguments: &'s [(ExprId, Option<ExprId>)],
    pub known_load_names: &'s [(ExprId, Atom)],
    pub own_url_arguments: &'s [OwnUrlArgument],
    pub exported_file_changers: &'s [ExportedFileChanger],
    pub other_file_queries: &'s [(Atom, Atom)],
    pub data_file_queries: &'s [(Atom, Atom)],
    pub own_path_queries: &'s [(Atom, Atom)],
    pub own_export_queries: &'s [Atom],
    pub names_from_data_files: &'s [(Atom, ExprId, bool)],
    pub names_resolved_from_listed_folders: &'s [(Atom, Atom, ExprId)],
    pub options_of_resolves_with_unread_folders: &'s [ExprId],
    pub keys_stored_in_caches: &'s [(ExprId, ImportSpecifier)],
    pub first_call_site: u32,
    pub sites_by_kind: &'s [u32],
    pub jsx_imports: JsxImportSet,
    pub unused_import_symbols: &'s [SymbolId],
    pub imports_used_only_in_dead_code: &'s [SymbolId],
    pub imports_used_without_a_read: &'s [SymbolId],
    pub module_require_objects: &'s [ExprId],
    pub requires_of_other_files: &'s [(u32, ResolvedFrom)],
    pub paths_given_to_create_require: &'s [(ExprId, Atom)],
    pub pending_macro_calls: &'s [ExprId],
    pub first_runtime_import: Option<ImportId>,
    pub has_import_equals_require: bool,
    pub errors: &'s [FoldError],
}
