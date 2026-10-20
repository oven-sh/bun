//! Every file of the program, and its symbols once the files are linked together: which file an
//! import resolves to, which declarations in different files merge into one symbol, what an alias
//! resolves to.

mod explain_files;

use crate::atom::{Atom, Interner, known};
use crate::bind::{self, Bound, Decl, ScopeId, ScopeKind, SymFlags, Symbol, SymbolId};
use crate::check::errors::{SuggestionLookup, is_close};
use crate::check::spans::{Spans, skip_trivia, skip_trivia_back};
use crate::components::Components;
use crate::hir::{self, *};
use crate::json::Json;
use crate::resolve::{
    DiagAndArgs, Host, INFERRED_TYPES_CONTAINING_FILE, JsxEmit, ModuleDetection, ModuleKind,
    Options, PackageId, ParseOptions, ResolvedModule, Resolver, ScriptKind, ScriptTarget, Tracer,
    ancestors, contains_path, displayed_path, file_extension_is_one_of, file_path,
    format_by_extension, get_base_file_name, get_lib_file_name, has_ts_implementation_extension,
    inside, is_javascript, is_javascript_file, is_relative, is_same_path, join, path_is_relative,
    remove_file_extension, run_with_current_helpers, supported_extensions, to_file_name_lower_case,
    to_path, to_path_in, typescript_path,
};
use crate::session::{
    Arena, ArenaBox, ArenaHashMap, ArenaHashSet, ArenaVec, Session, map_in, set_in, transfer_arena,
    vec_from_iter_in,
};
use crate::table::{Bases, ByNode, ByNodeIndirect, Frozen, RawWord};
use crate::util::SharedSort;
use crate::util::{FxBuild, FxHashMap, FxHashSet, List, ShardedMap};
use crate::verify::{ConfigLocation, Problem};
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::fs::Path;
use bun_paths::path_buffer_pool;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_threading::Guarded;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::hint::cold_path;
use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct FileId(pub u32);

impl FileId {
    #[inline]
    pub fn idx(self) -> usize {
        self.0 as usize
    }
}

/// A symbol of the program.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct Sym {
    pub file: FileId,
    pub id: SymbolId,
}

/// A symbol synthesized for an alias of a file, which no file declares (`SymbolFlagsTransient`):
/// the one `cloneTypeAsModuleType` creates for `import * as ns`, or `combineValueAndTypeSymbols`
/// for a name imported from `export = value`. It is stored in `bound.symbols` of the file of the
/// alias, after the binder's symbols.
#[derive(Copy, Clone)]
struct TransientSymbol {
    /// `exportTypeLinks.originatingImport`
    alias: SymbolId,
    symbol: SymbolId,
    /// `exportTypeLinks.target`, or the type symbol.
    target: Sym,
    is_combined: bool,
}

/// An alias that may need a transient symbol, found by `Files::transient_candidates_of`.
enum TransientCandidate<'s> {
    /// The alias gets this symbol, which was built without resolving any alias.
    Known(TransientSymbol, Symbol<'s>),
    /// Some alias must be resolved first to decide if this one gets a symbol, and for which target.
    Unresolved(SymbolId),
}

fn add_transient_symbols<'s>(
    module: &mut Module<'s>,
    created: Vec<(TransientSymbol, Symbol<'s>)>,
    arena: &'s Arena,
) {
    module.bound.symbols.reserve_exact(created.len());
    for (mut links, symbol) in created {
        links.symbol = SymbolId(module.bound.symbols.len() as u32);
        module.bound.symbols.push(symbol, arena);
        module.transient_symbols.push(links);
    }
}

/// Counts the identifier expressions in a file.
fn count_identifiers(hir: &hir::File) -> u32 {
    let tags = hir.exprs.iter().map(|it| it.kind.tag());
    tags.filter(|&tag| tag == ExprTag::Ident).count() as u32
}

/// Copies `list` into `arena`. An empty list allocates nothing.
fn slice_in<'s, T: Copy>(list: &[T], arena: &'s Arena) -> &'s [T] {
    if list.is_empty() {
        return &[];
    }
    arena.alloc_slice_copy(list)
}

/// Calls `work(index, module)` for every module, in parallel on the host's threads. `index` doesn't
/// count `None` entries.
fn each_module<'s>(
    host: &dyn Host,
    modules: &mut [Option<ArenaBox<'s, Module<'s>>>],
    work: &(dyn Fn(usize, &mut Module<'s>) + Sync),
) {
    let modules: Vec<Guarded<&mut ArenaBox<'s, Module<'s>>>> =
        modules.iter_mut().flatten().map(Guarded::new).collect();
    host.parallel(modules.len(), &|at| work(at, &mut modules[at].lock()));
}

/// Moves `list` into `arena` at its final size.
fn few_in<T>(list: Vec<T>, arena: &Arena) -> ArenaFew<'_, T> {
    ArenaFew::from_iter_in(list.into_iter(), arena)
}

pub struct Module<'s> {
    /// `text`: `Path()`, which identifies the file. `pretty`: `FileName()`.
    pub path: Path<'s>,
    pub hir: hir::File<'s>,
    pub bound: Bound<'s>,
    /// Lives as long as `bound`. Whether an alias resolves to the symbol synthesized for it can
    /// only be decided from types.
    transient_symbols: ArenaVec<'s, TransientSymbol>,
    /// `IsSourceFileDefaultLibrary`: one of TypeScript's own `lib.*.d.ts`, or the file that
    /// `libReplacement` reads in its place.
    pub is_lib: bool,
    /// The file that each specifier in this file resolves to, for each resolution mode it is used
    /// with there (`getModeForUsageLocation`).
    pub imports: ArenaHashMap<'s, (Atom, ResolutionMode), FileId>,
    /// The unresolved `/// <reference>`s: the position of the referenced name, and the diagnostic
    /// code.
    pub missing_references: ArenaFew<'s, (u32, u32)>,
    /// Under Node-style module resolution it is an ECMAScript module.
    pub is_esm: bool,
    /// Its file name or its package declares it an ECMAScript module, regardless of the module
    /// resolution mode. In that case it is only queried for packages.
    pub specifies_esm: bool,
    /// `GetImpliedNodeFormatForEmit`: the module format it is emitted as, if its file name or its
    /// package determines that.
    pub implied_format: ResolutionMode,
    /// `getModeForUsageLocation` for a plain `import` in it: the mode it is resolved in. The syntax
    /// that is emitted for it is `Files::emit_syntax_of_import`.
    pub default_mode: ResolutionMode,
    /// The `package.json` in `PackageJsonDirectory`, if it has no `PackageJsonType`. `NONE` otherwise. Also `NONE`
    /// unless `module` is `node16` or `node18`, because nothing else reads it.
    pub package_json_without_type: Atom,
    /// `GetNearestAncestorDirectoryWithPackageJson`: the directory of the `package.json` nearest to
    /// the file. `NONE` if there isn't one.
    pub package_json_directory: Atom,
    /// The specifiers that resolve to JavaScript without type declarations, with the resolution
    /// mode in which they do.
    pub untyped_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// For each of `untyped_imports`: the file it resolves to, and `PackageId.Name` of the package
    /// that file is in.
    pub untyped_import_files: ArenaFew<'s, (Atom, Option<Atom>)>,
    /// For `GetPackagesMap`: `PackageId.Name` of the resolutions of the file that have one, and
    /// whether `Extension` is `.d.ts`.
    pub resolved_packages: ArenaFew<'s, (Atom, bool)>,
    /// `AlternateResult` for those of `untyped_imports` that have one: the file with the types that
    /// is found if the `exports` of the package are ignored.
    pub untyped_import_alternates: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// `GetResolutionDiagnostic`, `needJsx`: the specifiers that resolve to a `.tsx` or `.jsx` file
    /// while `jsx` isn't set, with the mode they are resolved in and `ResolvedFileName`. The file
    /// isn't added to the program because of them (6142).
    pub jsx_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// `GetResolutionDiagnostic`, `needResolveJsonModule`: the specifiers that resolve to a JSON
    /// file without `resolveJsonModule`, with the mode they are resolved in and
    /// `ResolvedFileName`. They resolve to no file (7042).
    pub json_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// `ResolvedUsingTsExtension`: the specifiers that resolve through a TypeScript extension
    /// written in the specifier itself, with the mode they are resolved in.
    pub ts_extension_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// `GetResolutionDiagnostic`: the specifiers that resolve to a `.d.css.ts` file or the like
    /// without `allowArbitraryExtensions`, with the mode they are resolved in. They resolve to no
    /// file (6263).
    pub arbitrary_extension_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// For each of `arbitrary_extension_imports`: `ResolvedFileName`.
    pub arbitrary_extension_files: ArenaFew<'s, Atom>,
    /// The relative specifiers without an extension, under Node-style module resolution, which
    /// requires one for `import`; and `getSuggestedImportExtension`, if a candidate file exists.
    pub extensionless_imports: ArenaFew<'s, (Atom, Option<&'static [u8]>)>,
    /// `ResolvedFileName` for the `imports` that resolve to a different file than the one in the
    /// program: a duplicate of a package file (the program has the copy that's kept) or a source of
    /// a referenced project (the program has its declaration file). Also for the `imports` whose
    /// `ResolvedFileName` isn't normalized.
    pub redirected_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// The `imports` that resolve to a referenced project's declaration file, for which the source is loaded instead.
    pub project_reference_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// The specifiers that resolve to a source of a referenced project whose declaration file
    /// isn't in the program, with `OutputDts` and `ResolvedFileName`. They resolve to no file
    /// (6305).
    pub unbuilt_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom, Atom)>,
    /// `outputFileToProjectReferenceSource`: a name of the source of a referenced project whose
    /// task was redirected to it. `NONE`: the program has no task for its source.
    pub project_reference_source: Atom,
    /// `GetRedirectForResolution`: the options of the referenced project it belongs to, as a
    /// source or as the declaration file that is read in place of one.
    pub redirect_for_resolution: Option<&'s Options>,
    /// The files it refers to, in order of reference: `/// <reference>`s, then imports.
    pub edges: &'s [FileId],
    /// `IsSourceFileFromExternalLibrary`: `lowestDepth > 0`, meaning every task for it was reached
    /// through a step into a `node_modules`.
    pub is_from_external_library: bool,
    /// No file refers to it, and it adds no globally visible declarations. So only the task that
    /// checks it reads its HIR, which is freed at the end of that task (`Files::free_tree`), and
    /// nothing that mentions one of its nodes is published.
    pub is_leaf: bool,
    /// It adds no globally visible declarations, so it `is_leaf` if no file refers to it.
    adds_no_globals: bool,
    /// True if only files that import this module can refer to its declarations. Neither the module nor any file that
    /// imports it, directly or through other files, is a script or declares a global, an ambient module, a module
    /// augmentation or a UMD global.
    pub(crate) is_closed: bool,
    /// True if it contains a conditional or a mapped type node.
    has_conditional_or_mapped_type: bool,
    /// Result of `count_identifiers`, copied into `Files::sizes`.
    identifiers: u32,
}

/// Entry in the list of all modules. A `Module` is thousands of bytes, so it's boxed in the arena of the thread that
/// loaded it and never moved. The `UnsafeCell` lets `Files::free_tree` mutate it through `&Files`.
pub struct ModuleCell<'s>(std::cell::UnsafeCell<ArenaBox<'s, Module<'s>>>);

// SAFETY: a module is only mutated through `&mut Files`, or by `Files::free_tree`.
unsafe impl Sync for ModuleCell<'_> {}

impl<'s> std::ops::Deref for ModuleCell<'s> {
    type Target = Module<'s>;
    #[inline(always)]
    fn deref(&self) -> &Module<'s> {
        // SAFETY: see above.
        unsafe { &*self.0.get() }
    }
}

impl<'s> std::ops::DerefMut for ModuleCell<'s> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut Module<'s> {
        self.0.get_mut()
    }
}

/// Held while tasks on the I/O threads and tasks on the host's threads wait for each other. Both
/// pools are bounded and process-wide. With two loads in flight, one load's readers could fill one
/// pool and the other load's processors the other pool, and then each would wait for tasks that
/// never start. Everything else that runs on the pools finishes without waiting.
static WAITS_ACROSS_POOLS: Guarded<()> = Guarded::new(());

/// Returns the stub that replaces a file's HIR when it's freed. The text is retained for the report.
fn stub_of<'s>(hir: &mut hir::File<'s>) -> hir::File<'s> {
    hir::File {
        text: std::mem::take(&mut hir.text),
        kind: hir.kind,
        is_js: hir.is_js,
        source_len: hir.source_len,
        has_module_syntax: hir.has_module_syntax,
        is_forced_module: hir.is_forced_module,
        has_errors: hir.has_errors,
        ran_out_of_stack: hir.ran_out_of_stack,
        has_parse_diagnostics: hir.has_parse_diagnostics || hir.has_parse_or_grammar_diagnostics(),
        ..hir::File::empty_in(hir.arena(), hir.lazy.session)
    }
}

impl<'s> Module<'s> {
    /// `FileName()`: the file's name, as spelled where `collectFiles` first reaches it.
    #[inline]
    pub fn file_name(&self) -> &'s [u8] {
        self.path.pretty
    }
}

impl Module<'_> {
    /// True if its top-level declarations are local to it.
    pub fn is_module(&self) -> bool {
        self.hir.has_module_syntax || self.is_commonjs()
    }

    /// True for JavaScript that contains `require(..)`, `module.exports = ..` or `exports.a = ..`,
    /// and has neither imports nor exports.
    pub fn is_commonjs(&self) -> bool {
        self.bound.commonjs_indicator.is_some()
    }
}

/// `ast.SymbolTable`. Iteration is in insertion order, which is the same in every run.
pub struct SymbolMap<'s> {
    entries: ArenaVec<'s, (Atom, Sym)>,
    /// The index of a name in `entries`.
    index_by_name: ArenaHashMap<'s, Atom, u32>,
}

impl<'s> SymbolMap<'s> {
    /// Only the thread that owns `arena` may add to it.
    pub fn new_in(arena: &'s Arena) -> SymbolMap<'s> {
        SymbolMap {
            entries: ArenaVec::new_in(arena),
            index_by_name: map_in(arena),
        }
    }

    /// Allocates once, using the size hint of `symbols`.
    pub fn from_iter_in(
        symbols: impl IntoIterator<Item = (Atom, Sym)>,
        arena: &'s Arena,
    ) -> SymbolMap<'s> {
        let symbols = symbols.into_iter();
        let count = symbols.size_hint().0;
        let mut table = SymbolMap {
            entries: ArenaVec::with_capacity_in(count, arena),
            index_by_name: ArenaHashMap::with_capacity_and_hasher_in(count, FxBuild, arena),
        };
        for (name, symbol) in symbols {
            table.insert(name, symbol);
        }
        table
    }

    pub fn get(&self, name: Atom) -> Option<&Sym> {
        let entry_index = *self.index_by_name.get(&name)?;
        Some(&self.entries[entry_index as usize].1)
    }

    pub fn contains_key(&self, name: Atom) -> bool {
        self.index_by_name.contains_key(&name)
    }

    pub fn insert(&mut self, name: Atom, symbol: Sym) {
        match self.index_by_name.get(&name).copied() {
            Some(entry_index) => self.entries[entry_index as usize].1 = symbol,
            None => {
                self.index_by_name.insert(name, self.entries.len() as u32);
                self.entries.push((name, symbol));
            }
        }
    }

    /// `extendExportSymbols` without a lookup table: adds the entries of `source` whose names are
    /// not in the table.
    fn extend_with_missing(&mut self, source: &SymbolMap<'_>) {
        for &(name, symbol) in source.iter() {
            if !self.contains_key(name) {
                self.insert(name, symbol);
            }
        }
    }
}

impl std::ops::Deref for SymbolMap<'_> {
    type Target = [(Atom, Sym)];
    fn deref(&self) -> &[(Atom, Sym)] {
        &self.entries
    }
}

/// A name in `Files::globals`.
pub struct GlobalName {
    pub name: Box<[u8]>,
    pub is_value: bool,
    /// A type or a namespace.
    pub is_type: bool,
    /// A `var` or a `let` declares it in one of the project's own files. Libraries and packages
    /// write `declare var` for nearly everything, so there it means nothing.
    pub is_writable: bool,
}

/// A table that `NameResolver.Resolve` searches.
#[derive(Copy, Clone)]
pub enum SymbolTable {
    /// `location.Locals()`
    Locals(FileId, ScopeId),
    /// `symbol.Exports`
    Exports(Sym),
    Globals,
}

/// The lookups `resolveEntityName` needs for the symbols it visits. The symbol tables implement
/// them as far as they can, and the checker implements them where the answer depends on types.
pub trait EntityNameLookup {
    /// `getSymbol`, given the table's entry.
    fn get_symbol(&mut self, table_entry: Option<Sym>, meaning: SymFlags) -> Option<Sym>;

    /// `resolveAlias`. `None`: `unknownSymbol`.
    fn resolve_alias(&mut self, alias: Sym) -> Option<Sym>;
}

/// `filesByPath`
pub struct ByPath<'s> {
    /// By `Path::text`.
    files: ArenaHashMap<'s, &'s [u8], FileId>,
    is_case_sensitive: bool,
}

impl ByPath<'_> {
    /// The file with this name, in any spelling that the file system treats as the same.
    pub fn get(&self, file_name: &[u8]) -> Option<FileId> {
        if self.is_case_sensitive {
            return self.files.get(file_name).copied();
        }
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(file_name, false, &mut buffer[..]);
        self.files.get(&path[..]).copied()
    }

    pub fn contains(&self, file_name: &[u8]) -> bool {
        self.get(file_name).is_some()
    }
}

/// Used instead of a file of the program for a related location in the configuration file.
pub const IN_CONFIGURATION: FileId = FileId(u32::MAX - 1);

pub struct Files<'s> {
    session: &'s Session,
    /// The arena of the thread that runs `load`. The tables below live in it, and only that thread
    /// adds to them, since every method that does takes `&mut self`.
    arena: &'s Arena,
    pub atoms: Interner<'s>,
    pub options: &'s Options,
    pub modules: ArenaVec<'s, ModuleCell<'s>>,
    pub by_path: ByPath<'s>,

    pub globals: SymbolMap<'s>,
    /// `globalThisSymbol`: a module symbol that no file declares, which is in `globals` and whose
    /// `Exports` are `globals`. A symbol of the first file.
    pub global_this_symbol: Sym,
    /// `undefinedSymbol`: a property symbol that no file declares. It is in `globals` unless a file
    /// declares the name there.
    pub undefined_symbol: Sym,
    /// `unknownSymbol`: the target of an alias that can't be resolved. It isn't in any table.
    pub unknown_symbol: Sym,
    /// `CommonSourceDirectory` without its trailing `/`, if an output path depends on it.
    pub common_source_directory: Option<&'s [u8]>,
    /// `UseCaseSensitiveFileNames`
    pub is_case_sensitive: bool,
    /// `prototypeSymbol` of `bindClassLikeDeclaration`: the property `symbol.Exports["prototype"]`
    /// of a class, which has no declaration.
    /// Shared by all classes.
    pub prototype_symbol: Sym,
    ambient_modules: ArenaHashMap<'s, Atom, Sym>,
    /// `declare module "*.svg"`
    ambient_patterns: ArenaVec<'s, (&'s [u8], &'s [u8], Sym)>,
    /// Indexes into `ambient_patterns`, bucketed by the last byte of the text after the `*`. Bucket 256 is for patterns
    /// that end with the `*`. A specifier ending in byte `b` can only match patterns in buckets `b` and 256. Empty
    /// until all patterns are known.
    ambient_patterns_by_end: &'s [&'s [u32]],
    /// `patternAmbientModuleAugmentations`: keyed by the declared name, the symbol that `declare
    /// module "a.svg"` in a module creates from `declare module "*.svg"`.
    pattern_augmentations: ArenaHashMap<'s, Atom, Sym>,
    /// `mergedSymbols`
    merged_symbols: ArenaHashMap<'s, Sym, Sym>,
    /// `symbol.Declarations` of a transient symbol: the binder symbols that hold them, in merge
    /// order.
    merged_parts: ArenaHashMap<'s, Sym, ArenaVec<'s, Sym>>,
    /// Only used during the symbol merge: see `redirect_name_to`.
    placeholders: ArenaVec<'s, (Sym, SymbolId)>,
    /// The exports of a module or a namespace that couldn't merge with the export of the same name
    /// in another declaration.
    rejected_exports: ArenaHashSet<'s, Sym>,
    /// `symbol.Exports` of a transient symbol.
    merged_exports: ArenaHashMap<'s, Sym, SymbolMap<'s>>,
    /// `symbol.Members` of a transient symbol.
    merged_members: ArenaHashMap<'s, Sym, SymbolMap<'s>>,
    pub rejected_merges: ArenaVec<'s, RejectedMerge<'s>>,
    /// `mergeModuleAugmentation`: the symbols of the augmentations whose module resolved to a
    /// non-module entity at the time (2671).
    pub augmentations_of_non_modules: ArenaVec<'s, Sym>,
    /// The files that declare one of `rejected_merges`. Filled by `link`.
    files_with_rejected_merges: ArenaHashSet<'s, FileId>,
    /// The aliases `resolveAlias` found to be circular (2303) while `mergeSymbol` resolved the target of a merge. Their
    /// `aliasTarget` stays `unknownSymbol`, even if the merge breaks the cycle.
    pub circular_at_merge: ArenaVec<'s, Sym>,
    /// The aliases that `mergeSymbol` resolved so that it could merge into their target, with the
    /// links they got then. `aliasTarget` has since become a part of a merged symbol
    /// (`cloneSymbol`), and `resolveAlias` doesn't call `getMergedSymbol`.
    resolved_at_merge: ArenaVec<'s, (Sym, AliasSymbolLinks)>,
    /// `moduleSymbolLinks` of the modules whose exports `getExportsOfModule` resolved during the
    /// symbol merge, for an alias that `mergeSymbol` resolved. `resolvedExports` is a copy of the
    /// tables at that point: a name that a later augmentation adds to the module isn't in it, and
    /// is 2305 for an import. At the end of the merge they move to `Memo::module_links`.
    module_links_at_merge: Guarded<ArenaVec<'s, (Sym, ModuleSymbolLinks<'s>)>>,
    /// The modules of `module_links_at_merge`.
    modules_resolved_at_merge: &'s [Sym],
    /// `module_links_at_merge` is being filled.
    records_module_links: bool,
    /// The modules with one of `ModuleSymbolLinks::export_collisions` in another file. Filled by
    /// `link`.
    pub modules_with_nested_export_collisions: &'s [Sym],
    /// Sorted by file and identifier. The runs for one identifier are in the order they began. Filled by `link`.
    failed_lookups: &'s [FailedLookup<'s>],
    /// `symbol.Parent` of a transient symbol, where `mergeSymbolTable` has set it to a symbol of
    /// another file.
    parents_in_other_files: ArenaHashMap<'s, Sym, Sym>,

    /// Some file contains `export type * from`.
    has_type_only_stars: bool,

    /// `aliasSymbolLinks`. Filled by `link`.
    alias_symbol_links: ByNodeIndirect<Sym, AliasSymbolLinks, Frozen, &'s Session>,
    /// `link` has run: every table is filled, and nothing is mutated from here on.
    is_linked: bool,
    /// For `module_links` of a symbol that isn't a module.
    no_module_links: ModuleSymbolLinks<'s>,
    /// The symbol merge is done: symbols no longer change.
    is_merged: bool,
    /// Some alias has a `combined_symbol`.
    has_symbols_to_combine: bool,
    memo: Memo<'s>,
    /// The file order in which declarations of one symbol in several files are considered: it
    /// determines the order of overloads.
    pub order: &'s [FileId],
    /// The index of each file in `order`, indexed by `FileId`.
    ranks: &'s [u32],
    /// The components of the import graph, which is the `edges` and `imports` of every file in `order`.
    pub components: Components<'s>,
    /// `global_type` of every name below `known::sym_iterator`, indexed by atom number.
    global_types: &'s [GlobalType],
    /// The global `Array` or `ReadonlyArray` declares a member whose name begins with a digit. Only
    /// then can `T[][0]` be anything but `T`.
    pub arrays_have_numeric_members: bool,
    /// Errors in what the options refer to, not attributable to any file.
    program_errors: &'s [Problem],
    /// `GetIncludeProcessorDiagnostics`: errors about the inclusion of a file in the program,
    /// reported at the reference in another file. Each has that file and the span.
    include_errors: &'s [(FileId, u32, u32, Problem)],
    /// The `package.json` of each `node_modules` package that contains a file of the program, and
    /// the one in `Module::package_json_directory` of each file, keyed by its directory.
    /// Declaration files and messages need module specifiers from their `exports` and `imports`.
    pub package_jsons: ArenaHashMap<'s, &'s [u8], &'s Json>,
    /// `DirectoriesByRealpath`: each directory that is known to be a symlink target, with a symlink
    /// to it, in order. The `package.json` of each is in `package_jsons` under the path of the
    /// symlink.
    pub linked_directories: &'s [(&'s [u8], &'s [u8])],
    /// `redirectTargetsMap`: the paths of the duplicates of a package file, for which that file is
    /// in the program, in order.
    pub redirect_targets: ArenaHashMap<'s, FileId, &'s [&'s [u8]]>,
    /// (identifier expressions, type nodes) of each file, indexed by `FileId`. Used to estimate how much a file costs
    /// to check.
    pub sizes: &'s [(u32, u32)],
    /// The `traceResolution` log, in order.
    pub resolution_trace: &'s [DiagAndArgs],
    /// The fields of `Included` that come from `load`, saved for `explain_files`.
    starts: &'s [FileId],
    libs_end: usize,
    roots_end: usize,
    root_of_start: &'s [u32],
    /// `redirectFilesByPath`, in the order `collectFiles` reaches them: the name of a copy of a
    /// package file, and the copy that's in the program.
    package_copies: &'s [(&'s [u8], FileId)],
    /// `Included::explained_in_diagnostics` for the errors that `load` produced.
    explained_in_diagnostics: &'s [Vec<u8>],
}

/// `Files::global_type`
#[derive(Copy, Clone)]
struct GlobalType {
    /// `getGlobalTypeSymbol`
    symbol: Option<Sym>,
    /// The number of its type parameters. `u8::MAX`: it isn't a class or interface.
    arity: u8,
}

/// Results derived from the symbol merge. `whole` is filled at the end of the merge, the others by
/// `link`. Until the merge has ended the tables have zero capacity, so nothing is stored.
struct Memo<'s> {
    /// Maps each `MERGED` symbol to the symbol it's a part of, which may be itself.
    whole: ByNode<Sym, Option<Sym>, Frozen, &'s Session>,
    /// `symbol_flags` of an alias, with `FLAGS_KNOWN` set.
    symbol_flags: ByNode<Sym, RawWord, Frozen, &'s Session>,
    /// The declarations of a symbol that has several.
    decls: ByNodeIndirect<Sym, &'s [(FileId, Decl)], Frozen, &'s Session>,
    /// `moduleSymbolLinks`
    module_links: ByNodeIndirect<Sym, ModuleSymbolLinks<'s>, Frozen, &'s Session>,
}

/// `ExportCollision`, one for each of its `exportsWithDuplicate`: 2308.
#[derive(Copy, Clone, Debug)]
pub struct ExportCollision {
    /// The `export *` that exports `name` again.
    pub duplicate: (FileId, StmtId),
    /// The `export *` that exported it first. `specifierText` is its specifier.
    pub first: (FileId, StmtId),
    pub name: Atom,
    /// `targetSymbol` and `sourceSymbol`, set when only types can tell whether both `resolveSymbol`
    /// to the same symbol (`Resolve::may_need_types_to_resolve`). If they do, there's no error.
    pub symbols: Option<(Sym, Sym)>,
}

/// `ModuleSymbolLinks`. Allocated in the arena of the thread that computes them.
pub struct ModuleSymbolLinks<'s> {
    /// `getMergedSymbol` of each entry of `resolvedExports`. During the symbol merge, the entries themselves.
    pub resolved_exports: SymbolMap<'s>,
    /// The entries of `resolvedExports` that aren't their own merged symbol.
    unmerged_exports: &'s [(Atom, Sym)],
    /// `typeOnlyExportStarMap`: the `export type *`.
    pub type_only_export_star_map: ArenaHashMap<'s, Atom, (FileId, StmtId)>,
    /// The errors `getExportsOfModuleWorker` reports, for the `export *` declarations of the module and of every module
    /// that `visit` reaches from there. A module that was already visited exports nothing the second time, so these
    /// aren't the errors that module would get on its own.
    pub export_collisions: &'s [ExportCollision],
}

impl<'s> ModuleSymbolLinks<'s> {
    /// The links of a symbol that exports nothing. Doesn't allocate.
    fn empty_in(arena: &'s Arena) -> ModuleSymbolLinks<'s> {
        ModuleSymbolLinks {
            resolved_exports: SymbolMap::new_in(arena),
            unmerged_exports: &[],
            type_only_export_star_map: map_in(arena),
            export_collisions: &[],
        }
    }

    /// `resolvedExports[name]`
    fn export_in_table(&self, name: Atom) -> Option<Sym> {
        let unmerged = self.unmerged_exports.iter().find(|entry| entry.0 == name);
        match unmerged {
            Some(entry) => Some(entry.1),
            None => self.resolved_exports.get(name).copied(),
        }
    }
}

/// The state of `getExportsOfModuleWorker` while `visit` traverses the modules.
struct ExportsVisit<'s> {
    /// For the tables that `visit` returns.
    arena: &'s Arena,
    visited_symbols: Vec<Sym>,
    non_type_only_names: FxHashSet<Atom>,
    /// Becomes `ModuleSymbolLinks::type_only_export_star_map`.
    type_only_export_star_map: ArenaHashMap<'s, Atom, (FileId, StmtId)>,
    export_collisions: Vec<ExportCollision>,
}

/// Not a symbol flag.
const FLAGS_KNOWN: u32 = 1 << 31;

impl<'s> Memo<'s> {
    fn new_in(symbols: &Bases<&'s Session>, session: &'s Session) -> Memo<'s> {
        Memo {
            whole: ByNode::new_in(symbols, session),
            symbol_flags: ByNode::new_in(symbols, session),
            decls: ByNodeIndirect::new_in(symbols, session),
            module_links: ByNodeIndirect::new_in(symbols, session),
        }
    }
}

/// `Files::each_export`. One of the two lists is empty.
struct Exports<'a, 's> {
    files: &'a Files<'s>,
    file: FileId,
    /// As produced by the binder.
    own: std::slice::Iter<'a, (Atom, SymbolId)>,
    merged: std::slice::Iter<'a, (Atom, Sym)>,
    /// Yields the symbols as they are in the table. Otherwise yields `getMergedSymbol` of each.
    is_as_in_table: bool,
}

impl Iterator for Exports<'_, '_> {
    type Item = (Atom, Sym);
    #[inline]
    fn next(&mut self) -> Option<(Atom, Sym)> {
        match self.own.next() {
            Some(&(name, id)) if self.is_as_in_table => {
                let file = self.file;
                Some((name, Sym { file, id }))
            }
            Some(&(name, id)) => Some((name, self.files.sym(self.file, id))),
            None => match self.merged.next() {
                Some(&(name, symbol)) if !self.is_as_in_table => {
                    Some((name, self.files.canonical(symbol)))
                }
                merged => merged.copied(),
            },
        }
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let left = self.own.len() + self.merged.len();
        (left, Some(left))
    }
}

impl ExactSizeIterator for Exports<'_, '_> {}

/// A resolved entry of `resolutionsInFile`, and what the loader does with it.
#[derive(Copy, Clone)]
struct Resolution<'r> {
    spec: Atom,
    mode: ResolutionMode,
    /// The file `parseTask.load` reads for `ResolvedFileName`: `getParseFileRedirect` of it, or else the file itself.
    path: &'r [u8],
    /// `path`'s number from `prefetch_files`, or `NOT_NUMBERED`.
    number: u32,
    /// `shouldAddFile`, and there is a file to read.
    should_add_file: bool,
    /// `increaseDepth`
    increases_depth: bool,
    /// `packageId` of the task for `path`. `redirectedParseTask` has none.
    package_id: Option<PackageId<'r>>,
    /// `resolveExternalModule` calls `GetSourceFileForResolvedModule` for it. Otherwise it resolves
    /// to no file, even if the file is in the program.
    is_importable: bool,
    /// The error of `parseTask.load` for an extension that the program doesn't support. The file isn't read.
    unsupported_extension: Option<UnsupportedExtension>,
}

/// `Resolution::number` of a path that `prefetch_files` didn't number. It numbers each distinct path it
/// encounters, so equal numbers mean identical bytes. The loader threads compare paths anyway to
/// find new files. The single thread that assigns file ids then only has to compare numbers.
const NOT_NUMBERED: u32 = u32::MAX;

/// Data that `Files::load` records about a module while finishing it. A list of these is small enough to walk on one
/// thread.
struct ModuleSummary<'s> {
    file_name: &'s [u8],
    package_json_directory: Atom,
    /// `source_file_may_be_emitted`
    may_be_emitted: bool,
    /// Hash of the lowercased file name. 0 on a case-insensitive file system, where it isn't used.
    hash_of_name: u64,
    /// Length of `Bound::symbols`.
    symbols: usize,
    /// `identifiers` and `type_nodes` become the file's entry in `Files::sizes`.
    identifiers: u32,
    type_nodes: u32,
    edges: &'s [FileId],
    is_lib: bool,
    /// `edges`, followed by the files it imports.
    targets: Vec<FileId>,
    /// Sources of referenced projects that it imports, each with the declaration file that's read instead.
    built_imports: Vec<(Atom, FileId)>,
    /// The module is a leaf (`Module::is_leaf`) unless a file refers to it, or it imports from an ambient module that
    /// re-exports from a relative name.
    may_be_leaf: bool,
    /// It declares globals or ambient modules, or augments them.
    declares_globals: bool,
}

/// (`Files::package_jsons`, `Files::linked_directories`)
type PackageTables<'s> = (
    ArenaHashMap<'s, &'s [u8], &'s Json>,
    &'s [(&'s [u8], &'s [u8])],
);

#[derive(Copy, Clone)]
struct UnsupportedExtension {
    code: u32,
    /// The first specifier in the file that is resolved like this, if there is one.
    span: Option<(u32, u32)>,
}

/// `parse_and_bind`'s result for a package file. It's the same for every copy of the file that has the same text.
struct Parse<'s> {
    hir: hir::File<'s>,
    bound: Bound<'s>,
    /// It's shared with the other programs of the `Run`, and `rename_private_names` has already run.
    is_shared: bool,
}

/// Everything `parse_and_bind` takes for a file besides its path and its text.
#[derive(Copy, Clone, PartialEq, Eq)]
struct ParseKey {
    options: ParseOptions,
    script_kind: Option<ScriptKind>,
    is_lib: bool,
    specifies_esm: bool,
    /// `Host::origin`
    origin: usize,
}

/// State shared by the programs of one request: the names, and each file parsed and bound once. Two
/// programs share a file if its path and its `ParseKey` are equal. It's read once, since a file
/// doesn't change during a request. The programs may run concurrently.
pub struct Run<'u> {
    session: &'u Session,
    /// `Interner::in_common`
    atoms: Interner<'u>,
    /// By path. The last element is true if the file couldn't be read: see `Host::read_source`.
    parsed: ShardedMap<Vec<u8>, Guarded<Vec<(ParseKey, &'u Parse<'u>, bool)>>>,
    /// The paths (`tspath.Path`) whose text differs from what's on disk. They're parsed separately for each program.
    provided: FxHashSet<Vec<u8>>,
    /// Only declaration files are shared. Every other file is parsed for each program and freed with it.
    only_declaration_files: bool,
    parses: AtomicUsize,
    bytes: AtomicUsize,
    /// The first `Host::origin` number that isn't taken.
    origins: AtomicUsize,
}

impl<'u> Run<'u> {
    pub fn new(session: &'u Session, provided: FxHashSet<Vec<u8>>) -> Run<'u> {
        Run {
            session,
            atoms: Interner::in_common(session),
            parsed: ShardedMap::default(),
            provided,
            only_declaration_files: false,
            parses: AtomicUsize::new(0),
            bytes: AtomicUsize::new(0),
            origins: AtomicUsize::new(1),
        }
    }

    /// Makes the programs share only declaration files.
    pub fn sharing_only_declaration_files(self) -> Run<'u> {
        Run {
            only_declaration_files: true,
            ..self
        }
    }

    /// Reserves `count` numbers for `Host::origin` that no other host of the request uses, and returns the first.
    pub fn origins(&self, count: usize) -> usize {
        self.origins.fetch_add(count, Ordering::Relaxed)
    }

    /// Bytes allocated for the parsed files.
    pub fn bytes(&self) -> usize {
        self.bytes.load(Ordering::Relaxed)
    }

    /// How many files have been parsed.
    pub fn parses(&self) -> usize {
        self.parses.load(Ordering::Relaxed)
    }

    /// True if the file at `path` is shared by all programs.
    fn has_file(&self, host: &dyn Host, path: &[u8]) -> bool {
        let is_shared = !self.only_declaration_files
            || crate::resolve::is_declaration_file_name(path) && host.script_kind(path).is_none();
        is_shared
            && (self.provided.is_empty()
                || !(self.provided).contains(&*to_path(path, host.is_case_sensitive())))
    }

    /// True if `parse` may be able to answer for `path` without its text.
    fn has(&self, path: &[u8]) -> bool {
        self.parsed.get_ref(path).is_some()
    }

    fn parse(
        &self,
        host: &dyn Host,
        path: &[u8],
        key: ParseKey,
        text: Option<Cow<'static, [u8]>>,
    ) -> &'u Parse<'u> {
        let path_parses = match self.parsed.get_ref(path) {
            Some(path_parses) => path_parses,
            None => self
                .parsed
                .insert_ref(path.to_vec(), Guarded::new(Vec::new())),
        };
        // Held until the file is parsed, so a program that reaches it at the same time waits.
        let mut path_parses = path_parses.lock();
        if let Some(found) = path_parses.iter().find(|it| it.0 == key) {
            // Each program has to report the unreadable file, so this host's read has to fail too.
            if found.2 && text.is_none() && self.only_declaration_files {
                host.read_source(path);
            }
            return found.1;
        }
        self.parses.fetch_add(1, Ordering::Relaxed);
        let arena = self.session.arena();
        // Only this thread allocates in it.
        let before = arena.allocated_bytes();
        let text = text.unwrap_or_else(|| host.read_source(path));
        let is_unreadable = text.is_empty() && host.read(path).is_none();
        let (mut hir, bound) = Files::parse_and_bind(
            arena,
            host,
            key.options,
            &self.atoms,
            path,
            key.is_lib,
            key.specifies_esm,
            text,
        );
        rename_private_names(&mut hir, &bound, &self.atoms, path);
        // Nothing ever drops the `Parse`.
        keep_list(self.session, &mut hir.text);
        keep_list(self.session, &mut hir.diagnostics);
        keep_list(self.session, &mut hir.jsdoc_member_comments);
        keep_list(self.session, &mut hir.jsdoc_param_errors);
        let parse: &'u Parse<'u> = arena.alloc(Parse {
            hir,
            bound,
            is_shared: true,
        });
        path_parses.push((key, parse, is_unreadable));
        let more = arena.allocated_bytes().saturating_sub(before);
        self.bytes.fetch_add(more, Ordering::Relaxed);
        parse
    }
}

/// Moves an owned `list` into the session and borrows it back. The list is heap-allocated and a
/// program's files are never dropped, so it would leak otherwise.
fn keep_list<'s, T: Clone + Send + Sync + 'static>(session: &'s Session, list: &mut Cow<'s, [T]>) {
    if let Cow::Owned(owned) = list
        && !owned.is_empty()
    {
        *list = Cow::Borrowed(session.keep(std::mem::take(owned)));
    }
}

/// `'r`: the paths belong to the `Resolver`.
struct Loaded<'s, 'r> {
    /// Without `hir` and `bound` if `parse` has them. Boxed because it's large and moves from list to list.
    module: ArenaBox<'s, Module<'s>>,
    /// Argument for `Prefetch::take_parse`: the `Parse` it shares with the other copies of the file.
    parse: Option<u32>,
    imports: Vec<Resolution<'r>>,
    /// (path, is a lib, `increaseDepth`, `packageId`)
    references: Vec<(&'r [u8], bool, bool, Option<PackageId<'r>>)>,
    /// `Resolution::number` for each of `references`. Empty if they aren't numbered.
    reference_numbers: Vec<u32>,
    /// The `/// <reference lib>` to a library that's replaced by a file with an extension that the program doesn't
    /// support: its span, the file, and the error of `parseTask.load`. The file isn't read.
    unsupported_libs: Vec<(u32, u32, &'r [u8], u32)>,
    /// `typeResolutionsTrace`
    type_resolutions_trace: Vec<DiagAndArgs>,
    /// `resolutionsTrace`
    resolutions_trace: Vec<DiagAndArgs>,
}

/// A file for `Files::prefetch_files` to load.
#[derive(Copy, Clone)]
struct ToLoad<'r> {
    path: &'r [u8],
    is_lib: bool,
    /// Index of its `PackageId` in `PrefetchState::slots`.
    package: Option<u32>,
}

/// `Files::prefetch_files`'s state for all copies of one package file.
enum ParseSlot<'s, 'r> {
    /// A thread is parsing one copy. These other copies were read in the meantime. They're moved
    /// back to `ready` when the parse is done.
    InProgress(Vec<(ToLoad<'r>, Option<Cow<'static, [u8]>>)>),
    Done {
        parse: Arc<Parse<'s>>,
        specifies_esm: bool,
        path: &'r [u8],
    },
}

/// The module names of a file that has many, for `Files::prefetch_files`. A barrel file can name ten thousand modules, and none
/// of their files is known until its names are resolved. So the threads that have nothing to load resolve some of them,
/// which fills the resolver's cache. The thread that loads the file then finds them there.
struct NamesToResolve<'r> {
    /// The file.
    path: &'r [u8],
    names: Vec<(Atom, ResolutionMode)>,
    /// The index of the first name that no thread has taken.
    next: AtomicUsize,
}

struct PrefetchState<'s, 'r> {
    to_resolve: Vec<Arc<NamesToResolve<'r>>>,
    to_read: std::collections::VecDeque<ToLoad<'r>>,
    /// Files that have been read, with their text. The text is `None` if the run already has the
    /// file (see `Run::has`).
    ready: Vec<(ToLoad<'r>, Option<Cow<'static, [u8]>>)>,
    /// Maps each path to its `Resolution::number`: 0, 1, .. in the order the paths are first seen.
    seen: FxHashMap<&'r [u8], u32>,
    /// Number of files taken from `to_read` that aren't in `done` yet.
    in_progress: usize,
    done: FxHashMap<&'r [u8], Box<Loaded<'s, 'r>>>,
    /// Maps `PackageId.String` to an index in `slots`.
    by_package_id: FxHashMap<Vec<u8>, u32>,
    slots: Vec<Option<ParseSlot<'s, 'r>>>,
}

impl PrefetchState<'_, '_> {
    /// True if there's nothing more to load and no thread is loading. Once true it stays true, because only a thread
    /// that's loading a file can find more files.
    fn is_done(&self) -> bool {
        self.in_progress == 0 && self.to_read.is_empty()
    }
}

/// The files that `Files::prefetch_files` loads. One thread consumes them in the order in which they refer
/// to each other. It can start before the last file is loaded.
///
/// That thread gets the same answers no matter when it asks. A loaded file stays until it's taken, and a file is only
/// reported as not loaded once all files are loaded.
struct Prefetch<'s, 'r> {
    state: Guarded<PrefetchState<'s, 'r>>,
    /// Wakes the threads that process files, when a file is ready or all files are loaded.
    has_work: bun_threading::Condvar,
    /// Wakes the threads that only read. It's a separate condvar because they can't do anything
    /// with a ready file.
    has_to_read: bun_threading::Condvar,
    /// Wakes the thread that calls `take`, and only that thread, when a file is loaded or all files are. If it waited
    /// on `has_work`, it could consume the single wake-up for a ready file, and that file would never be processed.
    has_loaded: bun_threading::Condvar,
}

impl<'s, 'r> Prefetch<'s, 'r> {
    /// Each seed is (path, is a lib).
    fn new(seeds: Vec<(&'r [u8], bool)>) -> Prefetch<'s, 'r> {
        let mut seen: FxHashMap<&'r [u8], u32> = FxHashMap::default();
        for seed in &seeds {
            let next = seen.len() as u32;
            seen.entry(seed.0).or_insert(next);
        }
        Prefetch {
            state: Guarded::new(PrefetchState {
                to_resolve: Vec::new(),
                seen,
                to_read: (seeds.into_iter())
                    .map(|(path, is_lib)| ToLoad {
                        path,
                        is_lib,
                        package: None,
                    })
                    .collect(),
                ready: Vec::new(),
                in_progress: 0,
                done: FxHashMap::default(),
                by_package_id: FxHashMap::default(),
                slots: Vec::new(),
            }),
            has_work: bun_threading::Condvar::new(),
            has_to_read: bun_threading::Condvar::new(),
            has_loaded: bun_threading::Condvar::new(),
        }
    }

    fn is_done(&self) -> bool {
        self.state.lock().is_done()
    }

    /// Blocks until all files are loaded.
    fn wait(&self) {
        let mut state = self.state.lock();
        while !state.is_done() {
            self.has_loaded.wait_guarded(&mut state);
        }
    }

    /// Blocks until the file at `path` is loaded, then removes and returns it. Returns `None` if
    /// `prefetch_files` doesn't load that file, or loaded it with a different `is_lib`.
    fn take(&self, path: &[u8], is_lib: bool) -> Option<Box<Loaded<'s, 'r>>> {
        let mut state = self.state.lock();
        loop {
            if let Some(loaded) = state.done.get(path) {
                return match loaded.module.is_lib == is_lib {
                    true => state.done.remove(path),
                    false => None,
                };
            }
            if state.is_done() {
                return None;
            }
            self.has_loaded.wait_guarded(&mut state);
        }
    }

    /// True if `take` would return the file. Call only after `wait`.
    fn has(&self, path: &[u8], is_lib: bool) -> bool {
        let state = self.state.lock();
        let loaded = state.done.get(path);
        loaded.is_some_and(|loaded| loaded.module.is_lib == is_lib)
    }

    /// Call only after `wait`.
    fn insert(&self, path: &'r [u8], loaded: Box<Loaded<'s, 'r>>) {
        self.state.lock().done.insert(path, loaded);
    }

    /// Call only after `wait`.
    fn remove(&self, path: &[u8]) -> Option<Box<Loaded<'s, 'r>>> {
        self.state.lock().done.remove(path)
    }

    /// Removes and returns the parse in `slot`, which is a `Loaded::parse`. Call only after `wait`, when no loader
    /// thread still has a clone of the `Arc`. A parse is a few thousand bytes, and this is the first time it's moved.
    fn take_parse(&self, slot: u32) -> Option<Parse<'s>> {
        // All threads call this at the same time, so the parse is moved after the lock is released.
        let parse_slot = self.state.lock().slots[slot as usize].take();
        match parse_slot {
            Some(ParseSlot::Done { parse, .. }) => Arc::into_inner(parse),
            _ => None,
        }
    }
}

/// A file that `Files::load` has found.
#[derive(Copy, Clone)]
struct FoundFile<'s> {
    path: Path<'s>,
    is_lib: bool,
    /// `parseTaskData.packageId`, of `first`, as an index into `Found::retained_copies`.
    package: Option<u32>,
    /// `taskDataByPath`: the first task for the file, under any spelling of its name.
    first: FileId,
    /// The task that loads it reads it. Otherwise it's only read if `collectFiles` needs it.
    is_read: bool,
    /// `Loaded::parse`, until `collectFiles` has given the module its `hir` and `bound`.
    parse: Option<u32>,
    /// `parseTask.loaded`, of `first`: a task for the file has run that wasn't elided.
    is_loaded: bool,
    /// `seen` of `collectFiles`, of `first`: the task it reached first, whose spelling becomes the file's name.
    named: Option<FileId>,
}

/// One of `parseTask.subTasks`, or of `rootTasks`.
#[derive(Copy, Clone)]
struct SubTask {
    file: FileId,
    /// `increaseDepth`
    increases_depth: bool,
    /// `elideOnDepth`
    is_elided_on_depth: bool,
    /// `packageId`: `Found::package_of_task`.
    package: Option<u32>,
}

/// The bookkeeping of `Files::load` about the files it has found, besides the files themselves.
#[derive(Default)]
struct Found<'s> {
    /// By `FileId`.
    files: Vec<FoundFile<'s>>,
    /// The index in `retained_copies` for a `PackageId`.
    by_package_id: FxHashMap<Vec<u8>, u32>,
    /// `packageIdToSourceFile`: the copy of a package file that `collectFiles` reached first.
    retained_copies: Vec<Option<FileId>>,
}

impl Found<'_> {
    /// `package_id` of a task for `file`, as an index into `retained_copies`. Also `None` if the file already
    /// has an id, which it keeps.
    fn package_of_task(&mut self, file: FileId, package_id: Option<PackageId>) -> Option<u32> {
        let data = self.files[file.idx()].first;
        let id = package_id.filter(|_| self.files[data.idx()].package.is_none())?;
        let (version, peers) = (id.version, id.peer_dependencies);
        let key = [id.name, b"@", version, peers, b"/", id.sub_module_name].concat();
        let new = self.retained_copies.len() as u32;
        let index = *self.by_package_id.entry(key).or_insert(new);
        if index == new {
            self.retained_copies.push(None);
        }
        Some(index)
    }
}

/// `packageJsonInfoCache`, as far as `traceResolution` exposes it: a repeated lookup of a
/// `package.json` is logged as a cache hit. The cache fills in the order the tasks run, which isn't
/// the order `collectFiles` logs in.
#[derive(Default)]
struct PackageJsonInfoCache {
    /// By `tspath.Path`.
    cached: FxHashSet<Vec<u8>>,
    /// The directories that `GetPackageScopeForPath` has started from or walked through.
    with_scope: FxHashSet<Vec<u8>>,
}

impl PackageJsonInfoCache {
    /// `loadSourceFileMetaData`: looks for the scope of a file before anything in the file is
    /// resolved, and logs nothing.
    fn load_source_file_meta_data(&mut self, host: &dyn Host, file_name: &[u8]) {
        for dir in ancestors(dirname::<Posix>(file_name)) {
            if !self.with_scope.insert(dir.to_vec()) {
                break;
            }
            let package_json = inside(dir, b"package.json");
            let path = to_path(&package_json, host.is_case_sensitive());
            self.cached.insert(path.into_owned());
            if host.is_file(&package_json) {
                break;
            }
        }
    }

    /// `getPackageJsonInfo` for each lookup in `traces`, where all of them are logged as cache hits.
    fn get_package_json_infos(&mut self, host: &dyn Host, traces: &mut [DiagAndArgs]) {
        for trace in traces {
            let first = match trace.code {
                6239 => 6099,
                6240 => 6096,
                _ => continue,
            };
            // A candidate in a type root isn't normalized.
            let normalized = join(b"/", &trace.args[0]);
            let path = to_path(&normalized, host.is_case_sensitive());
            if self.cached.insert(path.into_owned()) {
                trace.code = first;
            }
        }
    }
}

/// `typeOnlyDeclaration`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TypeOnlyDeclaration {
    /// The alias, the file, and the alias's declaration in that file.
    Alias(Sym, FileId, Decl),
    /// The `export type *` through which a name is exported.
    ExportStar(FileId, StmtId),
}

impl TypeOnlyDeclaration {
    pub fn file(self) -> FileId {
        match self {
            TypeOnlyDeclaration::Alias(_, file, _) | TypeOnlyDeclaration::ExportStar(file, _) => {
                file
            }
        }
    }

    /// `NodeKindIs(typeOnlyDeclaration, KindExportSpecifier, KindExportDeclaration, KindNamespaceExport)`
    pub fn is_export(self) -> bool {
        !matches!(
            self,
            TypeOnlyDeclaration::Alias(
                _,
                _,
                Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ImportEquals(_)
            )
        )
    }
}

/// A `mergeSymbol(target, source)` call for two symbols that exclude each other, with a snapshot of what it reads from
/// them. It reports immediately, and later merges add flags and declarations to either symbol.
#[derive(Copy, Clone, Debug)]
pub struct RejectedMerge<'s> {
    pub target: Sym,
    pub source: Sym,
    pub target_flags: SymFlags,
    pub source_flags: SymFlags,
    /// `target.Declarations`, as `Files::parts`.
    pub target_parts: &'s [Sym],
    pub source_parts: &'s [Sym],
}

/// `AliasSymbolLinks`
#[derive(Copy, Clone, Default, Debug)]
pub struct AliasSymbolLinks {
    /// `getMergedSymbol` of the result of `getTargetOfAliasDeclaration`, which may itself be an
    /// alias. `Checker::resolve_alias` continues from it to the value: `getTypeOfAlias` has the
    /// symbol of the table, and `resolveAnonymousTypeMembers` reads the merged symbol of that.
    /// Not merged in links from the symbol merge (`Files::resolved_at_merge`).
    pub immediate_target: Option<Sym>,
    /// `aliasTarget`. `None`: `unknownSymbol`. For `import { a }` and `export { a } from` it's the
    /// symbol as stored in the module's table (`Resolve::module_export_in_table`).
    /// `resolveQualifiedName` reads that symbol's exports and `getDeclaredTypeOfSymbol` its
    /// declarations. After another alias it's a merged symbol (`resolveIndirectionAlias`).
    pub alias_target: Option<Sym>,
    pub type_only_declaration: Option<TypeOnlyDeclaration>,
    /// `resolveAlias` reports 2303 at the declaration of the alias.
    pub is_circular: bool,
    /// The stack ran out while the alias was in progress, where Go's would grow. It's marked `is_circular`, which it
    /// may be, and its file is reported as not fully checked instead of 2303.
    pub ran_out_of_stack: bool,
}

/// A run of `getResolvedSymbol` that finds nothing, for the first identifier of an expression that
/// `getTargetOfAliasLikeExpression` checks. Each run reports, with the spelling suggestion it finds.
#[derive(Copy, Clone)]
pub struct FailedLookup<'s> {
    pub file: FileId,
    pub identifier: ExprId,
    /// The aliases for which `tryResolveAlias` returns nil during the run.
    pub aliases_in_progress: &'s [Sym],
}

/// The functions that resolve names, exports and aliases. Each of them can call `alias_links`, and
/// `alias_links` can call each of them.
///
/// They're written once, as provided methods, and the trait has two implementations.
/// `AliasResolver` computes the links, for the merge and the link step. `Linked` only reads them:
/// after the link step every alias and every module has its links, and `Files` is immutable.
trait Resolve<'s>: std::ops::Deref<Target = Files<'s>> {
    /// `resolveAlias`, with everything it stores in `aliasSymbolLinks`.
    fn alias_links(&self, sym: Sym) -> AliasSymbolLinks;

    /// `symbol_flags` of an alias for which `stored_symbol_flags` has nothing.
    fn symbol_flags_of_alias(&self, sym: Sym) -> SymFlags;

    /// The arena of the calling thread, for the links that are computed.
    fn arena(&self) -> &'s Arena;

    /// `moduleSymbolLinks.Get(module)`, filled in by `getExportsOfModule`. `read` must not resolve anything.
    fn with_module_links<R>(
        &self,
        module: Sym,
        read: impl FnOnce(&ModuleSymbolLinks<'s>) -> R,
    ) -> R;

    /// Sets `ObjectFlagsMembersResolved` of the type of `symbol`. Returns true if it wasn't set before.
    fn set_members_resolved(&self, symbol: Sym) -> bool;

    /// `findResolutionCycleStartIndex(sym, TypeSystemPropertyNameAliasTarget) >= 0`
    fn is_alias_in_progress(&self, sym: Sym) -> bool;

    /// `symbolNodeLinks.Get(node).resolvedSymbol != nil` for the identifier `e` of `file`.
    fn has_resolved_symbol(&self, file: FileId, e: ExprId) -> bool;

    /// Sets `resolvedSymbol` of the identifier `e` of `file`.
    fn set_resolved_symbol(&self, file: FileId, e: ExprId);

    /// Records that a `FailedLookup` for the identifier `e` of `file` begins.
    fn note_failed_lookup(&self, file: FileId, e: ExprId);

    /// `getSymbol`: true if `sym`, found under a name, matches the requested `meaning`. An alias
    /// has the combined meanings of itself and of every symbol on the chain to its target.
    fn means(&self, sym: Sym, meaning: SymFlags) -> bool {
        if let Some(known) = self.has_meaning_by_own_flags(sym, meaning) {
            return known;
        }
        self.symbol_flags(sym).intersects(meaning)
            || meaning.intersects(SymFlags::VALUE) && self.may_be_property_of_export_equals(sym)
    }

    /// `getSymbolFlags`: the combined flags of `sym` and of every symbol on the chain to its
    /// target. All flags if it can't be resolved.
    #[inline]
    fn symbol_flags(&self, sym: Sym) -> SymFlags {
        match self.stored_symbol_flags(sym) {
            Some(stored) => stored,
            None => self.symbol_flags_of_alias(sym),
        }
    }

    /// `getSymbolFlagsEx`
    fn symbol_flags_ex(
        &self,
        mut symbol: Sym,
        exclude_type_only_meanings: bool,
        exclude_local_meanings: bool,
    ) -> SymFlags {
        let mut flags = if exclude_local_meanings {
            SymFlags::empty()
        } else {
            self.flags(symbol)
        };
        let mut seen_symbols: SmallVec<[Sym; 8]> = SmallVec::new();
        while self.flags(symbol).contains(SymFlags::ALIAS) {
            let links = self.alias_links(symbol);
            if exclude_type_only_meanings && links.type_only_declaration.is_some() {
                break;
            }
            let Some(target) = links.alias_target else {
                return SymFlags::all();
            };
            let target = self.export_symbol_of_value_symbol_if_exported(target);
            if self.flags(target).contains(SymFlags::ALIAS) {
                if target == symbol || seen_symbols.contains(&target) {
                    break;
                }
                if seen_symbols.is_empty() {
                    seen_symbols.push(symbol);
                }
                seen_symbols.push(target);
            }
            flags |= self.flags(target);
            symbol = target;
        }
        flags
    }

    /// `getExternalModuleMember`: a name imported from `export = value` may be a property of the
    /// value, which only the type of the value determines. Returns true if `sym`, or an alias on
    /// the chain to its target, is such an import.
    fn may_be_property_of_export_equals(&self, mut sym: Sym) -> bool {
        for _ in 0..32 {
            if !self.flags(sym).contains(SymFlags::ALIAS) {
                return false;
            }
            if self.is_named_import_from_export_equals(sym) {
                return true;
            }
            match self.alias_target(sym) {
                Some(next) if next != sym => sym = next,
                _ => return false,
            }
        }
        false
    }

    /// True if `getTargetOfAliasDeclaration` of `sym` goes through `getExternalModuleMember` for a module that has
    /// `export =`, and `symbolFromVariable` may be a symbol that isn't in the tables.
    fn is_named_import_from_export_equals(&self, sym: Sym) -> bool {
        self.export_equals_module_of_named_import(sym)
            .is_some_and(|m| {
                // The properties of a namespace, a function, a class or an enum are its exports,
                // which are in the tables.
                let only_the_type_tells = SymFlags::VARIABLE | SymFlags::PROPERTY | SymFlags::ALIAS;
                self.flags(self.module_value(m))
                    .intersects(only_the_type_tells)
            })
    }

    /// `NameResolver.Resolve` without a `nameNotFoundMessage`: the symbol that `name` resolves to
    /// in `scope` of `file`.
    fn resolve_name(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) -> Option<Sym> {
        self.resolve(file, scope, name, meaning, false)
            .unwrap_or(None)
    }

    /// `NameResolver.Resolve`. `reports_errors`: `nameNotFoundMessage != nil`. `Err`: the error it
    /// reports where it returns nil for a specific reason, which replaces the error for an
    /// unresolved name, with `propertyWithInvalidInitializer` next to 2301 and 2844.
    fn resolve(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        reports_errors: bool,
    ) -> Result<Option<Sym>, (u32, MemberId)> {
        let scope = self.bound(file).scope_to_resolve_from(scope, name);
        // `getSymbol`
        let lookup = &mut |_: SymbolTable, table_entry: Option<Sym>, meaning: SymFlags| {
            table_entry.filter(|&sym| self.means(sym, meaning))
        };
        self.resolve_with(file, scope, name, meaning, reports_errors, lookup)
    }

    /// `module`, or the target of its `export =`.
    fn module_value(&self, module: Sym) -> Sym {
        self.canonical(match self.export(module, known::export_equals) {
            // `resolveSymbolEx`
            Some(equals) => self.resolve_symbol(equals).unwrap_or(equals),
            None => module,
        })
    }

    /// `canHaveSyntheticDefault`: the module, or the target of its `export =`, if it can have a
    /// synthetic default.
    /// `usage`: the syntax the specifier is emitted as at the use site
    /// (`getEmitSyntaxForModuleSpecifierExpression`).
    fn synthetic_default(&self, usage: impl Usage, module: Sym) -> Option<Sym> {
        let exporter = self.module_value(module);
        self.synthetic_default_with(usage, module, &mut |name| {
            let found = self.export(exporter, name);
            Some(self.has_syntactic_default(found.or_else(|| self.export(module, name))?))
        })
    }

    /// `getExportOfModule(symbol, "module.exports")`
    fn module_exports_export(&self, symbol: Sym) -> Option<Sym> {
        if !self.flags(symbol).intersects(SymFlags::MODULE) {
            return None;
        }
        self.module_export(symbol, self.module_exports_name()?)
    }

    /// `getTargetOfModuleDefault`: the target of `default` of `module` for an import or export
    /// declaration in `file`. A synthetic default takes precedence over a declared one.
    fn default_of_module(&self, file: FileId, module: Sym) -> Option<Sym> {
        // `resolveExportByName`: only the exports the module declares itself. With `export =` it's
        // a property of the value instead.
        if self.is_commonjs_import_of_esm_file(file, module)
            && self.export(module, known::export_equals).is_none()
            && let Some(name) = self.module_exports_name()
            && let Some(found) = self.export(module, name)
        {
            return Some(found);
        }
        self.resolve_export_by_name(module, known::default);
        if let Some(synthesized) = self.synthetic_default(file, module) {
            return Some(synthesized);
        }
        // `hasDefaultOnly`. A JSON file itself always has a synthetic default.
        if self.hir(module.file).kind != FileKind::Json
            && self.is_only_importable_as_default(file, module)
        {
            return Some(self.external_module_symbol(module));
        }
        // `resolveExportByName`: `moduleSymbol.Exports[name]`, not `getExportsOfModule`.
        if self.export(module, known::export_equals).is_none() {
            return self.export(module, known::default);
        }
        self.module_export(module, known::default)
    }

    /// `getSymbol(getExportsOfModule(module), name, ..)`, before the test of the meaning: once
    /// symbols are merged, `getMergedSymbol` of the entry.
    fn module_export(&self, module: Sym, name: Atom) -> Option<Sym> {
        let found = self.module_export_in_table(module, name)?;
        Some(if self.is_merged {
            self.canonical(found)
        } else {
            found
        })
    }

    /// `getExportsOfModule(module)[name]`. The entry isn't its own merged symbol if a module
    /// augmentation has reached the declaration through a module that re-exports it: `mergeSymbol`
    /// clones the target of the alias, and only the augmented module's table has the clone.
    fn module_export_in_table(&self, module: Sym, name: Atom) -> Option<Sym> {
        let is_resolved_at_merge =
            self.records_module_links || self.modules_resolved_at_merge.contains(&module);
        // Without `export =`, the module's own exports are in the table unchanged, and without an
        // `export *` there are no others.
        if !is_resolved_at_merge && self.export(module, known::export_equals).is_none() {
            if let Some(found) = self.export_in_table(module, name) {
                return Some(found);
            }
            if name == known::default || self.export_stars_of(module).is_empty() {
                return None;
            }
        }
        self.with_exports_of_module(module, |links| links.export_in_table(name))
    }

    /// `getExportsOfModule(module)`, also while symbols are merged. `read` must not resolve anything.
    fn with_exports_of_module<R>(
        &self,
        module: Sym,
        read: impl FnOnce(&ModuleSymbolLinks<'s>) -> R,
    ) -> R {
        if self.is_merged {
            return self.with_module_links(module, read);
        }
        if !self.records_module_links && !self.modules_resolved_at_merge.contains(&module) {
            return read(&self.exports_of_module_worker(module));
        }
        // See `Files::module_links_at_merge`.
        {
            let stored = self.module_links_at_merge.lock();
            if let Some(links) = stored.iter().find(|links| links.0 == module) {
                return read(&links.1);
            }
        }
        // Not under the lock, because it resolves aliases, which can lead back here.
        let links = self.exports_of_module_worker(module);
        let result = read(&links);
        let mut stored = self.module_links_at_merge.lock();
        if !stored.iter().any(|links| links.0 == module) {
            stored.push((module, links));
        }
        result
    }

    /// `getExportsOfModuleWorker`
    fn exports_of_module_worker(&self, module: Sym) -> ModuleSymbolLinks<'s> {
        let arena = self.arena();
        let mut visit = ExportsVisit {
            arena,
            visited_symbols: Vec::new(),
            non_type_only_names: FxHashSet::default(),
            type_only_export_star_map: map_in(arena),
            export_collisions: Vec::new(),
        };
        // A module defined by an `export =` consists of one export that needs to be resolved.
        // `resolveExternalModuleSymbol` returns any other module as it is, merged or not.
        let value = match self.export(module, known::export_equals) {
            Some(_) => self.module_value(module),
            None => module,
        };
        let mut resolved_exports = self
            .visit_exports(Some(value), None, false, &mut visit)
            .unwrap_or_else(|| SymbolMap::new_in(arena));
        // Its other exports are included if they are a type or a namespace and not a value.
        if self.export(module, known::export_equals).is_some() {
            for (name, symbol) in self.each_export(module) {
                if name == known::export_equals || resolved_exports.contains_key(name) {
                    continue;
                }
                let flags = self.symbol_flags(symbol);
                if flags.intersects(SymFlags::TYPE | SymFlags::NAMESPACE)
                    && !flags.intersects(SymFlags::VALUE)
                {
                    resolved_exports.insert(name, symbol);
                }
            }
        }
        visit
            .type_only_export_star_map
            .retain(|name, _| !visit.non_type_only_names.contains(name));
        let links = ModuleSymbolLinks {
            resolved_exports,
            unmerged_exports: &[],
            type_only_export_star_map: visit.type_only_export_star_map,
            export_collisions: slice_in(&visit.export_collisions, arena),
        };
        if self.is_merged {
            self.with_merged_exports(links)
        } else {
            links
        }
    }

    /// `visit` of `getExportsOfModuleWorker`. `export_star`: the `export *` that led here.
    /// `is_type_only`: that one or an earlier one on the path has `type`.
    fn visit_exports(
        &self,
        symbol: Option<Sym>,
        export_star: Option<(FileId, StmtId)>,
        is_type_only: bool,
        visit: &mut ExportsVisit<'s>,
    ) -> Option<SymbolMap<'s>> {
        let symbol = symbol?;
        // Before the visited check: a plain `export *` reverts what an `export type *` of the same
        // module recorded.
        if !is_type_only {
            let names = self.each_export(symbol).map(|export| export.0);
            visit.non_type_only_names.extend(names);
        }
        if visit.visited_symbols.contains(&symbol) {
            return None;
        }
        visit.visited_symbols.push(symbol);
        let mut symbols = SymbolMap::from_iter_in(self.each_export_in_table(symbol), visit.arena);
        let mut nested_symbols = SymbolMap::new_in(visit.arena);
        // `ExportCollisionTable`: the `export *` that exported the name first.
        let mut lookup_table: FxHashMap<Atom, (FileId, StmtId)> = FxHashMap::default();
        for node in self.export_stars_of(symbol) {
            let StmtKind::ExportStar {
                spec,
                type_only,
                mode,
                ..
            } = self.hir(node.0)[node.1].kind
            else {
                continue;
            };
            let mode = self.mode_of_import(node.0, mode);
            let resolved_module = self.module_of_specifier_as(node.0, spec, mode);
            let is_type_only = is_type_only || type_only;
            let Some(exported) =
                self.visit_exports(resolved_module, Some(node), is_type_only, visit)
            else {
                continue;
            };
            // `extendExportSymbols`
            for &(name, source) in exported.iter() {
                if name == known::default {
                    continue;
                }
                let Some(&target) = nested_symbols.get(name) else {
                    nested_symbols.insert(name, source);
                    lookup_table.insert(name, node);
                    continue;
                };
                let is_same_symbol = self.resolve_symbol(target) == self.resolve_symbol(source);
                // The module's own exports take precedence.
                if name == known::export_equals || symbols.contains_key(name) {
                    continue;
                }
                let needs_types = target != source
                    && (self.may_need_types_to_resolve(target)
                        || self.may_need_types_to_resolve(source));
                if needs_types || !is_same_symbol {
                    visit.export_collisions.push(ExportCollision {
                        duplicate: node,
                        first: lookup_table[&name],
                        name,
                        symbols: needs_types.then_some((target, source)),
                    });
                }
            }
        }
        symbols.extend_with_missing(&nested_symbols);
        if let Some(star) = export_star
            && matches!(
                self.hir(star.0)[star.1].kind,
                StmtKind::ExportStar {
                    type_only: true,
                    ..
                }
            )
        {
            let names = symbols.iter().map(|export| (export.0, star));
            visit.type_only_export_star_map.extend(names);
        }
        Some(symbols)
    }

    /// `resolveSymbol`. `None`: `unknownSymbol`.
    fn resolve_symbol(&self, symbol: Sym) -> Option<Sym> {
        if self.is_non_local_alias(symbol) {
            self.resolve_alias(symbol)
        } else {
            Some(symbol)
        }
    }

    /// True if `resolveSymbol(sym)` may be a symbol that isn't in the tables, which
    /// `Checker::resolve_alias` finds from types. That's the case if, for `sym` or an alias on the
    /// chain to its target, `resolveESModuleSymbol` or `combineValueAndTypeSymbols` may create one,
    /// or the target may be a property.
    fn may_need_types_to_resolve(&self, mut sym: Sym) -> bool {
        for _ in 0..32 {
            if !self.is_non_local_alias(sym) {
                return false;
            }
            if matches!(
                self.declaration_of_alias_symbol(sym),
                Some((_, Decl::ImportNamespace(_) | Decl::ExportStarAs(_)))
            ) || self.is_named_import_from_export_equals(sym)
            {
                return true;
            }
            match self.alias_target(sym) {
                Some(next) if next != sym => sym = next,
                next => return next.is_none(),
            }
        }
        false
    }

    /// `typeOnlyExportStarMap[name]` of `module`: the `export type *` that is the only path through
    /// which it exports `name`.
    fn type_only_export_star(&self, module: Sym, name: Atom) -> Option<(FileId, StmtId)> {
        if !self.has_type_only_stars {
            return None;
        }
        self.with_module_links(module, |links| {
            links.type_only_export_star_map.get(&name).copied()
        })
    }

    /// `A.B.C` in `scope`: every name but the last resolves as a namespace, and the last must have
    /// `meaning`.
    fn resolve_entity(
        &self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags,
    ) -> Option<Sym> {
        self.resolve_entity_with(file, scope, names, meaning, false, &mut InTables(self))
    }

    /// `reports_errors`: `!ignoreErrors`.
    fn resolve_entity_with(
        &self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags,
        reports_errors: bool,
        symbols: &mut dyn EntityNameLookup,
    ) -> Option<Sym> {
        let (&last, mut qualifiers) = names.split_last()?;
        // `NodeIsMissing(name)`: a declaration whose name is missing is named "".
        if names[0] == known::empty {
            return None;
        }
        let scope = self.bound(file).scope_to_resolve_from(scope, names[0]);
        let lookup = &mut |_: SymbolTable, table_entry: Option<Sym>, meaning: SymFlags| {
            symbols.get_symbol(table_entry, meaning)
        };
        if qualifiers.is_empty() {
            let found = self.resolve_with(file, scope, last, meaning, reports_errors, lookup);
            return found.unwrap_or(None);
        }
        let namespace = SymFlags::NAMESPACE;
        let first = self.resolve_with(
            file,
            scope,
            qualifiers[0],
            namespace,
            reports_errors,
            lookup,
        );
        let first = match first.unwrap_or(None) {
            Some(found) => found,
            // `globalThis.A.B`
            None if qualifiers[0] == known::globalThis => match qualifiers.get(1) {
                None => {
                    let table_entry = self.globals.get(last).copied();
                    return lookup(SymbolTable::Globals, table_entry, meaning);
                }
                Some(&next) => {
                    qualifiers = &qualifiers[1..];
                    let table_entry = self.globals.get(next).copied();
                    lookup(SymbolTable::Globals, table_entry, namespace)?
                }
            },
            None => return None,
        };
        let mut container = self.resolve_alias_as_with(first, namespace, symbols)?;
        for &name in &qualifiers[1..] {
            container = self.member_as(container, name, namespace, symbols)?;
            container = self.resolve_alias_as_with(container, namespace, symbols)?;
        }
        self.member_as(container, last, meaning, symbols)
    }

    /// `resolveQualifiedName`: the export `name` of `namespace`, accepted only if it has the
    /// requested meaning.
    fn member_as(
        &self,
        namespace: Sym,
        name: Atom,
        meaning: SymFlags,
        symbols: &mut dyn EntityNameLookup,
    ) -> Option<Sym> {
        // `NodeIsMissing(right)`
        if name == known::empty {
            return None;
        }
        let table_entry = self.namespace_member(namespace, name);
        let found = symbols.get_symbol(table_entry, meaning);
        // A namespace that is merged with a re-export can be resolved further.
        if found.is_some() || !self.flags(namespace).contains(SymFlags::ALIAS) {
            return found;
        }
        let target = symbols.resolve_alias(namespace)?;
        let table_entry = self.namespace_member(target, name);
        symbols.get_symbol(table_entry, meaning)
    }

    /// A member of a namespace, a module or an enum.
    fn namespace_member(&self, container: Sym, name: Atom) -> Option<Sym> {
        if self.flags(container).intersects(SymFlags::MODULE) {
            return self.module_export(container, name);
        }
        self.export(container, name)
    }

    /// `resolveAlias`. `None`: `unknownSymbol`.
    fn resolve_alias(&self, sym: Sym) -> Option<Sym> {
        match self.stored_alias_target(sym) {
            Some(stored) => stored,
            None => self.alias_links(sym).alias_target,
        }
    }

    /// `Files::resolve_alias_as_with`, as far as the symbol tables can answer.
    fn resolve_alias_as(&self, sym: Sym, meaning: SymFlags) -> Option<Sym> {
        self.resolve_alias_as_with(sym, meaning, &mut InTables(self))
    }

    /// `tryResolveAlias`
    fn try_resolve_alias(&self, symbol: Sym) -> Option<AliasSymbolLinks> {
        (!self.is_alias_in_progress(symbol)).then(|| self.alias_links(symbol))
    }

    /// `getResolvedSymbol` of the identifier `e` in `scope` of `file`, limited to its side effects
    /// on aliases. It has no `resolvedSymbol` while the name is being looked up, so an alias that
    /// the lookup resolves can get here again.
    fn get_resolved_symbol(&self, file: FileId, e: ExprId, scope: ScopeId, name: Atom) {
        if self.has_resolved_symbol(file, e) {
            return;
        }
        let value = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
        if self.resolve_name(file, scope, name, value).is_none() {
            self.note_failed_lookup(file, e);
            self.on_failed_to_resolve_symbol(file, scope, name, value);
        }
        self.set_resolved_symbol(file, e);
    }

    /// `onFailedToResolveSymbol`, limited to its side effects on aliases: `getSymbol` resolves an
    /// alias of that name that doesn't have the meaning itself, and `getSpellingSuggestionForName`
    /// resolves every alias it inspects.
    fn on_failed_to_resolve_symbol(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) {
        // `checkAndReportErrorForUsingTypeAsNamespace`: the error is already determined.
        let types = SymFlags::TYPE.difference(SymFlags::NAMESPACE);
        if meaning == SymFlags::NAMESPACE && self.resolve_name(file, scope, name, types).is_some() {
            return;
        }
        // `getSymbolFlags` of what the name resolves to with another meaning. Also `None` for an
        // alias that doesn't resolve.
        let flags_as = |meaning: SymFlags| {
            let found = self.resolve_name(file, scope, name, meaning)?;
            Some(self.symbol_flags(found)).filter(|&flags| flags != SymFlags::all())
        };
        // `checkAndReportErrorForUsingNamespaceAsTypeOrValue`, for a `meaning` that includes values.
        let namespace = SymFlags::NAMESPACE_MODULE;
        if flags_as(namespace).is_some_and(|it| it.intersects(namespace)) {
            return;
        }
        // `checkAndReportErrorForExportingPrimitiveType`, `checkAndReportErrorForUsingTypeAsValue`
        if matches!(
            self.atoms.bytes(name),
            b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown"
        ) {
            return;
        }
        let is_type_only =
            |it: SymFlags| it.intersects(SymFlags::TYPE) && !it.intersects(SymFlags::VALUE);
        if flags_as(SymFlags::TYPE.difference(SymFlags::VALUE)).is_some_and(is_type_only) {
            return;
        }
        // `checkAndReportErrorForUsingValueAsType`
        if meaning.intersects(SymFlags::TYPE.difference(SymFlags::NAMESPACE))
            && flags_as(SymFlags::VALUE.difference(SymFlags::TYPE))
                .is_some_and(|it| !it.intersects(SymFlags::NAMESPACE))
        {
            return;
        }
        let name = (name, self.atoms.bytes(name));
        // Only called for the aliases that the search resolves. The suggestion itself is for the
        // error, which the checker reports.
        let _ = self.suggested_symbol_for_nonexistent_symbol(
            Some((file, scope)),
            name,
            meaning,
            &mut InTables(self),
            None,
        );
    }

    /// `resolveIndirectionAlias`. `type_only`: `typeOnlyDeclaration` of the source.
    fn resolve_indirection_alias(
        &self,
        target: Sym,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Option<Sym> {
        let links = self.alias_links(target);
        *type_only = type_only.or(links.type_only_declaration);
        // `getMergedSymbol(resolveAlias(target))`: see `resolved_at_merge`.
        links.alias_target.map(|resolved| self.canonical(resolved))
    }

    /// `resolveESModuleSymbol`, limited to what the symbol tables can answer.
    /// `namespace_import_in`: the file, if `namespaceImport != nil`.
    fn resolve_es_module_symbol(
        &self,
        module: Sym,
        namespace_import_in: Option<FileId>,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Sym {
        let mut symbol = self.external_module_symbol(module);
        if self.is_non_local_alias(symbol) {
            // Where the tables can't resolve further, types may be able to, so a caller that
            // continues from here does it one step at a time.
            symbol = (self.resolve_indirection_alias(symbol, type_only)).unwrap_or(symbol);
        }
        let Some(file) = namespace_import_in else {
            return symbol;
        };
        // `getTypeWithSyntheticDefaultOnly`: the only member is the synthetic `default`.
        if self.is_only_importable_as_default(file, module) {
            return symbol;
        }
        // `hasSignatures(getTypeOfSymbol(symbol))`
        self.resolve_members_of_type_of_symbol(symbol);
        if !self.has_exports_for_members(symbol) || self.is_shorthand_ambient_module_symbol(symbol)
        {
            return symbol;
        }
        let has_signatures = SymFlags::FUNCTION | SymFlags::METHOD | SymFlags::CLASS;
        let has_signatures = self.flags(symbol).intersects(has_signatures);
        // True if `cloneTypeAsModuleType` is called with the type itself. With a synthetic default
        // the members of `moduleType` are the properties of the type, which are resolved, or none
        // while it's being resolved.
        let is_cloned = if self.is_commonjs_import_of_esm_file(file, module)
            && self.module_exports_export(symbol).is_some()
        {
            has_signatures
        } else {
            (has_signatures
                || self.type_of_symbol_has_property(symbol, known::default)
                || self.is_commonjs_to_node(file, module))
                && self.synthetic_default(file, module).is_none()
        };
        // `newAnonymousType` has no `ObjectFlagsMembersResolved` to check.
        if is_cloned {
            self.get_named_members(symbol);
        }
        symbol
    }

    /// `resolveStructuredTypeMembers(getTypeOfSymbol(symbol))`, limited to what it does to aliases,
    /// and to a type whose members are the exports of `symbol`.
    fn resolve_members_of_type_of_symbol(&self, symbol: Sym) {
        if self.has_exports_for_members(symbol)
            && self.set_members_resolved(symbol)
            && !self.is_shorthand_ambient_module_symbol(symbol)
        {
            self.get_named_members(symbol);
        }
    }

    /// `getNamedMembers(getExportsOfSymbol(symbol), ..)`, limited to what it does to aliases: it
    /// calls `symbolIsValue` on each, which resolves it if it's an alias.
    fn get_named_members(&self, symbol: Sym) {
        let flags = self.flags(symbol);
        let is_alias_only = |export: Sym| {
            let flags = self.flags(export);
            flags.contains(SymFlags::ALIAS) && !flags.intersects(SymFlags::VALUE)
        };
        // `getExportsOfSymbol`
        let aliases: SmallVec<[Sym; 8]> = if flags.intersects(SymFlags::MODULE) {
            self.with_exports_of_module(symbol, |links| {
                let exports = links.resolved_exports.iter().map(|export| export.1);
                exports.filter(|&export| is_alias_only(export)).collect()
            })
        } else {
            let exports = self.each_export(symbol).map(|export| export.1);
            exports.filter(|&export| is_alias_only(export)).collect()
        };
        for alias in aliases {
            self.symbol_flags_ex(alias, true, false);
        }
    }

    /// `getTypeOfFuncClassEnumModule`: true if the members of `getTypeOfSymbol(symbol)` are the exports of `symbol`.
    fn has_exports_for_members(&self, symbol: Sym) -> bool {
        let flags = self.flags(symbol);
        let has_exports = SymFlags::FUNCTION
            | SymFlags::METHOD
            | SymFlags::CLASS
            | SymFlags::ENUM
            | SymFlags::VALUE_MODULE;
        !flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY) && flags.intersects(has_exports)
    }

    /// `resolveExportByName`, limited to what it does to aliases, which is nothing unless `module`
    /// has `export =`: `getPropertyOfTypeEx(getTypeOfSymbol(exportValue), name, ..)` resolves the
    /// members of the type, and calls `symbolIsValueEx` on the member `name`.
    fn resolve_export_by_name(&self, module: Sym, name: Atom) {
        if self.export(module, known::export_equals).is_none() {
            return;
        }
        let value = self.module_value(module);
        if !self.has_exports_for_members(value) {
            return;
        }
        self.resolve_members_of_type_of_symbol(value);
        self.type_of_symbol_has_property(value, name);
    }

    /// `getPropertyOfTypeEx(getTypeOfSymbol(symbol), name, ..) != nil`, where the members of the
    /// type are resolved and are the exports of `symbol`.
    fn type_of_symbol_has_property(&self, symbol: Sym, name: Atom) -> bool {
        // `getExportsOfSymbol`
        let member = self.namespace_member(symbol, name);
        // `symbolIsValueEx`
        member.is_some_and(|member| {
            let value = SymFlags::VALUE;
            self.flags(member).intersects(value)
                || self.symbol_flags_ex(member, true, false).intersects(value)
        })
    }

    /// `getImmediateAliasedSymbol`
    fn alias_target(&self, sym: Sym) -> Option<Sym> {
        self.alias_links(sym).immediate_target
    }

    /// `errorNoModuleMemberSymbol` for `name`, which `decl` of `file` imports from `module`,
    /// limited to its side effects on aliases: `reportNonExportedMember` resolves the local symbol
    /// of that name, and the exports it's compared with (`getSymbolIfSameReference`). Skipped with
    /// an `export =`, where only types tell whether there's a member.
    fn error_no_module_member_symbol(&self, file: FileId, decl: Decl, module: Sym, name: Atom) {
        if self.options.no_check
            || self.export(module, known::export_equals).is_some()
            || !matches!(decl, Decl::Require(_))
                && self.is_only_importable_as_default(self.emit_syntax_of_import(file), module)
        {
            return;
        }
        // `getSuggestedSymbolForNonexistentModule`: for an identifier, not for a string literal.
        let hir = self.hir(file);
        let start = match decl {
            Decl::ImportSpec(s) => hir[s].imported_pos,
            Decl::ExportSpec(s) => hir[s].local_pos,
            _ => u32::MAX,
        };
        let is_identifier = !matches!(hir.text.get(start as usize), Some(b'"' | b'\''));
        let text = self.atoms.bytes(name);
        let is_suggestion = |&(other, exported): &(Atom, Sym)| {
            self.flags(exported).intersects(SymFlags::MODULE_MEMBER)
                && is_close(text, self.atoms.bytes(other))
        };
        let has_suggestion = is_identifier
            && self.with_exports_of_module(module, |links| {
                links.resolved_exports.iter().any(is_suggestion)
            });
        if has_suggestion || self.export(module, known::default).is_some() {
            return;
        }
        let Some(local) = self.local_of_module(module, name) else {
            return;
        };
        let resolved = |symbol: Sym| {
            let resolved = self.resolve_symbol(self.canonical(symbol));
            resolved.map(|resolved| self.canonical(resolved))
        };
        // `findInMap`. The entry for the `export *` declarations isn't an alias.
        let exports = self.exports(module);
        let is_exported = (exports.iter()).any(|&(_, it)| resolved(it) == resolved(local));
        if !is_exported && !self.export_stars_of(module).is_empty() {
            resolved(local);
        }
    }

    /// `getTargetOfAliasDeclaration` for the declaration `decl` in `file` of `sym`: one step, to a
    /// symbol that may itself be an alias.
    /// `type_only`: `typeOnlyDeclaration` of `sym`.
    fn target_of_alias_declaration(
        &self,
        sym: Sym,
        file: FileId,
        decl: Decl,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Option<Sym> {
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let node = (sym, file, decl);
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `getTargetOfImportSpecifier`, `getTargetOfExportSpecifier`
        if let Some((spec, mode, name)) = self.external_module_member_of(file, decl) {
            let target = self
                .module_of_specifier_as(file, spec, mode)
                .and_then(|module| {
                    // `{ default as d }` is another syntax for the default import, but not in a
                    // binding pattern.
                    if name == known::default && !matches!(decl, Decl::Require(_)) {
                        return self.default_of_module(file, module);
                    }
                    // `getExternalModuleMember`, `getExportOfModule`
                    self.resolve_es_module_symbol(module, None, type_only);
                    // `nameText != "" || name.Kind == KindStringLiteral`
                    if name.is_none() {
                        return None;
                    }
                    if self.is_shorthand_ambient_module_symbol(module) {
                        return Some(module);
                    }
                    let star = self.type_only_export_star(module, name);
                    self.mark_symbol_of_alias_declaration_if_type_only(node, star, type_only);
                    let member = self.module_export_in_table(module, name);
                    if member.is_none() {
                        self.error_no_module_member_symbol(file, decl, module, name);
                    }
                    member
                });
            self.mark_symbol_of_alias_declaration_if_type_only(node, None, type_only);
            return target;
        }
        let target = match decl {
            // `getTargetOfImportClause`: without the module nothing is marked.
            Decl::ImportDefault(import) => {
                let module = self.module_of_specifier_as(
                    file,
                    hir[import].spec,
                    self.mode_of_import(file, hir[import].mode),
                )?;
                self.default_of_module(file, module)
            }
            // `getTargetOfNamespaceImport`
            Decl::ImportNamespace(import) => self
                .module_of_specifier_as(
                    file,
                    hir[import].spec,
                    self.mode_of_import(file, hir[import].mode),
                )
                .map(|module| {
                    // The `JSImportDeclaration` of an `@import` tag isn't an `ImportDeclaration`.
                    let is_import_declaration = !hir.is_in_jsdoc(hir[import].namespace_pos);
                    let import_in = is_import_declaration.then_some(file);
                    let symbol = self.resolve_es_module_symbol(module, import_in, type_only);
                    if self.is_commonjs_import_of_esm_file(file, module)
                        && let Some(found) = self.module_exports_export(symbol)
                    {
                        return found;
                    }
                    symbol
                }),
            Decl::ImportEquals(import) => match hir[import].target {
                ImportEqualsTarget::Require(spec) => self
                    .module_of_specifier_as(file, spec, self.mode_of_require(file))
                    .map(|module| self.required_module_symbol(module)),
                ImportEqualsTarget::Entity(names) => {
                    let names: SmallVec<[Atom; 4]> = hir.texts(names).collect();
                    // `getSymbolOfPartOfRightHandSideOfImportEquals`: `import a = b` resolves a
                    // namespace, `import a = b.c` any meaning.
                    let meaning = if names.len() == 1 {
                        SymFlags::NAMESPACE
                    } else {
                        all
                    };
                    let scope = bound.import_equals_scope[import.idx()];
                    // `resolveEntityName` marks `getAliasDeclarationFromName(name)` where a name is
                    // found to be an alias.
                    if self.is_type_only_import_or_export_declaration(file, decl)
                        && (1..=names.len()).any(|n| {
                            let meaning = if n == names.len() {
                                meaning
                            } else {
                                SymFlags::NAMESPACE
                            };
                            self.resolve_entity(file, scope, &names[..n], meaning)
                                .is_some_and(|found| self.flags(found).contains(SymFlags::ALIAS))
                        })
                    {
                        self.mark_symbol_of_alias_declaration_if_type_only(node, None, type_only);
                    }
                    let target = self.resolve_entity(file, scope, &names, meaning);
                    if target.is_none()
                        && self
                            .resolve_name(file, scope, names[0], SymFlags::NAMESPACE)
                            .is_none()
                    {
                        let namespace = SymFlags::NAMESPACE;
                        self.on_failed_to_resolve_symbol(file, scope, names[0], namespace);
                    }
                    return target;
                }
            },
            // `getTargetOfExportSpecifier` without `from`: `export { "a" as b }` refers to nothing.
            Decl::ExportSpec(spec)
                if matches!(
                    hir.text.get(hir[spec].local_pos as usize),
                    Some(b'"' | b'\'')
                ) =>
            {
                None
            }
            Decl::ExportSpec(spec) => {
                let scope = bound.export_scope[hir[spec].export.idx()];
                let target = self.resolve_name(file, scope, hir[spec].local, all);
                if target.is_none() {
                    self.on_failed_to_resolve_symbol(file, scope, hir[spec].local, all);
                }
                target
            }
            // `getTargetOfNamespaceExportDeclaration`: `resolveExternalModuleSymbol` merges an
            // `export =`, and returns `node.Parent.Symbol()` as it is.
            Decl::UmdGlobal(_) => {
                let module = Sym {
                    file,
                    id: bound.file_symbol,
                };
                let export_equals = self.export(module, known::export_equals);
                Some(export_equals.map_or(module, |it| self.canonical(it)))
            }
            // `getTargetOfNamespaceExport`
            Decl::ExportStarAs(stmt) => {
                let StmtKind::ExportStar { spec, mode, .. } = hir[stmt].kind else {
                    return None;
                };
                self.module_of_specifier_as(file, spec, self.mode_of_import(file, mode))
                    .map(|module| self.resolve_es_module_symbol(module, None, type_only))
            }
            // `getTargetOfImportEqualsDeclaration`: the whole required module.
            Decl::Require(pat) => {
                let (spec, _) = bound.required_by(hir, pat)?;
                self.module_of_specifier_as(file, spec, self.mode_of_require(file))
                    .map(|module| self.required_module_symbol(module))
            }
            _ => return self.target_of_alias_like_expression(file, decl),
        };
        self.mark_symbol_of_alias_declaration_if_type_only(node, None, type_only);
        target
    }

    /// `getTargetOfImportEqualsDeclaration`: the target of `import x = require(..)` and of `const x
    /// = require(..)` of `module`.
    fn required_module_symbol(&self, module: Sym) -> Sym {
        let resolved = self.external_module_symbol(module);
        self.module_exports_export(resolved).unwrap_or(resolved)
    }

    /// `getTargetOfExportAssignment`, `getTargetOfBinaryExpression`:
    /// `getTargetOfAliasLikeExpression`, limited to what the symbol tables can answer.
    fn target_of_alias_like_expression(&self, file: FileId, decl: Decl) -> Option<Sym> {
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let hir = self.hir(file);
        let bound = self.bound(file);
        let e = alias_like_expression(hir, decl)?;
        // `getTargetOfAliasLikeExpression`: a class expression is its own symbol.
        if let ExprKind::Class(c) = hir[e].kind {
            return Some(self.sym(file, bound.class_symbol[c.idx()]));
        }
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut at = e;
        loop {
            match hir[at].kind {
                ExprKind::Ident(name) => {
                    names.push(name);
                    break;
                }
                ExprKind::Dot { obj, name, .. } => {
                    names.push(name);
                    at = obj;
                }
                _ => return None,
            }
        }
        names.reverse();
        let scope = *bound.expr_scope.get(&e)?;
        let target = self.resolve_entity(file, scope, &names, all);
        // `checkExpressionCached(expression)`
        if target.is_none() {
            self.get_resolved_symbol(file, at, scope, names[0]);
        }
        target
    }

    /// `checkExportAssignment` of the statement `stmt`, limited to its side effects on aliases.
    fn check_export_assignment(&self, file: FileId, stmt: StmtId) {
        // `checkGrammarModuleElementContext`, and 1063 or 1319 in a namespace.
        let is_checked = match self.bound(file).parent_of_stmt(stmt) {
            bind::Parent::File => true,
            bind::Parent::Module(m) => !matches!(self.hir(file)[m].name, ModuleName::Ident(_)),
            _ => false,
        };
        // `resolveEntityName`, then `checkExpressionCached` of what isn't found. No alias is in progress for it here.
        if is_checked {
            self.target_of_alias_like_expression(file, Decl::ExportExpr(stmt));
        }
    }
}

/// `EntityNameLookup` and `SuggestionLookup` as far as the symbol tables can answer.
struct InTables<'a, R: ?Sized>(&'a R);

impl<'s, R: Resolve<'s> + ?Sized> EntityNameLookup for InTables<'_, R> {
    fn get_symbol(&mut self, table_entry: Option<Sym>, meaning: SymFlags) -> Option<Sym> {
        table_entry.filter(|&sym| self.0.means(sym, meaning))
    }

    fn resolve_alias(&mut self, alias: Sym) -> Option<Sym> {
        self.0.alias_links(alias).alias_target
    }
}

impl<'s, R: Resolve<'s> + ?Sized> SuggestionLookup for InTables<'_, R> {
    fn try_resolve_alias(&mut self, candidate: Sym) -> Option<SymFlags> {
        let target = self.0.try_resolve_alias(candidate)?.alias_target;
        // `unknownSymbol`
        Some(target.map_or(SymFlags::PROPERTY, |target| self.0.flags(target)))
    }
}

/// `Resolve` after the link step.
#[derive(Copy, Clone)]
struct Linked<'a, 's>(&'a Files<'s>);

impl<'s> std::ops::Deref for Linked<'_, 's> {
    type Target = Files<'s>;
    #[inline(always)]
    fn deref(&self) -> &Files<'s> {
        self.0
    }
}

impl<'s> Resolve<'s> for Linked<'_, 's> {
    #[inline]
    fn alias_links(&self, sym: Sym) -> AliasSymbolLinks {
        let links = self.alias_symbol_links.get(&sym);
        debug_assert!(links.is_some() || !self.flags(sym).contains(SymFlags::ALIAS));
        links.unwrap_or_default()
    }

    fn symbol_flags_of_alias(&self, sym: Sym) -> SymFlags {
        self.symbol_flags_ex(sym, false, false)
    }

    fn arena(&self) -> &'s Arena {
        self.0.thread_arena()
    }

    #[inline]
    fn with_module_links<R>(
        &self,
        module: Sym,
        read: impl FnOnce(&ModuleSymbolLinks<'s>) -> R,
    ) -> R {
        read(self.0.module_links(module))
    }

    /// Every alias already has its links.
    fn set_members_resolved(&self, _: Sym) -> bool {
        false
    }

    fn is_alias_in_progress(&self, _: Sym) -> bool {
        false
    }

    fn has_resolved_symbol(&self, _: FileId, _: ExprId) -> bool {
        true
    }

    fn set_resolved_symbol(&self, _: FileId, _: ExprId) {}

    fn note_failed_lookup(&self, _: FileId, _: ExprId) {}
}

/// `Resolve` while the tables are being filled. tsgo pushes `TypeSystemPropertyNameAliasTarget` on `typeResolutions`.
/// Here the aliases in progress belong to the resolver, which lives on one thread's stack.
///
/// It reads the tables first, then its own buffer. A result computed while reading an alias in
/// progress depends on where the cycle was entered, and it's stored like any other, as in tsgo. So
/// the result depends on the order in which a resolver is queried.
struct AliasResolver<'a, 's> {
    files: &'a Files<'s>,
    /// `typeResolutions` and `resolutionResults`: each alias in progress, and whether no cycle
    /// through it has been found.
    in_flight: std::cell::RefCell<Vec<(Sym, bool)>>,
    /// How many of `in_flight`, from the first, were in progress when the stack ran out.
    out_of_stack: std::cell::Cell<usize>,
    /// The number of times an alias was read while in progress, or was rejected because the stack
    /// has no room for it.
    cycles: std::cell::Cell<u32>,
    /// `None`: results are written to the tables immediately. For the merge, which is
    /// single-threaded.
    buffer: Option<std::cell::RefCell<Resolved<'s>>>,
    /// `Resolve::arena`, once it's been requested.
    arena: std::cell::OnceCell<&'s Arena>,
    /// The symbols whose type has `ObjectFlagsMembersResolved`.
    members_resolved: std::cell::RefCell<FxHashSet<Sym>>,
    /// The identifiers passed to `get_resolved_symbol` that have a `resolvedSymbol`.
    resolved_symbols: std::cell::RefCell<FxHashSet<(FileId, ExprId)>>,
    /// The plan and the component this resolver links, if other components are linked and published concurrently.
    /// `None` if no other thread writes to the tables while this resolver is in use.
    scope: Option<(&'a LinkPlan<'s>, u32)>,
}

/// State shared by the tasks of `Files::link_components`. Each task links one component and publishes its results for
/// that component's symbols as soon as it's done. No other task publishes results for those symbols.
///
/// A task's reads must not depend on how far other tasks have progressed. Of the link step's results, a task reads only
/// its own and those published by components at a lower level, waiting for them if necessary. It recomputes everything
/// else, even if the tables already have it. Entries stored by the merge are visible to every task.
struct LinkPlan<'s> {
    /// `Components::of_file`
    component_by_file: &'s [u32],
    /// `Component::level`, indexed by component.
    levels: Vec<u32>,
    /// Indexed by component.
    is_published: Vec<AtomicBool>,
    /// Number of tasks sleeping in `may_read`.
    asleep: Guarded<usize>,
    /// Wakes those tasks when a component is published.
    has_published: bun_threading::Condvar,
    /// Keys that the merge stored in `Files::alias_symbol_links`. `modules_at_merge` is the same for
    /// `Memo::module_links`.
    aliases_at_merge: FxHashSet<Sym>,
    modules_at_merge: FxHashSet<Sym>,
}

impl LinkPlan<'_> {
    /// Returns `u32::MAX` for a file that isn't in a component. Those files are linked after all
    /// components.
    fn component_of(&self, file: FileId) -> u32 {
        self.component_by_file
            .get(file.idx())
            .copied()
            .unwrap_or(u32::MAX)
    }

    /// True if the task for component `own` may read the tables' entries for `file`'s symbols. Blocks until those
    /// entries are published.
    ///
    /// This can't deadlock. A task only waits for a lower level, and some thread is always working on the lowest
    /// unfinished component (`Files::link_components`). That component finishes without waiting, then the next one
    /// does.
    fn may_read(&self, own: u32, file: FileId) -> bool {
        let other = self.component_of(file);
        // Nothing is published for the task's own symbols until it ends, so this read is
        // deterministic.
        if other == own {
            return true;
        }
        let level = self.levels.get(other as usize);
        if level.is_none_or(|&level| level >= self.levels[own as usize]) {
            return false;
        }
        let is_published = || self.is_published[other as usize].load(Ordering::Acquire);
        if is_published() {
            return true;
        }
        pause_before_sleeping();
        // Recheck under the lock, which `set_published` acquires after its store. Either this
        // thread observes the store, or `set_published` observes `asleep > 0` and notifies.
        let mut asleep = self.asleep.lock();
        *asleep += 1;
        while !is_published() {
            self.has_published.wait_guarded(&mut asleep);
        }
        *asleep -= 1;
        true
    }

    fn set_published(&self, component: u32) {
        self.is_published[component as usize].store(true, Ordering::Release);
        if *self.asleep.lock() > 0 {
            self.has_published.notify_all();
        }
    }
}

/// Candidates for `Files::modules_with_nested_export_collisions`, and the entries of
/// `Files::failed_lookups`.
type FoundByLink<'s> = Guarded<(Vec<Sym>, Vec<FailedLookup<'s>>)>;

/// True if one of `module`'s export collisions has its duplicate `export *` in another file.
fn is_nested(&(module, links): &(&Sym, &ModuleSymbolLinks)) -> bool {
    let mut collisions = links.export_collisions.iter();
    collisions.any(|it| it.duplicate.0 != module.file)
}

/// Spins briefly. Called before a thread sleeps to wait for a short piece of work on another thread. The spin lasts
/// about as long as waking a sleeping thread. If there's still nothing to do afterwards, the caller sleeps. Spinning
/// longer would take CPU time from the thread it's waiting for, when the process is limited to fewer CPUs than it has
/// threads.
fn pause_before_sleeping() {
    for _ in 0..64 {
        std::hint::spin_loop();
    }
}

/// A link-step task's write buffer. It's dropped at the barrier after the step. What's published
/// from it lives in the arena of the thread that ran the task.
#[derive(Default)]
struct Resolved<'s> {
    alias_links: FxHashMap<Sym, AliasSymbolLinks>,
    symbol_flags: FxHashMap<Sym, SymFlags>,
    /// `alias_links` and `symbol_flags` are drained into these lists when the task ends. See
    /// `Files::resolve_files`.
    alias_links_in_order: Vec<(Sym, AliasSymbolLinks)>,
    symbol_flags_in_order: Vec<(Sym, SymFlags)>,
    module_links: FxHashMap<Sym, ModuleSymbolLinks<'s>>,
    decls: Vec<(Sym, &'s [(FileId, Decl)])>,
    failed_lookups: Vec<FailedLookup<'s>>,
}

impl<'s> std::ops::Deref for AliasResolver<'_, 's> {
    type Target = Files<'s>;
    #[inline(always)]
    fn deref(&self) -> &Files<'s> {
        self.files
    }
}

/// `$call` with `$resolver` bound to the implementation of `Resolve` for the phase that `$files` is in.
macro_rules! resolve {
    ($files:expr, $resolver:ident => $call:expr) => {
        if $files.is_linked {
            let $resolver = Linked($files);
            $call
        } else {
            let $resolver = AliasResolver::new($files, None);
            $call
        }
    };
}

/// How a module is referenced, as input to `canHaveSyntheticDefault`: a resolution mode, or the
/// syntax a plain `import` in a file is emitted as.
pub trait Usage: Copy {
    fn mode(self, files: &Files) -> ResolutionMode;
}

impl Usage for ResolutionMode {
    fn mode(self, _: &Files) -> ResolutionMode {
        self
    }
}

impl Usage for FileId {
    fn mode(self, files: &Files) -> ResolutionMode {
        files.emit_syntax_of_import(self)
    }
}

/// `GetJSXRuntimeImport` of `GetJSXImplicitImportBase`.
pub(crate) fn jsx_runtime_of(options: &Options, hir: &File, atoms: &Interner) -> Option<Vec<u8>> {
    if hir.jsx_pragmas.classic == Some(true) {
        return None;
    }
    let runtime: &[u8] = if options.jsx == JsxEmit::ReactJsxDev {
        b"jsx-dev-runtime"
    } else {
        b"jsx-runtime"
    };
    if hir.jsx_pragmas.import_source.is_some() {
        return Some([atoms.bytes(hir.jsx_pragmas.import_source), b"/", runtime].concat());
    }
    if !options.jsx_runtime.is_empty() {
        return Some(options.jsx_runtime.clone());
    }
    (hir.jsx_pragmas.classic == Some(false))
        .then(|| [&options.jsx_import_source[..], b"/", runtime].concat())
}

fn lib_file(options: &Options, lib: &[u8]) -> Vec<u8> {
    lib_file_in(&options.lib_dir, lib)
}

fn lib_file_in(directory: &[u8], lib: &[u8]) -> Vec<u8> {
    if lib.is_empty() {
        return [directory, b"/lib.d.ts"].concat();
    }
    [directory, b"/lib.", lib, b".d.ts"].concat()
}

/// True if `directory` has every file of `Options::libs`. The files they refer to are next to them.
pub fn has_libraries(host: &dyn Host, options: &Options, directory: &[u8]) -> bool {
    let mut files = (options.libs.iter()).map(|lib| lib_file_in(directory, lib_file_stem(lib)));
    files.all(|file| host.is_file(&file))
}

/// `GetLibFileName`: the `N` of the `lib.N.d.ts` that contains the library `lib`, a result of
/// `lib_name`.
fn lib_file_stem(lib: &[u8]) -> &[u8] {
    crate::resolve::LIB_FALLBACKS.get(lib).map_or(lib, |it| *it)
}

/// `GetLibFileName` of the name `reference_text` in a `/// <reference lib>`. Another TypeScript version's
/// library directory may lack the file, in which case the name counts as unknown too.
fn referenced_lib(host: &dyn Host, options: &Options, reference_text: &[u8]) -> Option<Vec<u8>> {
    get_lib_file_name(reference_text).filter(|lib| host.is_file(&lib_file(options, lib)))
}

/// `ForEachDynamicImportOrRequireCall`: it looks at each `import` and `require` in the text, and
/// takes the node around it (`GetNodeAtPosition`, which doesn't descend into tokens). So a call is
/// found one more time for each such word in its specifier, or in a comment inside or before it.
fn dynamic_imports<'a>(hir: &'a hir::File) -> Vec<&'a SpecifierUse> {
    let text = &hir.text[..];
    let uses = hir.specifier_uses.iter().filter(|u| u.kind.is_dynamic());
    let mut uses: Vec<&SpecifierUse> = uses.collect();
    uses.shared_sort_by_key(|u| u.pos);
    let words = find_import_or_require(text);
    // From `node.Pos()` to the first child that isn't a token. A call has none before the token
    // after its specifier. In an import type the specifier is in a `LiteralType`.
    let mut ranges: Vec<(usize, usize, &SpecifierUse)> = Vec::new();
    for &(at, end) in &words {
        let open = skip_trivia(text, end);
        if text.get(open) != Some(&b'(') {
            continue;
        }
        let specifier = skip_trivia(text, open + 1);
        let Ok(u) = uses.binary_search_by_key(&(specifier as u32), |u| u.pos) else {
            continue;
        };
        let mut end = open + 1;
        if uses[u].kind.is_call() {
            end = specifier + 1;
            while end < text.len() && text[end] != text[specifier] {
                end += if text[end] == b'\\' { 2 } else { 1 };
            }
            end = skip_trivia(text, end + 1);
        }
        ranges.push((skip_trivia_back(text, at), end, uses[u]));
    }
    let mut found = Vec::new();
    let mut ranges = ranges.iter().peekable();
    for &(at, _) in &words {
        while ranges.next_if(|range| range.1 <= at).is_some() {}
        if let Some(&&(start, _, u)) = ranges.peek()
            && start <= at
        {
            found.push(u);
        }
    }
    found
}

/// `collectModuleReferences`: `IsAmbientModule(node) && (inAmbientModule ||
/// HasSyntacticModifier(node, ModifierFlagsAmbient) || file.IsDeclarationFile)`
fn ambient_module(hir: &hir::File, s: StmtId, is_in_ambient_module: bool) -> Option<ModuleId> {
    let StmtKind::Module(m) = hir[s].kind else {
        return None;
    };
    let is_ambient = is_in_ambient_module
        || hir[m].flags.contains(Flags::AMBIENT)
        || hir.kind == FileKind::Declaration;
    (is_ambient && !matches!(hir[m].name, ModuleName::Ident(_))).then_some(m)
}

/// `collectModuleReferences`: the import and export statements that it visits, in order, each with its start, its end
/// and `inAmbientModule`. It visits the file's statements and, in a script, those of the ambient modules the file
/// declares. It doesn't visit module augmentations or namespaces.
fn module_references(hir: &hir::File) -> Vec<(u32, u32, bool)> {
    let mut references = Vec::new();
    let mut visit = |s: StmtId, is_in_ambient_module: bool| {
        // `IsAnyImportOrReExport`
        let is_import_or_reexport = matches!(
            hir[s].kind,
            StmtKind::Import(_)
                | StmtKind::ImportEquals(_)
                | StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
        );
        if is_import_or_reexport {
            references.push((hir[s].start, hir[s].loc.end, is_in_ambient_module));
        }
        is_import_or_reexport
    };
    for s in hir.ids(hir.body) {
        if !visit(s, false)
            && !hir.has_module_syntax
            && let Some(m) = ambient_module(hir, s, false)
        {
            for s in hir.ids(hir[m].body) {
                visit(s, true);
            }
        }
    }
    // The one for an `@import` inside a statement comes before that statement.
    references.shared_sort_unstable();
    references
}

/// True if `u` is one of `file.Imports()`. `visited`: the `module_references` of the file.
fn is_among_imports(visited: &[(u32, u32, bool)], atoms: &Interner, u: &SpecifierUse) -> bool {
    // `ForEachDynamicImportOrRequireCall` looks at the whole text.
    if u.kind.is_dynamic() {
        return u.spec.is_some();
    }
    let after = visited.partition_point(|statement| statement.0 <= u.pos);
    after.checked_sub(1).is_some_and(|at| {
        let (_, end, is_in_ambient_module) = visited[at];
        // "Relative external module names are not permitted."
        u.pos < end && !(is_in_ambient_module && is_relative(atoms.bytes(u.spec)))
    })
}

/// `file.ModuleAugmentations` (`collectModuleReferences`), as the declarations whose names they are.
fn module_augmentations(hir: &hir::File, atoms: &Interner) -> Vec<ModuleId> {
    let mut augmentations = Vec::new();
    for s in hir.ids(hir.body) {
        let Some(m) = ambient_module(hir, s, false) else {
            continue;
        };
        if hir.has_module_syntax {
            augmentations.push(m);
            continue;
        }
        let nested = hir.ids(hir[m].body);
        let nested = nested.filter_map(|s| ambient_module(hir, s, true));
        augmentations.extend(nested.filter(|&nested| {
            !matches!(hir[nested].name, ModuleName::String(name) if is_relative(atoms.bytes(name)))
        }));
    }
    augmentations
}

/// True if `mergeModuleAugmentation` merges `symbol`, which a `declare global` or a `declare module
/// "m"` declares. It only does so for `symbol.Declarations[0]`, so that has to be one of
/// `collected`, the `module_augmentations` of the file.
fn merges_module_augmentation(bound: &Bound, collected: &[ModuleId], symbol: SymbolId) -> bool {
    matches!(
        bound.symbol(symbol).decls.first(),
        Some(Decl::Module(first)) if collected.contains(first)
    )
}

/// `resolveLibrary`'s arguments.
struct LibraryName {
    /// `getLibraryNameFromLibFileName`
    name: Vec<u8>,
    /// `getInferredLibraryNameResolveFrom`
    from: Vec<u8>,
}

fn library_name_and_resolve_from(options: &Options, lib: &[u8]) -> LibraryName {
    // `dom.iterable` is `@typescript/lib-dom/iterable`, `es2015.symbol.wellknown` is
    // `@typescript/lib-es2015/symbol-wellknown`.
    let mut name = b"@typescript/lib-".to_vec();
    for (i, part) in strings::split(lib, b".").enumerate() {
        match i {
            0 => {}
            1 => name.push(b'/'),
            _ => name.push(b'-'),
        }
        name.extend_from_slice(part);
    }
    let from = [
        &options.base_dir[..],
        b"/__lib_node_modules_lookup_lib.",
        lib,
        b".d.ts__.ts",
    ]
    .concat();
    LibraryName { name, from }
}

/// `pathForLibFile`: the path `lib.<lib>.d.ts` is read from. The task for it has a `libFile`,
/// replaced or not.
fn lib_path(resolver: &Resolver, options: &Options, lib: &[u8]) -> Vec<u8> {
    // `name != "lib.d.ts"`
    if options.lib_replacement && !lib.is_empty() {
        let LibraryName { name, from } = library_name_and_resolve_from(options, lib);
        // `resolveLibrary`: always resolved the way `require` resolves.
        if let Some(found) = resolver.resolve_module_name(&name, &from, ResolutionMode::Require) {
            return found.file_name.to_vec();
        }
    }
    lib_file(options, lib)
}

/// `pathForLibFile`, as far as `traceResolution` exposes it. The first time it's called for `lib`,
/// the resolution's lookups go through `cache`, and `libResolution.trace` is added to `resolutions`
/// (`pathForLibFileResolutions`), which is sorted by key.
fn trace_path_for_lib_file(
    host: &dyn Host,
    resolver: &Resolver,
    options: &Options,
    lib: &[u8],
    cache: &mut PackageJsonInfoCache,
    resolutions: &mut Vec<(Vec<u8>, Vec<DiagAndArgs>)>,
) {
    // `name != "lib.d.ts"`
    if !options.lib_replacement || lib.is_empty() {
        return;
    }
    let LibraryName { name, from } = library_name_and_resolve_from(options, lib);
    let key = to_path(&from, host.is_case_sensitive()).into_owned();
    let Err(at) = resolutions.binary_search_by(|known| known.0.cmp(&key)) else {
        return;
    };
    let tracer = Tracer::default();
    resolver.resolve_module_name_traced(&name, &from, ResolutionMode::Require, Some(&tracer));
    let mut trace = tracer.into_traces();
    cache.get_package_json_infos(host, &mut trace);
    resolutions.insert(at, (key, trace));
}

/// The tasks of `processAllProgramFiles` for the libraries: for each of `Options::libs` its reason,
/// `pathForLibFile`, and the error of `parseTask.load` for the extension of a file that replaces
/// it. Such a file isn't read.
fn lib_tasks(
    host: &dyn Host,
    resolver: &Resolver,
    options: &Options,
) -> impl Iterator<Item = (IncludeReason, Vec<u8>, Option<u32>)> {
    options.libs.iter().map(move |lib| {
        let stem = lib_file_stem(lib);
        let entry = [b"lib.", stem, b".d.ts"].concat();
        let reason = IncludeReason::LibFile(options.specifies_lib.then_some(entry));
        let path = lib_path(resolver, options, stem);
        let error = unsupported_extension_of_lib(host, options, &path);
        (reason, path, error)
    })
}

/// `unsupported_extension_error` for `path`, a result of `lib_path`.
fn unsupported_extension_of_lib(host: &dyn Host, options: &Options, path: &[u8]) -> Option<u32> {
    if !options.lib_replacement {
        return None;
    }
    unsupported_extension_error(options, path, host.is_case_sensitive())
        .filter(|_| host.script_kind(path).is_none())
}

/// `HasExtension`
fn has_extension(path: &[u8]) -> bool {
    strings::contains_char(
        &path[strings::last_index_of_char(path, b'/').map_or(0, |i| i + 1)..],
        b'.',
    )
}

/// The first test of `getSourceFileFromReference` and of `parseTask.load`: the error code for a file name whose
/// extension isn't supported (`isSupportedExtension` of `GetCanonicalFileName`). JavaScript needs `allowJs`, JSON needs
/// `resolveJsonModule`. `None` for a name without an extension.
fn unsupported_extension_error(
    options: &Options,
    path: &[u8],
    is_case_sensitive: bool,
) -> Option<u32> {
    if !has_extension(path) {
        return None;
    }
    let mut buffer = path_buffer_pool::get();
    let canonical_file_name = to_path_in(path, is_case_sensitive, &mut buffer[..]);
    let canonical_file_name = &canonical_file_name[..];
    let is_supported = has_ts_implementation_extension(canonical_file_name)
        || options.allow_js && is_javascript(canonical_file_name)
        || options.resolve_json_module && canonical_file_name.ends_with(b".json");
    if is_supported {
        return None;
    }
    Some(match is_javascript(canonical_file_name) {
        true => 6504,
        false => 6054,
    })
}

/// The full diagnostic for the error `code` that `referenced_file` returns for the file at `path`.
fn reference_problem(options: &Options, code: u32, path: &[u8]) -> Problem {
    let file_name = displayed_path(path);
    if code == 6504 || code == 6053 {
        return Problem::new(code, &[&file_name], ConfigLocation::Nowhere);
    }
    let extensions = supported_extensions(options).concat();
    let quoted = [b"'", &extensions.join(&b"', '"[..])[..], b"'"].concat();
    Problem::new(code, &[&file_name, &quoted], ConfigLocation::Nowhere)
}

/// `resolveTripleslashPathReference`: the path that the `/// <reference path>` with the value
/// `reference_text` in the file at `from` refers to.
fn referenced_path(reference_text: &[u8], from: &[u8]) -> Vec<u8> {
    join(dirname::<Posix>(from), reference_text)
}

/// `getSourceFileFromReference`: the file that a `/// <reference path>` in `from` resolves to,
/// where `name` is the referenced path; or else the error reported for it.
fn referenced_file(
    host: &dyn Host,
    options: &Options,
    name: &[u8],
    from: &[u8],
) -> Result<Vec<u8>, u32> {
    let allow_non_ts_extensions = host.script_kind(name).is_some();
    let is_case_sensitive = host.is_case_sensitive();
    // With an extension, it's that exact file or nothing.
    if has_extension(name) {
        if !allow_non_ts_extensions
            && let Some(code) = unsupported_extension_error(options, name, is_case_sensitive)
        {
            return Err(code);
        }
        if !host.is_file(name) {
            return Err(6053);
        }
        if is_same_path(name, from, is_case_sensitive) {
            return Err(1006);
        }
        return Ok(name.to_vec());
    }
    if allow_non_ts_extensions {
        return match host.is_file(name) {
            true => Ok(name.to_vec()),
            false => Err(6053),
        };
    }
    supported_extensions(options)[0]
        .iter()
        .map(|e| [name, &e[..]].concat())
        .find(|c| host.is_file(c))
        .ok_or(6231)
}

/// `UsesWildcardTypes`
fn uses_wildcard_types(options: &Options) -> bool {
    (options.types.iter().flatten()).any(|it| it == b"*")
}

/// The `N` of each `/// <reference lib="N" />` in the file at `path`.
pub fn libs_referenced_by(host: &dyn Host, path: &[u8]) -> Vec<Vec<u8>> {
    let Some(text) = host.read(path) else {
        return Vec::new();
    };
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let hir = host.parse(
        session.arena(),
        path,
        &text,
        &atoms,
        ParseOptions::default(),
    );
    let libs = (hir.references.iter()).filter(|it| it.0 == ReferenceKind::Lib);
    libs.map(|it| crate::resolve::lib_name(atoms.bytes(it.1)))
        .collect()
}

/// `GetAutomaticTypeDirectiveNames`: the entries of `compilerOptions.types`. A `*` in it represents
/// every package under the type roots.
fn automatic_type_directives(
    host: &dyn Host,
    resolver: &Resolver,
    options: &Options,
) -> Vec<Vec<u8>> {
    // Since TypeScript 6.0 nothing under `node_modules/@types` is included unless something
    // requests it.
    let Some(types) = &options.types else {
        return Vec::new();
    };
    if !uses_wildcard_types(options) {
        return types.clone();
    }
    let mut packages = Vec::new();
    for root in options.effective_type_roots() {
        let mut names = host.list_dir(&root);
        names.shared_sort_unstable();
        for name in names {
            if !host.is_dir(&inside(&root, &name)) {
                continue;
            }
            // `CombinePaths(root, normalized)`: a name can be a root (`c:`) or have a `\`.
            let dir = join(&root, &name);
            // `Typings.Null`: `"typings": null` is how a package declares that it isn't needed.
            // `Null` stays set whatever value follows for the same name.
            let is_not_needed_package = resolver.package_json(&dir).is_some_and(|fields| {
                let mut fields = fields.as_object().unwrap_or_default().iter();
                fields.any(|field| field.0 == b"typings" && field.1 == Json::Null)
            });
            let normalized = join(b"/", &name);
            let base_file_name = get_base_file_name(typescript_path(&normalized));
            if !is_not_needed_package && !base_file_name.starts_with(b".") {
                packages.push(base_file_name.to_vec());
            }
        }
    }
    let mut all: Vec<Vec<u8>> = Vec::new();
    for name in types {
        let names = if name == b"*" {
            packages.as_slice()
        } else {
            std::slice::from_ref(name)
        };
        for name in names {
            if !all.contains(name) {
                all.push(name.clone());
            }
        }
    }
    all
}

/// `GetPathComponents` of an absolute path: the root, then the names. The root is empty, or a
/// drive: `/c:/a` is `c:/a` to TypeScript.
fn components_of_path(path: &[u8]) -> Vec<&[u8]> {
    let mut parts: Vec<&[u8]> = strings::split(path, b"/")
        .filter(|part| !part.is_empty())
        .collect();
    let starts_with_drive = parts
        .first()
        .is_some_and(|first| matches!(first, [letter, b':'] if letter.is_ascii_alphabetic()));
    if !starts_with_drive {
        parts.insert(0, b"");
    }
    parts
}

/// `computeCommonSourceDirectoryOfFilenames`. `None`: the files have nothing in common, not even the drive.
fn common_directory_of(
    files: &[&[u8]],
    current_directory: &[u8],
    is_case_sensitive: bool,
) -> Option<Vec<u8>> {
    fn directory(file: &[u8]) -> Vec<&[u8]> {
        let mut parts = components_of_path(file);
        parts.pop();
        parts
    }
    // "Can happen when all input files are .d.ts files"
    let Some((first, rest)) = files.split_first() else {
        return Some(current_directory.to_vec());
    };
    let mut common = directory(first);
    for file in rest {
        let parts = directory(file);
        let shared = common
            .iter()
            .zip(&parts)
            .take_while(|(a, b)| is_same_path(a, b, is_case_sensitive))
            .count();
        if shared == 0 {
            return None;
        }
        common.truncate(shared);
    }
    Some(join(b"/", &common.join(&b"/"[..])))
}

/// `FileIncludeReason`
enum IncludeReason {
    /// `fileIncludeKindRootFile`: the index in `FileNames()`.
    RootFile(usize),
    /// `fileIncludeKindLibFile`: the entry of `lib`. `None`: it is the default library.
    LibFile(Option<Vec<u8>>),
    /// `fileIncludeKindAutomaticTypeDirectiveFile`: `typeReference` and `packageId.String()`.
    AutomaticTypeDirectiveFile(Vec<u8>, Option<Vec<u8>>),
    /// The kinds for which `isReferencedFile` is true.
    Reference(Reference),
}

/// `referenceFileLocation`
struct Reference {
    target: FileId,
    /// The code of the message, in its variant without a package id. `fileIncludeKindImport`: 1393,
    /// 1395 for the helpers, 1397 for the JSX runtime. `fileIncludeKindReferenceFile`: 1400.
    /// `fileIncludeKindTypeReferenceDirective`: 1402. `fileIncludeKindLibReferenceDirective`: 1405.
    code: u32,
    from: FileId,
    start: u32,
    end: u32,
    /// `packageId.String()`
    package_id: Option<Vec<u8>>,
    /// `normalizedFilePath` of the task that `parseTask.redirect` has redirected to `target`.
    redirected_from: Option<Vec<u8>>,
}

impl Reference {
    /// `isSynthetic`
    fn is_synthetic(&self) -> bool {
        matches!(self.code, 1395 | 1397)
    }
}

/// One visit of `collectFiles` to a file.
struct Visit {
    reason: IncludeReason,
    /// `task.normalizedFilePath`
    name: Vec<u8>,
    /// How many visits came before it.
    order: usize,
}

impl Visit {
    /// `isReferencedFile`
    fn is_reference(&self) -> bool {
        matches!(self.reason, IncludeReason::Reference(_))
    }

    /// The location to report it at, if it has one.
    fn location(&self) -> Option<(FileId, u32, u32)> {
        match &self.reason {
            IncludeReason::Reference(it) if !it.is_synthetic() => Some((it.from, it.start, it.end)),
            _ => None,
        }
    }
}

/// How many times `ForEachDynamicImportOrRequireCall` adds the specifier `u` of a call to
/// `file.Imports()`: once for each `import` and `require` in the text at which `GetNodeAtPosition`
/// finds the call. A token isn't a node to it (`KindFirstNode`), so that covers the call's own
/// tokens, including the specifier, and the comments before and between them.
fn times_among_imports(hir: &File, calls: &ExprsByKind, text: &[u8], u: &SpecifierUse) -> usize {
    let is_match =
        |args: IdList<ExprId>| hir.ids(args).next().is_some_and(|it| hir[it].pos == u.pos);
    let calls_of_kind = match u.kind {
        SpecifierKind::ImportCall => calls.of(ExprTag::ImportCall),
        _ => calls.of(ExprTag::Call),
    };
    let found = calls_of_kind.iter().find_map(|&e| match hir[e].kind {
        ExprKind::ImportCall { args } if is_match(args) => Some((e, args)),
        ExprKind::Call(call) if is_match(hir[call].args) => Some((e, hir[call].args)),
        _ => None,
    });
    let Some((call, args)) = found else {
        return 1;
    };
    let spans = Spans::of(hir);
    // `Loc`
    let range = |e: ExprId| {
        (
            skip_trivia_back(text, start_of(hir, e) as usize),
            spans.expr(e),
        )
    };
    let is_token = |e: &ExprId| {
        use ExprKind::*;
        !is_parenthesized(hir, *e)
            && matches!(
                hir[*e].kind,
                Missing
                    | Ident(_)
                    | PrivateIdentifier(_)
                    | This
                    | Super
                    | Null
                    | True
                    | False
                    | Number(_)
                    | String(_)
                    | BigInt(_)
                    | Regex
            )
    };
    let (mut at, end) = range(call);
    let mut times = 0;
    // In JavaScript the `/** */` before a statement are nodes of it (`includeJSDoc`).
    let start = start_of(hir, call);
    let is_first = |s: &Stmt| matches!(s.kind, StmtKind::Expr(e) if start_of(hir, e) == start);
    if hir.is_js && hir.stmts.iter().any(is_first) {
        times += count_after_jsdoc(&text[at..start as usize]);
        at = start as usize;
    }
    for (from, to) in hir.ids(args).filter(|e| !is_token(e)).map(range) {
        times += find_import_or_require(&text[at..from.max(at)]).len();
        at = to.max(at);
    }
    (times + find_import_or_require(&text[at..end.max(at)]).len()).max(1)
}

/// Counts `find_import_or_require` in `trivia`, after the last `/** */` in it. `withJSDoc`: a `JSDoc`
/// begins where the one before it ends, and the first one where its host begins.
fn count_after_jsdoc(trivia: &[u8]) -> usize {
    // `isShebangTrivia`
    let mut at = match trivia.starts_with(b"#!") {
        true => strings::index_of_any(trivia, b"\n\r").unwrap_or(trivia.len()),
        false => 0,
    };
    let mut end_of_jsdoc = 0;
    while let Some(next) = strings::index_of_char_usize(&trivia[at..], b'/') {
        at += next;
        let rest = &trivia[at..];
        let end = match rest.get(1) {
            Some(b'/') => strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len()),
            _ => {
                strings::index_of(&rest[2.min(rest.len())..], b"*/").map_or(rest.len(), |it| it + 4)
            }
        };
        at += end.max(1);
        // `/**/` isn't a JSDoc comment.
        if rest.starts_with(b"/**") && end > 4 {
            end_of_jsdoc = at;
        }
    }
    find_import_or_require(&trivia[end_of_jsdoc..]).len()
}

/// The matches of `findImportOrRequire` in `text`: the start and end of each word.
fn find_import_or_require(text: &[u8]) -> Vec<(usize, usize)> {
    let mut words: Vec<(usize, usize)> = Vec::new();
    let mut index = 0;
    while let Some(at) = strings::index_of_any(&text[index..], b"ir").map(|at| index + at) {
        let word: &[u8] = if text[at] == b'i' {
            b"import"
        } else {
            b"require"
        };
        index = if text[at..].starts_with(word) {
            words.push((at, at + word.len()));
            at + word.len()
        } else {
            at + 1
        };
    }
    words
}

/// The end of the string literal that starts at `start`.
fn end_of_string_literal(text: &[u8], start: u32) -> u32 {
    let Some(&quote) = text.get(start as usize) else {
        return start;
    };
    let mut at = start as usize + 1;
    while let Some(&c) = text.get(at) {
        at += 1;
        match c {
            b'\\' => at += 1,
            b'\n' => return at as u32 - 1,
            _ if c == quote => break,
            _ => {}
        }
    }
    at.min(text.len()) as u32
}

/// `getModeForUsageLocation`. `default_mode`: that of the file that contains the use.
pub(crate) fn mode_for_usage_location(
    options: &Options,
    default_mode: ResolutionMode,
    u: &SpecifierUse,
) -> ResolutionMode {
    match u.kind {
        _ if u.mode != ResolutionMode::None => u.mode,
        _ if !options.import_syntax_affects_module_resolution() => ResolutionMode::None,
        // `getEmitSyntaxForUsageLocationWorker`: the argument of `require()` is resolved as
        // CommonJS, whatever the file is emitted as.
        SpecifierKind::Require | SpecifierKind::RequireCall => ResolutionMode::Require,
        SpecifierKind::ImportCall => options.import_call_mode(default_mode),
        _ => default_mode,
    }
}

/// `GetImpliedNodeFormatForEmitWorker` over `loadSourceFileMetaData`: the format the file at `path`
/// is emitted as under `module: emit_module_kind`, if its name or its package determines that. The
/// meta data depend on the options of the program, which are those of `resolver`. The module kind
/// is that of the project the file belongs to (`getCompilerOptionsForFile`).
fn implied_node_format_for_emit(
    resolver: &Resolver,
    path: &[u8],
    is_lib: bool,
    emit_module_kind: ModuleKind,
) -> ResolutionMode {
    let by_extension = format_by_extension(path);
    // `parseTask.load`: `SourceFileMetaData{ImpliedNodeFormat: ResolutionModeCommonJS}`
    if is_lib {
        return if emit_module_kind.is_node() || by_extension == ResolutionMode::Require {
            ResolutionMode::Require
        } else {
            ResolutionMode::None
        };
    }
    if by_extension != ResolutionMode::None
        || !file_extension_is_one_of(path, &[b".ts", b".tsx", b".js", b".jsx"])
    {
        return by_extension;
    }
    // `PackageJsonType`
    let package_json_type =
        if resolver.options().resolves_like_node || strings::contains(path, b"/node_modules/") {
            resolver.package_type(path)
        } else {
            ResolutionMode::None
        };
    if emit_module_kind.is_node() && package_json_type != ResolutionMode::Import {
        return ResolutionMode::Require;
    }
    package_json_type
}

/// `ResolvedModule.Extension`, as far as `GetResolutionDiagnostic` distinguishes extensions.
#[derive(Copy, Clone)]
enum Extension {
    /// `.ts`, `.mts`, `.cts`, and the declaration files of these.
    Ts,
    Tsx,
    Jsx,
    /// `.js`, `.mjs`, `.cjs`
    Js,
    Json,
    /// `.d.css.ts` and the like.
    Arbitrary,
}

impl Extension {
    fn of(host: &dyn Host, resolved: &ResolvedModule) -> Extension {
        let found = resolved.file_name;
        if is_javascript_file(host, found) {
            match found.ends_with(b".jsx") {
                true => Extension::Jsx,
                false => Extension::Js,
            }
        } else if resolved.has_arbitrary_extension {
            Extension::Arbitrary
        } else if found.ends_with(b".tsx") && !resolved.is_project_reference_redirect {
            Extension::Tsx
        } else if found.ends_with(b".json") {
            Extension::Json
        } else {
            Extension::Ts
        }
    }
}

/// `GetResolutionDiagnostic`: the code of the message. `file`: the importing file.
fn get_resolution_diagnostic(options: &Options, extension: Extension, file: &File) -> Option<u32> {
    let need_jsx = || (options.jsx == JsxEmit::None).then_some(6142);
    let need_allow_js = || {
        let is_allowed = options.allow_js || !options.specifies_no_implicit_any;
        (!is_allowed).then_some(7016)
    };
    let need_resolve_json_module = || (!options.resolve_json_module).then_some(7042);
    let need_allow_arbitrary_extensions = || {
        let is_declaration_file = file.kind == FileKind::Declaration;
        (!is_declaration_file && !options.allow_arbitrary_extensions).then_some(6263)
    };
    match extension {
        Extension::Ts => None,
        Extension::Tsx => need_jsx(),
        Extension::Jsx => need_jsx().or_else(need_allow_js),
        Extension::Js => need_allow_js(),
        Extension::Json => need_resolve_json_module(),
        Extension::Arbitrary => need_allow_arbitrary_extensions(),
    }
}

/// `resolveImportsAndModuleAugmentations`: with `importHelpers`, a file that can be emitted with
/// helpers imports `tslib`.
fn imports_helpers(options: &Options, hir: &File) -> bool {
    // A JSON file is bound as a module, and has no `ExternalModuleIndicator`.
    let is_external_module = hir.has_module_syntax && hir.kind != FileKind::Json;
    options.import_helpers
        && (hir.is_js
            || hir.kind != FileKind::Declaration
                && (options.isolated_modules || is_external_module))
}

/// `addRootFileTask`: the file that's read for the root file `root`, or else the error. `Ok(None)`:
/// a declaration file that hasn't been built.
fn root_file_name(host: &dyn Host, options: &Options, root: &[u8]) -> Result<Option<Vec<u8>>, u32> {
    let found = referenced_file(host, options, root, b"")?;
    Ok(match options.parse_file_redirect(&found) {
        Some(output) => host.is_file(output).then(|| output.to_vec()),
        None => Some(found),
    })
}

/// `GetNormalizedAbsolutePathWithoutRoot`. `c:/a` is `/c:/a` here.
fn without_root(path: &[u8]) -> &[u8] {
    match path {
        [b'/', drive, b':', rest @ ..] if drive.is_ascii_alphabetic() => rest,
        _ => path,
    }
}

/// The parts of a program that the `includeProcessor` reads.
struct Included<'a, 's> {
    host: &'a dyn Host,
    options: &'a Options,
    atoms: &'a Interner<'s>,
    modules: &'a [ModuleCell<'s>],
    by_path: &'a ByPath<'s>,
    /// The names of the root files.
    roots: &'a [Vec<u8>],
    /// The files of `rootTasks`: the libraries up to `libs_end`, the root files up to `roots_end`,
    /// then what the automatic type directives resolve to.
    starts: &'a [FileId],
    libs_end: usize,
    roots_end: usize,
    /// For each of those root files, its index in `roots`.
    root_of_start: &'a [u32],
    /// The keys of `redirectAndFileFormat` that `createDiagnosticExplainingFile` has stored: a file
    /// name for each path.
    explained_in_diagnostics: std::cell::RefCell<Vec<Vec<u8>>>,
    /// The span of each entry of `files` and of `include` in the configuration file, which is
    /// parsed once for all of them. `None`: it can't be parsed.
    top_elements_in_configuration: std::cell::OnceCell<Option<[TopElements; 2]>>,
    /// `getMatchedFileSpec` for every path at once: maps a path to the first of
    /// `Options::file_specs` that has it.
    file_spec_by_path: std::cell::OnceCell<FxHashMap<Cow<'a, [u8]>, &'a [u8]>>,
}

type TopElements = FxHashMap<Vec<u8>, (u32, u32)>;

/// A problem with the inclusion of a file, and where it's reported if that's in a file.
type Explanation = (Option<(FileId, u32, u32)>, Problem);

/// The position of `Included::visits` in a file: the file, how many of its edges have been
/// followed, and its remaining references, if it refers to a file in `is_requested`.
type Frame = (
    FileId,
    usize,
    Option<std::vec::IntoIter<(Reference, Vec<u8>)>>,
);

impl Included<'_, '_> {
    /// `referenceFileLocation` of each reference in `file` to a file of the program, with
    /// `task.normalizedFilePath`, in the order of `parseTask.subTasks`. Only a reference to a file
    /// in `is_requested` gets its package id.
    fn references_in(
        &self,
        program_resolver: &Resolver,
        file: FileId,
        is_requested: &[bool],
    ) -> Vec<(Reference, Vec<u8>)> {
        let &Included {
            host,
            options: program_options,
            atoms,
            by_path,
            ..
        } = self;
        let module: &Module = &self.modules[file.idx()];
        let hir = &module.hir;
        let text: &[u8] = &module.hir.text;
        let (resolver, from) = program_resolver.redirect_for_resolution(module.file_name());
        let options = resolver.options();
        let mut references = Vec::new();
        let mut refer = |name: Vec<u8>,
                         code: u32,
                         (start, end),
                         package_id: Option<Vec<u8>>,
                         redirected_from: Option<Vec<u8>>| {
            if let Some(target) = by_path.get(&name) {
                let reference = Reference {
                    target,
                    code,
                    from: file,
                    start,
                    end,
                    package_id,
                    redirected_from,
                };
                references.push((reference, name));
            }
        };
        // They are processed by kind: paths, then types, then libraries.
        for current_kind in [
            ReferenceKind::Path,
            ReferenceKind::Types,
            ReferenceKind::Lib,
        ] {
            for &(kind, value, pos, mode) in hir.references.iter() {
                // `noResolve`: only library references are still processed.
                if kind != current_kind || program_options.no_resolve && kind != ReferenceKind::Lib
                {
                    continue;
                }
                let value = atoms.bytes(value);
                let end = pos + value.len() as u32;
                let mut redirected_from = None;
                let (name, code) = match kind {
                    ReferenceKind::Path => {
                        let reference_path = referenced_path(value, module.file_name());
                        let found = referenced_file(
                            host,
                            program_options,
                            &reference_path,
                            module.file_name(),
                        )
                        .ok();
                        let found =
                            found.and_then(|it| match program_options.parse_file_redirect(&it) {
                                Some(output) => {
                                    redirected_from = Some(it);
                                    host.is_file(output).then(|| output.to_vec())
                                }
                                None => Some(it),
                            });
                        (found, 1400)
                    }
                    ReferenceKind::Types => {
                        // `getModeForTypeReferenceDirectiveInFile`
                        let mode = match mode {
                            ResolutionMode::None => module.implied_format,
                            mode => mode,
                        };
                        let found = resolver.resolve_type_reference_and_id(value, from, mode, None);
                        (found.map(|it| it.0), 1402)
                    }
                    ReferenceKind::Lib if program_options.no_lib => (None, 1405),
                    ReferenceKind::Lib => {
                        let lib = referenced_lib(host, program_options, value);
                        let found =
                            lib.map(|lib| lib_path(program_resolver, program_options, &lib));
                        (found, 1405)
                    }
                };
                // `getReferencedLocation`: only that of an import has a `packageId`.
                if let Some(name) = name {
                    refer(name, code, (pos, end), None, redirected_from);
                }
            }
        }
        // `resolveImportsAndModuleAugmentations`: the synthetic imports come first.
        let mut specifiers: Vec<(Atom, ResolutionMode, u32, u32, u32)> = Vec::new();
        if imports_helpers(options, hir) {
            specifiers.push((known::tslib, module.default_mode, 1395, 0, 0));
        }
        if crate::resolve::is_jsx_file_name(module.file_name())
            && let Some(runtime) = jsx_runtime_of(options, hir, atoms)
        {
            specifiers.push((atoms.intern(&runtime), module.default_mode, 1397, 0, 0));
        }
        // `file.Imports()`: the specifiers of statements, then those of `import()`, the call and the type.
        let mut uses = hir.specifier_uses.to_vec();
        let visited = module_references(hir);
        uses.retain(|u| is_among_imports(&visited, atoms, u));
        uses.shared_sort_by_key(|u| (u.kind.is_dynamic(), u.pos));
        let calls = (uses.iter().any(|u| u.kind.is_call())).then(|| ExprsByKind::new(hir));
        for u in &uses {
            let mode = mode_for_usage_location(options, module.default_mode, u);
            let end = end_of_string_literal(text, u.pos);
            let times = calls.as_ref().filter(|_| u.kind.is_call());
            let times = times.map_or(1, |calls| times_among_imports(hir, calls, text, u));
            specifiers.extend(std::iter::repeat_n((u.spec, mode, 1393, u.pos, end), times));
        }
        for (spec, mode, code, start, end) in specifiers {
            let Some(&target) = module.imports.get(&(spec, mode)) else {
                continue;
            };
            // Use the file's own name unless the target is in `is_requested`.
            let requested_resolution = is_requested[target.idx()].then(|| {
                resolver.resolve_module_name_with_package_id(atoms.bytes(spec), from, mode)
            });
            match requested_resolution.flatten() {
                Some((found, id)) => {
                    // The reason belongs to `redirectedParseTask`.
                    let redirect = program_options.parse_file_redirect(found.file_name);
                    let name = redirect.unwrap_or(found.file_name).to_vec();
                    let redirected_from = redirect.map(|_| found.file_name.to_vec());
                    refer(name, code, (start, end), id, redirected_from);
                }
                None => {
                    let name = self.modules[target.idx()].file_name().to_vec();
                    refer(name, code, (start, end), None, None);
                }
            }
        }
        references
    }

    /// `fileIncludeReasons` of the files in `is_requested`, indexed by file. `collectFiles` adds a task's
    /// reason every time it reaches the task, even if it has already visited the file. Both lists
    /// have one more entry after the files, for the root files that aren't found, which have a task
    /// too.
    fn visits(&self, resolver: &Resolver, is_requested: &[bool]) -> Vec<Vec<Visit>> {
        let &Included {
            host,
            options,
            modules,
            starts,
            ..
        } = self;
        let no_file = FileId(modules.len() as u32);
        let mut visits: Vec<Vec<Visit>> = (0..=modules.len()).map(|_| Vec::new()).collect();
        let mut order = 0;
        let mut visit = |file: FileId, reason: IncludeReason, name: Vec<u8>| {
            visits[file.idx()].push(Visit {
                reason,
                name,
                order,
            });
            order += 1;
        };
        // `rootTasks`: the root files, the libraries, what the automatic type directives resolve to.
        let (libs, rest) = starts.split_at(self.libs_end);
        let (roots, automatic) = rest.split_at(self.roots_end - self.libs_end);
        let mut tasks: Vec<(FileId, Option<(IncludeReason, Vec<u8>)>)> = Vec::new();
        let mut found = roots.iter().zip(self.root_of_start).peekable();
        for (index, root) in self.roots.iter().enumerate() {
            let start = found.next_if(|it| *it.1 as usize == index).map(|it| *it.0);
            let name = match start {
                Some(start) if !is_requested[start.idx()] => None,
                Some(_) => root_file_name(host, options, root).ok().flatten(),
                None if !is_requested[no_file.idx()] => continue,
                None => root_file_name(host, options, root)
                    .is_err()
                    .then(|| root.clone()),
            };
            let reason = name.map(|name| (IncludeReason::RootFile(index), name));
            tasks.push((start.unwrap_or(no_file), reason));
        }
        let read = lib_tasks(host, resolver, options).filter(|task| task.2.is_none());
        for (&start, (reason, name, _)) in libs.iter().zip(read) {
            tasks.push((start, is_requested[start.idx()].then_some((reason, name))));
        }
        if automatic.iter().any(|start| is_requested[start.idx()]) {
            // `addAutomaticTypeDirectiveTasks`
            let from = inside(&options.base_dir, INFERRED_TYPES_CONTAINING_FILE);
            let found = (automatic_type_directives(host, resolver, options).into_iter())
                .filter_map(|name| {
                    let mode = ResolutionMode::None;
                    let found = resolver.resolve_type_reference_and_id(&name, &from, mode, None);
                    found.map(|(path, _, id)| {
                        let id = id.map(PackageId::to_bytes);
                        (IncludeReason::AutomaticTypeDirectiveFile(name, id), path)
                    })
                });
            tasks.extend(automatic.iter().copied().zip(found.map(Some)));
        } else {
            tasks.extend(automatic.iter().map(|&start| (start, None)));
        }
        let refers_to_requested =
            |file: FileId| (modules[file.idx()].edges.iter()).any(|edge| is_requested[edge.idx()]);
        let mut seen = vec![false; modules.len()];
        for (first, reason) in tasks {
            if let Some((reason, name)) = reason.filter(|_| is_requested[first.idx()]) {
                visit(first, reason, name);
            }
            if first == no_file {
                continue;
            }
            let frame = |file: FileId| -> Frame {
                let references = || self.references_in(resolver, file, is_requested).into_iter();
                (file, 0, refers_to_requested(file).then(references))
            };
            let mut stack: Vec<Frame> = Vec::new();
            if !std::mem::replace(&mut seen[first.idx()], true) {
                stack.push(frame(first));
            }
            while let Some(top) = stack.last_mut() {
                let edges = modules[top.0.idx()].edges;
                let edge = edges.get(top.1).copied();
                // `subTasks` has a task for each reference. The reason of one that repeats an earlier
                // reference of the file is added when the traversal gets to it.
                while let Some(references) = &mut top.2
                    && let Some((next, _)) = references.as_slice().first()
                {
                    let is_repeated = edges[..top.1].contains(&next.target);
                    if !is_repeated && Some(next.target) != edge {
                        break;
                    }
                    if let Some((reference, name)) = references.next()
                        && is_requested[reference.target.idx()]
                    {
                        visit(reference.target, IncludeReason::Reference(reference), name);
                    }
                    if !is_repeated {
                        break;
                    }
                }
                let Some(edge) = edge else {
                    stack.pop();
                    continue;
                };
                top.1 += 1;
                if !std::mem::replace(&mut seen[edge.idx()], true) {
                    stack.push(frame(edge));
                }
            }
        }
        visits
    }

    /// `GetEmitScriptTarget().String()`
    fn emit_script_target(&self) -> Vec<u8> {
        let target = match self.options.target {
            ScriptTarget::None => ScriptTarget::ES2025,
            target => target,
        };
        let mut name = Vec::new();
        let _ = write!(name, "{target:?}");
        name
    }

    /// `computeDiagnostic`: the code and the arguments of the message for a reason.
    fn reason_message(&self, visit: &Visit, to_file_name: ToFileName<'_>) -> (u32, Vec<Vec<u8>>) {
        let options = self.options;
        let uses_wildcard = uses_wildcard_types(options);
        let with_id = |code: u32, mut args: Vec<Vec<u8>>, id: Option<&Vec<u8>>| {
            args.extend(id.cloned());
            (code + u32::from(id.is_some()), args)
        };
        match &visit.reason {
            &IncludeReason::RootFile(index) => {
                root_file_reason(self, &self.roots[index], to_file_name)
            }
            IncludeReason::LibFile(Some(entry)) => (1422, vec![entry.clone()]),
            IncludeReason::LibFile(None) => (1425, vec![self.emit_script_target()]),
            IncludeReason::AutomaticTypeDirectiveFile(name, id) => {
                let code = if uses_wildcard { 1420 } else { 1417 };
                with_id(code, vec![name.clone()], id.as_ref())
            }
            IncludeReason::Reference(it) => {
                let from: &Module = &self.modules[it.from.idx()];
                // `referenceFileLocation.text`
                let location_text = match it.code {
                    1395 => b"\"tslib\"".to_vec(),
                    1397 => {
                        let runtime = jsx_runtime_of(options, &from.hir, self.atoms);
                        [&b"\""[..], &runtime.unwrap_or_default(), b"\""].concat()
                    }
                    _ => (from.hir.text.get(it.start as usize..it.end as usize))
                        .unwrap_or_default()
                        .to_vec(),
                };
                with_id(
                    it.code,
                    vec![location_text, to_file_name(from.file_name())],
                    it.package_id.as_ref(),
                )
            }
        }
    }

    /// `getMatchedFileSpec`: the first entry of `files` that refers to the file at `path`, as
    /// written. Its callers treat `""` as no match.
    fn matched_file_spec(&self, path: &[u8]) -> Option<&[u8]> {
        let is_case_sensitive = self.host.is_case_sensitive();
        let by_path = self.file_spec_by_path.get_or_init(|| {
            let mut by_path = FxHashMap::default();
            for (text, path) in &self.options.file_specs {
                let first = by_path.entry(to_path(path, is_case_sensitive));
                first.or_insert(&text[..]);
            }
            by_path
        });
        let spec = by_path.get(&to_path(path, is_case_sensitive)).copied();
        spec.filter(|spec| !spec.is_empty())
    }

    /// `toRelatedInfo`
    fn related_info(&self, visit: &Visit) -> Option<(FileId, u32, u32, u32)> {
        let options = self.options;
        let parsed = |then: &mut dyn FnMut(&crate::json::TsConfigSourceFile)| {
            let text = self.host.read(&options.config_path)?;
            let session = Session::new();
            then(&crate::json::TsConfigSourceFile::parse(
                self.host, &session, text,
            )?);
            Some(())
        };
        let in_configuration = |config_location: ConfigLocation, code: u32| {
            let mut span = None;
            parsed(&mut |file| {
                span = Problem::new(code, &[], config_location.clone()).span_in(file)
            });
            let (start, end) = span?;
            Some((IN_CONFIGURATION, start, end, code))
        };
        let top_element = |list: usize, spec: &[u8], code: u32| {
            let spans = self.top_elements_in_configuration.get_or_init(|| {
                let mut spans = None;
                parsed(&mut |file| {
                    let of = |name| crate::verify::spans_of_top_elements(file, name);
                    spans = Some([of(b"files"), of(b"include")]);
                });
                spans
            });
            let &(start, end) = spans.as_ref()?[list].get(spec)?;
            Some((IN_CONFIGURATION, start, end, code))
        };
        match &visit.reason {
            IncludeReason::Reference(it) => {
                let (file, start, end) = visit.location()?;
                let code = match it.code {
                    1400 => 1401,
                    1402 => 1404,
                    1405 => 1406,
                    _ => 1399,
                };
                Some((file, start, end, code))
            }
            _ if options.config_path.is_empty() => None,
            &IncludeReason::RootFile(index) => {
                match root_file_reason(self, &self.roots[index], &displayed_file_name) {
                    (1409, args) => top_element(0, &args[0], 1410),
                    (1407, args) => top_element(1, &args[0], 1408),
                    _ => None,
                }
            }
            IncludeReason::AutomaticTypeDirectiveFile(name, _) => {
                let config_location = ConfigLocation::Element(b"types", name.clone());
                (!uses_wildcard_types(options)).then(|| in_configuration(config_location, 1419))?
            }
            IncludeReason::LibFile(Some(entry)) => {
                in_configuration(ConfigLocation::Element(b"lib", entry.clone()), 1423)
            }
            IncludeReason::LibFile(None) => in_configuration(
                ConfigLocation::Element(b"target", self.emit_script_target()),
                1426,
            ),
        }
    }

    /// Groups `visits`, which are all to one file, by the path they used:
    /// `fileIncludeReasons[path]` for each path. A copy of a package file has its own path.
    fn by_path<'v>(&self, visits: &'v [Visit]) -> Vec<Vec<&'v Visit>> {
        let is_case_sensitive = self.host.is_case_sensitive();
        let mut by_path: Vec<Vec<&Visit>> = Vec::new();
        for visit in visits {
            let has_same_path =
                |it: &&mut Vec<&Visit>| is_same_path(&it[0].name, &visit.name, is_case_sensitive);
            match by_path.iter_mut().find(has_same_path) {
                Some(visits) => visits.push(visit),
                None => by_path.push(vec![visit]),
            }
        }
        by_path
    }

    /// The `visits` that used the path of the file called `name`.
    fn by_path_of<'v>(&self, visits: &'v [Visit], name: &[u8]) -> Vec<&'v Visit> {
        let is_case_sensitive = self.host.is_case_sensitive();
        let is_match = |visit: &&Visit| is_same_path(&visit.name, name, is_case_sensitive);
        visits.iter().filter(is_match).collect()
    }

    /// `createDiagnosticExplainingFile`: `visits` are the visits by one path, which represents
    /// `file`. `because`: `diagnosticReason`.
    fn explain(
        &self,
        resolver: &Resolver,
        file: FileId,
        visits: &[&Visit],
        because: Option<&Visit>,
        code: u32,
        args: &[&[u8]],
    ) -> Explanation {
        let is = |a: &Visit, b: &Visit| std::ptr::eq(a, b);
        let mut preferred_location = because.filter(|it| it.location().is_some());
        // `seenReasons`
        let other = because.filter(|&it| !visits.iter().any(|own| is(own, it)));
        let all: Vec<&Visit> = visits.iter().copied().chain(other).collect();
        let mut problem = Problem::new(code, args, ConfigLocation::Nowhere);
        for &visit in &all {
            // `processRelatedInfo`
            if preferred_location.is_none() && visit.location().is_some() {
                preferred_location = Some(visit);
            } else if !preferred_location.is_some_and(|it| is(it, visit)) {
                problem.related.extend(self.related_info(visit));
            }
        }
        if preferred_location.is_none() || all.len() != 1 {
            problem = problem.with(1, 1430, &[]);
            for visit in all {
                let (code, args) = self.reason_message(visit, &displayed_file_name);
                let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
                problem = problem.with(2, code, &args);
            }
        }
        let location = preferred_location.and_then(Visit::location);
        let Some(module) = self.modules.get(file.idx()) else {
            return (location, problem);
        };
        let name = visits.first().map_or(module.path.pretty, |it| &it.name[..]);
        for (code, args) in self.explain_redirect_and_implied_format(resolver, module, name, None) {
            let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
            problem = problem.with(1, code, &args);
        }
        (location, problem)
    }

    /// `explainRedirectAndImpliedFormat` for the path of `name`, the name of `module` or of a
    /// `redirectsFile` whose target is `module`: the code and the arguments of each message.
    /// `to_relative_file_name`: `toFileName` of `ExplainFiles`. `None` means the caller is
    /// `createDiagnosticExplainingFile`, which keeps names as they are. The result for a path is
    /// cached, so it has the names of the first caller. `ExplainFiles` calls last, and only once.
    fn explain_redirect_and_implied_format(
        &self,
        resolver: &Resolver,
        module: &Module,
        name: &[u8],
        to_relative_file_name: Option<ToFileName<'_>>,
    ) -> Vec<(u32, Vec<Vec<u8>>)> {
        let is_case_sensitive = self.host.is_case_sensitive();
        let mut explained = self.explained_in_diagnostics.borrow_mut();
        let is_explained = (explained.iter()).any(|it| is_same_path(it, name, is_case_sensitive));
        let to_file_name: ToFileName<'_> = match to_relative_file_name {
            Some(to_relative_file_name) if !is_explained => to_relative_file_name,
            _ => &displayed_file_name,
        };
        if to_relative_file_name.is_none() && !is_explained {
            explained.push(name.to_vec());
        }
        let mut result = Vec::new();
        // `redirectFilesByPath`
        let is_redirects_file = !is_same_path(name, module.file_name(), is_case_sensitive);
        if !is_redirects_file && module.project_reference_source.is_some() {
            let source = self.atoms.bytes(module.project_reference_source);
            result.push((1428, vec![to_file_name(source)]));
        }
        if is_redirects_file {
            result.push((1429, vec![to_file_name(module.file_name())]));
        } else {
            result.extend(implied_format_reason(
                resolver,
                self.options,
                module,
                to_file_name,
            ));
        }
        result
    }

    /// `createDiagnosticExplainingFile` for the `processingDiagnostics` of the tasks that don't
    /// read a file. `tasks`: the `diagnosticReason` and the message of each.
    fn explain_tasks_without_file(&self, tasks: &[(Visit, Problem)]) -> Vec<Explanation> {
        if tasks.is_empty() {
            return Vec::new();
        }
        let resolving = Session::new();
        let resolver = Resolver::new(&resolving, self.host, self.options);
        let no_file = FileId(self.modules.len() as u32);
        (tasks.iter())
            .map(|(because, message)| {
                let args: Vec<&[u8]> = message.args.iter().map(Vec::as_slice).collect();
                self.explain(&resolver, no_file, &[], Some(because), message.code, &args)
            })
            .collect()
    }

    /// Reports `code`, with the file and the path `arg` as arguments, for each source file that would be emitted and
    /// for which `is_wrong` returns true. `is_wrong`'s second argument is true for a root file.
    fn explain_source_files(
        &self,
        code: u32,
        arg: &[u8],
        is_wrong: &dyn Fn(&Module, bool) -> bool,
    ) -> Vec<Explanation> {
        let (options, modules) = (self.options, self.modules);
        let is_case_sensitive = self.host.is_case_sensitive();
        let mut is_root = vec![false; modules.len()];
        for root in self.roots {
            if let Some(id) = self.by_path.get(root) {
                is_root[id.idx()] = true;
            }
        }
        let mut is_reported: Vec<bool> = (modules.iter().zip(&is_root))
            .map(|(module, &is_root)| {
                source_file_may_be_emitted(options, module, is_case_sensitive)
                    && is_wrong(module, is_root)
            })
            .collect();
        if !is_reported.contains(&true) {
            return Vec::new();
        }
        is_reported.push(false);
        let resolving = Session::new();
        let resolver = Resolver::new(&resolving, self.host, options);
        let visits = self.visits(&resolver, &is_reported);
        (modules.iter().zip(&visits).enumerate())
            .map(|(i, (module, visits))| (i, module, self.by_path_of(visits, module.file_name())))
            .filter(|(.., visits)| !visits.is_empty())
            .map(|(i, module, visits)| {
                let file = FileId(i as u32);
                self.explain(
                    &resolver,
                    file,
                    &visits,
                    None,
                    code,
                    &[&displayed_path(module.file_name()), &displayed_path(arg)],
                )
            })
            .collect()
    }

    /// `normalizedFilePath` of the task that `parseTask.redirect` has redirected to the task that `visit` reaches.
    fn redirected_from<'v>(&'v self, visit: &'v Visit) -> Option<&'v [u8]> {
        match &visit.reason {
            IncludeReason::Reference(it) => it.redirected_from.as_deref(),
            &IncludeReason::RootFile(index) => {
                let root = &self.roots[index][..];
                self.options.parse_file_redirect(root).map(|_| root)
            }
            _ => None,
        }
    }

    /// `addProcessingDiagnosticsForFileCasing`, wherever `collectFiles` calls it. `respelled`: the
    /// files it reached under more than one spelling of their name. `case_variants`: the names that differ
    /// only in case, where that makes them the names of different files.
    fn file_casing_errors(
        &self,
        respelled: &[FileId],
        case_variants: &[Vec<(&[u8], FileId)>],
    ) -> Vec<Explanation> {
        if respelled.is_empty() && case_variants.is_empty() {
            return Vec::new();
        }
        let mut is_requested = vec![false; self.modules.len() + 1];
        let case_variant_files = case_variants.iter().flatten().map(|it| &it.1);
        for file in respelled.iter().chain(case_variant_files) {
            is_requested[file.idx()] = true;
        }
        let resolving = Session::new();
        let resolver = Resolver::new(&resolving, self.host, self.options);
        let visits = self.visits(&resolver, &is_requested);
        let differs = |file: FileId, to_file: &[&Visit], visit: &Visit, is_referred_to: bool| {
            let (existing, name) = (
                displayed_path(&to_file[0].name),
                displayed_path(&visit.name),
            );
            let (code, args) = match !visit.is_reference() && is_referred_to {
                true => (1261, [&*existing, &*name]),
                false => (1149, [&*name, &*existing]),
            };
            self.explain(&resolver, file, to_file, Some(visit), code, &args)
        };
        let is_reference = |visit: &&Visit| visit.is_reference();
        let mut problems = Vec::new();
        // `seen[data]` has another name.
        let is_forced = self.options.force_consistent_casing_in_file_names != Some(false);
        for &file in respelled.iter().filter(|_| is_forced) {
            for to_file in self.by_path(&visits[file.idx()]) {
                for (i, &visit) in to_file.iter().enumerate().skip(1) {
                    // A different drive letter isn't an error.
                    if without_root(&visit.name) != without_root(&to_file[0].name) {
                        let is_referred_to = to_file[..=i].iter().any(is_reference);
                        problems.push(differs(file, &to_file, visit, is_referred_to));
                    }
                }
            }
        }
        // `seen[data]` of a task that is redirected, which has no reasons and no file.
        let no_file = FileId(self.modules.len() as u32);
        let is_case_sensitive = self.host.is_case_sensitive();
        for &file in respelled.iter().filter(|_| is_forced) {
            let mut seen: Vec<&[u8]> = Vec::new();
            for visit in &visits[file.idx()] {
                let Some(name) = self.redirected_from(visit) else {
                    continue;
                };
                let mut checked = seen.iter().copied();
                match checked.find(|it| is_same_path(it, name, is_case_sensitive)) {
                    Some(checked_name) if without_root(checked_name) != without_root(name) => {
                        let names = (displayed_path(name), displayed_path(checked_name));
                        let (because, args) = (Some(visit), [&*names.0, &*names.1]);
                        problems.push(self.explain(&resolver, no_file, &[], because, 1149, &args));
                    }
                    Some(_) => {}
                    None => seen.push(name),
                }
            }
        }
        // `tasksSeenByNameIgnoreCase`
        for case_variants in case_variants {
            let mut each: Vec<(FileId, Vec<&Visit>)> = (case_variants.iter())
                .map(|&(name, file)| (file, self.by_path_of(&visits[file.idx()], name)))
                .filter(|it| !it.1.is_empty())
                .collect();
            each.shared_sort_by_key(|it| it.1[0].order);
            let Some(((file, to_file), others)) = each.split_first() else {
                continue;
            };
            for (_, to_other) in others {
                let visit = to_other[0];
                let mut before = to_file.iter().filter(|it| it.order < visit.order);
                problems.push(differs(*file, to_file, visit, before.any(is_reference)));
            }
        }
        problems
    }
}

/// `toFileName` of `computeDiagnostic` and `explainRedirectAndImpliedFormat`: how a message shows a file name.
type ToFileName<'a> = &'a dyn Fn(&[u8]) -> Vec<u8>;

/// `toFileName` of `toDiagnostic` without `relativeFileName`.
fn displayed_file_name(file_name: &[u8]) -> Vec<u8> {
    displayed_path(file_name).into_owned()
}

/// `computeDiagnostic` of `fileIncludeKindRootFile`: the code and the arguments of the message that
/// explains why the file at `path` is a root file.
fn root_file_reason(
    included: &Included,
    path: &[u8],
    to_file_name: ToFileName<'_>,
) -> (u32, Vec<Vec<u8>>) {
    let options = included.options;
    if options.config_path.is_empty() {
        return (1427, Vec::new());
    }
    if let Some(spec) = included.matched_file_spec(path) {
        return (1409, vec![spec.to_vec(), to_file_name(path)]);
    }
    if options.is_default_include_spec {
        return (1457, Vec::new());
    }
    match crate::config::matched_include_spec(
        &options.include_specs,
        &options.base_dir,
        path,
        included.host.is_case_sensitive(),
    ) {
        Some(spec) => (
            1407,
            vec![spec.to_vec(), to_file_name(&options.config_path)],
        ),
        None => (1427, Vec::new()),
    }
}

/// `explainRedirectAndImpliedFormat`: the code and the arguments of the message that explains the
/// module format `module` is emitted as.
fn implied_format_reason(
    resolver: &Resolver,
    options: &Options,
    module: &Module,
    to_file_name: ToFileName<'_>,
) -> Option<(u32, Vec<Vec<u8>>)> {
    if !module.is_module() {
        return None;
    }
    // `loadSourceFileMetaData`, which `parseTask.load` doesn't call for a library.
    let scope = ancestors(dirname::<Posix>(module.file_name()))
        .filter(|_| !module.is_lib)
        .find_map(|dir| Some((resolver.package_json(dir)?, dir)))
        .map(|(json, dir)| (join(dir, b"package.json"), json));
    let is_type_recorded = options.resolves_like_node
        && format_by_extension(module.file_name()) == ResolutionMode::None
        || strings::contains(module.file_name(), b"/node_modules/");
    let package_type = scope
        .as_ref()
        .filter(|_| is_type_recorded)
        .and_then(|scope| scope.1.get(b"type"))
        .and_then(Json::as_str)
        .unwrap_or(b"");
    let package_json = scope.as_ref().map(|scope| to_file_name(&scope.0));
    match (module.implied_format, package_json) {
        (ResolutionMode::Import, Some(path)) if package_type == b"module" => {
            Some((1458, vec![path]))
        }
        (ResolutionMode::Require, Some(path)) if !package_type.is_empty() => {
            Some((1459, vec![path]))
        }
        (ResolutionMode::Require, Some(path)) => Some((1460, vec![path])),
        (ResolutionMode::Require, None) => Some((1461, Vec::new())),
        _ => None,
    }
}

/// `sourceFileMayBeEmitted`
pub(crate) fn source_file_may_be_emitted(
    options: &Options,
    module: &Module,
    is_case_sensitive: bool,
) -> bool {
    if module.hir.kind == FileKind::Declaration || module.is_from_external_library {
        return false;
    }
    // The referenced project emits its own sources.
    if options.is_source_of_referenced_project(module.file_name()) {
        return false;
    }
    // `GetCommonSourceDirectory`, if `rootDir` or the configuration file determines it.
    let common = match options.root_dir.as_slice() {
        b"" => dirname::<Posix>(&options.config_path),
        root_dir => root_dir,
    };
    // `GetSourceFilePathInNewDirWorker`: a JSON file outside that directory would overwrite itself.
    module.hir.kind != FileKind::Json
        || !options.out_dir.is_empty()
            && (common.is_empty()
                || contains_path(common, module.file_name(), is_case_sensitive)
                    && !is_same_path(&options.out_dir, common, is_case_sensitive))
}

/// `GetSourceFilePathInNewDir`: the path under `dir` that mirrors the path of `path` relative to
/// the common source directory. A file outside that directory keeps its path.
fn source_file_path_in_new_dir(
    dir: &[u8],
    path: &[u8],
    common: Option<&[u8]>,
    is_case_sensitive: bool,
) -> Vec<u8> {
    match common {
        Some(common) if !dir.is_empty() && contains_path(common, path, is_case_sensitive) => join(
            dir,
            path.get(common.len()..)
                .unwrap_or(b"")
                .trim_start_with(|c| c == '/'),
        ),
        _ => path.to_vec(),
    }
}

/// `GetDeclarationEmitOutputFilePath`
pub fn declaration_emit_output_file_path(
    options: &Options,
    path: &[u8],
    common: Option<&[u8]>,
    is_case_sensitive: bool,
) -> Vec<u8> {
    let dir = match options.declaration_dir.as_slice() {
        b"" => options.out_dir.as_slice(),
        _ if !options.emits_declarations => options.out_dir.as_slice(),
        declaration_dir => declaration_dir,
    };
    let is_one_of = |extensions: [&[u8]; 2]| file_extension_is_one_of(path, &extensions);
    // `GetDeclarationEmitExtensionForPath`
    let extension: &[u8] = if is_one_of([b".mjs", b".mts"]) {
        b".d.mts"
    } else if is_one_of([b".cjs", b".cts"]) {
        b".d.cts"
    } else {
        b".d.ts"
    };
    let moved = source_file_path_in_new_dir(dir, path, common, is_case_sensitive);
    [remove_file_extension(&moved), extension].concat()
}

/// `GetOutputExtension`
pub fn get_output_extension(options: &Options, path: &[u8]) -> &'static [u8] {
    let is_one_of = |extensions: [&[u8]; 2]| file_extension_is_one_of(path, &extensions);
    if file_extension_is_one_of(path, &[b".json"]) {
        b".json"
    } else if options.jsx == JsxEmit::Preserve && is_one_of([b".jsx", b".tsx"]) {
        b".jsx"
    } else if is_one_of([b".mts", b".mjs"]) {
        b".mjs"
    } else if is_one_of([b".cts", b".cjs"]) {
        b".cjs"
    } else {
        b".js"
    }
}

/// `getOwnEmitOutputFilePath`
pub fn own_emit_output_file_path(
    options: &Options,
    path: &[u8],
    common: Option<&[u8]>,
    is_case_sensitive: bool,
) -> Vec<u8> {
    let moved = source_file_path_in_new_dir(&options.out_dir, path, common, is_case_sensitive);
    let extension = get_output_extension(options, path);
    [remove_file_extension(&moved), extension].concat()
}

/// `UseCaseSensitiveFileNames` of `Program.comparePathsOptions`. Nothing assigns that field, so
/// it's Go's zero value on every file system.
pub const COMPARE_PATHS_CASE_SENSITIVE: bool = false;

/// The parts of `verifyCompilerOptions` that depend on which files are emitted and where: 6307 for
/// a source file that a composite project doesn't list, 6059 (`checkSourceFilesBelongToPath`) for
/// one that isn't under `rootDir`, 5009 and 5011 for the common source directory, and
/// `verifyEmitFilePath`, which is 5055 for an output file that's an input file and 5056 for one
/// that two input files are emitted to. Errors reported at a position in a file go to
/// `include_errors`. Also returns `CommonSourceDirectory`, if anything depends on it.
fn output_path_errors(
    included: &Included,
    summaries: &[ModuleSummary],
    include_errors: &mut Vec<(FileId, u32, u32, Problem)>,
) -> (Vec<Problem>, Option<Vec<u8>>) {
    let &Included {
        host,
        options,
        modules,
        by_path,
        roots,
        ..
    } = included;
    let mut errors = Vec::new();
    let is_case_sensitive = host.is_case_sensitive();
    let declaration_dir = if options.emits_declarations {
        options.declaration_dir.as_slice()
    } else {
        b""
    };
    // See `Options::own_roots`.
    let reached_from_own_roots = options.own_roots.map(|count| {
        let own = roots.iter().take(count);
        let mut pending: Vec<FileId> = own.filter_map(|it| by_path.get(it)).collect();
        let mut is_reached = vec![false; modules.len()];
        while let Some(file) = pending.pop() {
            if !std::mem::replace(&mut is_reached[file.idx()], true) {
                pending.extend(modules[file.idx()].edges);
            }
        }
        is_reached
    });
    let is_own = |module: &Module| match &reached_from_own_roots {
        Some(is_reached) => {
            (by_path.get(module.file_name())).is_some_and(|file| is_reached[file.idx()])
        }
        None => true,
    };
    let (sources, paths): (Vec<&Module>, Vec<&[u8]>) = (modules.iter().zip(summaries))
        .filter(|(_, summary)| summary.may_be_emitted)
        .map(|(module, summary)| (&**module, summary.file_name))
        .filter(|(module, _)| is_own(module))
        .unzip();
    let explain = |code: u32, arg: &[u8], is_wrong: &dyn Fn(&Module, bool) -> bool| {
        included.explain_source_files(code, arg, is_wrong)
    };
    let mut explained = Vec::new();
    if options.composite {
        explained = explain(6307, options.config_path.as_slice(), &|module, is_root| {
            !is_root && is_own(module)
        });
    }
    // `CommonSourceDirectory`, if anything depends on it. `None`: there is none.
    let mut common = None;
    if !options.out_dir.is_empty()
        || !options.root_dir.is_empty()
        || options.specifies_source_or_map_root
        || !declaration_dir.is_empty()
    {
        let specified = if !options.root_dir.is_empty() {
            options.root_dir.as_slice()
        } else if !options.config_path.is_empty() {
            dirname::<Posix>(&options.config_path)
        } else {
            b""
        };
        if specified.is_empty() {
            common = common_directory_of(&paths, &options.current_directory, is_case_sensitive);
        } else {
            explained.extend(explain(6059, specified, &|module, _| {
                !contains_path(specified, module.file_name(), COMPARE_PATHS_CASE_SENSITIVE)
                    && is_own(module)
            }));
            common = Some(specified.to_vec());
        }
        if common.is_none() && !options.out_dir.is_empty() {
            errors.push(Problem::new(5009, &[], ConfigLocation::Key(b"outDir", b"")));
        }
    }
    for (at, problem) in explained {
        match at {
            Some((file, start, end)) => include_errors.push((file, start, end, problem)),
            None => errors.push(problem),
        }
    }
    if options.no_emit {
        return (errors, common);
    }
    // Before TypeScript 6 it was the common directory of the sources, with or without a
    // configuration file.
    if !options.composite
        && options.root_dir.is_empty()
        && !options.config_path.is_empty()
        && (!options.out_dir.is_empty() || !declaration_dir.is_empty())
        && let Some(computed) =
            common_directory_of(&paths, &options.current_directory, is_case_sensitive)
        && !is_same_path(
            &computed,
            dirname::<Posix>(&options.config_path),
            is_case_sensitive,
        )
    {
        let (one, other): (&[u8], &[u8]) = if options.out_dir.is_empty() {
            (b"declarationDir", b"")
        } else {
            (b"outDir", b"declarationDir")
        };
        let config_name = &options.config_path
            [strings::last_index_of_char(&options.config_path, b'/').map_or(0, |i| i + 1)..];
        let relative = crate::verify::relative_from_file(
            &options.config_path,
            &computed,
            COMPARE_PATHS_CASE_SENSITIVE,
        );
        errors.push(
            Problem::new(
                5011,
                &[config_name, &relative],
                ConfigLocation::Key(one, other),
            )
            .with(1, 5111, &[]),
        );
    }
    if options.suppress_output_path_check {
        return (errors, common);
    }
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    let mut verify = |output: Vec<u8>| {
        if by_path.contains(&output) {
            let problem = Problem::new(5055, &[&displayed_path(&output)], ConfigLocation::Nowhere);
            errors.push(if options.has_config_file {
                problem
            } else {
                problem.with(1, 5068, &[])
            });
        }
        if !seen.insert(to_path(&output, is_case_sensitive).into_owned()) {
            errors.push(Problem::new(
                5056,
                &[&displayed_path(&output)],
                ConfigLocation::Nowhere,
            ));
        }
    };
    for module in sources {
        let path = module.file_name();
        let is_json = module.hir.kind == FileKind::Json;
        if !options.emit_declaration_only {
            let output =
                own_emit_output_file_path(options, path, common.as_deref(), is_case_sensitive);
            // A JSON file whose output path equals its input path isn't emitted.
            if !is_json || output != path {
                let map = [&output[..], b".map"].concat();
                verify(output);
                if options.writes_source_maps && !is_json {
                    verify(map);
                }
            }
        }
        if options.emits_declarations && !is_json {
            let output = declaration_emit_output_file_path(
                options,
                path,
                common.as_deref(),
                is_case_sensitive,
            );
            let map = [&output[..], b".map"].concat();
            verify(output);
            if options.writes_declaration_maps {
                verify(map);
            }
        }
    }
    if !options.build_info_file_name.is_empty() {
        verify(options.build_info_file_name.clone());
    }
    (errors, common)
}

/// `GetSymbolNameForPrivateIdentifier`: `#x` is scoped to the class that declares it. From here on
/// it is spelled `\xFE#x@<hash of the path>.<class>` (`PRIVATE_NAME_PREFIX`), at its declaration
/// and at every reference. An `#x` that no enclosing class declares stays `#x`, which resolves to
/// nothing. A member of an interface, a type literal or an object literal is spelled like an `#x`
/// of the class that contains it.
fn rename_private_names(hir: &mut hir::File, bound: &Bound, atoms: &Interner, path: &[u8]) {
    let file = crate::util::spread_hash(path);
    let renamed = |class: u32, name: Atom| {
        let mut spelled = [&b"\xFE"[..], atoms.bytes(name)].concat();
        let _ = write!(spelled, "@{file:x}.{class}");
        atoms.intern(&spelled)
    };
    for class in 0..hir.classes.len() {
        for member in hir.classes[class].members.iter() {
            if let PropKey::Private(name) = hir.members[member.idx()].key {
                hir.members[member.idx()].key = PropKey::Private(renamed(class as u32, name));
            }
        }
    }
    for &(decl, class) in bound.private_names_outside_class_bodies.iter() {
        let key = match decl {
            Decl::Member(m) => &mut hir.members[m.idx()].key,
            Decl::Property(p) => &mut hir.props[p.idx()].key,
            _ => continue,
        };
        if let PropKey::Private(name) = *key {
            *key = PropKey::Private(renamed(class.0, name));
        }
    }
    for (&e, &class) in bound.private_class.iter() {
        if let ExprKind::Dot { name, .. } | ExprKind::PrivateIdentifier(name) =
            &mut hir.exprs[e.idx()].kind
        {
            *name = renamed(class.0, *name);
        }
    }
}

/// The `e` of `export default e`, `export = e`, `module.exports = e` or `exports.x = e`, if `decl` is one of them.
pub(crate) fn alias_like_expression(hir: &File, decl: Decl) -> Option<ExprId> {
    match decl {
        Decl::ExportExpr(stmt) => match hir[stmt].kind {
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => Some(e),
            _ => None,
        },
        // `getTargetOfBinaryExpression`
        Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => {
            match hir[assignment].kind {
                ExprKind::Assign { value, .. } => Some(value),
                _ => None,
            }
        }
        _ => None,
    }
}

/// `getExcludedSymbolFlags`
pub(crate) fn get_excluded_symbol_flags(flags: SymFlags) -> SymFlags {
    [
        (
            SymFlags::BLOCK_SCOPED_VARIABLE,
            SymFlags::BLOCK_SCOPED_VARIABLE_EXCLUDES,
        ),
        (
            SymFlags::FUNCTION_SCOPED_VARIABLE,
            SymFlags::FUNCTION_SCOPED_VARIABLE_EXCLUDES,
        ),
        (SymFlags::PROPERTY, SymFlags::PROPERTY_EXCLUDES),
        (SymFlags::ENUM_MEMBER, SymFlags::ENUM_MEMBER_EXCLUDES),
        (SymFlags::FUNCTION, SymFlags::FUNCTION_EXCLUDES),
        (SymFlags::CLASS, SymFlags::CLASS_EXCLUDES),
        (SymFlags::INTERFACE, SymFlags::INTERFACE_EXCLUDES),
        (SymFlags::REGULAR_ENUM, SymFlags::REGULAR_ENUM_EXCLUDES),
        (SymFlags::CONST_ENUM, SymFlags::CONST_ENUM_EXCLUDES),
        (SymFlags::VALUE_MODULE, SymFlags::VALUE_MODULE_EXCLUDES),
        (SymFlags::METHOD, SymFlags::METHOD_EXCLUDES),
        (SymFlags::GET_ACCESSOR, SymFlags::GET_ACCESSOR_EXCLUDES),
        (SymFlags::SET_ACCESSOR, SymFlags::SET_ACCESSOR_EXCLUDES),
        (SymFlags::TYPE_PARAMETER, SymFlags::TYPE_PARAMETER_EXCLUDES),
        (SymFlags::TYPE_ALIAS, SymFlags::TYPE_ALIAS_EXCLUDES),
        (SymFlags::ALIAS, SymFlags::ALIAS_EXCLUDES),
    ]
    .iter()
    .filter(|kind| flags.contains(kind.0))
    .fold(SymFlags::empty(), |excluded, kind| excluded | kind.1)
    .difference(if flags.contains(SymFlags::REPLACEABLE_BY_METHOD) {
        SymFlags::METHOD
    } else {
        SymFlags::empty()
    })
}

impl<'s> Files<'s> {
    /// Loads `roots` and every file reachable from them. The HIR and the side tables of a file are
    /// in the arena of the thread that loads it.
    ///
    /// `run`: the request's `Run`, if the request has more programs than this one.
    pub fn load<'u: 's>(
        session: &'s Session,
        run: Option<&'s Run<'u>>,
        host: &dyn Host,
        options: Options,
        roots: &[Vec<u8>],
        // Called once all files are read and only this thread still allocates in `session`. The
        // argument is the number of bytes that are freed when the program is loaded.
        files_are_found: &dyn Fn(usize),
    ) -> Files<'s> {
        let arena = session.arena();
        // Nothing ever drops `Files`.
        let options: &'s Options = session.keep(options);
        let atoms: Interner<'s> = match run {
            Some(run) => run.atoms,
            None => Interner::new_in(session),
        };
        // Owns the paths that are only needed until every file is found. They're freed together below, before the first
        // file is checked. In `session` they would stay allocated until the end.
        let resolving = Session::new();
        let resolver = Resolver::new(&resolving, host, options);
        let is_case_sensitive = host.is_case_sensitive();
        let mut by_path = ByPath {
            files: map_in(arena),
            is_case_sensitive,
        };
        // `parseTaskData.tasks`: the tasks by file name, where a file can have several.
        let mut by_name: FxHashMap<&'s [u8], FileId> = FxHashMap::default();
        let mut all_found = Found::default();
        let mut modules: Vec<Option<ArenaBox<Module>>> = Vec::new();
        // `parseTaskData.lowestDepth`, indexed by `FoundFile::first`: the lowest number of steps
        // into packages (`increaseDepth`) that a task for the file has run at.
        let mut depths: Vec<u32> = Vec::new();
        // `taskDataByPath.LoadOrStore`
        let mut add = |path: &[u8],
                       is_lib: bool,
                       modules: &mut Vec<Option<ArenaBox<'s, Module<'s>>>>,
                       depths: &mut Vec<u32>,
                       found: &mut Found<'s>|
         -> FileId {
            let known = match is_case_sensitive {
                true => by_path.files.get(path),
                false => by_name.get(path),
            };
            if let Some(&id) = known {
                return id;
            }
            let path = slice_in(path, arena);
            let interned_path = file_path(path, is_case_sensitive, arena);
            let id = FileId(modules.len() as u32);
            let first = *by_path.files.entry(interned_path.text).or_insert(id);
            modules.push(None);
            depths.push(u32::MAX);
            if !is_case_sensitive {
                by_name.insert(path, id);
            }
            found.files.push(FoundFile {
                path: interned_path,
                is_lib,
                package: None,
                first,
                // Another spelling of a name is only read if `collectFiles` reaches it first.
                is_read: first == id,
                parse: None,
                is_loaded: false,
                named: None,
            });
            id
        };

        let mut starts: Vec<FileId> = Vec::new();
        // `processAllProgramFiles`: without root files there are no libraries and no automatic type directives.
        let has_root_files = !roots.is_empty();
        // `processingDiagnostics` of the tasks that don't read a file, in the order of `rootTasks`:
        // `diagnosticReason`, and the message.
        let mut without_file: Vec<(Visit, Problem)> = Vec::new();
        let mut libs_without_file: Vec<(Visit, Problem)> = Vec::new();
        let because = |reason: IncludeReason, name: &[u8]| Visit {
            reason,
            name: name.to_vec(),
            order: 0,
        };
        let libs = lib_tasks(host, &resolver, options).filter(|_| has_root_files);
        for (reason, path, error) in libs {
            match error {
                Some(code) => {
                    let message = reference_problem(options, code, &path);
                    libs_without_file.push((because(reason, &path), message));
                }
                None => starts.push(add(&path, true, &mut modules, &mut depths, &mut all_found)),
            }
        }
        let libs_end = starts.len();
        let mut program_errors = Vec::new();
        let mut root_of_start: Vec<u32> = Vec::new();
        // Missing root files have a task too.
        let mut missing_roots: Vec<&[u8]> = Vec::new();
        for (index, root) in roots.iter().enumerate() {
            match root_file_name(host, options, root) {
                // Nothing is read.
                Ok(None) => {}
                Ok(Some(found)) => {
                    root_of_start.push(index as u32);
                    let file = add(&found, false, &mut modules, &mut depths, &mut all_found);
                    // The root files are the first of `rootTasks`, and the first task for a file
                    // name is the one that is loaded (`loadedTask`): it has no `libFile`.
                    all_found.files[file.idx()].is_lib = false;
                    starts.push(file);
                }
                Err(code) => {
                    missing_roots.push(root);
                    let message = reference_problem(options, code, root);
                    without_file.push((because(IncludeReason::RootFile(index), root), message));
                }
            }
        }
        without_file.append(&mut libs_without_file);
        // `collectFiles`, `seen[data]`: of the tasks for one path only the first is walked, and the
        // `processingDiagnostics` of the others are dropped. This uses a set of paths because
        // thousands of entries of `files` can be missing.
        let mut walked: FxHashSet<Vec<u8>> = FxHashSet::default();
        without_file
            .retain(|(visit, _)| walked.insert(to_path(&visit.name, is_case_sensitive).into()));
        let roots_end = starts.len();
        // `addAutomaticTypeDirectiveTasks`: the last of `rootTasks`, for this file name. There's
        // one `parseTaskData` per path, and `collectFiles` continues from the first of its tasks,
        // so a root file or a library at this path replaces the directives.
        let containing_file = inside(&options.base_dir, INFERRED_TYPES_CONTAINING_FILE);
        let is_containing_file = |found: &FoundFile| {
            is_same_path(found.path.pretty, &containing_file, is_case_sensitive)
        };
        let has_automatic_task = has_root_files && !all_found.files.iter().any(is_containing_file);
        let directives = if has_automatic_task {
            automatic_type_directives(host, &resolver, options)
        } else {
            Vec::new()
        };
        // Its entry in `taskDataByPath`. A sub task for the same file name gets it as `loadedTask`,
        // so the file isn't read. There's no such sub task unless the file exists.
        let mut automatic_task = None;
        if has_automatic_task && host.is_file(&containing_file) {
            let task = add(
                &containing_file,
                false,
                &mut modules,
                &mut depths,
                &mut all_found,
            );
            // The last of `rootTasks` runs first.
            all_found.files[task.idx()].is_read = false;
            all_found.files[task.idx()].is_loaded = true;
            depths[task.idx()] = 0;
            automatic_task = Some(task);
        }
        let automatic_tracer = options.trace_resolution.then(Tracer::default);
        // `subTasks` of that task.
        let mut automatic: Vec<SubTask> = Vec::new();
        for name in &directives {
            match resolver.resolve_type_reference_and_id(
                name,
                &containing_file,
                ResolutionMode::None,
                automatic_tracer.as_ref(),
            ) {
                Some((path, is_external, package_id)) => {
                    let file = add(&path, false, &mut modules, &mut depths, &mut all_found);
                    automatic.push(SubTask {
                        file,
                        increases_depth: is_external,
                        is_elided_on_depth: false,
                        package: all_found.package_of_task(file, package_id),
                    });
                }
                // `*` matches whatever exists.
                None if name == b"*" => {}
                None => {
                    let reason = IncludeReason::AutomaticTypeDirectiveFile(name.clone(), None);
                    let message = Problem::new(2688, &[name], ConfigLocation::Nowhere);
                    without_file.push((because(reason, b""), message));
                }
            }
        }
        starts.extend(automatic.iter().map(|task| task.file));

        // Imports that are resolved without adding the file to the program: they resolve if the
        // file is in the program for another reason.
        let mut only_found: Vec<(FileId, Atom, ResolutionMode, &[u8])> = Vec::new();
        // `processingDiagnostics` of the tasks for imported files with an extension that the
        // program doesn't support, each at the import: the file and the span.
        let mut unsupported: Vec<(FileId, u32, u32, Problem)> = Vec::new();
        // `singleThreadedWorkGroup.fns`: the tasks that `filesParser.start` has queued, each with
        // the `depth` it was called with. The task that's queued last runs first. With several
        // threads tsgo runs them in any order.
        let mut queued: Vec<(SubTask, u32)> = (starts[libs_end..roots_end].iter())
            .chain(&starts[..libs_end])
            .map(|&file| SubTask {
                file,
                increases_depth: false,
                is_elided_on_depth: false,
                package: None,
            })
            .chain(automatic)
            .map(|task| (task, 0))
            .collect();
        // `subTasks` of the tasks that are loaded and haven't started them yet.
        let mut not_started: FxHashMap<FileId, Vec<SubTask>> = FxHashMap::default();
        // `subTasks` of one file. Reused for the next.
        let mut sub_tasks: Vec<SubTask> = Vec::new();
        let mut package_json_info_cache = PackageJsonInfoCache::default();
        // `pathForLibFileResolutions`. The libraries of the options are resolved while `rootTasks` is built.
        let mut lib_resolutions: Vec<(Vec<u8>, Vec<DiagAndArgs>)> = Vec::new();
        if options.trace_resolution && has_root_files {
            for lib in &options.libs {
                trace_path_for_lib_file(
                    host,
                    &resolver,
                    options,
                    lib_file_stem(lib),
                    &mut package_json_info_cache,
                    &mut lib_resolutions,
                );
            }
        }
        // The last of `rootTasks` runs first.
        let mut automatic_traces = automatic_tracer
            .map(Tracer::into_traces)
            .unwrap_or_default();
        package_json_info_cache.get_package_json_infos(host, &mut automatic_traces);
        let seeds: Vec<(&[u8], bool)> = (all_found.files.iter())
            .filter(|found| found.is_read)
            .map(|found| (found.path.pretty, found.is_lib))
            .collect();
        let prefetch = Prefetch::new(seeds);
        // True once `files_are_found` has been called.
        let mut are_found = false;
        // Indexed by `FileId`. `Some` for a file that still needs `hir` and `bound`: its `Loaded::parse`, or `None` if
        // another file gets that parse.
        let mut parses_to_take: Vec<Option<Option<u32>>> = Vec::new();
        // Indexed by `Loaded::parse`.
        let mut is_parse_taken: Vec<bool> = Vec::new();
        // `Module::edges` of one file. Reused for the next.
        let mut edges: Vec<FileId> = Vec::new();
        let mut traces: Vec<Vec<DiagAndArgs>> = Vec::new();
        // `rootTasks`: the root files, the libraries, the automatic type directives (`None`) and
        // what they resolve to.
        let root_tasks: Vec<Option<FileId>> = (starts[libs_end..roots_end].iter())
            .chain(&starts[..libs_end])
            .map(|&start| Some(start))
            .chain([None])
            .chain(starts[roots_end..].iter().map(|&start| Some(start)))
            .collect();
        let mut next_root_task = 0;
        // (file, how many of its edges have been followed)
        let mut stack: Vec<(FileId, usize)> = Vec::new();
        let mut seen: Vec<bool> = Vec::new();
        // `redirectFilesByPath`: a copy of a package file, and the one that is in the program.
        let mut redirects: Vec<(FileId, FileId)> = Vec::new();
        // `redirectFilesByPath`: the name of a copy of a package file, and the copy that is kept.
        let mut package_copies: Vec<(&'s [u8], FileId)> = Vec::new();
        // The files that `collectFiles` reaches under more than one spelling of their name.
        let mut respelled: Vec<FileId> = Vec::new();
        // The `traceResolution` log, in order.
        let mut log: Vec<DiagAndArgs> = Vec::new();
        // Caches `add`'s result for each path, indexed by `Resolution::number`.
        let mut files_by_number: Vec<Option<FileId>> = Vec::new();
        let mut add_numbered = |number: u32,
                                path: &[u8],
                                is_lib: bool,
                                modules: &mut Vec<Option<ArenaBox<'s, Module<'s>>>>,
                                depths: &mut Vec<u32>,
                                found: &mut Found<'s>|
         -> FileId {
            if number == NOT_NUMBERED {
                return add(path, is_lib, modules, depths, found);
            }
            let at = number as usize;
            if at >= files_by_number.len() {
                files_by_number.resize(at + 1, None);
            }
            *files_by_number[at].get_or_insert_with(|| add(path, is_lib, modules, depths, found))
        };
        // Runs on this thread while the other threads load. See `prefetch_files`.
        let mut put_in_order = |all_are_loaded: &mut dyn FnMut()| {
            // Loading has already finished, so nothing runs concurrently. Report that before
            // ordering any file.
            if prefetch.is_done() {
                all_are_loaded();
                are_found = true;
                files_are_found(resolving.allocated_bytes());
            }
            'load: loop {
                // `singleThreadedWorkGroup.RunAndWait`. The body is the function that
                // `filesParser.start` queues for a task.
                while let Some((task, depth)) = queued.pop() {
                    let is_elided = |task: SubTask, depth: u32| {
                        task.is_elided_on_depth && depth > options.max_node_module_js_depth
                    };
                    let data = all_found.files[task.file.idx()].first;
                    // "Propagate packageId to data if we have one and data doesn't yet"
                    let package = &mut all_found.files[data.idx()].package;
                    *package = package.or(task.package);
                    let depth = depth + u32::from(task.increases_depth);
                    // "If we're seeing this task at a lower depth than before, reprocess its subtasks to
                    // ensure they are loaded." A task starts its sub tasks only once.
                    let starts_sub_tasks = depth < depths[data.idx()];
                    if starts_sub_tasks {
                        depths[data.idx()] = depth;
                    }
                    if is_elided(task, depth) {
                        continue;
                    }
                    all_found.files[data.idx()].is_loaded = true;
                    // `data.tasks`
                    let tasks = [data, task.file];
                    for id in &tasks[usize::from(data == task.file)..] {
                        let FoundFile {
                            path: Path { pretty: path, .. },
                            is_lib,
                            is_read,
                            ..
                        } = all_found.files[id.idx()];
                        if !is_read {
                            continue;
                        }
                        if modules[id.idx()].is_some() {
                            if starts_sub_tasks && let Some(waiting) = not_started.remove(id) {
                                queued.extend(waiting.into_iter().map(|task| (task, depth)));
                            }
                            continue;
                        }
                        let mut loaded = prefetch.take(path, is_lib);
                        if loaded.is_none() {
                            // `prefetch_files` couldn't predict this file. Load it now, along with the
                            // unpredicted files of the queued tasks.
                            prefetch.wait();
                            all_are_loaded();
                            let is_prefetched =
                                |found: &FoundFile| prefetch.has(found.path.pretty, found.is_lib);
                            let mut missing: Vec<FileId> = (queued.iter())
                                .filter(|it| {
                                    !is_elided(it.0, it.1 + u32::from(it.0.increases_depth))
                                })
                                .map(|it| all_found.files[it.0.file.idx()].first)
                                .chain([*id])
                                .filter(|file| modules[file.idx()].is_none())
                                .collect();
                            missing.shared_sort_unstable();
                            missing.dedup();
                            let missing: Vec<&FoundFile> = (missing.iter())
                                .map(|file| &all_found.files[file.idx()])
                                .filter(|&found| found.is_read && !is_prefetched(found))
                                .collect();
                            let results: Vec<Guarded<Option<Box<Loaded>>>> =
                                missing.iter().map(|_| Guarded::new(None)).collect();
                            let paths: Vec<&[u8]> =
                                missing.iter().map(|it| it.path.pretty).collect();
                            host.parallel(paths.len(), &|at| {
                                let text = host.read_source(paths[at]);
                                *results[at].lock() = Some(Box::new(Self::load_one(
                                    session,
                                    session.arena(),
                                    run,
                                    host,
                                    &resolver,
                                    options,
                                    &atoms,
                                    paths[at],
                                    missing[at].is_lib,
                                    Some(text),
                                    &|_| (),
                                )));
                            });
                            for (&path, result) in paths.iter().zip(results) {
                                if let Some(loaded) = result.lock().take() {
                                    prefetch.insert(path, loaded);
                                }
                            }
                            loaded = prefetch.remove(path);
                        }
                        let Some(loaded) = loaded else {
                            continue;
                        };
                        let mut loaded = *loaded;
                        sub_tasks.clear();
                        let numbers = loaded.reference_numbers.iter().copied();
                        let numbers = numbers.chain(std::iter::repeat(NOT_NUMBERED));
                        for (reference, number) in loaded.references.iter().zip(numbers) {
                            let &(path, is_lib, increases_depth, package_id) = reference;
                            let file = add_numbered(
                                number,
                                path,
                                is_lib,
                                &mut modules,
                                &mut depths,
                                &mut all_found,
                            );
                            sub_tasks.push(SubTask {
                                file,
                                increases_depth,
                                is_elided_on_depth: false,
                                package: all_found.package_of_task(file, package_id),
                            });
                        }
                        for &(start, end, path, code) in &loaded.unsupported_libs {
                            // Only one task loads the file, so report this once, however many files
                            // refer to it.
                            let file_name = displayed_path(path);
                            let is_about_it = |message: &Problem| message.args[0] == *file_name;
                            let is_for_its_path =
                                |task: &Visit| is_same_path(&task.name, path, is_case_sensitive);
                            if !unsupported.iter().any(|it| is_about_it(&it.3))
                                && !without_file.iter().any(|it| is_for_its_path(&it.0))
                            {
                                let problem = reference_problem(options, code, path);
                                unsupported.push((*id, start, end, problem));
                            }
                        }
                        // `load_one` created an empty map in another thread's arena. Replace it
                        // with one in this thread's.
                        loaded.module.imports = ArenaHashMap::with_capacity_and_hasher_in(
                            loaded.imports.len(),
                            FxBuild,
                            arena,
                        );
                        for resolution in &loaded.imports {
                            let &Resolution {
                                spec,
                                mode,
                                path,
                                increases_depth,
                                is_importable,
                                ..
                            } = resolution;
                            if !resolution.should_add_file {
                                if is_importable {
                                    only_found.push((*id, spec, mode, path));
                                }
                                continue;
                            }
                            if let Some(UnsupportedExtension { code, span }) =
                                resolution.unsupported_extension
                            {
                                // Only one task loads the file, so report this once, however many
                                // files refer to it.
                                if let Some((pos, end)) = span
                                    && !(unsupported.iter())
                                        .any(|it| it.3.args[0] == *displayed_path(path))
                                {
                                    let problem = reference_problem(options, code, path);
                                    unsupported.push((*id, pos, end, problem));
                                }
                                continue;
                            }
                            let file = add_numbered(
                                resolution.number,
                                path,
                                false,
                                &mut modules,
                                &mut depths,
                                &mut all_found,
                            );
                            if is_importable {
                                loaded.module.imports.insert((spec, mode), file);
                            }
                            sub_tasks.push(SubTask {
                                file,
                                increases_depth,
                                // `isJsFileFromNodeModules`
                                is_elided_on_depth: increases_depth
                                    && is_javascript_file(host, path)
                                    && strings::contains(path, b"/node_modules/"),
                                package: all_found.package_of_task(file, resolution.package_id),
                            });
                        }
                        edges.clear();
                        edges.extend(sub_tasks.iter().map(|task| task.file));
                        loaded.module.edges = slice_in(&edges, arena);
                        if options.trace_resolution {
                            // A library gets its `SourceFileMetaData` without a lookup.
                            if !is_lib {
                                package_json_info_cache.load_source_file_meta_data(host, path);
                            }
                            let mut file_trace = std::mem::take(&mut loaded.type_resolutions_trace);
                            package_json_info_cache.get_package_json_infos(host, &mut file_trace);
                            for &(kind, value, ..) in &loaded.module.hir.references {
                                if kind == ReferenceKind::Lib
                                    && !options.no_lib
                                    && let Some(lib) =
                                        referenced_lib(host, options, atoms.bytes(value))
                                {
                                    trace_path_for_lib_file(
                                        host,
                                        &resolver,
                                        options,
                                        &lib,
                                        &mut package_json_info_cache,
                                        &mut lib_resolutions,
                                    );
                                }
                            }
                            let import_trace = &mut loaded.resolutions_trace;
                            package_json_info_cache.get_package_json_infos(host, import_trace);
                            file_trace.append(import_trace);
                            traces.resize_with(traces.len().max(id.idx() + 1), Vec::new);
                            traces[id.idx()] = file_trace;
                        }
                        loaded.module.path = all_found.files[id.idx()].path;
                        all_found.files[id.idx()].parse = loaded.parse;
                        modules[id.idx()] = Some(loaded.module);
                        // `w.start(loader, taskByFileName.subTasks, data.lowestDepth)`
                        if starts_sub_tasks {
                            queued.extend(sub_tasks.iter().map(|&task| (task, depth)));
                        } else {
                            not_started.insert(*id, std::mem::take(&mut sub_tasks));
                        }
                    }
                }
                // Copies of a package file share a parse. It can only be taken once all files are loaded.
                prefetch.wait();
                all_are_loaded();
                if !std::mem::replace(&mut are_found, true) {
                    files_are_found(resolving.allocated_bytes());
                }
                // The part of `collectFiles` that logs and picks which copy of a package file is in the program.
                // `declaration_order` does the ordering.
                seen.resize(modules.len(), false);
                traces.resize_with(modules.len(), Vec::new);
                parses_to_take.resize(modules.len(), None);
                loop {
                    let file = match stack.last_mut() {
                        Some(top) => {
                            // Sub tasks that were never started aren't loaded.
                            let has_started = !not_started.contains_key(&top.0);
                            let edges = match modules[top.0.idx()].as_ref().filter(|_| has_started)
                            {
                                Some(module) => module.edges,
                                None if Some(top.0) == automatic_task => &starts[roots_end..],
                                None => &[],
                            };
                            let Some(&edge) = edges.get(top.1) else {
                                stack.pop();
                                continue;
                            };
                            top.1 += 1;
                            edge
                        }
                        None => {
                            let Some(&task) = root_tasks.get(next_root_task) else {
                                break 'load;
                            };
                            next_root_task += 1;
                            let Some(start) = task else {
                                log.append(&mut automatic_traces);
                                continue;
                            };
                            start
                        }
                    };
                    let FoundFile {
                        path: Path { pretty: path, .. },
                        first,
                        ..
                    } = all_found.files[file.idx()];
                    // `!task.loaded`
                    if !all_found.files[first.idx()].is_loaded {
                        continue;
                    }
                    // `seen[data]`
                    let named = *all_found.files[first.idx()].named.get_or_insert(file);
                    if named != file {
                        respelled.push(named);
                        if !std::mem::replace(&mut seen[file.idx()], true) {
                            redirects.push((file, named));
                        }
                        continue;
                    }
                    if seen[file.idx()] {
                        continue;
                    }
                    // `packageIdToSourceFile != nil && data.packageId.Name != ""`
                    if !options.retains_duplicate_packages
                        && let Some(package) = all_found.files[first.idx()].package
                    {
                        let retained_copy =
                            *all_found.retained_copies[package as usize].get_or_insert(file);
                        if retained_copy != file {
                            seen[file.idx()] = true;
                            redirects.push((file, retained_copy));
                            package_copies.push((path, retained_copy));
                            log.append(&mut traces[file.idx()]);
                            continue;
                        }
                    }
                    if Some(file) == automatic_task {
                        log.append(&mut automatic_traces);
                    } else if modules[file.idx()].is_none() {
                        // This copy is the one that's kept, but it hasn't been read. Queue its task again as if for the
                        // first time, then repeat this step.
                        match stack.last_mut() {
                            Some(top) => top.1 -= 1,
                            None => next_root_task -= 1,
                        }
                        all_found.files[file.idx()].is_read = true;
                        let task = SubTask {
                            file,
                            increases_depth: false,
                            is_elided_on_depth: false,
                            package: None,
                        };
                        queued.push((task, std::mem::replace(&mut depths[first.idx()], u32::MAX)));
                        continue 'load;
                    }
                    // This copy is in the program. Another file that shares the `Parse` has already taken it if the
                    // tasks gave them different package ids.
                    if let Some(slot) = all_found.files[file.idx()].parse.take() {
                        let at = slot as usize;
                        is_parse_taken.resize(is_parse_taken.len().max(at + 1), false);
                        let is_taken = std::mem::replace(&mut is_parse_taken[at], true);
                        parses_to_take[file.idx()] = Some((!is_taken).then_some(slot));
                    }
                    seen[file.idx()] = true;
                    log.append(&mut traces[file.idx()]);
                    stack.push((file, 0));
                }
            }
        };
        Self::prefetch_files(
            session,
            run,
            host,
            &resolver,
            options,
            &atoms,
            &prefetch,
            &mut put_in_order,
        );
        drop(by_name);
        // The task for the automatic type directives isn't a file.
        if let Some(task) = automatic_task {
            seen[task.idx()] = false;
        }
        for file in not_started.into_keys() {
            if let Some(module) = &mut modules[file.idx()] {
                module.edges = &[];
            }
        }
        // A spelling that `collectFiles` never reached still names the same file.
        for (task, found) in all_found.files.iter().enumerate() {
            if let Some(named) = all_found.files[found.first.idx()].named
                && named.idx() != task
                && !std::mem::replace(&mut seen[task], true)
            {
                redirects.push((FileId(task as u32), named));
            }
        }
        respelled.shared_sort_unstable();
        respelled.dedup();
        // Only the files that `collectFiles` reached are in the program, and only one copy of a
        // package file. The paths of the other copies map to that copy.
        if !redirects.is_empty() || !seen.iter().all(|&is_seen| is_seen) {
            let mut is_retained = seen;
            for &(copy, _) in &redirects {
                is_retained[copy.idx()] = false;
            }
            let mut renumbered: Vec<Option<FileId>> = vec![None; modules.len()];
            let retained_files = (0..modules.len()).filter(|&file| is_retained[file]);
            for (new, old) in retained_files.enumerate() {
                renumbered[old] = Some(FileId(new as u32));
            }
            for &(copy, retained_copy) in &redirects {
                renumbered[copy.idx()] = renumbered[retained_copy.idx()];
                // `lowestDepth` belongs to the path, however it is spelled. A copy of a package
                // file has its own.
                depths[retained_copy.idx()] =
                    depths[all_found.files[retained_copy.idx()].first.idx()];
            }
            let renumber = |file: FileId| renumbered[file.idx()].unwrap_or(file);
            let mut file = 0;
            modules.retain(|_| {
                file += 1;
                is_retained[file - 1]
            });
            each_module(host, &mut modules, &|_, module| {
                // An elided task doesn't load anything, so edges to it are dropped. `collectFiles`
                // continues from the task for the automatic type directives to its sub tasks, so an
                // edge to that task becomes edges to them.
                let mut edges: SmallVec<[FileId; 32]> = SmallVec::new();
                for edge in module.edges {
                    let tasks = match Some(*edge) == automatic_task {
                        true => &starts[roots_end..],
                        false => std::slice::from_ref(edge),
                    };
                    edges.extend(tasks.iter().filter_map(|task| renumbered[task.idx()]));
                }
                module.edges = slice_in(&edges, session.arena());
                (module.imports).retain(|_, target| match renumbered[target.idx()] {
                    Some(new) => {
                        *target = new;
                        true
                    }
                    None => false,
                });
            });
            let mut file = 0;
            depths.retain(|_| {
                file += 1;
                is_retained[file - 1]
            });
            let mut file = 0;
            parses_to_take.retain(|_| {
                file += 1;
                is_retained[file - 1]
            });
            by_path
                .files
                .retain(|_, file| match renumbered[file.idx()] {
                    Some(new) => {
                        *file = new;
                        true
                    }
                    None => false,
                });
            for file in respelled
                .iter_mut()
                .chain(package_copies.iter_mut().map(|it| &mut it.1))
            {
                *file = renumber(*file);
            }
            only_found.retain_mut(|(file, ..)| {
                let is_in_program = is_retained[file.idx()];
                *file = renumber(*file);
                is_in_program
            });
            unsupported.retain_mut(|(file, ..)| {
                let is_in_program = is_retained[file.idx()];
                *file = renumber(*file);
                is_in_program
            });
            for start in &mut starts {
                *start = renumber(*start);
            }
        }
        program_errors.extend(resolver.resolution_problems());
        for (id, spec, mode, path) in only_found {
            if let Some(target) = by_path.get(path)
                && let Some(module) = &mut modules[id.idx()]
            {
                module.imports.insert((spec, mode), target);
            }
        }
        // `redirectFilesByPath`: the paths that alias a file that is stored under another path.
        let retained_copy_ids: FxHashSet<FileId> = package_copies.iter().map(|it| it.1).collect();
        let names_of_copies: FxHashSet<&[u8]> = package_copies.iter().map(|it| it.0).collect();
        let mut redirect_targets: ArenaHashMap<'s, FileId, &'s [&'s [u8]]> = map_in(arena);
        if !retained_copy_ids.is_empty() {
            let mut duplicates: FxHashMap<FileId, Vec<&'s [u8]>> = FxHashMap::default();
            for &(path, id) in &package_copies {
                duplicates.entry(id).or_default().push(path);
            }
            for (id, mut paths) in duplicates {
                paths.shared_sort();
                redirect_targets.insert(id, slice_in(&paths, arena));
            }
        }
        // `tasksSeenByNameIgnoreCase`
        let hash_of_name = |name: &[u8]| match name.is_ascii() {
            true => bun_wyhash::hash_ascii_lowercase(0, name),
            false => bun_wyhash::hash_ascii_lowercase(0, &to_file_name_lower_case(name)),
        };
        let is_relative_name = |spec: Atom| spec.is_some() && is_relative(atoms.bytes(spec));
        let count = modules.len();
        let is_referred_to: Vec<AtomicBool> = (0..count).map(|_| AtomicBool::new(false)).collect();
        // Ambient modules with `export .. from "./relative"` (2439). The other errors reported
        // there depend on which files import from them (`Checker::modules_is_imported_by_name`).
        let ambient_with_relative_reexports: Guarded<Vec<Atom>> = Guarded::new(Vec::new());
        let has_type_only_stars = AtomicBool::new(false);
        let summaries: Vec<Guarded<Option<ModuleSummary<'s>>>> =
            (0..count).map(|_| Guarded::new(None)).collect();
        // All the work on a module that doesn't involve other modules. A module is thousands of bytes, so each
        // single-threaded walk over all of them costs at least one cache miss per module.
        each_module(host, &mut modules, &|at, module| {
            // The arena of the thread that runs this closure.
            let own = session.arena();
            if let Some(slot) = parses_to_take[at] {
                let parse = slot.and_then(|slot| prefetch.take_parse(slot));
                Self::set_parse(own, host, options, &atoms, module, parse);
            }
            module.is_from_external_library = depths[at] > 0;
            // `GetSourceFileForResolvedModule`: an import of a referenced project's source resolves to its declaration
            // file, if that file is in the program.
            let mut built_imports = Vec::new();
            if !module.unbuilt_imports.is_empty() {
                let reference_imports = module.unbuilt_imports.iter().copied();
                let (built, unbuilt): (Vec<_>, Vec<_>) =
                    reference_imports.partition(|it| module.imports.contains_key(&(it.0, it.1)));
                let targets = built.iter().map(|it| (it.3, module.imports[&(it.0, it.1)]));
                built_imports.extend(targets);
                let mut redirected = module.redirected_imports.to_vec();
                redirected.extend(built.into_iter().map(|it| (it.0, it.1, it.3)));
                module.redirected_imports = few_in(redirected, own);
                module.unbuilt_imports = few_in(unbuilt, own);
            }
            if !retained_copy_ids.is_empty() {
                let mut added = Vec::new();
                for (&(spec, mode), target) in &module.imports {
                    if !retained_copy_ids.contains(target) {
                        continue;
                    }
                    let (resolver, from) = resolver.redirect_for_resolution(module.file_name());
                    if let Some(found) = resolver.resolve_module_name(atoms.bytes(spec), from, mode)
                        && names_of_copies.contains(found.file_name)
                    {
                        added.push((spec, mode, atoms.intern(found.file_name)));
                    }
                }
                if !added.is_empty() {
                    let mut redirected = module.redirected_imports.to_vec();
                    redirected.append(&mut added);
                    module.redirected_imports = few_in(redirected, own);
                }
            }
            keep_list(session, &mut module.hir.text);
            keep_list(session, &mut module.hir.diagnostics);
            keep_list(session, &mut module.hir.jsdoc_member_comments);
            keep_list(session, &mut module.hir.jsdoc_param_errors);
            // The merge appends symbols on the thread that called `load`, so move these lists to its arena. No other
            // list of a module grows after this.
            module.bound.symbols.transfer_to(arena);
            transfer_arena(&mut module.transient_symbols, arena);
            let (hir, bound) = (&module.hir, &module.bound);
            let targets: Vec<FileId> =
                (module.edges.iter().chain(module.imports.values()).copied()).collect();
            for target in &targets {
                is_referred_to[target.idx()].store(true, Ordering::Relaxed);
            }
            for declared in hir.modules.iter() {
                let ModuleName::String(name) = declared.name else {
                    continue;
                };
                let has_one = hir.ids(declared.body).any(|s| match hir[s].kind {
                    StmtKind::ExportNamed(x) => is_relative_name(hir[x].spec),
                    StmtKind::ExportStar { spec, .. } => is_relative_name(spec),
                    _ => false,
                });
                if has_one {
                    ambient_with_relative_reexports.lock().push(name);
                }
            }
            // `getAlternativeContainingModules` searches the exports of every module of the
            // program for a symbol.
            let is_alternative_container = options.emits_declarations
                && hir.stmts.iter().any(|statement| match statement.kind {
                    StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => true,
                    StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                        expression_is_alias(hir, e)
                    }
                    StmtKind::ImportEquals(it) => hir[it].flags.contains(Flags::EXPORT),
                    _ => false,
                });
            // `checkExternalModuleExports` for a file with an `export *` reports in other files,
            // which look for such a file (`Checker::is_export_of_file_checked_before`).
            let may_be_leaf = module.adds_no_globals
                && !is_alternative_container
                && bound.export_stars.is_empty();
            let is_type_only = |&(_, star): &(SymbolId, StmtId)| {
                matches!(
                    hir[star].kind,
                    StmtKind::ExportStar {
                        type_only: true,
                        ..
                    }
                )
            };
            if bound.export_stars.iter().any(is_type_only) {
                has_type_only_stars.store(true, Ordering::Relaxed);
            }
            *summaries[at].lock() = Some(ModuleSummary {
                file_name: module.file_name(),
                package_json_directory: module.package_json_directory,
                may_be_emitted: source_file_may_be_emitted(options, module, is_case_sensitive),
                hash_of_name: match is_case_sensitive {
                    true => hash_of_name(module.file_name()),
                    false => 0,
                },
                symbols: bound.symbols.len(),
                identifiers: module.identifiers,
                type_nodes: hir.types.len() as u32,
                edges: module.edges,
                is_lib: module.is_lib,
                targets,
                built_imports,
                may_be_leaf,
                declares_globals: !module.is_module()
                    || !bound.global_augmentations.is_empty()
                    || !bound.umd_globals.is_empty()
                    || !bound.pattern_ambient_modules.is_empty()
                    || !bound.ambient_modules.is_empty(),
            });
        });
        let mut modules: ArenaVec<'s, ModuleCell<'s>> = vec_from_iter_in(
            (modules.into_iter()).map(|module| ModuleCell(module.unwrap().into())),
            arena,
        );
        let summaries: Vec<ModuleSummary<'s>> = (summaries.into_iter())
            .map(|mut summary| summary.get_mut().take().unwrap())
            .collect();
        // For each declaration file that's read instead of a source: a name of that source.
        let mut redirected_from: FxHashMap<FileId, Atom> = FxHashMap::default();
        for (&start, &root) in starts[libs_end..roots_end].iter().zip(&root_of_start) {
            let root = &roots[root as usize];
            if options.parse_file_redirect(root).is_some() {
                redirected_from.insert(start, atoms.intern(root));
            }
        }
        // Each source's task has its own `seen[data]`, so a second source for one target counts as
        // a second spelling of its name.
        let mut redirect = |source: Atom, target: FileId| {
            if *redirected_from.entry(target).or_insert(source) != source
                && !respelled.contains(&target)
            {
                respelled.push(target);
            }
        };
        let has_redirects = !options.referenced_projects.is_empty() && !options.no_resolve;
        for module in modules.iter().filter(|_| has_redirects) {
            let from = module.file_name();
            for &(kind, value, ..) in &module.hir.references {
                if kind != ReferenceKind::Path {
                    continue;
                }
                let name = referenced_path(atoms.bytes(value), from);
                let Ok(source) = referenced_file(host, options, &name, from) else {
                    continue;
                };
                let output = options.parse_file_redirect(&source);
                if let Some(target) = output.and_then(|output| by_path.get(output)) {
                    redirect(atoms.intern(&source), target);
                }
            }
        }
        for &(source, target) in summaries.iter().flat_map(|summary| &summary.built_imports) {
            redirect(source, target);
        }
        for (target, source) in redirected_from {
            modules[target.idx()].project_reference_source = source;
        }
        let ambient_with_relative_reexports =
            std::mem::take(&mut *ambient_with_relative_reexports.lock());
        let reexports_relatively = |spec: Atom| ambient_with_relative_reexports.contains(&spec);
        // `Files::new_symbol` adds symbols that no file declares to the first file's symbols, so
        // the first file is never a leaf.
        for (i, summary) in summaries.iter().enumerate().skip(1) {
            if summary.may_be_leaf && !is_referred_to[i].load(Ordering::Relaxed) {
                let module = &mut modules[i];
                let imports_from_one = !ambient_with_relative_reexports.is_empty()
                    && (module
                        .hir
                        .imports
                        .iter()
                        .any(|it| reexports_relatively(it.spec))
                        || module
                            .hir
                            .exports
                            .iter()
                            .any(|it| reexports_relatively(it.spec)));
                module.is_leaf = !imports_from_one;
            }
        }
        // `tasksSeenByNameIgnoreCase`: only where they are different files.
        let mut case_variants: Vec<Vec<(&[u8], FileId)>> = Vec::new();
        let no_file = FileId(count as u32);
        // Detects two missing roots that have the same path but are spelled differently.
        let mut spelled: FxHashMap<Cow<'_, [u8]>, &[u8]> = FxHashMap::default();
        let mut is_respelled = false;
        for &name in &missing_roots {
            let first = spelled.entry(to_path(name, is_case_sensitive));
            is_respelled |= *first.or_insert(name) != name;
        }
        if is_respelled {
            respelled.push(no_file);
        }
        if is_case_sensitive {
            // (name, file, `hash_of_name`)
            let names = || {
                let program_names = summaries.iter().enumerate();
                let program_names =
                    program_names.map(|(i, it)| (it.file_name, FileId(i as u32), it.hash_of_name));
                let missing = missing_roots.iter().map(|&name| (name, no_file));
                let others = package_copies.iter().copied().chain(missing);
                program_names.chain(others.map(|(name, file)| (name, file, hash_of_name(name))))
            };
            let mut hashes: FxHashSet<u64> = FxHashSet::default();
            hashes.reserve(count);
            let repeated: FxHashSet<u64> = (names().map(|it| it.2))
                .filter(|&hash| !hashes.insert(hash))
                .collect();
            if !repeated.is_empty() {
                let mut by_lower_case: FxHashMap<Vec<u8>, Vec<(&[u8], FileId)>> =
                    FxHashMap::default();
                for (name, file, _) in names().filter(|it| repeated.contains(&it.2)) {
                    let names = by_lower_case.entry(to_file_name_lower_case(name));
                    names.or_default().push((name, file));
                }
                case_variants.extend(by_lower_case.into_values().filter(|names| names.len() > 1));
            }
        }
        let mut include_errors = unsupported;
        let included = Included {
            host,
            options,
            atoms: &atoms,
            modules: &modules,
            by_path: &by_path,
            roots,
            starts: &starts,
            libs_end,
            roots_end,
            root_of_start: &root_of_start,
            explained_in_diagnostics: Default::default(),
            top_elements_in_configuration: Default::default(),
            file_spec_by_path: Default::default(),
        };
        // None of their reasons is a reference in a file.
        let explained = included.explain_tasks_without_file(&without_file);
        let mut program_errors: Vec<Problem> = (explained.into_iter())
            .map(|explanation| explanation.1)
            .chain(program_errors)
            .collect();
        let (output_path_errors, common_source_directory) =
            output_path_errors(&included, &summaries, &mut include_errors);
        program_errors.extend(output_path_errors);
        for (at, problem) in included.file_casing_errors(&respelled, &case_variants) {
            match at {
                Some((file, start, end)) => include_errors.push((file, start, end, problem)),
                None => program_errors.push(problem),
            }
        }
        let explained_in_diagnostics = included.explained_in_diagnostics.into_inner();
        let symbols = Bases::new_in(summaries.iter().map(|summary| summary.symbols), &session);
        let memo = Memo::new_in(
            &Bases::new_in(summaries.iter().map(|_| 0), &session),
            session,
        );
        // It already has every atom in the files, since no file is added to the program from here on.
        let atoms = match run {
            Some(_) => Interner::over(session, atoms),
            None => atoms,
        };
        let no_symbol = Sym {
            file: FileId(0),
            id: SymbolId::NONE,
        };
        let mut files = Files {
            session,
            arena,
            atoms,
            options,
            modules,
            by_path,
            globals: SymbolMap::new_in(arena),
            global_this_symbol: no_symbol,
            undefined_symbol: no_symbol,
            unknown_symbol: no_symbol,
            common_source_directory: common_source_directory
                .map(|it| &*arena.alloc_slice_copy(&it)),
            is_case_sensitive: host.is_case_sensitive(),
            prototype_symbol: no_symbol,
            ambient_modules: map_in(arena),
            ambient_patterns: ArenaVec::new_in(arena),
            ambient_patterns_by_end: &[],
            pattern_augmentations: map_in(arena),
            merged_symbols: map_in(arena),
            merged_parts: map_in(arena),
            placeholders: ArenaVec::new_in(arena),
            rejected_exports: set_in(arena),
            merged_exports: map_in(arena),
            merged_members: map_in(arena),
            rejected_merges: ArenaVec::new_in(arena),
            augmentations_of_non_modules: ArenaVec::new_in(arena),
            files_with_rejected_merges: set_in(arena),
            circular_at_merge: ArenaVec::new_in(arena),
            resolved_at_merge: ArenaVec::new_in(arena),
            module_links_at_merge: Guarded::new(ArenaVec::new_in(arena)),
            modules_resolved_at_merge: &[],
            records_module_links: false,
            modules_with_nested_export_collisions: &[],
            failed_lookups: &[],
            parents_in_other_files: map_in(arena),

            has_type_only_stars: has_type_only_stars.into_inner(),
            alias_symbol_links: ByNodeIndirect::new_in(&symbols, session),
            is_linked: false,
            no_module_links: ModuleSymbolLinks::empty_in(arena),
            is_merged: false,
            has_symbols_to_combine: false,
            memo,
            order: &[],
            ranks: &[],
            components: Components::EMPTY,
            global_types: &[],
            arrays_have_numeric_members: false,
            program_errors: session.keep(program_errors),
            include_errors: session.keep(include_errors),
            package_jsons: map_in(arena),
            linked_directories: &[],
            redirect_targets,
            sizes: arena
                .alloc_slice_fill_iter(summaries.iter().map(|it| (it.identifiers, it.type_nodes))),
            resolution_trace: &[],
            starts: slice_in(&starts, arena),
            libs_end,
            roots_end,
            root_of_start: slice_in(&root_of_start, arena),
            package_copies: slice_in(&package_copies, arena),
            explained_in_diagnostics: session.keep(explained_in_diagnostics),
        };
        let order: &'s [FileId] = slice_in(&files.declaration_order(&starts, &summaries), arena);
        files.order = order;
        if options.trace_resolution {
            log.extend(
                lib_resolutions
                    .into_iter()
                    .flat_map(|resolution| resolution.1),
            );
            files.resolution_trace = session.keep(log);
        }
        let ranks = arena.alloc_slice_fill_copy(files.modules.len(), u32::MAX);
        for (rank, &file) in files.order.iter().enumerate() {
            ranks[file.idx()] = rank as u32;
        }
        files.ranks = ranks;
        // While this thread merges the symbols, other threads do the work that needs neither the symbols nor this
        // thread.
        let components: Guarded<Option<Components<'s>>> = Guarded::new(None);
        let find_components = || {
            let imports = |file: FileId| summaries[file.idx()].targets.clone();
            *components.lock() = Some(Components::new(order, &imports, session.arena()));
        };
        let atoms = files.atoms;
        let leftovers = Guarded::new(Some((prefetch, resolver)));
        let package_tables: Guarded<Option<PackageTables<'s>>> = Guarded::new(None);
        let end_resolution = || {
            let mut leftovers = leftovers.lock();
            if let Some((_, resolver)) = &*leftovers {
                *package_tables.lock() =
                    Some(Self::package_tables(session, resolver, &atoms, &summaries));
            }
            // Also drops the files that `prefetch_files` loaded but that aren't in the program.
            *leftovers = None;
        };
        let side_jobs: [&(dyn Fn() + Sync); 2] = [&find_components, &end_resolution];
        let declares_globals = |file: &FileId| summaries[file.idx()].declares_globals;
        let declaring: Vec<FileId> = order.iter().copied().filter(declares_globals).collect();
        // A declaration that every file can see can refer to anything its file imports, so every file can reach those
        // files too.
        let (mut is_exposed, mut pending) = (vec![false; files.modules.len()], declaring.clone());
        while let Some(file) = pending.pop() {
            if !std::mem::replace(&mut is_exposed[file.idx()], true) {
                files.modules[file.idx()].is_closed = false;
                pending.extend(&summaries[file.idx()].targets);
            }
        }
        host.parallel_while(side_jobs.len(), &|at| side_jobs[at](), &mut || {
            files.merge(host, &declaring);
        });
        files.components = components.lock().take().unwrap_or(Components::EMPTY);
        if let Some((package_jsons, linked_directories)) = package_tables.lock().take() {
            (files.package_jsons, files.linked_directories) = (package_jsons, linked_directories);
        }
        drop(leftovers);
        // Owns the resolver's paths. Freed on another thread during `link`.
        let resolving = Guarded::new(Some(resolving));
        let free_paths = |_: usize| drop(resolving.lock().take());
        host.parallel_while(1, &free_paths, &mut || files.link(host));
        let known_names = (0..known::sym_iterator.0).map(Atom);
        files.global_types =
            arena.alloc_slice_fill_iter(known_names.map(|name| files.global_type(name)));
        let begins_with_digit = |member: &(Atom, Sym)| {
            let name = files.atoms.bytes(member.0);
            name.first().is_some_and(u8::is_ascii_digit)
        };
        files.arrays_have_numeric_members = [known::Array, known::ReadonlyArray]
            .into_iter()
            .filter_map(|name| files.global_type_symbol(name))
            .any(|array| files.members_in_table(array).iter().any(begins_with_digit));
        files
    }

    /// Loads the seeds of `prefetch` and every file that can be predicted from them to be in the
    /// program. Each file is loaded as soon as a reference to it is seen. A file's id, and which of
    /// two copies of the same package is used, depend on the order in which files refer to each
    /// other. `meanwhile` walks the files in that order on the calling thread. It calls
    /// `Prefetch::take` for each file, which blocks until the file is loaded.
    ///
    /// Loader threads never wait for `meanwhile`, and each one exits when there's nothing more to
    /// load, so `meanwhile` can't block forever. `meanwhile` calls its argument, any number of
    /// times, after `Prefetch::wait` has returned. After that no task here waits for another, so the
    /// calling thread releases `WAITS_ACROSS_POOLS`. That lets another load begin.
    ///
    /// `parseTask.load` parses every copy of a package file, and `collectFiles` drops all but one. Here one copy is
    /// parsed, and a copy with the same text reuses that result to find what it refers to from its own location.
    /// `Prefetch::take_parse` returns the result for a `Loaded::parse`.
    fn prefetch_files<'r, 'u: 's>(
        session: &'s Session,
        run: Option<&'s Run<'u>>,
        host: &dyn Host,
        resolver: &Resolver<'r>,
        options: &'s Options,
        atoms: &Interner<'s>,
        prefetch: &Prefetch<'s, 'r>,
        meanwhile: &mut dyn FnMut(&mut dyn FnMut()),
    ) {
        /// Adjacent paths are in the same directory.
        const RUN: usize = 16;
        /// Contents that have been read occupy memory until they are processed.
        const AHEAD: usize = 256;
        // Not shared if each copy is in the program, or if the log shows what each copy refers to.
        let shares_parses = !options.retains_duplicate_packages && !options.trace_resolution;
        let Prefetch {
            state: shared,
            has_work,
            has_to_read,
            has_loaded,
        } = prefetch;
        // Resolves the next few of `job.names`. Returns false if none is left.
        let resolve_some = |job: &NamesToResolve<'r>| -> bool {
            const AT_A_TIME: usize = 32;
            let from = job.next.fetch_add(AT_A_TIME, Ordering::Relaxed);
            let names = job.names.get(from..).unwrap_or_default();
            let (resolver, importer) = resolver.redirect_for_resolution(job.path);
            for &(name, mode) in names.iter().take(AT_A_TIME) {
                let name = atoms.bytes(name);
                if !name.is_empty() {
                    resolver.resolve_module_name(name, importer, mode);
                }
            }
            !names.is_empty()
        };
        // With `once`, returns true after reading or processing one batch, or after one wait. Returns false once every
        // file is loaded.
        let load = |reads: bool, processes: bool, once: bool| -> bool {
            // A thread that only reads allocates nothing for the session, so it gets no arena.
            let mut arena = None;
            let mut state = shared.lock();
            let mut is_first = true;
            loop {
                if once && !std::mem::replace(&mut is_first, false) {
                    return true;
                }
                if processes && let Some(job) = state.to_resolve.last().cloned() {
                    drop(state);
                    let is_any_left = resolve_some(&job);
                    state = shared.lock();
                    if !is_any_left {
                        state.to_resolve.retain(|it| !Arc::ptr_eq(it, &job));
                    }
                } else if reads && !state.to_read.is_empty() && state.ready.len() <= AHEAD {
                    let count = state.to_read.len().min(RUN);
                    let some: Vec<_> = state.to_read.drain(..count).collect();
                    state.in_progress += count;
                    drop(state);
                    for file in some {
                        let is_in_run =
                            file.package.is_none() && run.is_some_and(|run| run.has(file.path));
                        let text = (!is_in_run).then(|| host.read_source(file.path));
                        shared.lock().ready.push((file, text));
                        has_work.notify_one();
                    }
                    state = shared.lock();
                } else if processes && let Some((file, text)) = state.ready.pop() {
                    if state.ready.len() == AHEAD {
                        has_to_read.notify_all();
                    }
                    let ToLoad {
                        path,
                        is_lib,
                        package,
                    } = file;
                    let parsed = match package.map(|slot| &mut state.slots[slot as usize]) {
                        None => None,
                        Some(Some(ParseSlot::InProgress(waiting))) => {
                            waiting.push((file, text));
                            continue;
                        }
                        Some(Some(ParseSlot::Done {
                            parse,
                            specifies_esm,
                            path,
                        })) => Some((Arc::clone(parse), *specifies_esm, *path)),
                        Some(slot @ None) => {
                            *slot = Some(ParseSlot::InProgress(Vec::new()));
                            None
                        }
                    };
                    drop(state);
                    let arena = *arena.get_or_insert_with(|| session.arena());
                    let resolve_ahead = |names: &[(Atom, ResolutionMode, bool)]| {
                        const MANY: usize = 256;
                        if names.len() < MANY {
                            return;
                        }
                        let job = Arc::new(NamesToResolve {
                            path,
                            names: names.iter().map(|it| (it.0, it.1)).collect(),
                            next: AtomicUsize::new(0),
                        });
                        shared.lock().to_resolve.push(Arc::clone(&job));
                        has_work.notify_all();
                        while resolve_some(&job) {}
                        (shared.lock().to_resolve).retain(|it| !Arc::ptr_eq(it, &job));
                    };
                    let load_parsed = |specifies_esm: bool, parse: &Parse<'s>| {
                        let mut loaded = Self::load_parsed(
                            arena,
                            host,
                            resolver,
                            options,
                            atoms,
                            path,
                            is_lib,
                            specifies_esm,
                            Err(parse),
                            &resolve_ahead,
                        );
                        loaded.parse = package;
                        loaded
                    };
                    let specifies_esm =
                        package.is_some() && Self::specifies_esm(resolver, options, path, is_lib);
                    let mut parsed_now = None;
                    let loaded = match (package, parsed) {
                        (Some(_), Some((parse, parsed_specifies_esm, parsed_path)))
                            if parsed_specifies_esm == specifies_esm
                                // A package file's text is always `Some`, because it has been read.
                                && *parse.hir.text == *text.as_deref().unwrap_or_default()
                                && get_base_file_name(parsed_path) == get_base_file_name(path) =>
                        {
                            load_parsed(specifies_esm, &parse)
                        }
                        (Some(_), None) => {
                            let text = text.unwrap_or_default();
                            let parse = match run.filter(|run| run.has_file(host, path)) {
                                Some(run) => {
                                    let key = ParseKey {
                                        options: options.for_parsing(),
                                        script_kind: host.script_kind(path),
                                        is_lib,
                                        specifies_esm,
                                        origin: host.origin(path),
                                    };
                                    let parse = run.parse(host, path, key, Some(text));
                                    Parse {
                                        hir: parse.hir.share(arena, session),
                                        bound: parse.bound.share(arena),
                                        is_shared: true,
                                    }
                                }
                                None => {
                                    let (hir, bound) = Self::parse_and_bind(
                                        arena,
                                        host,
                                        options.for_parsing(),
                                        atoms,
                                        path,
                                        is_lib,
                                        specifies_esm,
                                        text,
                                    );
                                    Parse {
                                        hir,
                                        bound,
                                        is_shared: false,
                                    }
                                }
                            };
                            let parse = Arc::new(parse);
                            let loaded = load_parsed(specifies_esm, &parse);
                            parsed_now = Some(ParseSlot::Done {
                                parse,
                                specifies_esm,
                                path,
                            });
                            loaded
                        }
                        _ => Self::load_one(
                            session,
                            arena,
                            run,
                            host,
                            resolver,
                            options,
                            atoms,
                            path,
                            is_lib,
                            text,
                            &resolve_ahead,
                        ),
                    };
                    let mut loaded = Box::new(loaded);
                    // The sub tasks that don't depend on a file's depth in packages: all
                    // references, and these imports.
                    let predicted: Vec<usize> = (0..loaded.imports.len())
                        .filter(|&at| {
                            let it = &loaded.imports[at];
                            it.should_add_file
                                && it.unsupported_extension.is_none()
                                && !(is_javascript_file(host, it.path)
                                    && strings::contains(it.path, b"/node_modules/"))
                        })
                        .collect();
                    let found: Vec<(&'r [u8], bool, Option<PackageId<'r>>)> = loaded
                        .references
                        .iter()
                        .map(|&(path, is_lib, _, package_id)| (path, is_lib, package_id))
                        .chain(predicted.iter().map(|&at| {
                            let it = &loaded.imports[at];
                            (it.path, false, it.package_id)
                        }))
                        .collect();
                    let mut numbers: Vec<u32> = Vec::with_capacity(found.len());
                    state = shared.lock();
                    let before = state.to_read.len();
                    for (path, is_lib, package_id) in found {
                        let state = &mut *state;
                        let next = state.seen.len() as u32;
                        let number = *state.seen.entry(path).or_insert(next);
                        numbers.push(number);
                        if number == next {
                            let package = package_id.filter(|_| shares_parses).map(|id| {
                                let new = state.slots.len() as u32;
                                let slot = *state.by_package_id.entry(id.to_bytes()).or_insert(new);
                                if slot == new {
                                    state.slots.push(None);
                                }
                                slot
                            });
                            state.to_read.push_back(ToLoad {
                                path,
                                is_lib,
                                package,
                            });
                        }
                    }
                    let import_numbers = numbers.split_off(loaded.references.len());
                    loaded.reference_numbers = numbers;
                    for (&at, number) in predicted.iter().zip(import_numbers) {
                        loaded.imports[at].number = number;
                    }
                    let has_more = state.to_read.len() > before;
                    let mut has_ready = false;
                    if let (Some(slot), Some(done)) = (package, parsed_now)
                        && let Some(ParseSlot::InProgress(waiting)) =
                            state.slots[slot as usize].replace(done)
                    {
                        has_ready = !waiting.is_empty();
                        state.ready.extend(waiting);
                    }
                    state.done.insert(path, loaded);
                    state.in_progress -= 1;
                    has_loaded.notify_all();
                    if has_more || state.in_progress == 0 {
                        has_to_read.notify_all();
                    }
                    if has_more && reads || has_ready || state.in_progress == 0 {
                        has_work.notify_all();
                    }
                } else if state.in_progress == 0 && state.to_read.is_empty() {
                    has_work.notify_all();
                    has_to_read.notify_all();
                    return false;
                } else if processes {
                    has_work.wait_guarded(&mut state);
                } else {
                    has_to_read.wait_guarded(&mut state);
                }
            }
        };
        if prefetch.is_done() {
            return meanwhile(&mut || ());
        }
        let (threads, io) = (host.threads(), host.io_pool());
        let mut pools_lock = io.map(|_| WAITS_ACROSS_POOLS.lock());
        let mut meanwhile = || meanwhile(&mut || drop(pools_lock.take()));
        let mut on_all_threads = |reads: bool| {
            let work = || {
                load(reads, true, false);
            };
            match host.helpers_now() {
                Some(_) => {
                    let mut step = || load(reads, true, true);
                    run_with_current_helpers(host, 0, &mut step, &work);
                    meanwhile();
                }
                None => host.parallel_while(threads, &|_| work(), &mut meanwhile),
            }
        };
        match io {
            Some(io) => io.each_while(
                (),
                |(), (), _| {
                    load(true, false, false);
                },
                &mut vec![(); io.max_threads()],
                || on_all_threads(false),
            ),
            // Any one of these finishes the load by itself.
            None => on_all_threads(true),
        }
    }

    /// Does everything that depends only on the file's text and on what kind of file it is. The
    /// caller that assigns the result to a file also calls `rename_private_names`.
    fn parse_and_bind(
        arena: &'s Arena,
        host: &dyn Host,
        options: ParseOptions,
        atoms: &Interner<'s>,
        path: &[u8],
        is_lib: bool,
        specifies_esm: bool,
        text: Cow<'static, [u8]>,
    ) -> (hir::File<'s>, Bound<'s>) {
        let mut hir = host.parse(arena, path, &text, atoms, options);
        if !options.keeps_comments {
            hir.comments = Default::default();
        }
        if !is_lib || options.keeps_library_text {
            hir.text = text;
        }
        // `getExternalModuleIndicator`: the other conditions that make a file without imports or
        // exports a module.
        if !hir.has_module_syntax && hir.kind != FileKind::Declaration {
            let (mut has_import_meta, mut has_jsx) = (false, false);
            for e in &hir.exprs {
                has_import_meta |= matches!(e.kind, hir::ExprKind::ImportMeta);
                has_jsx |= matches!(e.kind, hir::ExprKind::Jsx(_));
            }
            // Syntax in the file indicates it: `import.meta`, or a JSX tag that imports its
            // factory.
            let is_indicated_by_syntax = has_import_meta
                || options.module_detection == ModuleDetection::Auto
                    && has_jsx
                    && options.jsx_imports_its_factory;
            // `moduleDetection: force`, `isFileForcedToBeModuleByFormat`: the file itself is the
            // external module indicator.
            let is_decreed = match options.module_detection {
                ModuleDetection::Force => true,
                ModuleDetection::Legacy => false,
                ModuleDetection::Auto => {
                    specifies_esm || format_by_extension(path) != ResolutionMode::None
                }
            };
            hir.has_module_syntax = is_indicated_by_syntax || is_decreed;
            hir.is_forced_module = !is_indicated_by_syntax && is_decreed;
        }
        let mut bound = bind::bind(&hir, options.bind, atoms, arena);
        // The same result as when the parser runs out of stack: an empty HIR, which `check_file`
        // reports as not fully checked.
        if bound.ran_out_of_stack {
            hir = hir::File {
                text: std::mem::take(&mut hir.text),
                source_len: hir.source_len,
                has_module_syntax: hir.has_module_syntax,
                has_errors: true,
                has_parse_diagnostics: true,
                ran_out_of_stack: true,
                ..host.parse(arena, path, b"", atoms, options)
            };
            bound = bind::bind(&hir, options.bind, atoms, arena);
        }
        (hir, bound)
    }

    /// Sets `hir` and `bound` of `module`, the copy of a package file that's in the program. If `parse`
    /// is `None`, another file took `prefetch_files`'s parse, so the file is read and parsed again. `arena`
    /// must belong to the calling thread.
    fn set_parse(
        arena: &'s Arena,
        host: &dyn Host,
        options: &Options,
        atoms: &Interner<'s>,
        module: &mut Module<'s>,
        parse: Option<Parse<'s>>,
    ) {
        let path = module.file_name();
        let parse = parse.unwrap_or_else(|| {
            let (hir, bound) = Self::parse_and_bind(
                arena,
                host,
                options.for_parsing(),
                atoms,
                path,
                false,
                module.specifies_esm,
                host.read_source(path),
            );
            Parse {
                hir,
                bound,
                is_shared: false,
            }
        });
        (module.hir, module.bound) = (parse.hir, parse.bound);
        // A parse from the run already went through `rename_private_names`, with the path of the copy that was parsed.
        // No other module has that path.
        if !parse.is_shared {
            rename_private_names(&mut module.hir, &module.bound, atoms, path);
        }
    }

    /// Builds `Files::package_jsons` and `Files::linked_directories` in the calling thread's arena.
    fn package_tables(
        session: &'s Session,
        resolver: &Resolver,
        atoms: &Interner<'s>,
        summaries: &[ModuleSummary<'s>],
    ) -> PackageTables<'s> {
        let arena = session.arena();
        let mut package_jsons: FxHashMap<&'s [u8], Arc<Json>> = FxHashMap::default();
        let mut previous_scope = Atom::NONE;
        for summary in summaries {
            let path: &'s [u8] = summary.file_name;
            if let Some((_, _, end)) = crate::resolve::node_module_path_parts(path)
                && !package_jsons.contains_key(&path[..end])
                && let Some(json) = resolver.package_json(&path[..end])
            {
                package_jsons.insert(&path[..end], json);
            }
            let scope = summary.package_json_directory;
            if scope.is_some() && scope != std::mem::replace(&mut previous_scope, scope) {
                let directory = atoms.bytes(scope);
                if !package_jsons.contains_key(directory)
                    && let Some(json) = resolver.package_json(directory)
                {
                    package_jsons.insert(slice_in(directory, arena), json);
                }
            }
        }
        let mut linked_directories: &'s [(&'s [u8], &'s [u8])] = &[];
        let emitted = summaries.iter().filter(|summary| summary.may_be_emitted);
        let found = resolver.linked_directories(emitted.map(|summary| summary.file_name));
        if !found.is_empty() {
            let found = found.iter();
            linked_directories = arena.alloc_slice_fill_iter(
                found.map(|(real, link)| (slice_in(real, arena), slice_in(link, arena))),
            );
        }
        for &(_, link) in linked_directories {
            if !package_jsons.contains_key(link)
                && let Some(json) = resolver.package_json(link)
            {
                package_jsons.insert(link, json);
            }
        }
        let (directories, jsons): (Vec<&'s [u8]>, Vec<Arc<Json>>) =
            package_jsons.into_iter().unzip();
        let jsons = session.keep(jsons).iter().map(|json| &**json);
        let mut package_jsons: ArenaHashMap<'s, &'s [u8], &'s Json> = map_in(arena);
        package_jsons.extend(directories.into_iter().zip(jsons));
        (package_jsons, linked_directories)
    }

    /// Frees the HIR of `file`, which `is_leaf`. Its text is retained for the report.
    ///
    /// # Safety
    /// Only the task that checks `file` may call this, and only at the end of the task, because an
    /// entry of its buffer can hold a value that's bound to an earlier file of the task. No
    /// reference into `hir` or `bound` of the file may be alive.
    pub unsafe fn free_tree(&self, file: FileId) {
        let cell = &self.modules[file.idx()];
        debug_assert!(cell.is_leaf);
        // SAFETY: no file refers to it, so no other task reads its HIR.
        let module: &mut Module<'s> = unsafe { &mut *cell.0.get() };
        module.hir = stub_of(&mut module.hir);
        module.bound = Bound::empty_in(module.hir.arena());
        module.transient_symbols.clear();
    }

    /// `arena`: the calling thread's arena in `session`. `text`: `None` if the file hasn't been read yet.
    fn load_one<'r, 'u: 's>(
        session: &'s Session,
        arena: &'s Arena,
        run: Option<&'s Run<'u>>,
        host: &dyn Host,
        resolver: &Resolver<'r>,
        options: &'s Options,
        atoms: &Interner<'s>,
        path: &[u8],
        is_lib: bool,
        text: Option<Cow<'static, [u8]>>,
        resolve_ahead: &dyn Fn(&[(Atom, ResolutionMode, bool)]),
    ) -> Loaded<'s, 'r> {
        let specifies_esm = Self::specifies_esm(resolver, options, path, is_lib);
        let parse = match run.filter(|run| run.has_file(host, path)) {
            Some(run) => {
                let key = ParseKey {
                    options: options.for_parsing(),
                    script_kind: host.script_kind(path),
                    is_lib,
                    specifies_esm,
                    origin: host.origin(path),
                };
                let parse = run.parse(host, path, key, text);
                Parse {
                    hir: parse.hir.share(arena, session),
                    bound: parse.bound.share(arena),
                    is_shared: true,
                }
            }
            None => {
                let (mut hir, bound) = Self::parse_and_bind(
                    arena,
                    host,
                    options.for_parsing(),
                    atoms,
                    path,
                    is_lib,
                    specifies_esm,
                    text.unwrap_or_else(|| host.read_source(path)),
                );
                rename_private_names(&mut hir, &bound, atoms, path);
                Parse {
                    hir,
                    bound,
                    is_shared: false,
                }
            }
        };
        Self::load_parsed(
            arena,
            host,
            resolver,
            options,
            atoms,
            path,
            is_lib,
            specifies_esm,
            Ok(parse),
            resolve_ahead,
        )
    }

    /// `parseTask.load`: a library is given `SourceFileMetaData{ImpliedNodeFormat: CommonJS}`,
    /// whatever `package.json` is above it.
    /// `GetImpliedNodeFormatForFile`: a JSON file is neither kind of module, regardless of its
    /// package.
    fn specifies_esm(resolver: &Resolver, options: &Options, path: &[u8], is_lib: bool) -> bool {
        !is_lib
            && !path.ends_with(b".json")
            && (options.resolves_like_node || strings::contains(path, b"/node_modules/"))
            && resolver.is_ecmascript_module(path)
    }

    /// Does everything that depends on where the file is. With `Err`, the returned module has no
    /// `hir` and `bound`. `resolve_ahead`: called with the module names before they're resolved one
    /// by one. It may resolve them.
    fn load_parsed<'r>(
        arena: &'s Arena,
        host: &dyn Host,
        resolver: &Resolver<'r>,
        options: &'s Options,
        atoms: &Interner<'s>,
        path: &[u8],
        is_lib: bool,
        specifies_esm: bool,
        parsed: Result<Parse<'s>, &Parse<'s>>,
        resolve_ahead: &dyn Fn(&[(Atom, ResolutionMode, bool)]),
    ) -> Loaded<'s, 'r> {
        let (Ok(Parse { hir, bound, .. }) | Err(Parse { hir, bound, .. })) = &parsed;
        let is_esm = options.resolves_like_node && specifies_esm;
        let package_json_without_type =
            if !is_lib && matches!(options.module, ModuleKind::Node16 | ModuleKind::Node18) {
                resolver
                    .package_json_without_type(path)
                    .map_or(Atom::NONE, |found| atoms.intern(&found))
            } else {
                Atom::NONE
            };
        // `optionsForFile`. Program-wide diagnostics still use the options of the program.
        let (program_options, program_resolver) = (options, resolver);
        let (resolver, from) = resolver.redirect_for_resolution(path);
        let options = resolver.options();
        let mut referenced = program_options.referenced_options.iter();
        let redirect_for_resolution = referenced.find(|&it| std::ptr::eq(it, options));
        let implied_format =
            implied_node_format_for_emit(program_resolver, path, is_lib, options.module);
        let default_mode = options.default_mode(implied_format);
        let visited = match hir.specifier_uses.is_empty() {
            true => Vec::new(),
            false => module_references(hir),
        };
        let is_import = |u: &SpecifierUse| is_among_imports(&visited, atoms, u);
        let mut extensionless_imports = Vec::new();
        // `moduleNames`, each with the mode it is resolved in, and whether it is a synthetic import
        // or one of `file.Imports()`: a module augmentation adds no file to the program.
        let mut module_names: Vec<(Atom, ResolutionMode, bool)> = Vec::new();
        if imports_helpers(options, hir) {
            module_names.push((known::tslib, default_mode, true));
        }
        // Interned whether or not it resolves: the checker passes it to `module_of_specifier`,
        // which only accepts published atoms.
        let runtime = jsx_runtime_of(options, hir, atoms);
        let runtime = runtime.map(|runtime| (atoms.intern(&runtime), runtime));
        // Only a file that can contain JSX tags, according to its file name, imports their runtime.
        let runtime = runtime.filter(|_| crate::resolve::is_jsx_file_name(path));
        // Each entry of `moduleNames` is resolved, even one that repeats another.
        let (types_tracer, tracer) = (Tracer::default(), Tracer::default());
        if program_options.trace_resolution {
            let trace = |name: &[u8], mode: ResolutionMode| {
                if !name.is_empty() {
                    resolver.resolve_module_name_traced(name, from, mode, Some(&tracer));
                }
            };
            if imports_helpers(options, hir) {
                trace(b"tslib", default_mode);
            }
            if let Some((_, runtime)) = &runtime {
                trace(runtime, default_mode);
            }
            let statements = hir.specifier_uses.iter().filter(|u| !u.kind.is_dynamic());
            let mut statements: Vec<&SpecifierUse> = statements.collect();
            statements.shared_sort_by_key(|u| u.pos);
            let uses = statements.into_iter().chain(dynamic_imports(hir));
            for u in uses.filter(|u| is_import(u)) {
                let mode = mode_for_usage_location(options, default_mode, u);
                trace(atoms.bytes(u.spec), mode);
            }
            // `getModuleNames`: nothing is resolved for `declare global`.
            for augmentation in module_augmentations(hir, atoms) {
                if let ModuleName::String(name) = hir[augmentation].name {
                    trace(atoms.bytes(name), default_mode);
                }
            }
        }
        // `isExtensionlessRelativePathImport`, with the answer of `getSuggestedImportExtension`.
        let extensionless_import = |spec: Atom| {
            let text = atoms.bytes(spec);
            if !options.resolves_like_node
                || !path_is_relative(text)
                || strings::contains_char(get_base_file_name(text), b'.')
            {
                return None;
            }
            let stem = join(dirname::<Posix>(path), text);
            let for_tsx: &'static [u8] = if options.jsx == JsxEmit::Preserve {
                b".jsx"
            } else {
                b".js"
            };
            let suggested = [
                (&b".mts"[..], &b".mjs"[..]),
                (b".ts", b".js"),
                (b".cts", b".cjs"),
                (b".mjs", b".mjs"),
                (b".js", b".js"),
                (b".cjs", b".cjs"),
                (b".tsx", for_tsx),
                (b".jsx", b".jsx"),
                (b".json", b".json"),
            ]
            .into_iter()
            .find(|(e, _)| host.is_file(&[&stem[..], e].concat()));
            Some((spec, suggested.map(|found| found.1)))
        };
        if let Some((spec, _)) = runtime {
            extensionless_imports.extend(extensionless_import(spec));
            module_names.push((spec, default_mode, true));
        }
        // `file.Imports()`, then `file.ModuleAugmentations`, each with its sort key in that order.
        // The specifiers of statements come before those of `import()`, the call and the type.
        const AFTER_IMPORTS: (bool, u32) = (true, u32::MAX);
        let mut keyed_names: Vec<((bool, u32), (Atom, ResolutionMode, bool))> = Vec::new();
        // Groups the uses by specifier, each group in the order of `specifier_uses`. A barrel file has thousands of
        // specifiers, so a scan of all uses for each one is quadratic.
        let uses = hir.specifier_uses.iter().enumerate();
        let mut uses_by_specifier: Vec<(u32, u32)> =
            uses.map(|(at, u)| (u.spec.0, at as u32)).collect();
        uses_by_specifier.shared_sort_unstable();
        let uses_of = |spec: Atom| {
            let from = uses_by_specifier.partition_point(|it| it.0 < spec.0);
            let group = uses_by_specifier[from..].iter();
            let group = group.take_while(move |it| it.0 == spec.0);
            group.map(|it| &hir.specifier_uses[it.1 as usize])
        };
        // `collectModuleReferences`: of the imports in the body of a `declare module "m"` in a
        // script, only non-relative specifiers are resolved.
        let ambient = bound
            .ambient_specifiers
            .iter()
            .filter(|&&spec| !is_relative(atoms.bytes(spec)));
        for &spec in ambient
            .chain(&bound.specifiers)
            .chain(bound.module_augmentations.iter())
        {
            extensionless_imports.extend(extensionless_import(spec));
            // It's resolved in each mode that one of `file.Imports()` requests. Each mode is paired
            // with the sort key of its first use.
            let mut modes = [(default_mode, AFTER_IMPORTS); 3];
            let mut count = 0;
            for u in uses_of(spec).filter(|u| is_import(u)) {
                let mode = mode_for_usage_location(options, default_mode, u);
                let sort_key = (u.kind.is_dynamic(), u.pos);
                match modes[..count].iter_mut().find(|known| known.0 == mode) {
                    Some(known) => known.1 = known.1.min(sort_key),
                    None => {
                        modes[count] = (mode, sort_key);
                        count += 1;
                    }
                }
            }
            let imported = count;
            // A module augmentation resolves the module the way the file itself would, regardless
            // of other uses of the specifier. It doesn't add the file to the program.
            let is_module_name = bound.ambient_modules.iter().any(|m| m.0 == spec);
            if (count == 0 || is_module_name && hir.has_module_syntax)
                && !modes[..count].iter().any(|known| known.0 == default_mode)
            {
                modes[count] = (default_mode, AFTER_IMPORTS);
                count += 1;
            }
            for (i, &(mode, sort_key)) in modes[..count].iter().enumerate() {
                keyed_names.push((sort_key, (spec, mode, i < imported || !is_module_name)));
            }
        }
        keyed_names.shared_sort_by_key(|name| name.0);
        module_names.extend(keyed_names.into_iter().map(|name| name.1));
        resolve_ahead(&module_names);
        let mut imports = Vec::new();
        let (mut untyped_imports, mut untyped_import_files) = (Vec::new(), Vec::new());
        let mut untyped_import_alternates = Vec::new();
        let mut resolved_packages: Vec<(Atom, bool)> = Vec::new();
        let (mut jsx_imports, mut json_imports) = (Vec::new(), Vec::new());
        let (mut arbitrary_extension_imports, mut arbitrary_extension_files) =
            (Vec::new(), Vec::new());
        let (mut ts_extension_imports, mut project_reference_imports) = (Vec::new(), Vec::new());
        let (mut unbuilt_imports, mut redirected_imports) = (Vec::new(), Vec::new());
        for (spec, mode, is_import) in module_names {
            let text = atoms.bytes(spec);
            if text.is_empty() {
                continue;
            }
            let Some(resolved) = resolver.resolve_module_name(text, from, mode) else {
                continue;
            };
            let (key, found) = ((spec, mode), resolved.file_name);
            if resolved.resolved_file_name != found {
                redirected_imports.push((spec, mode, atoms.intern(resolved.resolved_file_name)));
            }
            if let Some(id) = resolved.package_id {
                let package = (atoms.intern(id.name), found.ends_with(b".d.ts"));
                if !resolved_packages.contains(&package) {
                    resolved_packages.push(package);
                }
            }
            if resolved.using_ts_extension {
                ts_extension_imports.push(key);
            }
            if resolved.is_project_reference_redirect {
                project_reference_imports.push(key);
            }
            let extension = Extension::of(host, &resolved);
            // `!resolutionExtensionIsTSOrJson(Extension)`
            let is_javascript = matches!(extension, Extension::Js | Extension::Jsx);
            if is_javascript {
                untyped_imports.push(key);
                if let Some(types) = resolved.alternate_result {
                    untyped_import_alternates.push((spec, mode, atoms.intern(types)));
                }
                let package = resolved.package_id.map(|id| atoms.intern(id.name));
                untyped_import_files.push((atoms.intern(found), package));
            }
            // `resolveExternalModule` uses the program's options.
            let diagnostic = get_resolution_diagnostic(program_options, extension, hir);
            match diagnostic {
                Some(6142) => jsx_imports.push((spec, mode, atoms.intern(found))),
                Some(7042) => json_imports.push((spec, mode, atoms.intern(found))),
                Some(6263) => {
                    arbitrary_extension_imports.push(key);
                    arbitrary_extension_files.push(atoms.intern(resolved.resolved_file_name));
                }
                _ => {}
            }
            // "Don't treat redirected files as JS files."
            let is_js_file =
                is_javascript && !program_options.is_source_of_referenced_project(found);
            let should_add_file = is_import
                && get_resolution_diagnostic(options, extension, hir).is_none()
                && !options.no_resolve
                && !(program_options.imports_of_sources_add_no_file
                    && hir.kind != FileKind::Declaration
                    && !(resolved.is_external_library_import
                        && crate::resolve::is_declaration_file_name(found)))
                && !(is_js_file && !options.allow_js);
            // `parseTask.load`: the declaration file is read in place of a source of a referenced
            // project. Any other file needs an extension that the program supports.
            let redirect = program_options.parse_file_redirect(found);
            if let Some(output) = redirect {
                let source = atoms.intern(found);
                unbuilt_imports.push((spec, mode, atoms.intern(output), source));
            }
            let unsupported_extension = if should_add_file && redirect.is_none() {
                unsupported_extension_error(program_options, found, host.is_case_sensitive())
                    .filter(|_| host.script_kind(found).is_none())
            } else {
                None
            };
            let unsupported_extension = unsupported_extension.map(|code| {
                let mode_of = |u: &SpecifierUse| mode_for_usage_location(options, default_mode, u);
                let uses = hir.specifier_uses.iter();
                let uses = uses.filter(|u| u.spec == spec && mode_of(u) == mode);
                let first = uses.min_by_key(|u| u.pos);
                let span = first.map(|u| (u.pos, end_of_string_literal(&hir.text, u.pos)));
                UnsupportedExtension { code, span }
            });
            imports.push(Resolution {
                spec,
                mode,
                path: redirect.map_or(found, |output| resolver.keep(output)),
                number: NOT_NUMBERED,
                should_add_file: should_add_file
                    && redirect.is_none_or(|output| host.is_file(output)),
                increases_depth: resolved.is_external_library_import,
                package_id: resolved.package_id.filter(|_| redirect.is_none()),
                is_importable: matches!(diagnostic, None | Some(6142)),
                unsupported_extension,
            });
        }
        // They are processed by kind: paths, then types, then libraries.
        let (mut references, mut types, mut libs) = (Vec::new(), Vec::new(), Vec::new());
        let (mut missing_references, mut unsupported_libs) = (Vec::new(), Vec::new());
        for &(kind, value, pos, mode) in &hir.references {
            // `noResolve`: only library references are still processed.
            if program_options.no_resolve
                && matches!(kind, ReferenceKind::Path | ReferenceKind::Types)
            {
                continue;
            }
            let value = atoms.bytes(value);
            match kind {
                ReferenceKind::Path => {
                    match referenced_file(
                        host,
                        program_options,
                        &referenced_path(value, path),
                        path,
                    ) {
                        Ok(found) => match program_options.parse_file_redirect(&found) {
                            Some(output) if host.is_file(output) => {
                                references.push((resolver.keep(output), false, false, None));
                            }
                            Some(_) => {}
                            None => references.push((resolver.keep(&found), false, false, None)),
                        },
                        Err(code) => missing_references.push((pos, code)),
                    }
                }
                ReferenceKind::Lib => {
                    if program_options.no_lib {
                        continue;
                    }
                    match referenced_lib(host, program_options, value) {
                        Some(lib) => {
                            let found = lib_path(program_resolver, program_options, &lib);
                            let found = resolver.keep(&found);
                            match unsupported_extension_of_lib(host, program_options, found) {
                                Some(code) => {
                                    let end = pos + value.len() as u32;
                                    unsupported_libs.push((pos, end, found, code));
                                }
                                None => libs.push((found, true, false, None)),
                            }
                        }
                        None => missing_references.push((pos, 2726)),
                    }
                }
                ReferenceKind::Types => {
                    // `getModeForTypeReferenceDirectiveInFile`
                    let mode = if mode == ResolutionMode::None {
                        implied_format
                    } else {
                        mode
                    };
                    match resolver.resolve_type_reference_and_id(
                        value,
                        from,
                        mode,
                        program_options.trace_resolution.then_some(&types_tracer),
                    ) {
                        Some((found, is_external, package_id)) => {
                            types.push((resolver.keep(&found), false, is_external, package_id));
                        }
                        None => missing_references.push((pos, 2688)),
                    }
                }
            }
        }
        references.extend(types);
        references.extend(libs);
        let has_conditional_or_mapped_type = hir.types.iter().any(|node| {
            matches!(
                node.kind,
                TypeNodeKind::Cond { .. } | TypeNodeKind::Mapped(_)
            )
        });
        let identifiers = count_identifiers(hir);
        let is_closed = !is_lib
            && (hir.has_module_syntax || bound.commonjs_indicator.is_some())
            && bound.global_augmentations.is_empty()
            && bound.ambient_modules.is_empty()
            && bound.pattern_ambient_modules.is_empty()
            && bound.umd_globals.is_empty();
        let adds_no_globals = is_closed
            && matches!(hir.kind, FileKind::Ts | FileKind::Tsx)
            && !hir.is_js
            && hir.has_module_syntax;
        let (type_resolutions_trace, resolutions_trace) =
            (types_tracer.into_traces(), tracer.into_traces());
        let parse = parsed.unwrap_or_else(|parse| Parse {
            hir: hir::File::empty_in(arena, parse.hir.lazy.session),
            bound: Bound::empty_in(arena),
            is_shared: false,
        });
        let module = Module {
            hir: parse.hir,
            bound: parse.bound,
            is_lib,
            // `load` fills `path`, `imports` and `edges`.
            path: Path::init(b""),
            imports: map_in(arena),
            untyped_imports: few_in(untyped_imports, arena),
            untyped_import_files: few_in(untyped_import_files, arena),
            resolved_packages: few_in(resolved_packages, arena),
            untyped_import_alternates: few_in(untyped_import_alternates, arena),
            jsx_imports: few_in(jsx_imports, arena),
            json_imports: few_in(json_imports, arena),
            ts_extension_imports: few_in(ts_extension_imports, arena),
            arbitrary_extension_imports: few_in(arbitrary_extension_imports, arena),
            arbitrary_extension_files: few_in(arbitrary_extension_files, arena),
            extensionless_imports: few_in(extensionless_imports, arena),
            missing_references: few_in(missing_references, arena),
            is_esm,
            specifies_esm,
            implied_format,
            default_mode,
            package_json_without_type,
            package_json_directory: resolver
                .package_json_directory(path)
                .map_or(Atom::NONE, |directory| atoms.intern(directory)),
            edges: &[],
            redirected_imports: few_in(redirected_imports, arena),
            project_reference_imports: few_in(project_reference_imports, arena),
            unbuilt_imports: few_in(unbuilt_imports, arena),
            project_reference_source: Atom::NONE,
            redirect_for_resolution,
            is_from_external_library: false,
            is_leaf: false,
            adds_no_globals,
            is_closed,
            has_conditional_or_mapped_type,
            identifiers,
            transient_symbols: ArenaVec::new_in(arena),
        };
        Loaded {
            module: ArenaBox::new_in(module, arena),
            parse: None,
            imports,
            references,
            reference_numbers: Vec::new(),
            unsupported_libs,
            type_resolutions_trace,
            resolutions_trace,
        }
    }

    /// Errors in what the options refer to, not attributable to any file. Errors in the options
    /// themselves are in `options.problems`.
    pub fn program_problems(&self) -> &[Problem] {
        self.program_errors
    }

    /// `GetIncludeProcessorDiagnostics`: errors about the inclusion of a file in the program,
    /// reported at a reference to it in `file`. The second and the third fields are the span.
    pub fn include_problems_in(
        &self,
        file: FileId,
    ) -> impl Iterator<Item = &(FileId, u32, u32, Problem)> {
        self.include_errors
            .iter()
            .filter(move |problem| problem.0 == file)
    }

    /// The module that `file` imports implicitly for its JSX.
    pub fn jsx_runtime(&self, file: FileId) -> Option<Atom> {
        let module = &self.modules[file.idx()];
        // `resolveImportsAndModuleAugmentations`: only `ScriptKindTSX` and `ScriptKindJSX` import it.
        if !crate::resolve::is_jsx_file_name(module.file_name()) {
            return None;
        }
        let runtime = jsx_runtime_of(self.options, &module.hir, &self.atoms)?;
        self.atoms.lookup(&runtime)
    }

    // ───────────────────────────── merging ─────────────────────────────

    #[inline]
    /// `rank_of_file`, indexed by file.
    pub(crate) fn ranks(&self) -> &'s [u32] {
        self.ranks
    }

    /// `fileIndexMap`: the index of `file` among the files of the program, which `compareNodes` uses.
    pub fn rank_of_file(&self, file: FileId) -> u32 {
        self.ranks[file.idx()]
    }

    /// `getDefaultLibFilePriority`
    fn default_lib_file_priority(&self, file: FileId) -> usize {
        let path = self.modules[file.idx()].file_name();
        let is_in_lib_dir = path
            .strip_prefix(self.options.lib_dir.trim_end_with(|c| c == '/'))
            .is_some_and(|rest| rest.starts_with(b"/"));
        if is_in_lib_dir {
            let basename =
                &path[strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1)..];
            if basename == b"lib.d.ts" || basename == b"lib.es6.d.ts" {
                return 0;
            }
            let name = basename.strip_prefix(b"lib.").unwrap_or(basename);
            let name = name.strip_suffix(b".d.ts").unwrap_or(name);
            if let Some(index) = crate::resolve::LIBS.iter().position(|lib| lib == name) {
                return index + 1;
            }
        }
        crate::resolve::LIBS.len() + 2
    }

    /// `getProcessedFiles`: `collectFiles(rootTasks)` walks depth first from each task and lists a file after
    /// everything it refers to. The files with a `libFile` come first, sorted (`sortLibs`).
    fn declaration_order(&self, starts: &[FileId], summaries: &[ModuleSummary]) -> Vec<FileId> {
        let mut seen = vec![false; self.modules.len()];
        let mut libs = Vec::new();
        let mut others = Vec::new();
        // `rootTasks`: the root files, the libraries, what the automatic type directives resolve to.
        let root_tasks = (starts[self.libs_end..self.roots_end].iter())
            .chain(&starts[..self.libs_end])
            .chain(&starts[self.roots_end..]);
        for &start in root_tasks {
            // (file, how many of its edges have been followed)
            let mut stack: Vec<(FileId, usize)> = Vec::new();
            if !std::mem::replace(&mut seen[start.idx()], true) {
                stack.push((start, 0));
            }
            while let Some(top) = stack.last_mut() {
                let (file, next) = *top;
                match summaries[file.idx()].edges.get(next) {
                    Some(&edge) => {
                        top.1 += 1;
                        if !std::mem::replace(&mut seen[edge.idx()], true) {
                            stack.push((edge, 0));
                        }
                    }
                    None => {
                        if summaries[file.idx()].is_lib {
                            libs.push(file)
                        } else {
                            others.push(file)
                        }
                        stack.pop();
                    }
                }
            }
        }
        libs.shared_sort_by_cached_key(|&file| self.default_lib_file_priority(file));
        libs.extend(others);
        libs
    }

    /// True if `mergeModuleAugmentation` merges `symbol` of `file`.
    pub fn merges_module_augmentation(&self, file: FileId, symbol: SymbolId) -> bool {
        let module = self.module(file);
        let collected = module_augmentations(&module.hir, &self.atoms);
        merges_module_augmentation(&module.bound, &collected, symbol)
    }

    /// `declaring` is `order` minus the modules without a global augmentation, an `export as namespace` or a
    /// `declare module`.
    fn merge(&mut self, host: &dyn Host, declaring: &[FileId]) {
        self.records_module_links = true;
        self.make_global_this_symbol();
        // `initializeChecker`: file by file, the declarations of scripts and the names under which
        // modules are globally visible; then the global augmentations of modules.
        let passes =
            (declaring.iter().map(|&id| (id, false))).chain(declaring.iter().map(|&id| (id, true)));
        for (id, augmentations) in passes {
            let file = id.idx();
            let module = &self.modules[file];
            let mut additions: Vec<(Atom, SymbolId)> = Vec::new();
            if !augmentations && !module.is_module() {
                additions.extend(module.bound.table(module.bound.scopes[0].locals));
            }
            if augmentations && !module.bound.global_augmentations.is_empty() {
                let collected = module_augmentations(&module.hir, &self.atoms);
                for &augmentation in &module.bound.global_augmentations {
                    if !merges_module_augmentation(&module.bound, &collected, augmentation) {
                        continue;
                    }
                    let exports = module.bound.symbol(augmentation).exports;
                    additions.extend(module.bound.table(exports));
                }
            }
            for (name, s) in additions {
                let sym = Sym { file: id, id: s };
                // `mergeGlobalSymbol`
                let merged = match self.globals.get(name).copied() {
                    Some(existing) => self.merge_symbol(existing, sym, false),
                    None => self.get_merged_symbol(sym),
                };
                self.globals.insert(name, merged);
            }
            // The first declaration of a name owns it. What a later file declares under the name of
            // a module is merged into the module.
            if !augmentations {
                for &(name, symbol) in self.modules[file].bound.umd_globals.iter() {
                    if !self.globals.contains_key(name) {
                        self.globals.insert(
                            name,
                            Sym {
                                file: id,
                                id: symbol,
                            },
                        );
                    }
                }
            }
        }
        let mut augmentations: Vec<(FileId, Atom, Sym)> = Vec::new();
        for &id in declaring {
            let file = id.idx();
            // `c.patternAmbientModules`
            for &(name, symbol) in self.modules[file].bound.pattern_ambient_modules.iter() {
                let text = self.atoms.bytes(name);
                if let Some(star) = strings::index_of_char_usize(text, b'*') {
                    let prefix = slice_in(&text[..star], self.arena);
                    let suffix = slice_in(&text[star + 1..], self.arena);
                    let sym = Sym {
                        file: id,
                        id: symbol,
                    };
                    self.ambient_patterns.push((prefix, suffix, sym));
                }
            }
            let mut collected: Option<Vec<ModuleId>> = None;
            for at in 0..self.modules[file].bound.ambient_modules.len() {
                let (name, symbol, is_global) = self.modules[file].bound.ambient_modules[at];
                let sym = Sym {
                    file: id,
                    id: symbol,
                };
                if !is_global {
                    let module = &self.modules[file];
                    let collected = collected
                        .get_or_insert_with(|| module_augmentations(&module.hir, &self.atoms));
                    if merges_module_augmentation(&module.bound, collected, symbol) {
                        augmentations.push((id, name, sym));
                    }
                    continue;
                }
                // `!IsExternalOrCommonJSModule(file)`: it is a local of a CommonJS module.
                if self.modules[file].is_module() {
                    continue;
                }
                let merged = match self.ambient_modules.get(&name).copied() {
                    Some(existing) => self.merge_symbol(existing, sym, false),
                    None => sym,
                };
                self.ambient_modules.insert(name, merged);
            }
        }
        if !self.ambient_patterns.is_empty() {
            let mut by_end: Vec<Vec<u32>> = vec![Vec::new(); 257];
            for (at, pattern) in self.ambient_patterns.iter().enumerate() {
                let end = pattern.1.last().map_or(256, |&end| usize::from(end));
                by_end[end].push(at as u32);
            }
            let arena = self.arena;
            let by_end = by_end.iter().map(|patterns| slice_in(patterns, arena));
            self.ambient_patterns_by_end = arena.alloc_slice_fill_iter(by_end);
        }
        for (file, name, sym) in augmentations {
            match self.module_of_specifier_as(file, name, self.module(file).default_mode) {
                // An augmentation of a module that is `export = ns` is merged into `ns`.
                Some(main_module) => {
                    let main_module = self.external_module_symbol_to_augment(main_module);
                    // `mergeModuleAugmentation`: a module whose `export =` target isn't a
                    // namespace can't be augmented.
                    if !self.flags(main_module).intersects(SymFlags::NAMESPACE) {
                        self.augmentations_of_non_modules.push(sym);
                        continue;
                    }
                    // `mergeModuleAugmentation`: an augmentation of `a.svg`, which only the pattern
                    // `*.svg` declares, isn't merged into the pattern. Instead the contents of the
                    // pattern are merged into the augmentation, which is registered under its own
                    // name. A pattern that several scripts declare isn't the symbol of any of them
                    // (`mainModule == module.Symbol`), and is augmented like any module.
                    if self.ambient_patterns.iter().any(|p| p.2 == main_module) {
                        let merged = self.merge_symbol(sym, main_module, true);
                        self.pattern_augmentations.insert(name, merged);
                        continue;
                    }
                    // An augmentation of a name that the module only re-exports with `export *` is
                    // merged into the symbol at its declaration.
                    // `getResolvedMembersOrExportsOfSymbol` calls `getExportsOfModuleWorker`, and
                    // stores nothing in `moduleSymbolLinks`.
                    let resolved_exports = if self.export_stars_of(main_module).is_empty() {
                        SymbolMap::new_in(self.arena)
                    } else {
                        let links = resolve!(&*self, resolver => resolver.exports_of_module_worker(main_module));
                        links.resolved_exports
                    };
                    for (name, addition) in self.exports_in_table(sym) {
                        if self.export(main_module, name).is_none()
                            && let Some(&found) = resolved_exports.get(name)
                            && let Some(resolved) = self.resolve_alias_if_needed(found)
                        {
                            // `mergeSymbol`: symbols that can't merge stay separate, and the
                            // module has the augmentation's symbol under the name.
                            if self
                                .flags(resolved)
                                .intersects(get_excluded_symbol_flags(self.flags(addition)))
                            {
                                // `reportMergeSymbolError(target, source)`, where `target` is the
                                // entry: an alias isn't resolved.
                                let rejected_target = match self.is_non_local_alias(found) {
                                    true => found,
                                    false => self.canonical(resolved),
                                };
                                self.reject_merge(rejected_target, addition);
                                continue;
                            }
                            self.merge_symbol(found, addition, false);
                        }
                    }
                    self.merge_symbol(main_module, sym, false);
                }
                // `mergeModuleAugmentation`: an augmentation of a module that doesn't exist is
                // ignored.
                None => {}
            }
        }
        self.records_module_links = false;
        let at_merge = self.module_links_at_merge.get_mut().iter();
        if at_merge.len() != 0 {
            self.modules_resolved_at_merge = self
                .arena
                .alloc_slice_fill_iter(at_merge.map(|links| links.0));
        }
        // Each file is visited once, however many of its names are redirected.
        let mut placeholders =
            std::mem::replace(&mut self.placeholders, ArenaVec::new_in(self.arena));
        placeholders.shared_sort_unstable();
        for file_placeholders in placeholders.chunk_by(|a, b| a.0.file == b.0.file) {
            let is_placeholder = |symbol: &mut SymbolId| {
                if let Ok(i) = file_placeholders.binary_search_by_key(symbol, |s| s.0.id) {
                    *symbol = file_placeholders[i].1;
                }
            };
            let bound = &mut self.modules[file_placeholders[0].0.file.idx()].bound;
            bound.entries.make_owned_in(self.arena);
            (bound.expr_symbol).change_each_in(self.arena, is_placeholder);
            bound
                .entries
                .iter_mut()
                .map(|e| &mut e.1)
                .for_each(is_placeholder);
        }
        // `addUndefinedToGlobalsOrErrorOnRedeclaration`
        if !self.modules.is_empty() && !self.globals.contains_key(known::undefined) {
            self.globals.insert(known::undefined, self.undefined_symbol);
        }
        let counts = self.make_transient_symbols(host);
        // The target an alias resolved to during the symbol merge may since have become part of a merged symbol.
        let session = self.session;
        let symbols = Bases::new_in(counts.into_iter(), &session);
        self.alias_symbol_links = ByNodeIndirect::new_in(&symbols, session);
        // Their `aliasTarget` stays `unknownSymbol`, even if the merge broke the cycle.
        for &alias in &self.circular_at_merge {
            let links = AliasSymbolLinks {
                is_circular: true,
                ..AliasSymbolLinks::default()
            };
            self.alias_symbol_links.insert_ref(alias, links);
        }
        for &(alias, links) in &self.resolved_at_merge {
            self.alias_symbol_links.insert_ref(alias, links);
        }
        self.memo = Memo::new_in(&symbols, session);
        for &part in self.merged_symbols.keys() {
            self.memo.whole.insert(part, Some(self.canonical(part)));
        }
        for &whole in self.merged_parts.keys() {
            self.memo.whole.insert(whole, Some(whole));
        }
        let at_merge = ArenaVec::new_in(self.arena);
        for (module, links) in std::mem::replace(self.module_links_at_merge.get_mut(), at_merge) {
            let links = self.with_merged_exports(links);
            self.memo.module_links.insert_ref(module, links);
        }
        self.is_merged = true;
    }

    /// Converts `links`, whose `resolved_exports` are the tables' entries, to the form that's
    /// stored once symbols are merged.
    fn with_merged_exports(&self, mut links: ModuleSymbolLinks<'s>) -> ModuleSymbolLinks<'s> {
        let mut unmerged = Vec::new();
        for at in 0..links.resolved_exports.len() {
            let (name, symbol) = links.resolved_exports[at];
            let merged = self.canonical(symbol);
            if merged != symbol {
                unmerged.push((name, symbol));
                links.resolved_exports.insert(name, merged);
            }
        }
        if !unmerged.is_empty() {
            links.unmerged_exports = slice_in(&unmerged, self.thread_arena());
        }
        links
    }

    fn symbols_mut(&mut self, file: FileId) -> &mut bind::Symbols<'s> {
        &mut self.modules[file.idx()].bound.symbols
    }

    /// `newSymbol`: a symbol of the first file.
    fn new_symbol(&mut self, flags: SymFlags, name: Atom) -> Sym {
        let arena = self.arena;
        let symbols = &mut self.modules[0].bound.symbols;
        let symbol = Symbol {
            name,
            flags: flags | SymFlags::TRANSIENT,
            decls: &[],
            value_declaration: u32::MAX,
            parent: SymbolId::NONE,
            exports: bind::TableId::NONE,
            members: bind::TableId::NONE,
            export_symbol: SymbolId::NONE,
        };
        symbols.push(symbol, arena);
        Sym {
            file: FileId(0),
            id: SymbolId(symbols.len() as u32 - 1),
        }
    }

    /// `NewChecker`: `c.unknownSymbol = c.newSymbol(ast.SymbolFlagsProperty, "unknown")`,
    /// `c.undefinedSymbol = c.newSymbol(ast.SymbolFlagsProperty, "undefined")`,
    /// `c.globalThisSymbol = c.newSymbolEx(ast.SymbolFlagsModule, "globalThis", ..)`, `c.globalThisSymbol.Exports = c.globals`
    fn make_global_this_symbol(&mut self) {
        if self.modules.is_empty() {
            return;
        }
        self.unknown_symbol = self.new_symbol(SymFlags::PROPERTY, known::unknown);
        self.prototype_symbol = self.new_symbol(SymFlags::PROPERTY, known::prototype);
        self.undefined_symbol = self.new_symbol(SymFlags::PROPERTY, known::undefined);
        self.global_this_symbol =
            self.new_symbol(SymFlags::MODULE | SymFlags::MERGED, known::globalThis);
        self.globals
            .insert(known::globalThis, self.global_this_symbol);
    }

    /// `symbol.Exports` of a transient symbol. `c.globalThisSymbol.Exports = c.globals`: they're
    /// the same table, even while the symbol merge fills it.
    fn merged_exports_of(&self, symbol: Sym) -> Option<&SymbolMap<'s>> {
        if symbol == self.global_this_symbol {
            Some(&self.globals)
        } else {
            self.merged_exports.get(&symbol)
        }
    }

    /// `target.Exports` of a transient symbol, during the symbol merge.
    fn exports_of_transient_symbol(&mut self, target: Sym) -> &mut SymbolMap<'s> {
        if target == self.global_this_symbol {
            &mut self.globals
        } else {
            let arena = self.arena;
            let exports = self.merged_exports.entry(target);
            exports.or_insert_with(|| SymbolMap::new_in(arena))
        }
    }

    /// `getMergedSymbol`
    fn get_merged_symbol(&self, sym: Sym) -> Sym {
        self.merged_symbols.get(&sym).copied().unwrap_or(sym)
    }

    /// `recordMergedSymbol`
    fn record_merged_symbol(&mut self, target: Sym, source: Sym) {
        *self.symbols_mut(source.file).flags_mut(source.id) |= SymFlags::MERGED;
        self.merged_symbols.insert(source, target);
    }

    /// `newSymbol(target.Flags, target.Name)`, for `alias`. Its other contents are read from
    /// `target` as long as nothing is merged into it: see `parts` and `holder_of_exports`.
    fn transient_symbol_for(
        &self,
        alias: SymbolId,
        target: Sym,
        is_combined: bool,
    ) -> (TransientSymbol, Symbol<'s>) {
        let links = TransientSymbol {
            alias,
            symbol: SymbolId::NONE,
            target,
            is_combined,
        };
        let mut flags = self.flags(target) | SymFlags::MERGED | SymFlags::TRANSIENT;
        if is_combined {
            flags |= SymFlags::PROPERTY;
        }
        let symbol = Symbol {
            name: self.symbol(target).name,
            flags,
            decls: &[],
            value_declaration: self.symbol(target).value_declaration,
            parent: SymbolId::NONE,
            exports: bind::TableId::NONE,
            members: bind::TableId::NONE,
            export_symbol: SymbolId::NONE,
        };
        (links, symbol)
    }

    /// The symbol that `cloneTypeAsModuleType` creates from `symbol` for `originating_import`
    /// during the symbol merge, as a merge target: it gets a copy of the current contents of
    /// `symbol`. Unlike `clone_symbol` it leaves `symbol` unchanged, and no merge is recorded.
    fn clone_type_as_module_type(&mut self, symbol: Sym, originating_import: Sym) -> Sym {
        let created = vec![self.transient_symbol_for(originating_import.id, symbol, false)];
        let module = &mut self.modules[originating_import.file.idx()];
        add_transient_symbols(module, created, self.arena);
        let clone = Sym {
            file: originating_import.file,
            id: SymbolId(module.bound.symbols.len() as u32 - 1),
        };
        let parts = vec_from_iter_in(self.parts(symbol).iter().copied(), self.arena);
        self.merged_parts.insert(clone, parts);
        let exports = SymbolMap::from_iter_in(self.exports_in_table(symbol), self.arena);
        self.merged_exports.insert(clone, exports);
        clone
    }

    /// `resolveExternalModuleSymbol(mainModule)` of `mergeModuleAugmentation`. If the `export =` of `module` resolves
    /// through an `import * as ns`, `resolveESModuleSymbol` creates the clone now, from the current contents. Whether
    /// it does is decided from the symbol tables, because there are no types yet.
    fn external_module_symbol_to_augment(&mut self, module: Sym) -> Sym {
        let value = self.module_value(module);
        let Some(mut at) = self.export(module, known::export_equals) else {
            return value;
        };
        for _ in 0..32 {
            if !self.is_non_local_alias(at) {
                return value;
            }
            let import = self.declaration_of_alias_symbol(at);
            if let Some((file, Decl::ImportNamespace(import))) = import {
                let import = &self.hir(file)[import];
                let mode = self.mode_of_import(file, import.mode);
                let imported = self.module_of_specifier_as(file, import.spec, mode);
                // `hasSignatures(typ) || getPropertyOfType(typ, "default") != nil || isEsmCjsRef`
                if !self
                    .flags(value)
                    .intersects(SymFlags::FUNCTION | SymFlags::CLASS)
                    && self.export(value, known::default).is_none()
                    && !imported.is_some_and(|imported| self.is_commonjs_to_node(file, imported))
                {
                    return value;
                }
                let originating_import = self.canonical(at);
                return match self.module_clone(originating_import) {
                    Some(clone) => clone,
                    None => self.clone_type_as_module_type(value, originating_import),
                };
            }
            match self.alias_target(at) {
                Some(next) if next != at => at = next,
                _ => return value,
            }
        }
        value
    }

    /// `symbolFromModule` of `getExternalModuleMember` for `alias`, in the case where
    /// `combineValueAndTypeSymbols` creates a symbol from it if `symbolFromVariable` is a property.
    /// That's the case when it isn't a value.
    fn type_symbol_to_combine(&self, alias: Sym) -> Option<Sym> {
        if !self.is_named_import_from_export_equals(alias) {
            return None;
        }
        let (file, decl) = self.declaration_of_alias_symbol(alias)?;
        let (spec, mode, name) = self.external_module_member_of(file, decl)?;
        // `{ default as d }` is another syntax for the default import, but not in a binding
        // pattern.
        if name == known::default && !matches!(decl, Decl::Require(_)) {
            return None;
        }
        let module = self.module_of_specifier_as(file, spec, mode)?;
        // `getExportOfModule` ends in `resolveSymbol`: `namespace N { export { I as name } }`.
        let type_symbol = self.resolve_symbol(self.module_export(module, name)?)?;
        let type_symbol = self.canonical(type_symbol);
        let is_type = !self.flags(type_symbol).intersects(SymFlags::VALUE);
        is_type.then_some(type_symbol)
    }

    /// Returns the module that `getExternalModuleMember` reads `sym`'s name from, if that module has `export =`.
    /// Doesn't resolve any alias.
    fn export_equals_module_of_named_import(&self, sym: Sym) -> Option<Sym> {
        let (file, decl) = self.declaration_of_alias_symbol(sym)?;
        let (spec, mode, _) = self.external_module_member_of(file, decl)?;
        let module = self.module_of_specifier_as(file, spec, mode)?;
        self.export(module, known::export_equals).map(|_| module)
    }

    /// Returns the `import * as ns` that declares `alias`, if there is one.
    fn namespace_import_of(&self, alias: Sym) -> Option<&Import> {
        let hir = self.hir(alias.file);
        let mut decls = self.symbol(alias).decls.iter();
        decls.find_map(|&decl| match decl {
            Decl::ImportNamespace(import) => Some(&hir[import]),
            _ => None,
        })
    }

    /// Returns the aliases of `file` that may get a transient symbol, in symbol order: every `import * as ns`, and
    /// every name imported from a module with `export =`.
    ///
    /// Doesn't resolve aliases, and doesn't read anything that `make_transient_symbols` changes when it adds symbols
    /// and resolves aliases. So the result doesn't depend on which files were processed earlier, or on which thread.
    fn transient_candidates_of(&self, file: FileId) -> Vec<TransientCandidate<'s>> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut found = Vec::new();
        let has_export_equals = |specifier: Atom, mode: ResolutionMode| {
            self.module_of_specifier_as(file, specifier, mode)
                .is_some_and(|m| self.export(m, known::export_equals).is_some())
        };
        // Most files don't have a candidate, so skip the scan of their symbols. `hir.imports` and `hir.exports` have
        // the declarations that make an alias a candidate, anywhere in the file. `bound.specifiers` doesn't: it omits
        // an import in the body of an ambient module. `require` only declares an alias in JavaScript.
        let mode_of = |specified_mode: ResolutionMode| self.mode_of_import(file, specified_mode);
        let may_have_one = hir.is_js
            || (hir.imports.iter())
                .any(|it| it.namespace.is_some() || has_export_equals(it.spec, mode_of(it.mode)))
            || (hir.exports.iter())
                .any(|it| it.has_module_specifier && has_export_equals(it.spec, mode_of(it.mode)));
        if !may_have_one {
            return found;
        }
        for (id, symbol) in bound.symbols.iter().enumerate() {
            let id = SymbolId(id as u32);
            let alias = Sym { file, id };
            // One already exists if it was merged into during the symbol merge.
            if !symbol.flags.contains(SymFlags::ALIAS)
                || self.canonical(alias) != alias
                || (self.module(file).transient_symbols.iter()).any(|created| created.alias == id)
            {
                continue;
            }
            let Some(import) = self.namespace_import_of(alias) else {
                if self.export_equals_module_of_named_import(alias).is_some() {
                    found.push(TransientCandidate::Unresolved(id));
                }
                continue;
            };
            let mode = self.mode_of_import(file, import.mode);
            let Some(module) = self.module_of_specifier_as(file, import.spec, mode) else {
                continue;
            };
            if self.export(module, known::export_equals).is_some() {
                found.push(TransientCandidate::Unresolved(id));
                continue;
            }
            // Same as `module_value`, for a module without `export =`.
            let target = self.canonical(module);
            if !self.is_non_local_alias(target) {
                let (links, symbol) = self.transient_symbol_for(id, target, false);
                found.push(TransientCandidate::Known(links, symbol));
            }
        }
        found
    }

    /// Returns the transient symbol to create for alias `id` of `file`, which is a `TransientCandidate::Unresolved`. An
    /// `import * as ns` gets one, and so does a name for which `type_symbol_to_combine` returns a symbol.
    fn transient_symbol_of(
        &self,
        file: FileId,
        id: SymbolId,
    ) -> Option<(TransientSymbol, Symbol<'s>)> {
        let alias = Sym { file, id };
        let import = self.namespace_import_of(alias);
        let target = match import {
            Some(import) => {
                let mode = self.mode_of_import(file, import.mode);
                let module = self.module_of_specifier_as(file, import.spec, mode);
                module.map(|module| self.module_value(module))
            }
            None => self.type_symbol_to_combine(alias),
        };
        let target = target.filter(|&target| !self.is_non_local_alias(target))?;
        Some(self.transient_symbol_for(id, target, import.is_none()))
    }

    /// Returns the transient symbols to create for `file`, given its candidates in `found`.
    fn transient_symbols_of(
        &self,
        file: FileId,
        found: Vec<TransientCandidate<'s>>,
    ) -> Vec<(TransientSymbol, Symbol<'s>)> {
        let mut created = Vec::with_capacity(found.len());
        for candidate in found {
            match candidate {
                TransientCandidate::Known(links, symbol) => created.push((links, symbol)),
                TransientCandidate::Unresolved(alias) => {
                    created.extend(self.transient_symbol_of(file, alias));
                }
            }
        }
        created
    }

    /// Creates the transient symbols now, because nothing can be added to the shared state once the merge has ended.
    ///
    /// An alias's target can depend on which aliases were resolved and which symbols were added before it, so that part
    /// runs file by file, in order. Few aliases need it.
    ///
    /// Returns the final symbol count of each file, indexed by `FileId`.
    fn make_transient_symbols(&mut self, host: &dyn Host) -> Vec<usize> {
        const NOT_COUNTED: usize = usize::MAX;
        let order = self.order;
        let found: Vec<Guarded<Vec<TransientCandidate<'s>>>> =
            order.iter().map(|_| Guarded::new(Vec::new())).collect();
        let counts: Vec<AtomicUsize> = (0..self.modules.len())
            .map(|_| AtomicUsize::new(NOT_COUNTED))
            .collect();
        let files = &*self;
        host.parallel(order.len(), &|at| {
            let file = order[at];
            *found[at].lock() = files.transient_candidates_of(file);
            let count = files.modules[file.idx()].bound.symbols.len();
            counts[file.idx()].store(count, Ordering::Relaxed);
        });
        let mut counts: Vec<usize> = counts.into_iter().map(AtomicUsize::into_inner).collect();
        for (&file, mut found) in order.iter().zip(found) {
            let created = self.transient_symbols_of(file, std::mem::take(found.get_mut()));
            if created.is_empty() {
                continue;
            }
            self.has_symbols_to_combine |= created.iter().any(|it| it.0.is_combined);
            counts[file.idx()] = counts[file.idx()].saturating_add(created.len());
            add_transient_symbols(&mut self.modules[file.idx()], created, self.arena);
        }
        for (count, module) in counts.iter_mut().zip(self.modules.iter()) {
            if *count == NOT_COUNTED {
                *count = module.bound.symbols.len();
            }
        }
        counts
    }

    /// `cloneSymbol`. The clone is a symbol of the same file as `symbol`, so `decls`, `parent` and
    /// `exports` have the same meaning as for `symbol`. It takes over the table entries of
    /// `symbol`: from now on `canonical` redirects past `symbol`.
    fn clone_symbol(&mut self, symbol: Sym) -> Sym {
        let parts = self.merged_parts.remove(&symbol);
        let exports = self.merged_exports.remove(&symbol);
        let members = self.merged_members.remove(&symbol);
        let arena = self.arena;
        let cloned = self.symbol(symbol);
        let clone = Symbol {
            flags: cloned.flags | SymFlags::MERGED | SymFlags::TRANSIENT,
            decls: slice_in(cloned.decls, arena),
            ..cloned
        };
        let symbols = self.symbols_mut(symbol.file);
        let result = Sym {
            file: symbol.file,
            id: SymbolId(symbols.len() as u32),
        };
        symbols.push(clone, arena);
        let parts = parts.unwrap_or_else(|| vec_from_iter_in([symbol], arena));
        self.merged_parts.insert(result, parts);
        if let Some(exports) = exports {
            self.merged_exports.insert(result, exports);
        }
        if let Some(members) = members {
            self.merged_members.insert(result, members);
        }
        if let Some(&parent) = self.parents_in_other_files.get(&symbol) {
            self.parents_in_other_files.insert(result, parent);
        }
        self.record_merged_symbol(result, symbol);
        result
    }

    /// `merged.Parent = mergedParent` of `mergeSymbolTable`.
    fn set_parent(&mut self, merged: Sym, parent: Sym) {
        if merged.file == parent.file {
            self.parents_in_other_files.remove(&merged);
            self.symbols_mut(merged.file)
                .set_parent(merged.id, parent.id);
        } else {
            self.parents_in_other_files.insert(merged, parent);
        }
    }

    /// `symbol.Members`
    pub fn members_in_table(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        match self.merged_members.get(&sym) {
            Some(table) => table.to_vec(),
            None => {
                let (file, bound) = (sym.file, self.bound(sym.file));
                bound
                    .table(bound.symbol(sym.id).members)
                    .iter()
                    .map(|&(n, id)| (n, Sym { file, id }))
                    .collect()
            }
        }
    }

    /// `symbol.Members[name]`
    pub fn member(&self, sym: Sym, name: Atom) -> Option<Sym> {
        match self.merged_members.get(&sym) {
            Some(table) => table.get(name).map(|&member| self.canonical(member)),
            None => {
                let bound = self.bound(sym.file);
                let member = bound.lookup(bound.symbol(sym.id).members, name)?;
                Some(self.sym(sym.file, member))
            }
        }
    }

    /// `symbol.Members != nil`. `mergeSymbol` creates the table of the target for a source that
    /// has one.
    pub fn has_members_table(&self, sym: Sym) -> bool {
        let parts = self.parts(self.canonical(sym));
        parts.iter().any(|&it| self.symbol(it).members.is_some())
    }

    /// The two branches of `mergeSymbol` that report.
    fn reject_merge(&mut self, target: Sym, source: Sym) {
        let rejected_merge = RejectedMerge {
            target,
            source,
            target_flags: self.flags(target),
            source_flags: self.flags(source),
            target_parts: slice_in(&self.parts(target), self.arena),
            source_parts: slice_in(&self.parts(source), self.arena),
        };
        self.rejected_merges.push(rejected_merge);
    }

    /// True if `file` declares one of `rejected_merges`. There may be thousands of those, and every file queries this.
    pub fn has_rejected_merges(&self, file: FileId) -> bool {
        self.files_with_rejected_merges.contains(&file)
    }

    /// `symbol.Exports`
    fn exports_in_table(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        self.each_export_in_table(sym).collect()
    }

    /// `mergeSymbol`. Returns the symbol that the table containing `target` holds from then on.
    fn merge_symbol(&mut self, mut target: Sym, source: Sym, unidirectional: bool) -> Sym {
        // `mergeModuleAugmentation`: the one symbol of several augmentations in a file is merged once.
        if source == target || self.get_merged_symbol(source) == target {
            return target;
        }
        let (target_flags, source_flags) = (self.flags(target), self.flags(source));
        let is_alias = self.is_non_local_alias(target);
        // "Assignment declarations are allowed to merge with variables, no matter what other flags they have."
        let is_excluded = |flags: SymFlags| {
            flags.intersects(get_excluded_symbol_flags(source_flags))
                && !(source_flags | flags).contains(SymFlags::ASSIGNMENT)
        };
        // `reportMergeSymbolError`
        if is_excluded(target_flags) {
            self.reject_merge(target, source);
            // A symbol that can't merge with the existing symbol of the name contributes nothing
            // to it: two classes, a class and a variable. It remains the symbol of its own
            // declarations, and the name continues to resolve to the first symbol wherever it is
            // used. Two aliases never merge, and nothing refers to a member by its name alone.
            if !is_alias && !unidirectional && !source_flags.intersects(SymFlags::CLASS_MEMBER) {
                for part in self.parts(source).into_vec() {
                    // `declareModuleMember`: the `locals` of the declaring block hold an `ExportValue` symbol whose
                    // `exportSymbol` is `part`, so there the name still resolves to `part` as a value.
                    match self.symbol(part).parent.is_some() {
                        true => _ = self.rejected_exports.insert(part),
                        false => self.redirect_name_to(part, target),
                    }
                }
            }
            return target;
        }
        if !target_flags.contains(SymFlags::TRANSIENT) {
            // `resolveSymbol`: a symbol merged into an alias is merged into the target of the
            // alias.
            let mut resolved = target;
            if is_alias {
                match self.resolve_alias(target) {
                    Some(found) if found == source => return source,
                    // If the two can't merge, the added symbol takes the name.
                    Some(found) if is_excluded(self.flags(found)) => {
                        self.reject_merge(target, source);
                        return source;
                    }
                    Some(found) => {
                        self.resolved_at_merge
                            .push((target, self.alias_links(target)));
                        resolved = found;
                    }
                    // It may be a property of a module's `export =` value, which only the type of
                    // that value determines. The alias continues to refer to it.
                    None if self.may_be_property_of_export_equals(target) => {}
                    // If the alias can't be resolved (`unknownSymbol`), the added symbol takes the
                    // name as well.
                    None => {
                        self.record_circular_aliases(target);
                        return source;
                    }
                }
            }
            target = self.clone_symbol(resolved);
        }
        // The name resolver hides an export only if `moduleExport.Flags == SymbolFlagsAlias`, and
        // `target` has `SymbolFlagsTransient`.
        let flags = self.symbols_mut(target.file).flags_mut(target.id);
        *flags = (*flags | source_flags).difference(SymFlags::EXPORT_ONLY);
        // `SetValueDeclaration(target, source.ValueDeclaration)`
        let own = self.value_declaration(target).map(|it| it.1);
        if let Some((_, declaration)) = self.value_declaration(source)
            && bind::replaces_value_declaration(own, declaration)
        {
            let parts = self.parts(target);
            let before: usize = parts.iter().map(|&it| self.symbol(it).decls.len()).sum();
            let index = before as u32 + self.symbol(source).value_declaration;
            (self.symbols_mut(target.file)).set_value_declaration(target.id, index);
        }
        let parts = self.parts(source).into_vec();
        let arena = self.arena;
        let merged_parts = self.merged_parts.entry(target);
        merged_parts
            .or_insert_with(|| ArenaVec::new_in(arena))
            .extend(parts);
        // `mergeSymbolTable(GetMembers(target), source.Members, ..)`
        let source_members = self.members_in_table(source);
        if !source_members.is_empty() && !self.merged_members.contains_key(&target) {
            let table = SymbolMap::from_iter_in(self.members_in_table(target), arena);
            self.merged_members.insert(target, table);
        }
        for (name, source_symbol) in source_members {
            let merged = match self.merged_members[&target].get(name).copied() {
                Some(existing) => self.merge_symbol(existing, source_symbol, unidirectional),
                None => self.get_merged_symbol(source_symbol),
            };
            let members = self.merged_members.entry(target);
            members
                .or_insert_with(|| SymbolMap::new_in(arena))
                .insert(name, merged);
        }
        let source_exports = self.exports_in_table(source);
        if !source_exports.is_empty() || self.symbol(target).exports.is_some() {
            if target != self.global_this_symbol && !self.merged_exports.contains_key(&target) {
                let table = SymbolMap::from_iter_in(self.exports_in_table(target), arena);
                self.merged_exports.insert(target, table);
            }
            // `mergeSymbolTable`
            for (name, source_symbol) in source_exports {
                let existing = self.exports_of_transient_symbol(target).get(name).copied();
                let merged = match existing {
                    Some(existing) => self.merge_symbol(existing, source_symbol, unidirectional),
                    None => self.get_merged_symbol(source_symbol),
                };
                // "If a merge was performed on the target symbol, set its parent to the merged
                // parent that initiated the merge of its exports."
                if existing.is_some()
                    && target != self.global_this_symbol
                    && self.flags(merged).contains(SymFlags::TRANSIENT)
                {
                    self.set_parent(merged, target);
                }
                self.exports_of_transient_symbol(target)
                    .insert(name, merged);
            }
        }
        if !unidirectional {
            self.record_merged_symbol(target, source);
        }
        target
    }

    /// Names are looked up in the table the two symbols were meant to share, which holds `target`.
    /// The binder resolved the names in the file of `rejected_symbol` to `rejected_symbol`. Those names get a
    /// placeholder symbol for `target` there, and the declarations of `rejected_symbol` keep their symbol.
    fn redirect_name_to(&mut self, rejected_symbol: Sym, target: Sym) {
        let arena = self.arena;
        let bound = &mut self.modules[rejected_symbol.file.idx()].bound;
        let placeholder = SymbolId(bound.symbols.len() as u32);
        let (name, parent) = {
            let symbol = bound.symbol(rejected_symbol.id);
            (symbol.name, symbol.parent)
        };
        let symbol = Symbol {
            name,
            flags: SymFlags::MERGED,
            decls: &[],
            value_declaration: u32::MAX,
            parent,
            exports: bind::TableId::NONE,
            members: bind::TableId::NONE,
            export_symbol: SymbolId::NONE,
        };
        bound.symbols.push(symbol, arena);
        self.placeholders.push((rejected_symbol, placeholder));
        self.merged_symbols.insert(
            Sym {
                file: rejected_symbol.file,
                id: placeholder,
            },
            target,
        );
    }

    /// Records the aliases that `resolveAlias(start)` found to be circular, a result that must
    /// persist after the merge.
    fn record_circular_aliases(&mut self, start: Sym) {
        let mut alias = start;
        while self.is_non_local_alias(alias) {
            let links = self.alias_links(alias);
            if links.is_circular {
                if self.circular_at_merge.contains(&alias) {
                    return;
                }
                self.circular_at_merge.push(alias);
            }
            match links.immediate_target {
                Some(next) if links.is_circular || next != alias => alias = next,
                _ => return,
            }
        }
    }

    // ───────────────────────────── symbols ─────────────────────────────

    /// The calling thread's arena, for what a `&self` method stores. Finding it takes a lookup, so
    /// a caller that allocates more than once should keep the result.
    fn thread_arena(&self) -> &'s Arena {
        self.session.arena()
    }

    #[inline]
    pub fn module(&self, file: FileId) -> &Module<'s> {
        &self.modules[file.idx()]
    }

    /// `GetSourceFileFromReference` for a `/// <reference path>` in `origin`.
    pub fn source_file_from_reference(
        &self,
        origin: FileId,
        reference_text: &[u8],
    ) -> Option<FileId> {
        let name = referenced_path(reference_text, self.module(origin).file_name());
        if has_extension(&name) {
            let is_case_sensitive = self.is_case_sensitive;
            if unsupported_extension_error(self.options, &name, is_case_sensitive).is_some() {
                return None;
            }
            return self.by_path.get(&name);
        }
        let mut extensions = supported_extensions(self.options)[0].iter();
        extensions.find_map(|it| self.by_path.get(&[&name[..], &it[..]].concat()))
    }

    /// `GetSourceOfProjectReferenceIfOutputIncluded`
    pub fn source_of_project_reference_if_output_included(&self, file: FileId) -> &[u8] {
        let module = self.module(file);
        match module.project_reference_source.is_some() {
            true => self.atoms.bytes(module.project_reference_source),
            false => module.file_name(),
        }
    }

    /// `GetOutputPathsFor(file).DeclarationFilePath()`
    pub fn declaration_file_path(&self, file: FileId) -> Vec<u8> {
        declaration_emit_output_file_path(
            self.options,
            self.module(file).file_name(),
            self.common_source_directory,
            self.is_case_sensitive,
        )
    }

    #[inline]
    pub fn hir(&self, file: FileId) -> &hir::File<'s> {
        &self.modules[file.idx()].hir
    }

    #[inline]
    pub fn bound(&self, file: FileId) -> &Bound<'s> {
        &self.modules[file.idx()].bound
    }

    #[inline(always)]
    pub fn symbol(&self, sym: Sym) -> Symbol<'_> {
        self.modules[sym.file.idx()].bound.symbol(sym.id)
    }

    #[inline]
    pub fn sym(&self, file: FileId, id: SymbolId) -> Sym {
        self.canonical(Sym { file, id })
    }

    /// `getMergedSymbol`, applied repeatedly until it reaches a fixed point. A clone can be cloned
    /// again, and tsgo reaches the last one by calling it at each layer (`resolveEntityName`,
    /// `getSymbolOfDeclaration`, `getTypeFromClassOrInterfaceReference`).
    #[inline]
    pub fn canonical(&self, sym: Sym) -> Sym {
        if self.symbol(sym).flags.contains(SymFlags::MERGED) {
            cold_path();
            return self.whole_of(sym);
        }
        sym
    }

    /// `canonical` of a symbol that is `MERGED`.
    fn whole_of(&self, sym: Sym) -> Sym {
        match self.memo.whole.get(&sym) {
            Some(Some(whole)) => whole,
            _ => {
                let mut whole = sym;
                for _ in 0..32 {
                    match self.merged_symbols.get(&whole) {
                        Some(&next) => whole = next,
                        None => break,
                    }
                }
                whole
            }
        }
    }

    #[inline(always)]
    pub fn flags(&self, sym: Sym) -> SymFlags {
        self.symbol(sym).flags
    }

    /// Returns every declaration of `sym`, which is canonical. The list is cached permanently if there are several.
    #[inline(always)]
    pub fn decls_of(&self, sym: Sym) -> List<'_, (FileId, Decl)> {
        let symbol = self.symbol(sym);
        if !symbol.flags.contains(SymFlags::MERGED) {
            match symbol.decls {
                [] => return List::Permanent(&[]),
                [decl] => return List::One((sym.file, *decl)),
                _ => {}
            }
        }
        self.several_decls_of(sym)
    }

    #[inline(never)]
    fn several_decls_of(&self, sym: Sym) -> List<'_, (FileId, Decl)> {
        match self.memo.decls.get_ref(&sym) {
            Some(&cached_decls) => List::Permanent(cached_decls),
            // `link` hasn't reached it yet.
            None => {
                let mut decls = Vec::new();
                self.collect_decls(sym, &mut decls);
                List::Own(decls)
            }
        }
    }

    /// Adds every declaration of `sym` to `decls`.
    fn collect_decls(&self, sym: Sym, decls: &mut Vec<(FileId, Decl)>) {
        for &part in self.parts(sym).iter() {
            decls.extend(
                self.symbol(part)
                    .decls
                    .iter()
                    .map(|&decl| (part.file, decl)),
            );
        }
    }

    /// `symbol.Exports[name]`, as stored in the table.
    pub fn export_in_table(&self, sym: Sym, name: Atom) -> Option<Sym> {
        let symbol = self.symbol(sym);
        if symbol.flags.contains(SymFlags::MERGED) {
            cold_path();
            if let Some(table) = self.merged_exports_of(sym) {
                return table.get(name).copied();
            }
            if let Some(target) = self.target_of_module_clone(sym) {
                return self.export_in_table(target, name);
            }
        }
        Some(Sym {
            file: sym.file,
            id: self.bound(sym.file).lookup(symbol.exports, name)?,
        })
    }

    pub fn export(&self, sym: Sym, name: Atom) -> Option<Sym> {
        let found = self.export_in_table(sym, name)?;
        // `getExportsOfModule` returns the symbols as stored in the table, and `mergeSymbol` clones
        // one that isn't transient.
        Some(if self.is_merged {
            self.canonical(found)
        } else {
            found
        })
    }

    /// The names that `sym` exports directly.
    pub fn exports(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        self.each_export(sym).collect()
    }

    /// `exports`, as an iterator.
    pub fn each_export(&self, sym: Sym) -> impl ExactSizeIterator<Item = (Atom, Sym)> + '_ {
        // Like `export`: during the symbol merge, as stored in the table.
        self.each_export_as(sym, !self.is_merged)
    }

    /// `symbol.Exports`
    fn each_export_in_table(&self, sym: Sym) -> impl ExactSizeIterator<Item = (Atom, Sym)> + '_ {
        self.each_export_as(sym, true)
    }

    fn each_export_as(&self, sym: Sym, is_as_in_table: bool) -> Exports<'_, 's> {
        let sym = self.holder_of_exports(sym);
        let symbol = self.symbol(sym);
        // `None`: the exports recorded by the binder.
        let merged = if symbol.flags.contains(SymFlags::MERGED) {
            self.merged_exports_of(sym)
        } else {
            None
        };
        let own: &[(Atom, SymbolId)] = match merged {
            Some(_) => &[],
            None => self.bound(sym.file).table(symbol.exports),
        };
        Exports {
            files: self,
            file: sym.file,
            own: own.iter(),
            merged: merged.map_or(&[][..], |table| &table[..]).iter(),
            is_as_in_table,
        }
    }

    /// `moduleSymbol.ValueDeclaration.Locals()[name]`: a local declaration of the file, or of the
    /// first `declare module "m"`.
    pub fn local_of_module(&self, module: Sym, name: Atom) -> Option<Sym> {
        let &(of, decl) = self.decls_of(module).first()?;
        let bound = self.bound(of);
        let scope = match decl {
            Decl::File => 0,
            Decl::Module(m) => bound.module_scope[m.idx()].idx(),
            _ => return None,
        };
        let local = bound.lookup(bound.scopes.get(scope)?.locals, name)?;
        Some(self.sym(of, local))
    }

    /// `symbol.ValueDeclaration`
    #[inline(always)]
    pub fn value_declaration(&self, sym: Sym) -> Option<(FileId, Decl)> {
        let symbol = self.symbol(sym);
        let index = symbol.value_declaration as usize;
        if symbol.flags.contains(SymFlags::MERGED) {
            cold_path();
            return self.value_declaration_of_merged(sym, index);
        }
        symbol.decls.get(index).map(|&decl| (sym.file, decl))
    }

    #[inline(never)]
    fn value_declaration_of_merged(&self, sym: Sym, mut index: usize) -> Option<(FileId, Decl)> {
        // The symbol has no value declaration. An interface can have thousands of parts.
        if index == u32::MAX as usize {
            return None;
        }
        for &part in self.parts(sym).iter() {
            let decls = self.symbol(part).decls;
            match decls.get(index) {
                Some(&decl) => return Some((part.file, decl)),
                None => index -= decls.len(),
            }
        }
        None
    }

    pub fn parts(&self, sym: Sym) -> List<'_, Sym> {
        if self.symbol(sym).flags.contains(SymFlags::MERGED) {
            if let Some(parts) = self.merged_parts.get(&sym) {
                return List::Permanent(parts);
            }
            // `slices.Clone(symbol.Declarations)`
            if let Some(created) = self.transient_symbol(sym) {
                return self.parts(created.target);
            }
        }
        List::One(sym)
    }

    /// The global names: what a name can resolve to if no scope of its file declares it. Sorted by name. Returns `None`
    /// if an entry of `types` isn't installed, since what it declares is unknown.
    pub fn global_names(&self) -> Option<Vec<GlobalName>> {
        if self.program_errors.iter().any(|it| it.code == 2688) {
            return None;
        }
        let is_project_file = |file: FileId| {
            let module = self.module(file);
            !module.is_lib
                && !module.is_from_external_library
                && !strings::contains(module.file_name(), b"/node_modules/")
        };
        let mut names = Vec::with_capacity(self.globals.len());
        for &(name, symbol) in self.globals.iter() {
            let text = self.atoms.bytes(name);
            // An ambient module is listed with its quotes, and the binder's internal names start
            // with a byte that no source text has.
            if matches!(text.first(), None | Some(b'"' | b'\'' | 0xFE)) {
                continue;
            }
            let symbol = self.canonical(symbol);
            let flags = self.symbol_flags(symbol);
            let is_variable = |part: &Sym| {
                let flags = self.flags(*part);
                flags.intersects(SymFlags::VARIABLE) && !flags.contains(SymFlags::CONST)
            };
            names.push(GlobalName {
                name: text.into(),
                is_value: flags.intersects(SymFlags::VALUE),
                is_type: flags.intersects(SymFlags::TYPE | SymFlags::NAMESPACE),
                is_writable: (self.parts(symbol).iter())
                    .any(|part| is_project_file(part.file) && is_variable(part)),
            });
        }
        names.sort_unstable_by(|a, b| a.name.cmp(&b.name));
        Some(names)
    }

    pub fn global(&self, name: Atom, meaning: SymFlags) -> Option<Sym> {
        let sym = *self.globals.get(name)?;
        self.means(sym, meaning).then_some(sym)
    }

    fn global_type(&self, name: Atom) -> GlobalType {
        let symbol = self.global(name, SymFlags::TYPE);
        let generic = SymFlags::CLASS | SymFlags::INTERFACE;
        let generic = symbol.filter(|&sym| self.flags(sym).intersects(generic));
        let arity = generic.map(|sym| self.type_argument_arity(sym).1);
        GlobalType {
            symbol,
            arity: arity.map_or(u8::MAX, |arity| arity.min(usize::from(u8::MAX) - 1) as u8),
        }
    }

    /// `getGlobalTypeSymbol`
    #[inline]
    pub fn global_type_symbol(&self, name: Atom) -> Option<Sym> {
        match self.global_types.get(name.0 as usize) {
            Some(known) => known.symbol,
            None => self.global(name, SymFlags::TYPE),
        }
    }

    /// `getGlobalType`: the global class or interface `name` that has `arity` type parameters.
    /// `Err`: the error it reports with `reportErrors`, at `global_type_declaration` of the symbol
    /// with that name. 2318 isn't reported in any file.
    #[inline]
    pub fn get_global_type(&self, name: Atom, arity: usize) -> Result<Sym, (u32, Option<Sym>)> {
        let global = match self.global_types.get(name.0 as usize) {
            Some(&known) => known,
            None => self.global_type(name),
        };
        match global.symbol {
            None => Err((2318, None)),
            Some(symbol) if global.arity == u8::MAX => Err((2316, Some(symbol))),
            Some(symbol) if usize::from(global.arity) != arity => Err((2317, Some(symbol))),
            Some(symbol) => Ok(symbol),
        }
    }

    /// `getGlobalType` without `reportErrors`.
    #[inline]
    pub fn global_type_of_arity(&self, name: Atom, arity: usize) -> Option<Sym> {
        self.get_global_type(name, arity).ok()
    }

    /// `getGlobalTypeDeclaration`
    pub fn global_type_declaration(&self, symbol: Sym) -> Option<(FileId, Decl)> {
        let declarations = self.decls_of(symbol);
        let mut declarations = declarations.iter().copied();
        declarations.find(|it| {
            matches!(
                it.1,
                Decl::Class(_) | Decl::Interface(_) | Decl::Enum(_) | Decl::Alias(_)
            )
        })
    }

    /// True if `file` contains a conditional or a mapped type node.
    #[inline]
    pub fn has_conditional_or_mapped_type(&self, file: FileId) -> bool {
        self.module(file).has_conditional_or_mapped_type
    }

    /// The type parameter list of a symbol with exactly one declaration.
    pub(crate) fn only_type_param_list(&self, sym: Sym) -> Option<(FileId, Span<TypeParamId>)> {
        let symbol = self.symbol(sym);
        let [decl] = symbol.decls[..] else {
            return None;
        };
        if symbol.flags.contains(SymFlags::MERGED) {
            return None;
        }
        let hir = self.hir(sym.file);
        let params = match decl {
            Decl::Class(c) => hir[c].type_params,
            Decl::Interface(i) => hir[i].type_params,
            Decl::Alias(a) => hir[a].type_params,
            _ => Span::EMPTY,
        };
        Some((sym.file, params))
    }

    /// The type parameter lists of the declarations of a class, an interface or an alias.
    pub(crate) fn type_param_lists(&self, sym: Sym) -> SmallVec<[(FileId, Span<TypeParamId>); 16]> {
        let flags = self.flags(sym);
        (self.parts(sym).iter())
            .flat_map(|&part| (self.symbol(part).decls.iter()).map(move |&decl| (part.file, decl)))
            .filter_map(|(file, decl)| {
                let hir = self.hir(file);
                match decl {
                    Decl::Class(c) if flags.contains(SymFlags::CLASS) => {
                        Some((file, hir[c].type_params))
                    }
                    Decl::Interface(i) if flags.contains(SymFlags::INTERFACE) => {
                        Some((file, hir[i].type_params))
                    }
                    Decl::Alias(a) if flags.contains(SymFlags::TYPE_ALIAS) => {
                        Some((file, hir[a].type_params))
                    }
                    _ => None,
                }
            })
            .collect()
    }

    /// The minimum and maximum number of type arguments of a reference to `sym`.
    pub(crate) fn type_argument_arity(&self, sym: Sym) -> (usize, usize) {
        let lists = match self.only_type_param_list(sym) {
            Some(list) => std::iter::once(list).collect(),
            None => self.type_param_lists(sym),
        };
        // In a single list a type parameter without a name is its own symbol.
        let is_single_list = lists.len() == 1;
        // `appendTypeParameters`, `getMinTypeArgumentCount`, `hasTypeParameterDefault`: type
        // parameters with the same name are one symbol, even within one list (`<T, T>`), and it has
        // a default if any of its declarations has one.
        let mut all: SmallVec<[(Atom, bool); 4]> = SmallVec::new();
        for (file, params) in lists {
            let hir = self.hir(file);
            for tp in params.iter() {
                let (name, has_default) = (hir[tp].name, hir[tp].default.is_some());
                let is_named = !is_single_list || (name != Atom::NONE && name != known::empty);
                match all.iter_mut().find(|seen| is_named && seen.0 == name) {
                    Some(seen) => seen.1 |= has_default,
                    None => all.push((name, has_default)),
                }
            }
        }
        (
            all.iter()
                .rposition(|known| !known.1)
                .map_or(0, |last| last + 1),
            all.len(),
        )
    }

    /// `getParentOfSymbol`
    pub fn parent_of_symbol(&self, sym: Sym) -> Option<Sym> {
        let symbol = self.symbol(sym);
        // `mergeSymbolTable` only sets the parent of a transient symbol.
        if symbol.flags.contains(SymFlags::TRANSIENT)
            && let Some(&parent) = self.parents_in_other_files.get(&sym)
        {
            return Some(self.canonical(parent));
        }
        let parent = symbol.parent;
        parent.is_some().then(|| self.sym(sym.file, parent))
    }

    /// The raw `symbol.Parent` field, unlike `getParentOfSymbol`, which returns the merged parent. `mergeSymbolTable`
    /// only re-parents symbols that were actually merged. A symbol that exists only in the source table keeps its
    /// parent, for example the `declare module "m"` block that contains it.
    pub fn symbol_parent(&self, sym: Sym) -> Option<Sym> {
        if let Some(&parent) = self.parents_in_other_files.get(&sym) {
            return Some(parent);
        }
        let (file, id) = (sym.file, self.symbol(sym).parent);
        if id.is_some() {
            return Some(Sym { file, id });
        }
        // `cloneTypeAsModuleType`: `result.Parent = symbol.Parent`. `combineValueAndTypeSymbols`:
        // that of the type symbol, if the value symbol has none.
        let created = self.transient_symbol(sym)?;
        self.symbol_parent(created.target)
    }

    /// `getExportSymbolOfValueSymbolIfExported`
    pub fn export_symbol_of_value_symbol_if_exported(&self, sym: Sym) -> Sym {
        let exported = self
            .bound(sym.file)
            .export_symbol_of_value_symbol_if_exported(sym.id);
        self.sym(sym.file, exported)
    }

    /// The arguments `decl` passes to `getExternalModuleMember`, if it is `import { a }`, `export {
    /// a } from` or `const { a } = require(..)`: the module specifier, its resolution mode
    /// (`getModeForUsageLocation`), and the name.
    pub fn external_module_member_of(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<(Atom, ResolutionMode, Atom)> {
        let hir = self.hir(file);
        match decl {
            Decl::ImportSpec(s) => {
                let import = &hir[hir[s].import];
                let mode = self.mode_of_import(file, import.mode);
                let name = if hir[s].is_name_missing() {
                    Atom::NONE
                } else {
                    hir[s].imported
                };
                Some((import.spec, mode, name))
            }
            Decl::ExportSpec(s) => {
                let export = &hir[hir[s].export];
                let mode = self.mode_of_import(file, export.mode);
                export
                    .has_module_specifier
                    .then_some((export.spec, mode, hir[s].local))
            }
            Decl::Require(pat) => {
                let (spec, name) = self.bound(file).required_by(hir, pat)?;
                Some((spec, self.mode_of_require(file), name?))
            }
            _ => None,
        }
    }

    /// `GetLocalSymbolForExportDefault(symbol).Name`
    fn name_of_local_symbol_for_export_default(&self, symbol: Sym) -> Option<Atom> {
        let declarations = self.decls_of(symbol);
        let &(file, first) = declarations.first()?;
        // `isExportDefaultSymbol`
        let modifiers = self.bound(file).modifier_flags(self.hir(file), first);
        if !modifiers.contains(Flags::DEFAULT) {
            return None;
        }
        // `declareModuleMember`: "No local symbol for an unnamed default!"
        declarations.iter().find_map(|&(file, declaration)| {
            let hir = self.hir(file);
            let name = match declaration {
                Decl::Fn(it) => hir[it].name,
                Decl::Class(it) => hir[it].name,
                Decl::Interface(it) => hir[it].name,
                _ => Atom::NONE,
            };
            name.is_some().then_some(name)
        })
    }

    /// `NameResolver.Resolve`. `lookup`: `NameResolver.Lookup`, which receives the table, its entry
    /// for `name`, and the meaning.
    pub fn resolve_with(
        &self,
        file: FileId,
        mut scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        reports_errors: bool,
        lookup: &mut dyn FnMut(SymbolTable, Option<Sym>, SymFlags) -> Option<Sym>,
    ) -> Result<Option<Sym>, (u32, MemberId)> {
        let bound = self.bound(file);
        // `lastLocation`: the kind of the scope the search has just left.
        let mut from = ScopeKind::Block;
        while scope.is_some() {
            if meaning.contains(SymFlags::TYPE_PARAMETER)
                && let Some((code, container)) = bound.type_parameter_out_of_reach(scope)
            {
                let locals = bound.scopes[container.idx()].locals;
                let table_entry = bound.lookup(locals, name).map(|id| self.sym(file, id));
                let table = SymbolTable::Locals(file, container);
                if lookup(table, table_entry, SymFlags::TYPE_PARAMETER).is_some() {
                    return Err((code, MemberId::NONE));
                }
            }
            let s = &bound.scopes[scope.idx()];
            if reports_errors
                && let Some(invalid) = bound.property_with_invalid_initializer(scope, name, meaning)
            {
                // Nil, regardless of what is found. The most recently recorded property, the
                // outermost, is the one the error refers to.
                return Err(self
                    .resolve_with(file, s.parent, name, meaning, true, lookup)
                    .err()
                    .unwrap_or(invalid));
            }
            // The `infer`s of a conditional type are visible from its true branch, not from the
            // `extends` clause that declares them.
            if !matches!(from, ScopeKind::Extends) {
                let table_entry = bound.lookup(s.locals, name).map(|id| self.sym(file, id));
                let is_export_value_only =
                    table_entry.is_some_and(|sym| self.rejected_exports.contains(&sym));
                // `meaning&ast.SymbolFlagsType`: a type parameter of a class or an interface shares
                // a symbol with the member of the same name, which isn't in scope.
                let is_type_parameter =
                    matches!(s.kind, ScopeKind::Class(_) | ScopeKind::Interface(_))
                        && table_entry
                            .is_some_and(|sym| self.flags(sym).contains(SymFlags::TYPE_PARAMETER));
                let meaning = match (is_export_value_only, is_type_parameter) {
                    (true, _) => meaning & SymFlags::VALUE,
                    (false, true) => meaning & SymFlags::TYPE,
                    (false, false) => meaning,
                };
                if let Some(sym) = lookup(SymbolTable::Locals(file, scope), table_entry, meaning)
                    && bound.is_visible_from(from, self.flags(sym), meaning)
                {
                    return Ok(Some(sym));
                }
            }
            // The exports of a module, a namespace or an enum are in scope inside it, wherever they
            // were declared. `default` isn't a name.
            if s.symbol.is_some() && name != known::default {
                // Enum members are in scope in the enum, but not in a namespace merged with it.
                let visible = match s.kind {
                    ScopeKind::Enum(_) => meaning & SymFlags::ENUM_MEMBER,
                    _ => meaning & SymFlags::MODULE_MEMBER,
                };
                let container = self.sym(file, s.symbol);
                let is_external_module = || bound.is_external_module(self.hir(file), scope);
                // "First see if the module has an export default and if the local name of that export default matches."
                if let Some(default) = self.export(container, known::default)
                    && self.flags(default).intersects(meaning)
                    && self.name_of_local_symbol_for_export_default(default) == Some(name)
                    && is_external_module()
                {
                    return Ok(Some(default));
                }
                let table_entry = self.export(container, name);
                // There, an entry that only an export specifier created isn't in scope. That is
                // decided before the alias is resolved, because its target may be the very name
                // being resolved.
                let is_purely_an_export_specifier = table_entry
                    .is_some_and(|sym| self.flags(sym).contains(SymFlags::EXPORT_ONLY))
                    && is_external_module();
                // A symbol found in the exports of a CommonJS module is only in scope if it is a type.
                let is_commonjs = s.kind == ScopeKind::File && bound.commonjs_indicator.is_some();
                if !is_purely_an_export_specifier
                    && let Some(sym) = lookup(SymbolTable::Exports(container), table_entry, visible)
                    && !(is_commonjs && !self.flags(sym).intersects(SymFlags::TYPE))
                {
                    return Ok(Some(sym));
                }
            }
            // The name of a method or an accessor is a child of it: its locals are searched. From
            // there `useResult` is false for a type and for a function scoped variable.
            if let ScopeKind::FunctionName(f) = s.kind {
                let function = bound.fns[f.idx()].scope;
                let locals = bound.scopes[function.idx()].locals;
                let table_entry = bound.lookup(locals, name).map(|id| self.sym(file, id));
                if let Some(sym) = lookup(SymbolTable::Locals(file, function), table_entry, meaning)
                {
                    let flags = self.flags(sym);
                    let is_function_scoped = (meaning & flags).intersects(SymFlags::VARIABLE)
                        && flags.intersects(SymFlags::FUNCTION_SCOPED_VARIABLE);
                    if !(meaning & flags).intersects(SymFlags::TYPE) && !is_function_scoped {
                        return Ok(Some(sym));
                    }
                }
            }
            from = s.kind;
            scope = s.parent;
        }
        let table_entry = self.globals.get(name).copied();
        Ok(lookup(SymbolTable::Globals, table_entry, meaning))
    }

    // ───────────────────────────── modules and aliases ─────────────────────────────

    pub fn file_symbol(&self, file: FileId) -> Sym {
        self.sym(file, self.bound(file).file_symbol)
    }

    /// The module that `spec` resolves to in `file`, for callers that know the specifier but not
    /// its position: its resolution for a plain `import`, or else for whatever use requests it
    /// there.
    pub fn module_of_specifier(&self, file: FileId, spec: Atom) -> Option<Sym> {
        let module = self.module(file);
        let modes = [
            module.default_mode,
            ResolutionMode::Import,
            ResolutionMode::Require,
            ResolutionMode::None,
        ];
        let mode = modes
            .into_iter()
            .find(|&mode| module.imports.contains_key(&(spec, mode)))
            .unwrap_or(module.default_mode);
        self.module_of_specifier_as(file, spec, mode)
    }

    /// `getModeForUsageLocation` of an import or export declaration or an import type, where
    /// `specified_mode` is the mode it specifies.
    pub fn mode_of_import(&self, file: FileId, specified_mode: ResolutionMode) -> ResolutionMode {
        if specified_mode == ResolutionMode::None {
            self.module(file).default_mode
        } else {
            specified_mode
        }
    }

    /// `getModeForUsageLocation` of the argument of `import()`.
    pub fn mode_of_import_call(&self, file: FileId) -> ResolutionMode {
        self.compiler_options_for_file(file)
            .import_call_mode(self.module(file).default_mode)
    }

    /// `getModeForUsageLocation` of the argument of `require()`, also in `import a = require()`.
    pub fn mode_of_require(&self, file: FileId) -> ResolutionMode {
        let options = self.compiler_options_for_file(file);
        if options.import_syntax_affects_module_resolution() {
            ResolutionMode::Require
        } else {
            ResolutionMode::None
        }
    }

    /// `GetEmitSyntaxForUsageLocation` of the specifier of a plain `import`.
    pub fn emit_syntax_of_import(&self, file: FileId) -> ResolutionMode {
        self.compiler_options_for_file(file)
            .emit_syntax_for_import(self.module(file).implied_format)
    }

    /// `GetEmitSyntaxForUsageLocation` of the argument of `import()`.
    pub fn emit_syntax_of_import_call(&self, file: FileId) -> ResolutionMode {
        self.compiler_options_for_file(file)
            .emit_syntax_for_import_call(self.emit_syntax_of_import(file))
    }

    /// `getCompilerOptionsForFile`: the options of the referenced project that `file` belongs to,
    /// or else those of the program.
    pub fn compiler_options_for_file(&self, file: FileId) -> &'s Options {
        self.module(file)
            .redirect_for_resolution
            .unwrap_or(self.options)
    }

    /// `GetDefaultResolutionModeForFile`
    pub fn default_resolution_mode_for_file(&self, file: FileId) -> ResolutionMode {
        let options = self.compiler_options_for_file(file);
        if options.import_syntax_affects_module_resolution() {
            self.module(file).implied_format
        } else {
            ResolutionMode::None
        }
    }

    /// `tryFindAmbientModule(moduleName, true /*withAugmentations*/)`: a relative name never
    /// matches.
    pub fn try_find_ambient_module(&self, spec: Atom) -> Option<Sym> {
        let &ambient = self.ambient_modules.get(&spec)?;
        (!is_relative(self.atoms.bytes(spec))).then(|| self.canonical(ambient))
    }

    /// `resolveExternalModule`: the module that `spec` resolves to in `file` in `mode`.
    pub fn module_of_specifier_as(
        &self,
        file: FileId,
        spec: Atom,
        mode: ResolutionMode,
    ) -> Option<Sym> {
        // The specifier isn't a string literal (1141). No ambient pattern may match it.
        if spec.is_none() {
            return None;
        }
        if let Some(ambient) = self.try_find_ambient_module(spec) {
            return Some(ambient);
        }
        // A file that isn't a module still ends the search.
        if let Some(&target) = self.module(file).imports.get(&(spec, mode)) {
            return self
                .module(target)
                .is_module()
                .then(|| self.file_symbol(target));
        }
        if self.ambient_patterns.is_empty() {
            return None;
        }
        let pattern = self.best_ambient_pattern(spec)?;
        let augmented = self.pattern_augmentations.get(&spec).copied();
        Some(self.canonical(augmented.unwrap_or(pattern)))
    }

    /// `FindBestPatternMatch` over `c.patternAmbientModules`: the longest prefix wins, and on a tie the earliest
    /// pattern.
    fn best_ambient_pattern(&self, spec: Atom) -> Option<Sym> {
        let all = 0..self.ambient_patterns.len() as u32;
        let Some((ending_with_the_star, by_end)) = self.ambient_patterns_by_end.split_last() else {
            return self.best_ambient_pattern_among(spec, all);
        };
        let end = self.atoms.bytes(spec).last();
        let same_ending = end.map_or(&[][..], |&end| by_end[usize::from(end)]);
        let candidates = same_ending.iter().chain(*ending_with_the_star).copied();
        self.best_ambient_pattern_among(spec, candidates)
    }

    /// `best_ambient_pattern`, when only the patterns at `candidates` can match. These are indexes into
    /// `ambient_patterns`, in any order.
    fn best_ambient_pattern_among(
        &self,
        spec: Atom,
        candidates: impl Iterator<Item = u32>,
    ) -> Option<Sym> {
        let text = self.atoms.bytes(spec);
        // (prefix length, index in `ambient_patterns`)
        let mut best: Option<(usize, u32)> = None;
        for at in candidates {
            let (prefix, suffix, _) = self.ambient_patterns[at as usize];
            if best.is_none_or(|b| prefix.len() > b.0 || prefix.len() == b.0 && at < b.1)
                && text.len() >= prefix.len() + suffix.len()
                && text.starts_with(prefix)
                && text.ends_with(suffix)
            {
                best = Some((prefix.len(), at));
            }
        }
        best.map(|(_, at)| self.ambient_patterns[at as usize].2)
    }

    /// `core.Some(symbol.Declarations, isSyntacticDefault)`
    pub fn has_syntactic_default(&self, symbol: Sym) -> bool {
        self.decls_of(symbol).iter().any(|&(file, decl)| {
            let hir = self.hir(file);
            match decl {
                Decl::ExportExpr(stmt) => matches!(hir[stmt].kind, StmtKind::ExportDefault(_)),
                Decl::ExportSpec(_) | Decl::ExportStarAs(_) => true,
                Decl::Fn(f) => hir[f].flags.contains(Flags::DEFAULT),
                Decl::Class(c) => hir[c].flags.contains(Flags::DEFAULT),
                Decl::Interface(i) => hir[i].flags.contains(Flags::DEFAULT),
                _ => false,
            }
        })
    }

    /// `resolve_export_by_name`: `resolveExportByName(module, name)`. `None` if there is none, or
    /// else `has_syntactic_default`. For a module that is `export =` it's a property of the type of
    /// the value, which the symbol tables can't answer.
    pub fn synthetic_default_with(
        &self,
        usage: impl Usage,
        module: Sym,
        resolve_export_by_name: &mut dyn FnMut(Atom) -> Option<bool>,
    ) -> Option<Sym> {
        self.synthetic_default_in_mode(usage.mode(self), module, resolve_export_by_name)
    }

    /// `synthetic_default_with`, given the mode of its `usage`.
    fn synthetic_default_in_mode(
        &self,
        usage: ResolutionMode,
        module: Sym,
        resolve_export_by_name: &mut dyn FnMut(Atom) -> Option<bool>,
    ) -> Option<Sym> {
        let is_file = self
            .symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File));
        if is_file && usage == ResolutionMode::Import {
            let file = self.module(module.file);
            match file.implied_format {
                // For Node a CommonJS module is its own default, regardless of what it declares.
                ResolutionMode::Require if self.options.module.is_node() => {
                    return Some(self.external_module_symbol(module));
                }
                // Between ECMAScript modules there is no synthetic default.
                ResolutionMode::Import => return None,
                // `GetEmitModuleFormatOfFile`: a referenced project determines what its declaration
                // files are emitted as.
                ResolutionMode::None
                    if file.hir.kind == FileKind::Declaration
                        && file.redirect_for_resolution.is_some_and(|redirect| {
                            (ModuleKind::Es2015..=ModuleKind::EsNext).contains(&redirect.module)
                        }) =>
                {
                    return None;
                }
                _ => {}
            }
        }
        if self.options.forbids_synthetic_default_imports {
            return None;
        }
        let can = if !is_file || self.hir(module.file).kind == FileKind::Declaration {
            // A module that is only declared may have a synthetic default, unless it declares its
            // default or declares that it is an ECMAScript module.
            resolve_export_by_name(known::default) != Some(true)
                && self
                    .atoms
                    .lookup(b"__esModule")
                    .is_none_or(|name| resolve_export_by_name(name).is_none())
        } else if self.hir(module.file).is_js {
            // A JavaScript file has one if it has no ECMAScript module syntax and doesn't declare
            // that it is an ECMAScript module.
            let of = self.hir(module.file);
            (!of.has_module_syntax || of.is_forced_module)
                && self
                    .atoms
                    .lookup(b"__esModule")
                    .is_none_or(|name| resolve_export_by_name(name).is_none())
        } else {
            // `hasExportAssignmentSymbol`: a TypeScript file declares its default explicitly,
            // unless it has `export =`.
            self.export(module, known::export_equals).is_some()
        };
        can.then(|| self.external_module_symbol(module))
    }

    /// `isOnlyImportableAsDefault`: for Node's `import` a JSON module has only a default export.
    pub fn is_only_importable_as_default(&self, usage: impl Usage, module: Sym) -> bool {
        self.options.module.is_node()
            && usage.mode(self) == ResolutionMode::Import
            && (self.source_file_of_module(module)).is_some_and(|file| self.is_json_module(file))
    }

    /// `GetSourceFileOfModule`
    fn source_file_of_module(&self, module: Sym) -> Option<FileId> {
        let declaration = self.value_declaration(module).or_else(|| {
            // `GetNonAugmentationDeclaration`
            let is_augmentation = |&(file, decl): &(FileId, Decl)| {
                matches!(decl, Decl::Module(m) if self.hir(file)[m].name == ModuleName::Global
                    || self.is_external_module_augmentation(file, m))
            };
            (self.decls_of(module).iter())
                .find(|&it| !is_augmentation(it))
                .copied()
        });
        declaration.map(|(file, _)| file)
    }

    /// `IsExternalModuleAugmentation`
    pub fn is_external_module_augmentation(&self, file: FileId, m: ModuleId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_ambient_module = |it: ModuleId| !matches!(hir[it].name, ModuleName::Ident(_));
        let parent = |it: ModuleId| bound.parent_of_stmt(hir[it].stmt);
        is_ambient_module(m)
            && match parent(m) {
                bind::Parent::File => hir.has_module_syntax,
                bind::Parent::Module(enclosing_module) => {
                    is_ambient_module(enclosing_module)
                        && matches!(parent(enclosing_module), bind::Parent::File)
                        && !hir.has_module_syntax
                }
                _ => false,
            }
    }

    /// `ast.IsJsonSourceFile(file) || tspath.GetDeclarationFileExtension(file.FileName()) ==
    /// ".d.json.ts"`
    pub fn is_json_module(&self, file: FileId) -> bool {
        let name = self.module(file).file_name();
        self.hir(file).kind == FileKind::Json
            || crate::resolve::get_declaration_file_extension(name) == b".d.json.ts"
    }

    /// `isESMFormatImportImportingCommonjsFormatFile` for a plain `import` in `from`: a file that
    /// is emitted as CommonJS, imported by a file whose `import`s are emitted as `import`s.
    pub fn is_commonjs_to_node(&self, from: FileId, module: Sym) -> bool {
        self.symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && self.emit_syntax_of_import(from) == ResolutionMode::Import
            && self.module(module.file).implied_format == ResolutionMode::Require
    }

    /// True if the import is emitted as `require` (`getEmitSyntaxForModuleSpecifierExpression`, see
    /// `synthetic_default` for `usage`), and `module` is a file that's emitted as an ECMAScript
    /// module (`GetImpliedNodeFormatForEmit`).
    pub fn is_commonjs_import_of_esm_file(&self, usage: impl Usage, module: Sym) -> bool {
        self.symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && usage.mode(self) == ResolutionMode::Require
            && self.module(module.file).implied_format == ResolutionMode::Import
    }

    /// `InternalSymbolNameModuleExports`. From Node 20 on, `require` of an ECMAScript module returns its export named
    /// `"module.exports"`, if it has one. `None` unless `module` is `node20` .. `nodenext`.
    pub fn module_exports_name(&self) -> Option<Atom> {
        if !(ModuleKind::Node20..=ModuleKind::NodeNext).contains(&self.options.module) {
            return None;
        }
        self.atoms.lookup(b"module.exports")
    }

    /// The link step: resolves the aliases and the exports of every module. `Files` is immutable
    /// afterwards.
    fn link(&mut self, host: &dyn Host) {
        // A file that's unreachable from every starting point is in `modules` but not in `order`.
        let unordered: Vec<FileId> = (0..self.modules.len() as u32)
            .map(FileId)
            .filter(|file| self.ranks[file.idx()] == u32::MAX)
            .collect();
        let at_merge = self.modules_resolved_at_merge.iter();
        let at_merge = at_merge.filter_map(|module| {
            let links = self.memo.module_links.get_ref(module)?;
            Some((module, links))
        });
        let nested: Vec<Sym> = at_merge.filter(is_nested).map(|it| *it.0).collect();
        let found = Guarded::new((nested, Vec::<FailedLookup>::new()));
        self.link_components(host, &unordered, &found);
        let (mut nested, mut failed_lookups) = std::mem::take(&mut *found.lock());
        failed_lookups.shared_sort_by_key(|it| (it.file, it.identifier));
        self.failed_lookups = slice_in(&failed_lookups, self.arena);
        nested.retain(|&module| self.canonical(module) == module);
        nested.shared_sort_unstable();
        nested.dedup();
        // One of these can be the symbol made for an `import * as ns`, which belongs to the importing file. Checking
        // any file with two `export *` reads its declarations, so the importing file can't be a leaf.
        for module in &nested {
            self.modules[module.file.idx()].is_leaf = false;
        }
        self.modules_with_nested_export_collisions = slice_in(&nested, self.arena);
        let rejected = self.rejected_merges.iter();
        let parts = rejected.flat_map(|it| it.target_parts.iter().chain(it.source_parts.iter()));
        self.files_with_rejected_merges
            .extend(parts.map(|part| part.file));
        self.is_linked = true;
    }

    /// Links each component as soon as the components it imports are published. Each component gets its own resolver
    /// and publishes immediately. There's no barrier, so a long chain of imports only delays the components that depend
    /// on it.
    ///
    /// The result depends only on the program, not on how the threads are scheduled:
    /// - The levels determine which results of other tasks a task reads. See `LinkPlan`.
    /// - A task starts with an empty buffer and processes its files in order.
    /// - A task publishes its results for the symbols of its own files, and keeps the failed lookups in those files. It
    ///   discards its results for aliases and modules of other files, because the tasks for those files compute them.
    /// - Its results for other symbols of other files are deferred until all tasks have ended. Then the first entry for a
    ///   key wins, with the components ordered by level.
    ///
    /// The order only saves work. An alias can depend on a file that its own file doesn't import: through an ambient
    /// module, a UMD global, an `import a = b.c` in a script, or a module augmentation. A task resolves for itself
    /// whatever it may not read.
    ///
    /// A thread that doesn't find a ready component exits if the remaining levels are too narrow for the threads still
    /// present. Otherwise it sleeps until more components are ready than the thread that made them ready can link
    /// itself. So a chain of modules is linked by one thread, which never waits.
    fn link_components(&self, host: &dyn Host, unordered: &[FileId], found: &FoundByLink<'s>) {
        use std::cmp::Reverse;
        let all = self.components.all;
        let at_merge = self.resolved_at_merge.iter().map(|it| it.0);
        let plan = LinkPlan {
            component_by_file: self.components.of_file,
            levels: all.iter().map(|it| it.level).collect(),
            is_published: all.iter().map(|_| AtomicBool::new(false)).collect(),
            asleep: Guarded::new(0),
            has_published: bun_threading::Condvar::new(),
            aliases_at_merge: at_merge
                .chain(self.circular_at_merge.iter().copied())
                .collect(),
            modules_at_merge: self.modules_resolved_at_merge.iter().copied().collect(),
        };
        // The importers of each component, in one flat list. `ends` delimits each component's
        // range.
        let mut ends = vec![0usize; all.len() + 1];
        for &imported in all.iter().flat_map(|it| it.imports) {
            ends[imported as usize] += 1;
        }
        let mut total = 0;
        for end in &mut ends {
            total += *end;
            *end = total;
        }
        let mut importers = vec![0u32; total];
        for (at, component) in all.iter().enumerate().rev() {
            for &imported in component.imports {
                ends[imported as usize] -= 1;
                importers[ends[imported as usize]] = at as u32;
            }
        }
        // Each range was filled back to front, so `ends[at]` is now where range `at` starts.
        let importers_of = |at: usize| &importers[ends[at]..ends[at + 1]];
        let waits_for: Vec<AtomicU32> = (all.iter())
            .map(|it| AtomicU32::new(it.imports.len() as u32))
            .collect();
        // Sort key: level, then program order.
        let priority = |at: u32| Reverse(u64::from(plan.levels[at as usize]) << 32 | u64::from(at));
        struct Queue {
            /// `priority` of each component that's ready to be linked.
            ready: std::collections::BinaryHeap<Reverse<u64>>,
            finished: usize,
            /// Number of components in each level that haven't been taken by a thread.
            not_taken: Vec<usize>,
            /// Lowest level with a nonzero `not_taken`.
            lowest: usize,
            /// Number of threads that have started and haven't exited.
            present: usize,
            /// Number of those threads sleeping because `ready` is empty.
            asleep: usize,
        }
        let levels = plan.levels.iter().map(|&it| it as usize + 1).max();
        let mut widths = vec![0usize; levels.unwrap_or(0)];
        for &level in &plan.levels {
            widths[level as usize] += 1;
        }
        // `widest_from[level]` is the width of the widest level from `level` up. More threads than that can't all be
        // busy.
        let mut widest_from = vec![0usize; widths.len() + 1];
        for level in (0..widths.len()).rev() {
            widest_from[level] = widest_from[level + 1].max(widths[level]);
        }
        let first = (0..all.len() as u32).filter(|&at| all[at as usize].imports.is_empty());
        let shared = Guarded::new(Queue {
            ready: first.map(priority).collect(),
            finished: 0,
            not_taken: widths,
            lowest: 0,
            present: 0,
            asleep: 0,
        });
        // Wakes threads that sleep because `ready` is empty, when it's refilled or all components are finished.
        let has_tasks = bun_threading::Condvar::new();
        // `Files::decls_of` reads these without asking the plan, so they're only published after all tasks have ended.
        let decls: Guarded<Vec<Vec<(Sym, &'s [(FileId, Decl)])>>> = Guarded::new(Vec::new());
        // (`priority` of the component, its deferred results)
        let left_over: Guarded<Vec<(u64, Resolved<'s>)>> = Guarded::new(Vec::new());
        let workers = host.threads().min(widest_from[0]);
        host.parallel(workers, &|_| {
            let mut queue = shared.lock();
            queue.present += 1;
            let mut has_paused = false;
            let mut batch: Vec<u64> = Vec::new();
            loop {
                // Take the lowest component first. A thread that finishes a component pushes the components this made
                // ready and pops the lowest without releasing the lock. So some thread is always working on the lowest
                // unfinished component.
                let Some(Reverse(next)) = queue.ready.pop() else {
                    if queue.finished == all.len() {
                        break;
                    }
                    // The remaining levels can't keep all present threads busy, so this one exits. The rest never need
                    // to wake it.
                    let is_any_left = queue.lowest < queue.not_taken.len();
                    if is_any_left && queue.present > widest_from[queue.lowest] {
                        queue.present -= 1;
                        return;
                    }
                    if !std::mem::replace(&mut has_paused, true) {
                        drop(queue);
                        pause_before_sleeping();
                        queue = shared.lock();
                        continue;
                    }
                    queue.asleep += 1;
                    has_tasks.wait_guarded(&mut queue);
                    queue.asleep -= 1;
                    continue;
                };
                has_paused = false;
                // A package of ten thousand one-line modules is ten thousand components that are ready at the same
                // time. A thread takes its share of half of them, so that the threads don't queue up for the lock. The
                // share counts the threads that have yet to start, because the files without imports are all ready when
                // the first thread gets here. The components it takes are all on one level. A component only waits for
                // lower levels (`LinkPlan::may_read`), so none of them waits for what another one of them makes ready,
                // which this thread only queues when it's through with all of them.
                batch.clear();
                batch.push(next);
                let more = queue.ready.len() / (2 * workers);
                for _ in 0..more {
                    match queue.ready.peek() {
                        Some(it) if it.0 >> 32 == next >> 32 => batch.push(it.0),
                        _ => break,
                    }
                    queue.ready.pop();
                }
                for &next in &batch {
                    queue.not_taken[(next >> 32) as usize] -= 1;
                }
                while queue.not_taken.get(queue.lowest) == Some(&0) {
                    queue.lowest += 1;
                }
                drop(queue);
                let mut now_ready: SmallVec<[Reverse<u64>; 8]> = SmallVec::new();
                for &next in &batch {
                    let at = next as u32;
                    let files = all[at as usize].files;
                    let mut resolved = self.resolve_files(files, Some((&plan, at)));
                    let symbol_decls = std::mem::take(&mut resolved.decls);
                    if !symbol_decls.is_empty() {
                        decls.lock().push(symbol_decls);
                    }
                    let mut nested = Vec::new();
                    let mut failed_lookups = std::mem::take(&mut resolved.failed_lookups);
                    failed_lookups.retain(|it| plan.component_of(it.file) == at);
                    let rest = self.publish_own(resolved, &plan, at, &mut nested);
                    plan.set_published(at);
                    let is_ready =
                        |&&it: &&u32| waits_for[it as usize].fetch_sub(1, Ordering::AcqRel) == 1;
                    let importers = importers_of(at as usize).iter();
                    now_ready.extend(importers.filter(is_ready).map(|&it| priority(it)));
                    if !nested.is_empty() || !failed_lookups.is_empty() {
                        let mut found = found.lock();
                        found.0.append(&mut nested);
                        found.1.append(&mut failed_lookups);
                    }
                    if let Some(rest) = rest {
                        left_over.lock().push((next, rest));
                    }
                }
                queue = shared.lock();
                queue.ready.extend(now_ready);
                queue.finished += batch.len();
                if queue.finished == all.len() {
                    has_tasks.notify_all();
                }
                // This thread pops one of them itself.
                for _ in 0..queue.ready.len().saturating_sub(1).min(queue.asleep) {
                    has_tasks.notify_one();
                }
            }
            drop(queue);
            loop {
                let symbol_decls = decls.lock().pop();
                let Some(symbol_decls) = symbol_decls else {
                    break;
                };
                for (sym, decls) in symbol_decls {
                    self.memo.decls.insert_ref(sym, decls);
                }
            }
        });
        let mut left_over = std::mem::take(&mut *left_over.lock());
        left_over.shared_sort_unstable_by_key(|it| it.0);
        let mut found = found.lock();
        let mut publish = |mut resolved: Resolved<'s>| {
            let links = resolved.module_links.iter();
            found.0.extend(links.filter(is_nested).map(|it| *it.0));
            found.1.append(&mut resolved.failed_lookups);
            self.publish(resolved);
        };
        left_over.into_iter().for_each(|it| publish(it.1));
        publish(self.resolve_files(unordered, None));
    }

    /// Runs one task of the link step. First it computes the links of every alias of `files`, file
    /// by file in symbol order, because the order determines where a cycle is entered. Then, with
    /// nothing in progress, it computes everything else.
    fn resolve_files(&self, files: &[FileId], scope: Option<(&LinkPlan<'s>, u32)>) -> Resolved<'s> {
        let mut resolver = AliasResolver::new(self, Some(Resolved::default()));
        resolver.scope = scope;
        let arena = resolver.arena();
        let symbols = |&file: &FileId| {
            let ids = 0..self.bound(file).symbols.len() as u32;
            ids.map(move |id| Sym {
                file,
                id: SymbolId(id),
            })
        };
        // Most symbols don't need linking. These are the ones that do.
        let mut linked: Vec<Sym> = Vec::new();
        for sym in files.iter().flat_map(symbols) {
            let symbol = self.symbol(sym);
            let kinds = SymFlags::ALIAS | SymFlags::MODULE | SymFlags::MERGED;
            if symbol.flags.intersects(kinds) || symbol.decls.len() > 1 {
                linked.push(sym);
            }
            if !symbol.flags.contains(SymFlags::ALIAS) {
                continue;
            }
            // This is where the walk reaches an `ExportAssignment`, which declares one of these names.
            if symbol.name == known::default || symbol.name == known::export_equals {
                for &decl in symbol.decls {
                    if let Decl::ExportExpr(stmt) = decl {
                        resolver.check_export_assignment(sym.file, stmt);
                    }
                }
            }
            resolver.alias_links(sym);
        }
        let mut decls = Vec::new();
        let mut decl_buffer = Vec::new();
        for &sym in &linked {
            let symbol = self.symbol(sym);
            if symbol.flags.contains(SymFlags::ALIAS) {
                resolver.symbol_flags(sym);
            }
            if symbol.flags.intersects(SymFlags::MODULE) {
                resolver.with_module_links(sym, |_| ());
            }
            let has_several = symbol.flags.contains(SymFlags::MERGED) || symbol.decls.len() > 1;
            if has_several && self.canonical(sym) == sym {
                decl_buffer.clear();
                self.collect_decls(sym, &mut decl_buffer);
                decls.push((sym, slice_in(&decl_buffer, arena)));
            }
        }
        let mut resolved = resolver
            .buffer
            .map(|it| it.into_inner())
            .unwrap_or_default();
        resolved.decls = decls;
        // Other threads wait for the one that publishes, and the tables are indexed by symbol. So the entries for the
        // symbols of `files` come first, in symbol order. A task has one entry per key, so the order doesn't matter
        // otherwise.
        let (alias_links, symbol_flags) = (&mut resolved.alias_links, &mut resolved.symbol_flags);
        resolved.alias_links_in_order.reserve(alias_links.len());
        resolved.symbol_flags_in_order.reserve(symbol_flags.len());
        for sym in &linked {
            (resolved.alias_links_in_order).extend(alias_links.remove_entry(sym));
            (resolved.symbol_flags_in_order).extend(symbol_flags.remove_entry(sym));
        }
        resolved.alias_links_in_order.extend(alias_links.drain());
        resolved.symbol_flags_in_order.extend(symbol_flags.drain());
        resolved
    }

    /// Publishes the results of the task for component `own` for the symbols of its files. Adds the modules among them
    /// that are `is_nested` to `nested`. Returns its results for symbols of other files that are neither aliases nor
    /// modules, if there are any.
    fn publish_own(
        &self,
        resolved: Resolved<'s>,
        plan: &LinkPlan,
        own: u32,
        nested: &mut Vec<Sym>,
    ) -> Option<Resolved<'s>> {
        let is_own = |sym: Sym| plan.component_of(sym.file) == own;
        let mut rest = Resolved::default();
        for (sym, links) in resolved.alias_links_in_order {
            if is_own(sym) {
                self.alias_symbol_links.insert_ref(sym, links);
            } else if !self.flags(sym).contains(SymFlags::ALIAS) {
                rest.alias_links_in_order.push((sym, links));
            }
        }
        // Every key here is an alias, so none of them belongs in `rest`.
        for (sym, flags) in resolved.symbol_flags_in_order {
            if is_own(sym) {
                let known = RawWord(flags.bits() | FLAGS_KNOWN);
                self.memo.symbol_flags.insert(sym, known);
            }
        }
        for (module, links) in resolved.module_links {
            if is_own(module) {
                if is_nested(&(&module, &links)) {
                    nested.push(module);
                }
                self.memo.module_links.insert_ref(module, links);
            } else if !self.flags(module).intersects(SymFlags::MODULE) {
                rest.module_links.insert(module, links);
            }
        }
        let is_empty = rest.alias_links_in_order.is_empty() && rest.module_links.is_empty();
        (!is_empty).then_some(rest)
    }

    /// Publishes everything in `resolved`. Only called at a barrier, on one thread.
    fn publish(&self, resolved: Resolved<'s>) {
        for (sym, links) in resolved.alias_links_in_order {
            self.alias_symbol_links.insert_ref(sym, links);
        }
        for (sym, flags) in resolved.symbol_flags_in_order {
            let known = RawWord(flags.bits() | FLAGS_KNOWN);
            self.memo.symbol_flags.insert(sym, known);
        }
        for (module, links) in resolved.module_links {
            self.memo.module_links.insert_ref(module, links);
        }
        for (sym, decls) in resolved.decls {
            self.memo.decls.insert_ref(sym, decls);
        }
    }

    /// The `FailedLookup`s for the identifier `e` of `file`.
    pub fn failed_lookups_of(&self, file: FileId, e: ExprId) -> &'s [FailedLookup<'s>] {
        let all = self.failed_lookups;
        let from = all.partition_point(|it| (it.file, it.identifier) < (file, e));
        let count = all[from..].partition_point(|it| (it.file, it.identifier) == (file, e));
        &all[from..from + count]
    }

    /// `means(sym, meaning)`, if no alias has to be resolved for it.
    #[inline]
    fn has_meaning_by_own_flags(&self, sym: Sym, meaning: SymFlags) -> Option<bool> {
        if meaning.is_empty() {
            return Some(false);
        }
        let flags = self.flags(sym);
        if flags.intersects(meaning) {
            return Some(true);
        }
        (!flags.contains(SymFlags::ALIAS)).then_some(false)
    }

    /// See `Resolve::means`.
    #[inline]
    pub fn means(&self, sym: Sym, meaning: SymFlags) -> bool {
        match self.has_meaning_by_own_flags(sym, meaning) {
            Some(known) => known,
            None => resolve!(self, resolver => resolver.means(sym, meaning)),
        }
    }

    /// `symbol_flags(sym)`, if no alias has to be resolved for it.
    #[inline]
    fn stored_symbol_flags(&self, sym: Sym) -> Option<SymFlags> {
        let flags = self.flags(sym);
        if !flags.contains(SymFlags::ALIAS) {
            return Some(flags);
        }
        let stored = self.memo.symbol_flags.raw(sym);
        (stored != 0).then(|| SymFlags::from_bits_retain(stored & !FLAGS_KNOWN))
    }

    /// See `Resolve::symbol_flags`.
    #[inline]
    pub fn symbol_flags(&self, sym: Sym) -> SymFlags {
        match self.stored_symbol_flags(sym) {
            Some(stored) => stored,
            None => resolve!(self, resolver => resolver.symbol_flags_of_alias(sym)),
        }
    }

    /// `resolve_alias(sym)`, if no alias has to be resolved for it.
    #[inline]
    fn stored_alias_target(&self, sym: Sym) -> Option<Option<Sym>> {
        if !self.flags(sym).contains(SymFlags::ALIAS) {
            return Some(Some(sym));
        }
        let stored = self.alias_symbol_links.get_ref(&sym)?;
        Some(stored.alias_target)
    }

    /// See `Resolve::resolve_alias`.
    #[inline]
    pub fn resolve_alias(&self, sym: Sym) -> Option<Sym> {
        match self.stored_alias_target(sym) {
            Some(stored) => stored,
            None => resolve!(self, resolver => resolver.alias_links(sym).alias_target),
        }
    }

    /// `canHaveSyntheticDefault`: see `Resolve::synthetic_default`.
    pub fn synthetic_default(&self, usage: impl Usage, module: Sym) -> Option<Sym> {
        resolve!(self, resolver => resolver.synthetic_default(usage, module))
    }

    /// `resolveEntityName`, `dontResolveAlias`. `reports_errors`: `!ignoreErrors`.
    pub fn resolve_entity_with(
        &self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags,
        reports_errors: bool,
        symbols: &mut dyn EntityNameLookup,
    ) -> Option<Sym> {
        resolve!(self, resolver => {
            resolver.resolve_entity_with(file, scope, names, meaning, reports_errors, symbols)
        })
    }

    /// The loop at the end of `resolveEntityName`: the first symbol on the alias chain from `sym`
    /// that has `meaning` itself; the end of the chain if none has.
    pub fn resolve_alias_as_with(
        &self,
        mut sym: Sym,
        meaning: SymFlags,
        symbols: &mut dyn EntityNameLookup,
    ) -> Option<Sym> {
        for _ in 0..32 {
            let flags = self.flags(sym);
            if flags.intersects(meaning) || !flags.contains(SymFlags::ALIAS) {
                return Some(sym);
            }
            let next = symbols.resolve_alias(sym)?;
            if next == sym {
                return None;
            }
            sym = next;
        }
        None
    }

    /// `moduleSymbolLinks.Get(module)`, filled in by `getExportsOfModule`.
    pub fn module_links(&self, module: Sym) -> &ModuleSymbolLinks<'s> {
        debug_assert!(self.is_linked);
        let links = self.memo.module_links.get_ref(&module);
        // `link` stores them for every symbol that has a flag of `SymFlags::MODULE`.
        debug_assert!(links.is_some() || !self.flags(module).intersects(SymFlags::MODULE));
        links.unwrap_or(&self.no_module_links)
    }

    /// `getExportsOfModule`
    pub fn exports_of_module(&self, module: Sym) -> &[(Atom, Sym)] {
        &self.module_links(module).resolved_exports
    }

    /// The entries of `getExportsOfModule(module)` that aren't their own merged symbol.
    /// `exports_of_module` has the merged symbol instead.
    pub fn unmerged_exports_of_module(&self, module: Sym) -> &[(Atom, Sym)] {
        self.module_links(module).unmerged_exports
    }

    /// `symbol.Exports[InternalSymbolNameExportStar].Declarations`
    fn export_stars_of(&self, symbol: Sym) -> SmallVec<[(FileId, StmtId); 4]> {
        let mut stars = SmallVec::new();
        for &part in self.parts(symbol).iter() {
            let file_export_stars = self.bound(part.file).export_stars.iter();
            stars.extend(
                file_export_stars
                    .filter(|star| star.0 == part.id)
                    .map(|star| (part.file, star.1)),
            );
        }
        stars
    }

    pub fn is_type_only_star_export(&self, module: Sym, name: Atom) -> bool {
        self.type_only_export_star(module, name).is_some()
    }

    /// The end of the alias chain from `sym`: a symbol that isn't an alias at all, merged. tsgo has no such function,
    /// because its callers want a specific meaning, which `resolve_alias_as` handles.
    #[inline]
    pub fn resolve_alias_if_needed(&self, sym: Sym) -> Option<Sym> {
        let target = self.resolve_alias_as(sym, SymFlags::empty())?;
        // `mergeSymbol` needs `resolveSymbol(target)`.
        Some(if self.is_merged {
            self.canonical(target)
        } else {
            target
        })
    }

    /// `getTypeOnlyAliasDeclarationEx(symbol, SymbolFlagsValue)`
    pub fn type_only_alias_declaration_ex(&self, mut symbol: Sym) -> Option<TypeOnlyDeclaration> {
        for _ in 0..32 {
            let flags = self.flags(symbol);
            if !flags.contains(SymFlags::ALIAS) || flags.intersects(SymFlags::VALUE) {
                return None;
            }
            let links = self.alias_links(symbol);
            if links.type_only_declaration.is_some() {
                return links.type_only_declaration;
            }
            symbol = links.alias_target?;
        }
        None
    }

    /// The record of `symbol`, if it was synthesized for an alias.
    fn transient_symbol(&self, symbol: Sym) -> Option<TransientSymbol> {
        if !self.flags(symbol).contains(SymFlags::TRANSIENT) {
            return None;
        }
        let mut created = self.module(symbol.file).transient_symbols.iter();
        created.find(|created| created.symbol == symbol.id).copied()
    }

    fn transient_symbol_of_alias(&self, alias: Sym, is_combined: bool) -> Option<Sym> {
        let mut created = self.module(alias.file).transient_symbols.iter();
        let created = created
            .find(|created| created.alias == alias.id && created.is_combined == is_combined)?;
        Some(Sym {
            file: alias.file,
            id: created.symbol,
        })
    }

    /// The result of `resolveESModuleSymbol` for the alias of an `import * as ns`, if it isn't the
    /// module symbol itself.
    pub fn module_clone(&self, originating_import: Sym) -> Option<Sym> {
        self.transient_symbol_of_alias(originating_import, false)
    }

    /// The result of `combineValueAndTypeSymbols` for `alias`, if the `export =` value has a
    /// property of that name.
    pub fn combined_symbol(&self, alias: Sym) -> Option<Sym> {
        self.transient_symbol_of_alias(alias, true)
    }

    /// True if `alias`, or an alias on the chain to its target, has a `combined_symbol`. In that
    /// case only types tell what `resolveAlias` and `getSymbolFlags` return for it.
    pub fn has_symbol_to_combine(&self, mut alias: Sym) -> bool {
        let mut links_followed = 0;
        while self.has_symbols_to_combine
            && links_followed < 32
            && self.flags(alias).contains(SymFlags::ALIAS)
        {
            if self.combined_symbol(alias).is_some() {
                return true;
            }
            let Some(next) = self.alias_links(alias).immediate_target else {
                return false;
            };
            alias = next;
            links_followed += 1;
        }
        false
    }

    /// `exportTypeLinks.target` of a symbol that `cloneTypeAsModuleType` created.
    pub fn target_of_module_clone(&self, symbol: Sym) -> Option<Sym> {
        let created = self.transient_symbol(symbol)?;
        (!created.is_combined).then_some(created.target)
    }

    /// The alias that `symbol` was synthesized for, and whether `combineValueAndTypeSymbols`
    /// created it. Otherwise it is `exportTypeLinks.originatingImport`.
    pub fn alias_of_transient_symbol(&self, symbol: Sym) -> Option<(Sym, bool)> {
        let created = self.transient_symbol(symbol)?;
        let alias = Sym {
            file: symbol.file,
            id: created.alias,
        };
        Some((alias, created.is_combined))
    }

    /// The symbol whose table is used as `Exports` of `sym`. `maps.Clone(symbol.Exports)`: a clone
    /// that nothing was merged into has the same entries as its original.
    fn holder_of_exports(&self, sym: Sym) -> Sym {
        if self.flags(sym).contains(SymFlags::TRANSIENT)
            && !self.merged_exports.contains_key(&sym)
            && let Some(target) = self.target_of_module_clone(sym)
        {
            return target;
        }
        sym
    }

    /// `IsNonLocalAlias(sym, Value | Type | Namespace)`: an alias and nothing else, or an alias
    /// merged with an assignment declaration.
    pub fn is_non_local_alias(&self, sym: Sym) -> bool {
        let flags = self.flags(sym);
        flags.contains(SymFlags::ALIAS)
            && (!flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
                || flags.contains(SymFlags::ASSIGNMENT))
    }

    /// `IsTypeOnlyImportOrExportDeclaration`
    pub fn is_type_only_import_or_export_declaration(&self, file: FileId, decl: Decl) -> bool {
        let hir = self.hir(file);
        match decl {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => hir[import].type_only,
            Decl::ImportSpec(s) => hir[s].type_only || hir[hir[s].import].type_only,
            Decl::ImportEquals(import) => hir[import].flags.contains(Flags::TYPE_ONLY),
            Decl::ExportSpec(s) => hir[s].type_only || hir[hir[s].export].type_only,
            Decl::ExportStarAs(statement) => matches!(
                hir[statement].kind,
                StmtKind::ExportStar {
                    type_only: true,
                    ..
                }
            ),
            _ => false,
        }
    }

    /// `markSymbolOfAliasDeclarationIfTypeOnly` for the declaration `decl` in `file` of `sym`.
    fn mark_symbol_of_alias_declaration_if_type_only(
        &self,
        (sym, file, decl): (Sym, FileId, Decl),
        export_star_declaration: Option<(FileId, StmtId)>,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) {
        if type_only.is_some() {
            return;
        }
        *type_only = if self.is_type_only_import_or_export_declaration(file, decl) {
            Some(TypeOnlyDeclaration::Alias(sym, file, decl))
        } else {
            export_star_declaration.map(|(of, star)| TypeOnlyDeclaration::ExportStar(of, star))
        };
    }

    /// `resolveExternalModuleSymbol(module, dontResolveAlias)`: `module`, or its `export =` symbol,
    /// unresolved.
    fn external_module_symbol(&self, module: Sym) -> Sym {
        self.export(module, known::export_equals).unwrap_or(module)
    }

    /// `IsAliasSymbolDeclaration`
    pub fn is_alias_symbol_declaration(&self, file: FileId, decl: Decl) -> bool {
        let hir = self.hir(file);
        match decl {
            Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
            | Decl::ImportEquals(_)
            | Decl::ExportSpec(_)
            | Decl::ExportStarAs(_)
            | Decl::UmdGlobal(_)
            | Decl::Require(_) => true,
            _ => alias_like_expression(hir, decl).is_some_and(|e| expression_is_alias(hir, e)),
        }
    }

    /// `getDeclarationOfAliasSymbol`: the last alias declaration of `sym`, in whichever file it is.
    /// `Symbol::decls` also lists the declarations `declareSymbolEx` rejected, which aren't
    /// declarations of the symbol. An import excludes every other alias (`AliasExcludes`), so an
    /// import that follows an alias declaration was rejected.
    pub fn declaration_of_alias_symbol(&self, sym: Sym) -> Option<(FileId, Decl)> {
        let decls = self.decls_of(sym);
        (0..decls.len()).rev().find_map(|i| {
            let (file, decl) = decls[i];
            if !self.is_alias_symbol_declaration(file, decl) {
                return None;
            }
            let is_import = matches!(
                decl,
                Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ImportEquals(_)
                    | Decl::Require(_)
            );
            let is_rejected = is_import
                && decls[..i].iter().any(|&(other, earlier)| {
                    other == file && self.is_alias_symbol_declaration(other, earlier)
                });
            (!is_rejected).then_some((file, decl))
        })
    }

    /// `isShorthandAmbientModuleSymbol`: true if `ValueDeclaration`, which is the first of several
    /// module declarations, is `declare module "m";`.
    pub fn is_shorthand_ambient_module_symbol(&self, module: Sym) -> bool {
        matches!(
            self.decls_of(module).first(),
            Some(&(file, Decl::Module(id))) if !self.hir(file)[id].has_body
        )
    }
}

impl<'a, 's> AliasResolver<'a, 's> {
    fn new(files: &'a Files<'s>, buffer: Option<Resolved<'s>>) -> AliasResolver<'a, 's> {
        AliasResolver {
            files,
            in_flight: Default::default(),
            out_of_stack: Default::default(),
            cycles: Default::default(),
            buffer: buffer.map(std::cell::RefCell::new),
            arena: Default::default(),
            members_resolved: Default::default(),
            resolved_symbols: Default::default(),
            scope: None,
        }
    }

    /// See `LinkPlan::may_read`. Always true without a `scope`.
    fn may_read(&self, file: FileId) -> bool {
        self.scope
            .is_none_or(|(plan, own)| plan.may_read(own, file))
    }
}

impl<'s> Resolve<'s> for AliasResolver<'_, 's> {
    fn arena(&self) -> &'s Arena {
        self.arena.get_or_init(|| self.files.thread_arena())
    }

    fn symbol_flags(&self, sym: Sym) -> SymFlags {
        let flags = self.flags(sym);
        if !flags.contains(SymFlags::ALIAS) {
            return flags;
        }
        // The merge doesn't store any symbol flags, so only `may_read` matters here.
        let stored = match self.may_read(sym.file) {
            true => self.stored_symbol_flags(sym),
            false => None,
        };
        stored.unwrap_or_else(|| self.symbol_flags_of_alias(sym))
    }

    fn resolve_alias(&self, sym: Sym) -> Option<Sym> {
        match self.flags(sym).contains(SymFlags::ALIAS) {
            true => self.alias_links(sym).alias_target,
            false => Some(sym),
        }
    }

    fn alias_links(&self, sym: Sym) -> AliasSymbolLinks {
        let is_at_merge = |(plan, _): (&LinkPlan, u32)| plan.aliases_at_merge.contains(&sym);
        let is_at_merge = self.scope.is_none_or(is_at_merge);
        // A cycle of aliases can include a link that isn't an import, so it can span several components. Each
        // component's task walks the cycle itself: an alias is circular if it's in progress when the cycle closes.
        if (is_at_merge || self.may_read(sym.file))
            && let Some(known) = self.alias_symbol_links.get(&sym)
            && (is_at_merge || !known.is_circular)
        {
            return known;
        }
        if let Some(buffer) = &self.buffer
            && let Some(&known) = buffer.borrow().alias_links.get(&sym)
        {
            return known;
        }
        // `pushTypeResolution`: a read of an alias in progress forms a cycle with every alias
        // pushed since.
        let is_pushed = {
            let mut in_flight = self.in_flight.borrow_mut();
            let start = in_flight.iter().position(|begun| begun.0 == sym);
            if let Some(start) = start {
                for begun in &mut in_flight[start..] {
                    begun.1 = false;
                }
            }
            let is_pushed = start.is_none() && bun_core::StackCheck::init().is_safe_to_recurse();
            if is_pushed {
                in_flight.push((sym, true));
            } else if start.is_none() {
                self.out_of_stack.set(in_flight.len());
            }
            is_pushed
        };
        if !is_pushed {
            self.cycles.set(self.cycles.get() + 1);
            return AliasSymbolLinks::default();
        }
        let mut links = AliasSymbolLinks::default();
        if let Some((file, decl)) = self.declaration_of_alias_symbol(sym) {
            let type_only = &mut links.type_only_declaration;
            let target = self.target_of_alias_declaration(sym, file, decl, type_only);
            let merged = target.map(|target| self.canonical(target));
            // `getExternalModuleMember` returns the symbol as stored in the table of the module, and
            // `getTargetOfNamespaceExportDeclaration` the symbol of the file. `resolveEntityName`
            // and `resolveExternalModuleName` end with `getMergedSymbol`.
            let is_as_in_table = self.external_module_member_of(file, decl).is_some()
                || matches!(decl, Decl::UmdGlobal(_));
            links.immediate_target = if is_as_in_table && !self.is_merged {
                target
            } else {
                merged
            };
            links.alias_target = match links.immediate_target {
                Some(target) if self.is_non_local_alias(target) => {
                    self.resolve_indirection_alias(target, type_only)
                }
                _ if is_as_in_table => target,
                target => target,
            };
        }
        // `popTypeResolution`
        let begun = self.in_flight.borrow_mut().pop();
        let left = self.in_flight.borrow().len();
        if left < self.out_of_stack.get() {
            self.out_of_stack.set(left);
            links.ran_out_of_stack = true;
        }
        if links.ran_out_of_stack || !begun.is_some_and(|begun| begun.1) {
            links.alias_target = None;
            links.is_circular = true;
        }
        match &self.buffer {
            Some(buffer) => *buffer.borrow_mut().alias_links.entry(sym).or_insert(links),
            None => self.alias_symbol_links.insert(sym, links),
        }
    }

    fn symbol_flags_of_alias(&self, sym: Sym) -> SymFlags {
        if let Some(buffer) = &self.buffer
            && let Some(&known) = buffer.borrow().symbol_flags.get(&sym)
        {
            return known;
        }
        let cycles = self.cycles.get();
        let flags = self.symbol_flags_ex(sym, false, false);
        // The flags of an alias in progress aren't its final flags.
        if self.cycles.get() == cycles {
            match &self.buffer {
                Some(buffer) => {
                    buffer.borrow_mut().symbol_flags.insert(sym, flags);
                }
                None => {
                    let known = RawWord(flags.bits() | FLAGS_KNOWN);
                    self.memo.symbol_flags.insert(sym, known);
                }
            }
        }
        flags
    }

    fn with_module_links<R>(
        &self,
        module: Sym,
        read: impl FnOnce(&ModuleSymbolLinks<'s>) -> R,
    ) -> R {
        let is_at_merge = |(plan, _): (&LinkPlan, u32)| plan.modules_at_merge.contains(&module);
        if (self.scope.is_some_and(is_at_merge) || self.may_read(module.file))
            && let Some(published) = self.memo.module_links.get_ref(&module)
        {
            return read(published);
        }
        if let Some(buffer) = &self.buffer
            && let Some(own) = buffer.borrow().module_links.get(&module)
        {
            return read(own);
        }
        // It can re-enter here for the same module. The first finished result wins, as in the
        // tables.
        let links = self.exports_of_module_worker(module);
        match &self.buffer {
            Some(buffer) => read(
                buffer
                    .borrow_mut()
                    .module_links
                    .entry(module)
                    .or_insert(links),
            ),
            None => read(self.memo.module_links.insert_ref(module, links)),
        }
    }

    fn set_members_resolved(&self, symbol: Sym) -> bool {
        self.members_resolved.borrow_mut().insert(symbol)
    }

    fn is_alias_in_progress(&self, sym: Sym) -> bool {
        self.in_flight.borrow().iter().any(|begun| begun.0 == sym)
    }

    fn has_resolved_symbol(&self, file: FileId, e: ExprId) -> bool {
        self.resolved_symbols.borrow().contains(&(file, e))
    }

    fn set_resolved_symbol(&self, file: FileId, e: ExprId) {
        self.resolved_symbols.borrow_mut().insert((file, e));
    }

    /// Only the link step records them.
    fn note_failed_lookup(&self, file: FileId, e: ExprId) {
        if let Some(buffer) = &self.buffer {
            let in_flight = self.in_flight.borrow();
            let in_progress: SmallVec<[Sym; 4]> = in_flight.iter().map(|begun| begun.0).collect();
            buffer.borrow_mut().failed_lookups.push(FailedLookup {
                file,
                identifier: e,
                aliases_in_progress: slice_in(&in_progress, self.arena()),
            });
        }
    }
}

/// Defines the methods of `Files` that resolve aliases. Each forwards to the `Resolve` method of the same name.
macro_rules! resolutions {
    ($($visibility:vis fn $name:ident($($argument:ident: $type:ty),*) -> $result:ty;)*) => {
        impl Files<'_> {
            $(
                #[doc = concat!("See `Resolve::", stringify!($name), "`.")]
                $visibility fn $name(&self, $($argument: $type),*) -> $result {
                    resolve!(self, resolver => resolver.$name($($argument),*))
                }
            )*
        }
    };
}

resolutions! {
    pub fn symbol_flags_ex(
        symbol: Sym,
        exclude_type_only_meanings: bool,
        exclude_local_meanings: bool
    ) -> SymFlags;
    fn may_be_property_of_export_equals(sym: Sym) -> bool;
    fn is_named_import_from_export_equals(sym: Sym) -> bool;
    pub fn resolve_name(file: FileId, scope: ScopeId, name: Atom, meaning: SymFlags) -> Option<Sym>;
    pub fn resolve(
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        reports_errors: bool
    ) -> Result<Option<Sym>, (u32, MemberId)>;
    pub fn module_value(module: Sym) -> Sym;
    pub fn module_exports_export(symbol: Sym) -> Option<Sym>;
    pub fn module_export(module: Sym, name: Atom) -> Option<Sym>;
    pub fn resolve_symbol(symbol: Sym) -> Option<Sym>;
    pub fn type_only_export_star(module: Sym, name: Atom) -> Option<(FileId, StmtId)>;
    pub fn resolve_entity(
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags
    ) -> Option<Sym>;
    pub fn namespace_member(container: Sym, name: Atom) -> Option<Sym>;
    pub fn resolve_alias_as(sym: Sym, meaning: SymFlags) -> Option<Sym>;
    pub fn alias_links(sym: Sym) -> AliasSymbolLinks;
    pub fn alias_target(sym: Sym) -> Option<Sym>;
}
