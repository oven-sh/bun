mod analyze;
#[cfg(test)]
mod tests;
mod top_level_await;

pub(crate) use top_level_await::has_live_top_level_await;

use crate::atom::{Atom, Interner};
use crate::bind::{BindOptions, Bound, SymbolId};
use crate::fold::{Decisions, FoldError, FoldInputs};
use crate::hir::{ExprId, File};
use crate::hir_from_data::HostValue;
use crate::import_sites::{ImportSite, ImportSiteKind, JsxImportSet, JsxMode};
use crate::module_format::{DeclaredModuleType, ModuleFormat};
use crate::session::Arena;

#[derive(Copy, Clone, Debug)]
pub struct FileInputs<'s> {
    pub declared_module_type: DeclaredModuleType,
    pub import_meta_main: Option<bool>,
    pub is_library: bool,
    pub host_values: &'s [(ExprId, HostValue<'s>)],
    pub jsx: JsxMode,
}

#[derive(Copy, Clone, Default, Debug)]
pub struct FileAnalysis<'s> {
    pub decisions: Decisions<'s>,
    pub module_format: ModuleFormat,
    pub has_esm_syntax: bool,
    pub import_sites: &'s [ImportSite],
    pub jsx_imports: JsxImportSet,
    pub unused_import_symbols: &'s [SymbolId],
    pub imports_used_only_in_dead_code: &'s [SymbolId],
    pub pending_macro_calls: &'s [ExprId],
    pub has_live_top_level_await: bool,
    pub errors: &'s [FoldError],
    pub strings_over_limit: &'s [ExprId],
    pub relies_on_running_before_calls: bool,
    requires_of_other_files: &'s [(u32, Atom)],
    sites_by_kind: &'s [u32],
    first_call_site: u32,
}

const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<FileAnalysis<'static>>();
};

impl FileAnalysis<'_> {
    pub fn import_site_index(&self, kind: ImportSiteKind) -> Option<usize> {
        let sites = self.import_sites;
        let found = self
            .sites_by_kind
            .binary_search_by(|&site| sites[site as usize].kind.cmp(&kind))
            .ok()?;
        Some(self.sites_by_kind[found] as usize)
    }

    // The path that the specifier of a site is resolved from, if the call goes through the `require` of another file.
    pub fn path_to_resolve_from(&self, site: usize) -> Option<Atom> {
        let others = self.requires_of_other_files;
        let found = others.binary_search_by_key(&(site as u32), |it| it.0);
        Some(others[found.ok()?].1)
    }

    pub fn import_site_of_call(&self, call: ExprId) -> Option<usize> {
        let first_call_site = self.first_call_site as usize;
        let found = self.import_sites[first_call_site..]
            .binary_search_by_key(&Some(call), |site| site.kind.call())
            .ok()?;
        Some(first_call_site + found)
    }
}

pub fn analyze_file<'s>(
    hir: &mut File<'s>,
    options: BindOptions,
    inputs: &FoldInputs<'s>,
    file: FileInputs<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> (Bound<'s>, FileAnalysis<'s>) {
    analyze::run(hir, options, inputs, &file, atoms, arena)
}
