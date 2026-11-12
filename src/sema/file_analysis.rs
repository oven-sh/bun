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
    CallerRelativeRead, ChangedPath, ExportedFileChanger, ImportSite, ImportSiteKind,
    ImportSpecifier, JsxImport, JsxImportSet, JsxMode, NamedPath, OwnUrlArgument, ResolvedForm,
    ResolvedFrom, WorkerName,
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
    names_of_workers: &'s [WorkerName],
    pub paths_of_changed_files: &'s [ChangedPath],
    /// File reads with a path relative to this module, as in `fs.readFileSync(path.join(import.meta.dirname, "a.txt"))`: the operand and each path it can name.
    pub module_relative_reads: &'s [(ExprId, Atom)],
    /// The same of paths that are not known in between, as in `fs.readFileSync(path.join(import.meta.dirname, "lang", `${name}.json`))`: the operand, the start and the end.
    pub module_relative_patterns: &'s [(ExprId, Atom, Atom)],
    pub caller_relative_reads: &'s [CallerRelativeRead],
    /// Path operands of file reads, queries and folder listings with a value that can't be resolved, as in `fs.existsSync(path.join(folder, "package.json"))`.
    pub unknown_path_reads: &'s [ExprId],
    /// The operands in `module_relative_reads` of calls that ask about a file and don't read its contents, as in `fs.existsSync(..)`. Sorted.
    pub path_queries: &'s [ExprId],
    /// The operands in `module_relative_reads` of calls that list or copy what lies in a folder, as in `fs.readdirSync(..)`. Sorted.
    pub path_listings: &'s [ExprId],
    /// The operands of `process.chdir(..)` that lead to the file's own folder, each with the path.
    pub folders_entered: &'s [(ExprId, Atom)],
    /// The reads of paths that start at the working directory.
    pub reads_below_working_folder: &'s [(ExprId, Atom)],
    pub named_paths: &'s [NamedPath],
    /// Files and folders that the file creates or writes to, relative to its own folder.
    pub paths_created: &'s [Atom],
    /// Functions that read a file by a path that their callers give, whole or in part. Sorted.
    pub reading_functions: &'s [SymbolId],
    /// What leads to the file's own folder and is passed to a function, as in `find(__dirname)`, each with the function, or is handed on otherwise, as in `{ cwd: __dirname }`. Not the operand of a read that is known, the text that such a read gives, or what a started process is passed.
    pub own_folder_arguments: &'s [(ExprId, Option<ExprId>)],
    /// Loads whose name is partly unknown, as in `require(path.join(process.argv[2] ?? __dirname, "a.json"))`: the argument and each name it is known to take. Sorted by argument.
    pub known_load_names: &'s [(ExprId, Atom)],
    pub own_url_arguments: &'s [OwnUrlArgument],
    pub exported_file_changers: &'s [ExportedFileChanger],
    pub other_file_queries: &'s [(Atom, Atom)],
    pub data_file_queries: &'s [(Atom, Atom)],
    /// The exports of other files, each with its specifier, that a path of a file read may be made of. The members of an object are written with a NUL between them.
    pub own_path_queries: &'s [(Atom, Atom)],
    pub own_export_queries: &'s [Atom],
    pub names_from_data_files: &'s [(Atom, ExprId, bool)],
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

    pub fn known_load_names_at(&self, argument: ExprId) -> impl Iterator<Item = Atom> {
        let names = self.known_load_names;
        let names = &names[names.partition_point(|it| it.0 < argument)..];
        let names = names.iter().take_while(move |it| it.0 == argument);
        names.map(|it| it.1)
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

    pub fn find_name_of_worker(&self, argument: ExprId) -> Option<&WorkerName> {
        let names = self.names_of_workers;
        let index = names.binary_search_by_key(&argument, |it| it.argument);
        index.ok().map(|index| &names[index])
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

/// The bindings of a file that is neither folded nor scanned: those that `analyze_file` returns, unless they depend on
/// sloppy mode.
pub fn bind_file<'s>(
    hir: &mut File<'s>,
    options: BindOptions,
    inputs: &FoldInputs<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> Bound<'s> {
    analyze::bind(hir, options, inputs, atoms, arena)
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
