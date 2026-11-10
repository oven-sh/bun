mod analyze;
#[cfg(test)]
mod tests;
mod top_level_await;

pub use top_level_await::has_live_await;
use top_level_await::has_live_top_level_await;
pub(crate) use top_level_await::has_written_top_level_await;

use crate::atom::{Atom, Interner};
use crate::bind::{BindOptions, Binding, Bound, Decl, SymbolId};
use crate::fold::{Decisions, FoldError, FoldInputs};
use crate::hir::{ExprId, File, ImportEqualsId, ImportedName, NodeData};
use crate::hir_from_data::HostValue;
use crate::import_sites::{
    ChangedPath, ExportedFileChanger, FileReadBesideCaller, ImportSite, ImportSiteKind,
    ImportSpecifier, JsxImport, JsxImportSet, JsxMode, OwnUrlHanded, ResolvedForm, ResolvedFrom,
};
use crate::module_format::{DeclaredModuleType, FormatByDeclaredType, ModuleFormat};
use crate::session::Arena;

#[derive(Copy, Clone, Debug)]
pub struct FileInputs<'s> {
    pub declared_module_type: DeclaredModuleType,
    pub import_meta_main: Option<bool>,
    pub is_library: bool,
    pub host_values: &'s [(ExprId, HostValue<'s>)],
    pub jsx: JsxMode,
    pub own_name: &'s [u8],
}

#[derive(Copy, Clone, Default, Debug)]
pub struct FileAnalysis<'s> {
    pub decisions: Decisions<'s>,
    pub module_format: ModuleFormat,
    pub module_formats: FormatByDeclaredType,
    pub has_esm_syntax: bool,
    pub import_sites: &'s [ImportSite],
    alternatives: &'s [ImportSpecifier],
    paths_from_own_directory: &'s [ExprId],
    answers_of_resolvers: &'s [(ExprId, ResolvedForm)],
    names_of_workers: &'s [(ExprId, ImportSpecifier)],
    pub paths_of_changed_files: &'s [ChangedPath],
    pub paths_of_files_read: &'s [(ExprId, Atom)],
    pub files_read_beside_callers: &'s [FileReadBesideCaller],
    pub own_urls_handed: &'s [OwnUrlHanded],
    pub exported_file_changers: &'s [ExportedFileChanger],
    pub asked_of_other_files: &'s [(Atom, Atom)],
    pub asked_of_data_files: &'s [(Atom, Atom)],
    pub asked_of_own_exports: &'s [Atom],
    pub names_out_of_data_files: &'s [(Atom, ExprId, bool)],
    pub names_resolved_from_listed_folders: &'s [(Atom, Atom, ExprId)],
    pub options_of_resolves_with_unread_folders: &'s [ExprId],
    keys_stored_in_caches: &'s [(ExprId, ImportSpecifier)],
    pub jsx_imports: JsxImportSet,
    pub unused_import_symbols: &'s [SymbolId],
    pub imports_used_only_in_dead_code: &'s [SymbolId],
    pub imports_used_without_a_read: &'s [SymbolId],
    pub pending_macro_calls: &'s [ExprId],
    pub has_live_top_level_await: bool,
    pub errors: &'s [FoldError],
    fold_error_count: u32,
    pub strings_over_limit: &'s [ExprId],
    pub asks_for_main_module: bool,
    pub imported_names: &'s [ImportedName],
    requires_of_other_files: &'s [(u32, ResolvedFrom)],
    paths_given_to_create_require: &'s [(ExprId, Atom)],
    sites_by_kind: &'s [u32],
    first_call_site: u32,
}

const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<FileAnalysis<'static>>();
};

