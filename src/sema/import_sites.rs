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
mod touched_exports;
mod written_arms;

pub use call_sites::is_load_found_late;
pub use call_sites::{
    RequireCall, RequireCallForm, WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY,
    does_import_meta_resolve_ask_resolver, ends_in_call_that_reads_frame_of_caller,
    find_module_printed_as_require, find_require_call, is_linked_by_bundler,
    is_module_call_of_plugin, is_name_read_by_transpiler, is_name_written_out,
    may_spell_word_that_mock_looks_for, names_word_that_mock_looks_for,
};
pub(crate) use call_sites::{
    call_site_arguments, call_site_kind, is_free_common_js, is_in_with_scope, is_process,
    may_construct_worker,
};
pub use changed_files::{
    TextsOfFile, find_texts_of_exports, write_from_other_folder, write_start_from_other_folder,
};
pub use encoders::{ENCODERS, Encoder};
pub use import_uses::find_imports_of_unused_names;
pub use jsx::{
    AutomaticJsx, JsxCallee, JsxImport, JsxImportSet, JsxMode, KeyAttribute, find_key_attribute,
    has_static_children, is_ignored_key, jsx_callee, jsx_children,
};
pub use macro_calls::{macro_callee, macro_import_symbols};
pub use made_requires::{
    ExportedRequire, OwnRequire, find_base_that_a_call_made_of_own_file, find_exported_requires,
    find_holder_of_require_made_for_choice, find_made_requires_that_go_out_of_sight,
    find_other_values_of_own_require, find_own_require, find_result_expression,
    gives_first_argument_to_own_require, holds_import_meta_require, is_call_of_create_require,
    is_create_require_behind_get_builtin_module, is_create_require_called_through_call,
    is_made_require, is_require_made_for_own_file, may_be_modified,
    may_call_have_made_base_of_require, may_call_have_made_path, may_require_get_members,
    may_still_be_undefined,
};
pub(crate) use made_requires::{OtherUse, find_imported_export, names_own_file, settled_symbol};
pub use parameters::{
    ExportedNames, find_names_exported_for, find_parameter_named, find_values_of_parameter,
    find_values_passed_for, is_exported,
};
pub(crate) use scan::collect_import_sites;
pub(crate) use statements::is_runtime_import;
pub(crate) use touched_exports::{
    is_module_that_reaches_modules, reaches_modules_unnamed, touches_export,
};
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
    pub asked_of_own_exports: &'s [Atom],
    pub names_out_of_data_files: &'s [(Atom, ExprId, bool)],
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
