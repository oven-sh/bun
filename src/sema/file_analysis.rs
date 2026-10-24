mod analyze;
#[cfg(test)]
mod tests;
mod top_level_await;

pub(crate) use top_level_await::has_live_top_level_await;

use crate::atom::Interner;
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

#[derive(Copy, Clone, Debug)]
pub struct FileAnalysis<'s> {
    pub decisions: Decisions<'s>,
    pub module_format: ModuleFormat,
    /// `import`, `export`, `import.meta` or a top-level `await`. A CommonJS file can have `import.meta`.
    pub has_esm_syntax: bool,
    pub import_sites: &'s [ImportSite],
    pub jsx_imports: JsxImportSet,
    pub unused_import_symbols: &'s [SymbolId],
    /// Those of `unused_import_symbols` that are evaluated somewhere.
    pub imports_used_only_in_dead_code: &'s [SymbolId],
    pub pending_macro_calls: &'s [ExprId],
    pub has_live_top_level_await: bool,
    pub errors: &'s [FoldError],
    pub strings_over_limit: &'s [ExprId],
    /// Something was decided because no function of the file runs before a statement of its body. Another file can call what this one exports before that only on a cycle of imports.
    pub relies_on_running_before_calls: bool,
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

    pub fn import_site_of_call(&self, call: ExprId) -> Option<usize> {
        let first_call_site = self.first_call_site as usize;
        let found = self.import_sites[first_call_site..]
            .binary_search_by_key(&Some(call), |site| site.kind.call())
            .ok()?;
        Some(first_call_site + found)
    }

    fn empty() -> Self {
        FileAnalysis {
            decisions: Decisions::default(),
            module_format: ModuleFormat::Esm,
            has_esm_syntax: false,
            import_sites: &[],
            jsx_imports: JsxImportSet::default(),
            unused_import_symbols: &[],
            imports_used_only_in_dead_code: &[],
            pending_macro_calls: &[],
            has_live_top_level_await: false,
            errors: &[],
            strings_over_limit: &[],
            relies_on_running_before_calls: false,
            sites_by_kind: &[],
            first_call_site: 0,
        }
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