impl FileAnalysis<'_> {
    pub fn jsx_takes_this(&self) -> bool {
        self.jsx_imports.contains(JsxImport::JsxDev)
    }

    pub fn alternatives_of<'a>(&'a self, specifier: &'a ImportSpecifier) -> &'a [ImportSpecifier] {
        match *specifier {
            ImportSpecifier::OneOf(range) => {
                &self.alternatives[range.first as usize..][..range.count as usize]
            }
            _ => std::slice::from_ref(specifier),
        }
    }

    pub fn is_path_from_own_directory(&self, argument: ExprId) -> bool {
        self.decisions.is_path_from_own_directory(argument)
            || self
                .paths_from_own_directory
                .binary_search(&argument)
                .is_ok()
    }

    pub fn find_resolved_form(&self, argument: ExprId) -> Option<ResolvedForm> {
        let answers = self.answers_of_resolvers;
        let index = answers.binary_search_by_key(&argument, |&(argument, _)| argument);
        index.ok().map(|index| answers[index].1)
    }

    pub fn find_name_of_worker(&self, argument: ExprId) -> Option<&ImportSpecifier> {
        let names = self.names_of_workers;
        let index = names.binary_search_by_key(&argument, |&(argument, _)| argument);
        index.ok().map(|index| &names[index].1)
    }

    pub fn find_key_stored_in_cache(&self, key: ExprId) -> Option<&ImportSpecifier> {
        let keys = self.keys_stored_in_caches;
        let index = keys.binary_search_by_key(&key, |&(key, _)| key);
        index.ok().map(|index| &keys[index].1)
    }

    pub(crate) fn names_every_file_by_a_constant(&self) -> bool {
        let mut sites = self.import_sites.iter();
        sites.all(|site| matches!(site.specifier, ImportSpecifier::Constant(_)))
    }

    pub fn import_site_index(&self, kind: ImportSiteKind) -> Option<usize> {
        let sites = self.import_sites;
        let found = self
            .sites_by_kind
            .binary_search_by(|&site| sites[site as usize].kind.cmp(&kind))
            .ok()?;
        Some(self.sites_by_kind[found] as usize)
    }

    pub fn path_to_resolve_from(&self, site: usize) -> Option<ResolvedFrom> {
        let others = self.requires_of_other_files;
        let found = others.binary_search_by_key(&(site as u32), |it| it.0);
        Some(others[found.ok()?].1)
    }

    pub fn find_path_given_to_create_require(&self, given: ExprId) -> Option<Atom> {
        let paths = self.paths_given_to_create_require;
        let found = paths.binary_search_by_key(&given, |it| it.0);
        Some(paths[found.ok()?].1)
    }

    pub fn import_site_of_call(&self, call: ExprId) -> Option<usize> {
        let first_call_site = self.first_call_site as usize;
        let found = self.import_sites[first_call_site..]
            .binary_search_by_key(&Some(call), |site| site.kind.call())
            .ok()?;
        Some(first_call_site + found)
    }

    pub fn bindings_read_without_expression(
        &self,
        hir: &File<'_>,
        bound: &Bound<'_>,
    ) -> impl Iterator<Item = Binding> {
        let aliases = (0..hir.import_equals.len() as u32).map(ImportEqualsId);
        let roots = aliases.filter_map(|alias| {
            let name = bound.declared_symbol(Decl::ImportEquals(alias));
            let is_evaluated = self.unused_import_symbols.binary_search(&name).is_err();
            is_evaluated.then(|| bound.entity_root_binding(alias))
        });
        let implicit = bound.runtime.implicit_references().iter();
        let implicit = implicit.filter(|reference| {
            !matches!(reference.node, NodeData::Expr(element) if self.decisions.is_dead_expr(element))
        });
        roots.chain(implicit.map(|reference| reference.binding))
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

pub struct AnalyzedAgain<'s> {
    pub analysis: FileAnalysis<'s>,
    pub has_same_import_sites: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AnalyzedAgainFrom {
    Folding,
    ImportScan,
}

pub fn analyze_file_again<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: FileInputs<'s>,
    previous: &FileAnalysis<'s>,
    from: AnalyzedAgainFrom,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> Option<AnalyzedAgain<'s>> {
    analyze::run_again(hir, bound, inputs, &file, previous, from, atoms, arena)
}
