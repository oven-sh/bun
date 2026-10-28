mod alternatives;
mod call_sites;
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
    RequireCall, RequireCallForm, find_module_printed_as_require, find_require_call,
};
pub(crate) use call_sites::{
    call_site_arguments, call_site_kind, is_free_common_js, is_in_with_scope,
};
pub use encoders::{ENCODERS, Encoder};
pub use jsx::{
    AutomaticJsx, JsxCallee, JsxImport, JsxImportSet, JsxMode, KeyAttribute, find_key_attribute,
    has_static_children, is_ignored_key, jsx_callee, jsx_children,
};
pub use macro_calls::macro_callee;
pub use made_requires::{
    ExportedRequire, OwnRequire, find_exported_requires, find_own_require, find_result_expression,
    holds_import_meta_require, is_create_require_behind_get_builtin_module, is_made_require,
    is_require_made_for_own_file, may_require_get_members, may_still_be_undefined,
};
pub(crate) use made_requires::{find_imported_export, settled_symbol};
pub use parameters::{find_values_of_parameter, is_exported};
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
}

impl ImportSiteKind {
    pub fn call(self) -> Option<ExprId> {
        match self {
            ImportSiteKind::ImportCall(call)
            | ImportSiteKind::Require(call)
            | ImportSiteKind::RequireResolve(call)
            | ImportSiteKind::ImportMetaRequire(call)
            | ImportSiteKind::ImportMetaResolve(call)
            | ImportSiteKind::GetBuiltinModule(call) => Some(call),
            _ => None,
        }
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

/// What a resolver answers for a name: `require.resolve` a path, `import.meta.resolve` a URL.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum ResolvedForm {
    Path,
    Url,
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

pub(crate) struct ImportScan<'s> {
    pub sites: &'s [ImportSite],
    pub alternatives: &'s [ImportSpecifier],
    pub paths_from_own_directory: &'s [ExprId],
    pub answers_of_resolvers: &'s [(ExprId, ResolvedForm)],
    pub first_call_site: u32,
    pub sites_by_kind: &'s [u32],
    pub jsx_imports: JsxImportSet,
    pub unused_import_symbols: &'s [SymbolId],
    pub imports_used_only_in_dead_code: &'s [SymbolId],
    pub imports_used_without_a_read: &'s [SymbolId],
    pub module_require_objects: &'s [ExprId],
    pub requires_of_other_files: &'s [(u32, Atom)],
    pub pending_macro_calls: &'s [ExprId],
    pub first_runtime_import: Option<ImportId>,
    pub has_import_equals_require: bool,
    pub errors: &'s [FoldError],
}
