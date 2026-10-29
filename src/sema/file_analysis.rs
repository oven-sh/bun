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
    ImportSite, ImportSiteKind, ImportSpecifier, JsxImportSet, JsxMode, ResolvedForm,
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
    pub jsx_imports: JsxImportSet,
    pub unused_import_symbols: &'s [SymbolId],
    pub imports_used_only_in_dead_code: &'s [SymbolId],
    /// No code that runs reads them: `export { name }` hands them on, or the metadata of a decorator names them.
    pub imports_used_without_a_read: &'s [SymbolId],
    pub pending_macro_calls: &'s [ExprId],
    pub has_live_top_level_await: bool,
    pub errors: &'s [FoldError],
    pub strings_over_limit: &'s [ExprId],
    pub relies_on_running_before_calls: bool,
    /// What the code reads of other files through its import statements, each name once, in the order of the first reads.
    pub imported_names: &'s [ImportedName],
    requires_of_other_files: &'s [(u32, Atom)],
    sites_by_kind: &'s [u32],
    first_call_site: u32,
}

const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<FileAnalysis<'static>>();
};

impl FileAnalysis<'_> {
    /// What the specifier of a site may be, each a `Constant`, a `Pattern` or `Unknown`.
    pub fn alternatives_of<'a>(&'a self, specifier: &'a ImportSpecifier) -> &'a [ImportSpecifier] {
        match *specifier {
            ImportSpecifier::OneOf(range) => {
                &self.alternatives[range.first as usize..][..range.count as usize]
            }
            _ => std::slice::from_ref(specifier),
        }
    }

    /// The specifier of the site is written from the folder of the file, `./lib/a.js`, where `argument` makes the whole path.
    pub fn is_path_from_own_directory(&self, argument: ExprId) -> bool {
        self.decisions.is_path_from_own_directory(argument)
            || self
                .paths_from_own_directory
                .binary_search(&argument)
                .is_ok()
    }

    /// The specifier of the site is the name that a resolver was asked for, where `argument` is what it answered: `require(require.resolve("./a.js"))`.
    pub fn find_resolved_form(&self, argument: ExprId) -> Option<ResolvedForm> {
        let answers = self.answers_of_resolvers;
        let index = answers.binary_search_by_key(&argument, |&(argument, _)| argument);
        index.ok().map(|index| answers[index].1)
    }

    /// What a name that is no constant may be hangs on more of a folding than the specifiers that it finds.
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

    /// What code that runs reads where no expression spells the name: the root of `import a = b.c`, the factory of a JSX element, a class that the metadata of a decorator names.
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

pub struct FoldedAgain<'s> {
    pub analysis: FileAnalysis<'s>,
    /// The import sites, the format and the uses of the imports are those of the analysis before.
    pub has_same_import_sites: bool,
}

/// Folds a file that `analyze_file` has analyzed once more, with other `inputs` or other constants of other files. `None`: it is to be analyzed anew.
pub fn fold_file_again<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: FileInputs<'s>,
    previous: &FileAnalysis<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> Option<FoldedAgain<'s>> {
    analyze::run_again(hir, bound, inputs, &file, previous, atoms, arena)
}
