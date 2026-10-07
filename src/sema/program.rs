//! Every file of the program, and its symbols once the files are linked together: which file an
//! import resolves to, which declarations in different files merge into one symbol, what an alias
//! resolves to.

mod explain_files;

use crate::atom::{Atom, Interner, known};
use crate::bind::{self, Bound, Decl, ScopeId, ScopeKind, SymFlags, Symbol, SymbolId};
use crate::check::errors::SuggestionLookup;
use crate::check::spans::{Spans, skip_trivia, skip_trivia_back};
use crate::components::Components;
use crate::hir::{self, *};
use crate::json::Json;
use crate::resolve::{
    DiagAndArgs, Host, INFERRED_TYPES_CONTAINING_FILE, JsxEmit, ModuleDetection, ModuleKind,
    Options, Phase, ResolvedModule, Resolver, ScriptTarget, Spent, Tracer, ancestors,
    contains_path, displayed_path, file_extension_is_one_of, file_path, format_by_extension,
    get_lib_file_name, has_ts_implementation_extension, inside, is_javascript, is_javascript_file,
    is_relative, is_same_path, join, remove_file_extension, supported_extensions,
    to_file_name_lower_case, to_path, to_path_in,
};
use crate::session::{
    Arena, ArenaHashMap, ArenaHashSet, ArenaVec, Session, map_in, set_in, transfer_arena,
    vec_from_iter_in,
};
use crate::table::{Bases, ByNode, ByNodeIndirect, Frozen, RawWord};
use crate::util::{FxBuild, FxHashMap, FxHashSet, List};
use crate::verify::{Place, Problem};
use bstr::ByteSlice;
use bun_core::strings;
use bun_paths::fs::Path;
use bun_paths::path_buffer_pool;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_threading::Guarded;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};

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

fn add_transient_symbols<'s>(module: &mut Module<'s>, created: Vec<(TransientSymbol, Symbol<'s>)>) {
    module.bound.symbols.reserve_exact(created.len());
    for (mut links, symbol) in created {
        links.symbol = SymbolId(module.bound.symbols.len() as u32);
        module.bound.symbols.push(symbol);
        module.transient_symbols.push(links);
    }
}

/// A copy of `list` in `arena`. An empty list takes no memory.
fn slice_in<'s, T: Copy>(list: &[T], arena: &'s Arena) -> &'s [T] {
    if list.is_empty() {
        return &[];
    }
    arena.alloc_slice_copy(list)
}

/// Hands the list `field` of every file to the session, and borrows it from there. It is on the
/// regular heap, and nothing drops a file of a program.
fn keep_lists<'s, T: Clone + Send + Sync + 'static>(
    session: &'s Session,
    modules: &mut [ModuleCell<'s>],
    field: impl for<'a> Fn(&'a mut hir::File<'s>) -> &'a mut Cow<'s, [T]>,
) {
    let mut owned: Vec<(usize, Vec<T>)> = Vec::new();
    for (i, module) in modules.iter_mut().enumerate() {
        if let Cow::Owned(list) = field(&mut module.hir)
            && !list.is_empty()
        {
            owned.push((i, std::mem::take(list)));
        }
    }
    if owned.is_empty() {
        return;
    }
    for (i, list) in session.keep(owned) {
        *field(&mut modules[*i].hir) = Cow::Borrowed(list);
    }
}

/// `list` at its final size, in `arena`.
fn few<T>(list: Vec<T>, arena: &Arena) -> ArenaFew<'_, T> {
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
    /// The `package.json` in `PackageJsonDirectory`, if it has no `PackageJsonType`. `NONE`
    /// otherwise, and unless `module` is `node16` or `node18`: nothing else reads it.
    pub package_json_without_type: Atom,
    /// `SourceFileMetaData.PackageJsonDirectory`: the directory of the `package.json` nearest to
    /// the file. None: there is none.
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
    /// while `jsx` is not set, with the mode they are resolved in and `ResolvedFileName`. The file
    /// is not added to the program because of them (6142).
    pub jsx_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// `GetResolutionDiagnostic`, `needResolveJsonModule`: the specifiers that resolve to a JSON
    /// file without `resolveJsonModule`, with the mode they are resolved in and
    /// `ResolvedFileName`. They resolve to no file (7042).
    pub json_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// `ResolvedUsingTsExtension`: the specifiers that resolve through a TypeScript extension written in the specifier itself, with the
    /// mode they are resolved in.
    pub ts_extension_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// `GetResolutionDiagnostic`: the specifiers that resolve to a `.d.css.ts` file or the like
    /// without `allowArbitraryExtensions`, with the mode they are resolved in. They resolve to no
    /// file (6263).
    pub arbitrary_extension_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// For each of `arbitrary_extension_imports`: the file it resolves to.
    pub arbitrary_extension_files: ArenaFew<'s, Atom>,
    /// The relative specifiers without an extension, under Node-style module resolution, which
    /// requires one for `import`; and `getSuggestedImportExtension`, if a candidate file exists.
    pub extensionless_imports: ArenaFew<'s, (Atom, Option<&'static [u8]>)>,
    /// `ResolvedFileName` for those of `imports` for which another file is in the program: for a
    /// duplicate of a package file the copy that is kept, for a source of a referenced project its
    /// declaration file.
    pub redirected_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// Those of `imports` that resolve to a declaration file of a referenced project, for which its source is loaded.
    pub project_reference_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// The specifiers that resolve to one of `Options::referenced_sources` whose declaration file
    /// is not in the program, with `OutputDts` and `ResolvedFileName`. They resolve to no file
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
    /// `IsSourceFileFromExternalLibrary`: `lowestDepth > 0`, every task for it ran below a step
    /// into a `node_modules`.
    pub is_from_external_library: bool,
    /// No file refers to it, and it adds no globally visible declarations. So only the task that
    /// checks it reads its HIR, which is freed at the end of that task (`Files::free_tree`), and
    /// nothing that mentions one of its nodes is published.
    pub is_leaf: bool,
    /// It adds no globally visible declarations, so it `is_leaf` if no file refers to it.
    adds_nothing: bool,
    /// Whether it contains a conditional or a mapped type node.
    has_conditional_or_mapped_type: bool,
}

/// A module in the list of all modules. In a cell for `Files::free_tree`.
pub struct ModuleCell<'s>(std::cell::UnsafeCell<Module<'s>>);

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

/// Held while tasks on the threads that only read and tasks on the threads of the host wait for
/// each other. Both pools are bounded and belong to the process. With two loads under way, the
/// readers of one can occupy one pool and the processors of the other the other pool, and then each
/// waits for tasks that never start. Whatever else runs on the pools ends without waiting.
static WAITS_ACROSS_POOLS: Guarded<()> = Guarded::new(());

/// Reads the files at `paths` and passes the contents of each to `work`, on all the threads of the
/// host. Where the host has threads that only read (`Host::io_pool`), they read, one file after
/// the other, and the threads of the host never wait for the file system.
fn read_and_work(
    host: &dyn Host,
    paths: &[&[u8]],
    work: &(dyn Fn(usize, Cow<'static, [u8]>) + Sync),
) {
    let threads = host.threads();
    let Some(io) = host.io_pool().filter(|_| paths.len() >= 4 * threads) else {
        host.parallel(paths.len(), &|i| {
            work(i, host.read_source(paths[i]));
        });
        return;
    };
    /// Adjacent paths are in the same directory.
    const RUN: usize = 16;
    /// Contents that have been read occupy memory until they are processed.
    const AHEAD: usize = 256;
    struct Shared {
        ready: Vec<(usize, Cow<'static, [u8]>)>,
        to_read: usize,
    }
    let shared = Guarded::new(Shared {
        ready: Vec::new(),
        to_read: paths.len(),
    });
    let (is_more, has_room) = (bun_threading::Condvar::new(), bun_threading::Condvar::new());
    let next = AtomicUsize::new(0);
    let read = |(): &(), (): (), _: usize| {
        loop {
            let from = next.fetch_add(RUN, Ordering::Relaxed);
            if from >= paths.len() {
                break;
            }
            for i in from..(from + RUN).min(paths.len()) {
                let text = host.read_source(paths[i]);
                let mut shared = shared.lock();
                while shared.ready.len() > AHEAD {
                    has_room.wait_guarded(&mut shared);
                }
                shared.ready.push((i, text));
                shared.to_read -= 1;
                let is_last = shared.to_read == 0;
                drop(shared);
                if is_last {
                    is_more.notify_all();
                } else {
                    is_more.notify_one();
                }
            }
        }
    };
    let process = |_: usize| {
        loop {
            let mut shared = shared.lock();
            let (i, text) = loop {
                if let Some(ready) = shared.ready.pop() {
                    break ready;
                }
                if shared.to_read == 0 {
                    return;
                }
                is_more.wait_guarded(&mut shared);
            };
            let has_room_again = shared.ready.len() == AHEAD;
            drop(shared);
            if has_room_again {
                has_room.notify_all();
            }
            work(i, text);
        }
    };
    let _alone = WAITS_ACROSS_POOLS.lock();
    io.each_while((), read, &mut vec![(); io.max_threads()], || {
        host.parallel(threads, &process);
    });
}

/// What remains of a file whose HIR is freed. The text is retained for the report.
fn stub_of<'s>(hir: &mut hir::File<'s>) -> hir::File<'s> {
    hir::File {
        text: std::mem::take(&mut hir.text),
        kind: hir.kind,
        is_js: hir.is_js,
        source_len: hir.source_len,
        has_module_syntax: hir.has_module_syntax,
        is_module_by_decree: hir.is_module_by_decree,
        has_errors: hir.has_errors,
        ran_out_of_stack: hir.ran_out_of_stack,
        has_parse_diagnostics: hir.has_parse_diagnostics || hir.has_parse_or_grammar_diagnostics(),
        ..hir::File::empty_in(hir.arena(), hir.lazy.session)
    }
}

impl<'s> Module<'s> {
    /// `FileName()`: the name of the file, as it is spelled where `collectFiles` first comes to it.
    #[inline]
    pub fn file_name(&self) -> &'s [u8] {
        self.path.pretty
    }
}

impl Module<'_> {
    /// Whether its top-level declarations are local to it.
    pub fn is_module(&self) -> bool {
        self.hir.has_module_syntax || self.is_commonjs()
    }

    /// JavaScript that contains `require(..)`, `module.exports = ..` or `exports.a = ..`, and has
    /// neither imports nor exports.
    pub fn is_commonjs(&self) -> bool {
        self.bound.commonjs_indicator.is_some()
    }

    /// The file that `spec` resolves to in this file, for callers that know the specifier but not
    /// its position: its resolution for a plain `import`, or else for whatever use requests it
    /// there. Same lookup as `Files::module_of_specifier`.
    pub fn imported_file(&self, spec: Atom) -> Option<FileId> {
        [
            self.default_mode,
            ResolutionMode::Import,
            ResolutionMode::Require,
            ResolutionMode::None,
        ]
        .into_iter()
        .find_map(|mode| self.imports.get(&(spec, mode)).copied())
    }
}

/// `ast.SymbolTable`. Iteration is in insertion order, which is the same in every run.
pub struct SymbolMap<'s> {
    entries: ArenaVec<'s, (Atom, Sym)>,
    /// The index of a name in `entries`.
    places: ArenaHashMap<'s, Atom, u32>,
}

impl<'s> SymbolMap<'s> {
    /// It grows only on the thread that `arena` belongs to.
    pub fn new_in(arena: &'s Arena) -> SymbolMap<'s> {
        SymbolMap {
            entries: ArenaVec::new_in(arena),
            places: map_in(arena),
        }
    }

    /// Allocated once, with room for as many entries as `symbols` announces.
    pub fn from_iter_in(
        symbols: impl IntoIterator<Item = (Atom, Sym)>,
        arena: &'s Arena,
    ) -> SymbolMap<'s> {
        let symbols = symbols.into_iter();
        let count = symbols.size_hint().0;
        let mut table = SymbolMap {
            entries: ArenaVec::with_capacity_in(count, arena),
            places: ArenaHashMap::with_capacity_and_hasher_in(count, FxBuild, arena),
        };
        for (name, symbol) in symbols {
            table.insert(name, symbol);
        }
        table
    }

    pub fn get(&self, name: Atom) -> Option<&Sym> {
        let place = *self.places.get(&name)?;
        Some(&self.entries[place as usize].1)
    }

    pub fn contains_key(&self, name: Atom) -> bool {
        self.places.contains_key(&name)
    }

    pub fn insert(&mut self, name: Atom, symbol: Sym) {
        match self.places.get(&name).copied() {
            Some(place) => self.entries[place as usize].1 = symbol,
            None => {
                self.places.insert(name, self.entries.len() as u32);
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

/// A table that `NameResolver.Resolve` searches.
#[derive(Copy, Clone)]
pub enum SymbolTable {
    /// `location.Locals()`
    Locals(FileId, ScopeId),
    /// `symbol.Exports`
    Exports(Sym),
    Globals,
}

/// What `resolveEntityName` asks about the symbols it comes to. The symbol tables answer as far as
/// they can. The checker answers where types decide.
pub trait EntityNameLookup {
    /// `getSymbol`, as `lookup` of `Files::resolve_with`.
    fn get_symbol(
        &mut self,
        table: SymbolTable,
        held: Option<Sym>,
        meaning: SymFlags,
    ) -> Option<Sym>;

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
    /// The file with this name, in every spelling that the file system takes for the same.
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

/// In place of a file of the program: the configuration file, for a related location in it.
pub const IN_CONFIGURATION: FileId = FileId(u32::MAX - 1);

pub struct Files<'s> {
    session: &'s Session,
    /// The arena of the thread that runs `load`. The tables below are in it, and only that thread
    /// adds to them: every method that does takes `&mut self`.
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
    /// `unknownSymbol`: the target of an alias that cannot be resolved. It is in no table.
    pub unknown_symbol: Sym,
    /// `CommonSourceDirectory` without the `/` at its end, if an output path depends on it.
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
    /// `patternAmbientModuleAugmentations`: keyed by the declared name, the symbol that `declare
    /// module "a.svg"` in a module creates from `declare module "*.svg"`.
    pattern_augmentations: ArenaHashMap<'s, Atom, Sym>,
    /// `mergedSymbols`
    merged_symbols: ArenaHashMap<'s, Sym, Sym>,
    /// `symbol.Declarations` of a transient symbol: the binder symbols that hold them, in merge
    /// order.
    merged_parts: ArenaHashMap<'s, Sym, ArenaVec<'s, Sym>>,
    /// During the symbol merge: `redirect_name_to`.
    stand_ins: ArenaVec<'s, (Sym, SymbolId)>,
    /// The exports of a module or a namespace that could not merge with the export of the same name in another declaration.
    refused_exports: ArenaHashSet<'s, Sym>,
    /// `symbol.Exports` of a transient symbol.
    merged_exports: ArenaHashMap<'s, Sym, SymbolMap<'s>>,
    /// `symbol.Members` of a transient symbol.
    merged_members: ArenaHashMap<'s, Sym, SymbolMap<'s>>,
    pub refused_merges: ArenaVec<'s, RefusedMerge<'s>>,
    /// `mergeModuleAugmentation`: the symbols of the augmentations whose module resolved to a
    /// non-module entity at the time (2671).
    pub augmentations_of_non_modules: ArenaVec<'s, Sym>,
    /// The files that declare one of `refused_merges`. Filled by `link`.
    files_of_refused_merges: ArenaHashSet<'s, FileId>,
    /// The aliases `resolveAlias` found to be circular (2303) while `mergeSymbol` resolved the target of a merge. Their `aliasTarget`
    /// stays `unknownSymbol`, even if the merge breaks the cycle.
    pub circular_at_merge: ArenaVec<'s, Sym>,
    /// The aliases that `mergeSymbol` resolved so that it could merge into their target, with the
    /// links they got then. `aliasTarget` has since become a part of a merged symbol
    /// (`cloneSymbol`), and `resolveAlias` does not call `getMergedSymbol`.
    resolved_at_merge: ArenaVec<'s, (Sym, AliasSymbolLinks)>,
    /// `moduleSymbolLinks` of the modules whose exports `getExportsOfModule` resolved during the
    /// symbol merge, for an alias that `mergeSymbol` resolved. `resolvedExports` is a copy of the
    /// tables at that point: a name that a later augmentation adds to the module is not in it, and
    /// is 2305 for an import. At the end of the merge they move to `Memo::module_links`.
    module_links_at_merge: Guarded<ArenaVec<'s, (Sym, ModuleSymbolLinks<'s>)>>,
    /// The modules of `module_links_at_merge`.
    modules_resolved_at_merge: &'s [Sym],
    /// `module_links_at_merge` is being filled.
    keeps_module_links: bool,
    /// The modules with one of `ModuleSymbolLinks::export_collisions` in another file. Filled by
    /// `link`.
    pub modules_with_nested_export_collisions: &'s [Sym],
    /// `symbol.Parent` of a transient symbol, where `mergeSymbolTable` has set it to a symbol of
    /// another file: the module through which an augmentation has reached the target of an alias.
    parents_in_other_files: ArenaHashMap<'s, Sym, Sym>,

    /// Some file contains `export type * from`.
    has_type_only_stars: bool,

    /// `aliasSymbolLinks`. Filled by `link`.
    alias_symbol_links: ByNodeIndirect<Sym, AliasSymbolLinks, Frozen, &'s Session>,
    /// `link` has run: every table is filled, and nothing is mutated from here on.
    is_linked: bool,
    /// For `module_links` of a symbol that is not a module.
    no_module_links: ModuleSymbolLinks<'s>,
    /// The symbol merge is done: symbols no longer change.
    is_merged: bool,
    memo: Memo<'s>,
    /// The file order in which declarations of one symbol in several files are considered: it
    /// determines the order of overloads.
    pub order: &'s [FileId],
    /// The index of each file in `order`, indexed by `FileId`.
    ranks: &'s [u32],
    /// Of the import graph: `edges` and `imports` of every file in `order`.
    pub components: Components<'s>,
    /// `global_type` of every name below `known::sym_iterator`, indexed by atom number.
    global_types: &'s [GlobalType],
    /// Errors in what the options refer to, not attributable to any file.
    program_errors: &'s [Problem],
    /// `GetIncludeProcessorDiagnostics`: errors about the inclusion of a file in the program,
    /// reported at the reference in another file: that file and the span.
    include_errors: &'s [(FileId, u32, u32, Problem)],
    /// The `package.json` of each `node_modules` package that contains a file of the program, keyed
    /// by its directory. Declaration files and messages need module specifiers for such files.
    pub package_jsons: ArenaHashMap<'s, &'s [u8], &'s Json>,
    /// `DirectoriesByRealpath`: each directory that is known to be a symlink target, with a symlink
    /// to it, in order. The `package.json` of each is in `package_jsons` under the path of the
    /// symlink.
    pub linked_directories: &'s [(&'s [u8], &'s [u8])],
    /// `redirectTargetsMap`: the paths of the duplicates of a package file, for which that file is
    /// in the program, in order.
    pub redirect_targets: ArenaHashMap<'s, FileId, &'s [&'s [u8]]>,
    /// What `traceResolution` logs, in order.
    pub resolution_trace: &'s [DiagAndArgs],
    /// What `Included` has of `load`, for `explain_files`.
    starts: &'s [FileId],
    libs_end: usize,
    roots_end: usize,
    root_of_start: &'s [u32],
    /// `redirectFilesByPath`, in the order in which `collectFiles` comes to them: the name of a copy
    /// of a package file, and the copy that is in the program.
    package_copies: &'s [(&'s [u8], FileId)],
}

/// `Files::global_type`
#[derive(Copy, Clone)]
struct GlobalType {
    /// `getGlobalTypeSymbol`
    symbol: Option<Sym>,
    /// The number of its type parameters. `u8::MAX`: it is not a class or interface.
    arity: u8,
}

/// Results derived from the symbol merge. `whole` is filled at the end of the merge, the others by
/// `link`. Until the merge has ended the tables have zero capacity, so nothing is stored.
struct Memo<'s> {
    /// From each symbol that is `MERGED` to the symbol it is a part of, which may be itself.
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
}

/// `ModuleSymbolLinks`. In the arena of the thread that computes them.
pub struct ModuleSymbolLinks<'s> {
    /// `getMergedSymbol` of each entry of `resolvedExports`. During the symbol merge, the entries.
    pub resolved_exports: SymbolMap<'s>,
    /// The entries of `resolvedExports` that are not their own merged symbol.
    unmerged_exports: &'s [(Atom, Sym)],
    /// `typeOnlyExportStarMap`: the `export type *`.
    pub type_only_export_star_map: ArenaHashMap<'s, Atom, (FileId, StmtId)>,
    /// The errors `getExportsOfModuleWorker` reports, for the `export *` declarations of the module
    /// and of every module that `visit` comes to from there. A module that has been visited exports
    /// nothing the second time, so these are not the errors of that module by itself.
    pub export_collisions: &'s [ExportCollision],
}

impl<'s> ModuleSymbolLinks<'s> {
    /// Of a symbol that exports nothing. It allocates nothing.
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
    /// It becomes `ModuleSymbolLinks::type_only_export_star_map`.
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
    /// Otherwise `getMergedSymbol` of each.
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

/// What becomes of an entry of `resolutionsInFile` that is resolved.
#[derive(Copy, Clone)]
struct Resolution<'r> {
    spec: Atom,
    mode: ResolutionMode,
    /// What `parseTask.load` reads for `ResolvedFileName`: `getParseFileRedirect` of it, or else
    /// the file itself.
    path: &'r [u8],
    /// `shouldAddFile`, and there is a file to read.
    should_add_file: bool,
    /// `increaseDepth`
    increases_depth: bool,
    /// `resolveExternalModule` asks `GetSourceFileForResolvedModule` for it. Otherwise it resolves
    /// to no file, even if the file is in the program.
    is_importable: bool,
    /// The error of `parseTask.load` for an extension that the program does not support. The file
    /// is not read.
    unsupported_extension: Option<u32>,
}

/// `'r`: the paths belong to the `Resolver`.
struct Loaded<'s, 'r> {
    module: Module<'s>,
    imports: Vec<Resolution<'r>>,
    /// (path, is a lib, `increaseDepth`)
    references: Vec<(&'r [u8], bool, bool)>,
    /// The `/// <reference lib>` to a library that is replaced by a file with an extension that
    /// the program does not support: its span, the file, and the error of `parseTask.load`. The
    /// file is not read.
    unsupported_libs: Vec<(u32, u32, &'r [u8], u32)>,
    /// `typeResolutionsTrace`, then `resolutionsTrace`
    traces: Vec<DiagAndArgs>,
}

/// A file that `Files::load` has found.
#[derive(Copy, Clone)]
struct FoundFile<'s> {
    path: Path<'s>,
    is_lib: bool,
    /// `parseTaskData.packageId`, as an index into `Found::kept`.
    package: Option<u32>,
    /// `taskDataByPath`: the first task for the file, by whichever spelling of its name.
    first: FileId,
    /// The task that loads it reads it. Otherwise it is read if `collectFiles` wants it.
    is_read: bool,
    /// `parseTask.loaded`, of `first`: a task for the file has run that was not elided.
    is_loaded: bool,
    /// `seen` of `collectFiles`, of `first`: the task that it came to first, whose spelling is the
    /// name of the file.
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
}

/// What `Files::load` knows about the files it has found, besides the files themselves.
#[derive(Default)]
struct Found<'s> {
    /// By `FileId`.
    files: Vec<FoundFile<'s>>,
    /// The index in `kept` for a `Resolver::package_id`.
    by_package_id: FxHashMap<Vec<u8>, u32>,
    /// `packageIdToSourceFile`: the copy of a package file that `collectFiles` came to first.
    kept: Vec<Option<FileId>>,
    /// Whether `collectFiles` has begun.
    is_collecting: bool,
}

impl Found<'_> {
    /// The index in `kept` for `package_id`, and whether no file has had that id before.
    fn package(&mut self, package_id: Vec<u8>) -> (u32, bool) {
        let new = self.kept.len() as u32;
        let index = *self.by_package_id.entry(package_id).or_insert(new);
        if index == new {
            self.kept.push(None);
        }
        (index, index == new)
    }
}

/// `packageJsonInfoCache`, as far as `traceResolution` shows it: a lookup of a `package.json` that
/// is not the first is logged as such. The cache fills in the order in which the tasks run, which
/// is not the order in which `collectFiles` logs.
#[derive(Default)]
struct PackageJsonInfoCache {
    /// By `tspath.Path`.
    cached: FxHashSet<Vec<u8>>,
    /// The directories that `GetPackageScopeForPath` has started from or passed.
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

    /// `getPackageJsonInfo`, for each lookup in `traces`, which log all of them as repeated.
    fn get_package_json_infos(&mut self, host: &dyn Host, traces: &mut [DiagAndArgs]) {
        for trace in traces {
            let first = match trace.code {
                6239 => 6099,
                6240 => 6096,
                _ => continue,
            };
            // A candidate in a type root is not normalized.
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
    /// This declaration, in this file, of this alias.
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

/// `mergeSymbol(target, source)` for two symbols that exclude each other, with what it reads of
/// them. It reports at once. Merges that follow add flags and declarations to either symbol.
#[derive(Copy, Clone, Debug)]
pub struct RefusedMerge<'s> {
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
    /// `aliasTarget`. `None`: `unknownSymbol`. For `import { a }` and `export { a } from` it is the
    /// symbol as the table of the module has it (`Resolve::module_export_in_table`), of which
    /// `resolveQualifiedName` reads the exports and `getDeclaredTypeOfSymbol` the declarations.
    /// After another alias it is a merged symbol (`resolveIndirectionAlias`).
    pub alias_target: Option<Sym>,
    pub type_only_declaration: Option<TypeOnlyDeclaration>,
    /// `resolveAlias` reports 2303 at the declaration of the alias.
    pub is_circular: bool,
    /// The stack ended while the alias was in progress, where Go's grows. It `is_circular`, as it
    /// may be, and its file is reported as not fully checked in place of 2303.
    pub ran_out_of_stack: bool,
}

/// The functions that resolve names, exports and aliases. Each of them can call `alias_links`, and
/// `alias_links` can call each of them.
///
/// They are written once, as provided methods, and have two implementations. `AliasResolver`
/// computes: it is for the merge and the link step. `Linked` reads: after the link step every alias
/// and every module has its links, and `Files` is immutable.
trait Resolve<'s>: std::ops::Deref<Target = Files<'s>> {
    /// `resolveAlias`, with everything it stores in `aliasSymbolLinks`.
    fn alias_links(&self, sym: Sym) -> AliasSymbolLinks;

    /// `symbol_flags` of an alias for which `stored_symbol_flags` has nothing.
    fn symbol_flags_of_alias(&self, sym: Sym) -> SymFlags;

    /// The arena of the calling thread, for the links that are computed.
    fn arena(&self) -> &'s Arena;

    /// `moduleSymbolLinks.Get(module)`, filled in by `getExportsOfModule`. `read` resolves nothing.
    fn with_module_links<R>(
        &self,
        module: Sym,
        read: impl FnOnce(&ModuleSymbolLinks<'s>) -> R,
    ) -> R;

    /// Sets `ObjectFlagsMembersResolved` of the type of `symbol`. Returns whether it was not set.
    fn set_members_resolved(&self, symbol: Sym) -> bool;

    /// `getSymbol`: whether `sym`, found under a name, matches the requested `meaning`. An alias
    /// has the combined meanings of itself and of every symbol on the chain to its target.
    fn means(&self, sym: Sym, meaning: SymFlags) -> bool {
        if let Some(known) = self.has_meaning_by_own_flags(sym, meaning) {
            return known;
        }
        self.symbol_flags(sym).intersects(meaning)
            || meaning.intersects(SymFlags::VALUE) && self.may_be_property_of_export_equals(sym)
    }

    /// `getSymbolFlags`: the combined flags of `sym` and of every symbol on the chain to its
    /// target. All flags if it cannot be resolved.
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
    /// value, which only the type of the value determines. Whether `sym`, or an alias on the chain
    /// to its target, is such an import.
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

    /// Whether `getTargetOfAliasDeclaration` of `sym` goes through `getExternalModuleMember` for a
    /// module that has `export =`, and `symbolFromVariable` may be a symbol that is not in the
    /// tables.
    fn is_named_import_from_export_equals(&self, sym: Sym) -> bool {
        self.declaration_of_alias_symbol(sym)
            .and_then(|(file, decl)| {
                let (spec, mode, _) = self.external_module_member_of(file, decl)?;
                self.module_of_specifier_as(file, spec, mode)
            })
            .is_some_and(|m| {
                // The properties of a namespace, a function, a class or an enum are its exports,
                // which are in the tables.
                let only_the_type_tells = SymFlags::VARIABLE | SymFlags::PROPERTY | SymFlags::ALIAS;
                self.export(m, known::export_equals).is_some()
                    && self
                        .flags(self.module_value(m))
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
        let lookup = &mut |_: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
            held.filter(|&sym| self.means(sym, meaning))
        };
        self.resolve_with(file, scope, name, meaning, reports_errors, lookup)
    }

    /// `module`, or the target of its `export =`.
    fn module_value(&self, module: Sym) -> Sym {
        self.canonical(match self.export(module, known::export_equals) {
            // `resolveSymbolEx`
            Some(equals) if !self.is_non_local_alias(equals) => equals,
            Some(equals) => self.resolve_alias(equals).unwrap_or(equals),
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
        // `resolveExportByName`: only the exports the module declares itself. With `export =` it is a property of the value instead.
        if self.is_commonjs_import_of_esm_file(file, module)
            && self.export(module, known::export_equals).is_none()
            && let Some(name) = self.module_exports_name()
            && let Some(found) = self.export(module, name)
        {
            return Some(found);
        }
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

    /// `getExportsOfModule(module)[name]`. The entry is not its own merged symbol if a module
    /// augmentation has reached the declaration through a module that re-exports it:
    /// `mergeSymbol` clones the target of the alias, and the clone is in the table of the
    /// augmented module alone.
    fn module_export_in_table(&self, module: Sym, name: Atom) -> Option<Sym> {
        let is_resolved_at_merge =
            self.keeps_module_links || self.modules_resolved_at_merge.contains(&module);
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

    /// `getExportsOfModule(module)`, also while symbols are merged. `read` resolves nothing.
    fn with_exports_of_module<R>(
        &self,
        module: Sym,
        read: impl FnOnce(&ModuleSymbolLinks<'s>) -> R,
    ) -> R {
        if self.is_merged {
            return self.with_module_links(module, read);
        }
        if !self.keeps_module_links && !self.modules_resolved_at_merge.contains(&module) {
            return read(&self.exports_of_module_worker(module));
        }
        // See `Files::module_links_at_merge`.
        {
            let stored = self.module_links_at_merge.lock();
            if let Some(links) = stored.iter().find(|links| links.0 == module) {
                return read(&links.1);
            }
        }
        // Not under the lock: it resolves aliases, which leads back here.
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
                // The module's own exports take precedence.
                if self.resolve_symbol(target) != self.resolve_symbol(source)
                    && name != known::export_equals
                    && !symbols.contains_key(name)
                {
                    visit.export_collisions.push(ExportCollision {
                        duplicate: node,
                        first: lookup_table[&name],
                        name,
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
        let (&last, qualifiers) = names.split_last()?;
        // `NodeIsMissing(name)`: a declaration whose name is missing is named "".
        if names[0] == known::empty {
            return None;
        }
        let scope = self.bound(file).scope_to_resolve_from(scope, names[0]);
        let lookup = &mut |table: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
            symbols.get_symbol(table, held, meaning)
        };
        if qualifiers.is_empty() {
            let found = self.resolve_with(file, scope, last, meaning, reports_errors, lookup);
            return found.unwrap_or(None);
        }
        let mut qualifiers = qualifiers;
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
            None if qualifiers[0] == known::globalThis => match qualifiers {
                [_] => {
                    let held = self.globals.get(last).copied();
                    return lookup(SymbolTable::Globals, held, meaning);
                }
                [_, next, ..] => {
                    qualifiers = &qualifiers[1..];
                    let held = self.globals.get(*next).copied();
                    lookup(SymbolTable::Globals, held, namespace)?
                }
                [] => return None,
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
        let held = self.namespace_member(namespace, name);
        let found = symbols.get_symbol(SymbolTable::Exports(namespace), held, meaning);
        // A namespace that is merged with a re-export can be resolved further.
        if found.is_some() || !self.flags(namespace).contains(SymFlags::ALIAS) {
            return found;
        }
        let target = symbols.resolve_alias(namespace)?;
        let held = self.namespace_member(target, name);
        symbols.get_symbol(SymbolTable::Exports(target), held, meaning)
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

    /// `tryResolveAlias(candidate)`, for a spelling suggestion for an unresolved name in the alias
    /// declaration at `asking`. It skips an alias whose resolution is in progress, so the result
    /// depends on which resolution started first. tsgo resolves them in source order: an alias
    /// declared before `asking` is resolved or in progress, and is left alone. An alias declared
    /// after it has not been started. If it has been started here, by a caller that entered through
    /// it, it is in a cycle with `asking`, as if `asking` had been first.
    fn try_resolve_alias(&self, asking: (FileId, u32), candidate: Sym) -> Option<AliasSymbolLinks> {
        let (file, decl) = self.declaration_of_alias_symbol(candidate)?;
        ((file, self.start_of_declaration(file, decl)) > asking)
            .then(|| self.alias_links(candidate))
    }

    /// `onFailedToResolveSymbol`, limited to its side effects on aliases: `getSymbol` resolves an
    /// alias of that name that has not the meaning itself, and `getSpellingSuggestionForName`
    /// every alias it inspects.
    /// `decl`: the alias declaration in `file` that contains the name.
    fn on_failed_to_resolve_symbol(
        &self,
        file: FileId,
        decl: Decl,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) {
        // `checkAndReportErrorForUsingTypeAsNamespace`: the error is already determined.
        let types = SymFlags::TYPE.difference(SymFlags::NAMESPACE);
        if meaning == SymFlags::NAMESPACE && self.resolve_name(file, scope, name, types).is_some() {
            return;
        }
        // `getSymbolFlags` of what the name resolves to with another meaning. `None` too for an
        // alias that does not resolve.
        let flags_as = |meaning: SymFlags| {
            let found = self.resolve_name(file, scope, name, meaning)?;
            Some(self.symbol_flags(found)).filter(|&flags| flags != SymFlags::all())
        };
        // `checkAndReportErrorForUsingNamespaceAsTypeOrValue`
        let namespace = if meaning.intersects(SymFlags::VALUE.difference(SymFlags::TYPE)) {
            SymFlags::NAMESPACE_MODULE
        } else if meaning.intersects(SymFlags::TYPE.difference(SymFlags::VALUE)) {
            SymFlags::MODULE
        } else {
            SymFlags::empty()
        };
        if !namespace.is_empty() && flags_as(namespace).is_some_and(|it| it.intersects(namespace)) {
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
        if meaning.intersects(SymFlags::VALUE)
            && flags_as(SymFlags::TYPE.difference(SymFlags::VALUE)).is_some_and(is_type_only)
        {
            return;
        }
        // `checkAndReportErrorForUsingValueAsType`
        if meaning.intersects(SymFlags::TYPE.difference(SymFlags::NAMESPACE))
            && flags_as(SymFlags::VALUE.difference(SymFlags::TYPE))
                .is_some_and(|it| !it.intersects(SymFlags::NAMESPACE))
        {
            return;
        }
        let symbols = &mut InAliasDeclaration {
            resolver: self,
            asking: (file, self.start_of_declaration(file, decl)),
        };
        let name = (name, self.atoms.bytes(name));
        // For the aliases that the search resolves. The suggestion is for the error, which the
        // checker reports.
        let _ = self.suggested_symbol_for_nonexistent_symbol(
            Some((file, scope)),
            name,
            meaning,
            symbols,
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
    /// `is_namespace_import`: `namespaceImport != nil`.
    fn resolve_es_module_symbol(
        &self,
        module: Sym,
        is_namespace_import: bool,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Sym {
        let mut symbol = self.external_module_symbol(module);
        if self.is_non_local_alias(symbol) {
            // Where the tables cannot resolve further, types may: a caller that continues from here
            // does so one step at a time.
            symbol = (self.resolve_indirection_alias(symbol, type_only)).unwrap_or(symbol);
        }
        // `hasSignatures(getTypeOfSymbol(symbol))`
        if is_namespace_import {
            self.resolve_members_of_type_of_symbol(symbol);
        }
        symbol
    }

    /// `resolveStructuredTypeMembers(getTypeOfSymbol(symbol))`, limited to what it does to aliases,
    /// and to a type whose members are the exports of `symbol`: `getNamedMembers` asks
    /// `symbolIsValue` of each, which resolves it if it is an alias.
    fn resolve_members_of_type_of_symbol(&self, symbol: Sym) {
        let flags = self.flags(symbol);
        // `getTypeOfFuncClassEnumModule`
        let has_exports_for_members = SymFlags::FUNCTION
            | SymFlags::METHOD
            | SymFlags::CLASS
            | SymFlags::ENUM
            | SymFlags::VALUE_MODULE;
        if flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY)
            || !flags.intersects(has_exports_for_members)
            || !self.set_members_resolved(symbol)
            || self.is_shorthand_ambient_module_symbol(symbol)
        {
            return;
        }
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

    /// `getImmediateAliasedSymbol`
    fn alias_target(&self, sym: Sym) -> Option<Sym> {
        self.alias_links(sym).immediate_target
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
                    self.resolve_es_module_symbol(module, false, type_only);
                    // `nameText != "" || name.Kind == KindStringLiteral`
                    if name.is_none() {
                        return None;
                    }
                    if self.is_shorthand_ambient_module_symbol(module) {
                        return Some(module);
                    }
                    let star = self.type_only_export_star(module, name);
                    self.mark_symbol_of_alias_declaration_if_type_only(node, star, type_only);
                    self.module_export_in_table(module, name)
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
                    // The `JSImportDeclaration` of an `@import` tag is no `ImportDeclaration`.
                    let is_import_declaration = !hir.is_in_jsdoc(hir[import].namespace_pos);
                    let symbol =
                        self.resolve_es_module_symbol(module, is_import_declaration, type_only);
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
                    // `resolveEntityName` marks `getAliasDeclarationFromName(name)` where a name is found to be an alias.
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
                    // `globalThisSymbol` is found, and has no `Sym`.
                    if target.is_none()
                        && names[0] != known::globalThis
                        && self
                            .resolve_name(file, scope, names[0], SymFlags::NAMESPACE)
                            .is_none()
                    {
                        self.on_failed_to_resolve_symbol(
                            file,
                            decl,
                            scope,
                            names[0],
                            SymFlags::NAMESPACE,
                        );
                    }
                    return target;
                }
            },
            // `getTargetOfExportSpecifier` without `from`: `export { "a" as b }` names nothing.
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
                    self.on_failed_to_resolve_symbol(file, decl, scope, hir[spec].local, all);
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
                    .map(|module| self.resolve_es_module_symbol(module, false, type_only))
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

    /// `getTargetOfImportEqualsDeclaration`: the target of `import x = require(..)` and of `const x = require(..)` of `module`.
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
        match decl {
            Decl::ExportExpr(_) | Decl::ModuleExports(_) | Decl::ExportsProperty(_) => {
                let e = match decl {
                    Decl::ExportExpr(stmt) => match hir[stmt].kind {
                        StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => e,
                        _ => return None,
                    },
                    // `getTargetOfBinaryExpression`
                    Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => {
                        match hir[assignment].kind {
                            ExprKind::Assign { value, .. } => value,
                            _ => return None,
                        }
                    }
                    _ => return None,
                };
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
                // `checkExpressionCached(expression)`: `getResolvedSymbol` of the first name. For an
                // `ExportAssignment`, `checkExportAssignment` has cached it before.
                let value = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
                if target.is_none()
                    && !matches!(decl, Decl::ExportExpr(_))
                    && self.resolve_name(file, scope, names[0], value).is_none()
                {
                    self.on_failed_to_resolve_symbol(file, decl, scope, names[0], value);
                }
                target
            }
            _ => None,
        }
    }
}

/// `EntityNameLookup` as far as the symbol tables can answer.
struct InTables<'a, R: ?Sized>(&'a R);

impl<'s, R: Resolve<'s> + ?Sized> EntityNameLookup for InTables<'_, R> {
    fn get_symbol(&mut self, _: SymbolTable, held: Option<Sym>, meaning: SymFlags) -> Option<Sym> {
        held.filter(|&sym| self.0.means(sym, meaning))
    }

    fn resolve_alias(&mut self, alias: Sym) -> Option<Sym> {
        self.0.alias_links(alias).alias_target
    }
}

/// For an unresolved name in the alias declaration at `asking`.
struct InAliasDeclaration<'a, R: ?Sized> {
    resolver: &'a R,
    asking: (FileId, u32),
}

impl<'s, R: Resolve<'s> + ?Sized> SuggestionLookup for InAliasDeclaration<'_, R> {
    fn get_symbol(&mut self, held: Option<Sym>, meaning: SymFlags) -> Option<Sym> {
        held.filter(|&sym| self.resolver.means(sym, meaning))
    }

    fn try_resolve_alias(&mut self, candidate: Sym) -> Option<SymFlags> {
        let InAliasDeclaration { resolver, asking } = *self;
        let target = resolver.try_resolve_alias(asking, candidate)?.alias_target;
        // `unknownSymbol`
        Some(target.map_or(SymFlags::PROPERTY, |target| resolver.flags(target)))
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

    /// Every alias has its links.
    fn set_members_resolved(&self, _: Sym) -> bool {
        false
    }
}

/// `Resolve` while the tables are filled. tsgo pushes `TypeSystemPropertyNameAliasTarget` on
/// `typeResolutions`. Here the aliases in progress belong to the resolver, which is on the stack of
/// one thread.
///
/// It reads the tables, then its own buffer. A result that was computed with a read of an alias in
/// progress depends on where the cycle was entered, and it is stored like any other, as in tsgo. So
/// the order in which a resolver is queried is part of the result.
struct AliasResolver<'a, 's> {
    files: &'a Files<'s>,
    /// `typeResolutions` and `resolutionResults`: each alias in progress, and whether no cycle
    /// through it has been found.
    in_flight: std::cell::RefCell<Vec<(Sym, bool)>>,
    /// How many of `in_flight`, from the first, were in progress when the stack ended.
    out_of_stack: std::cell::Cell<usize>,
    /// The number of times an alias was read while in progress, or was rejected because the stack
    /// has no room for it.
    cycles: std::cell::Cell<u32>,
    /// `None`: results are written to the tables immediately. For the merge, which is
    /// single-threaded.
    buffer: Option<std::cell::RefCell<Resolved<'s>>>,
    /// `Resolve::arena`, once it has been asked for.
    arena: std::cell::OnceCell<&'s Arena>,
    /// The symbols whose type has `ObjectFlagsMembersResolved`.
    members_resolved: std::cell::RefCell<FxHashSet<Sym>>,
}

/// The write buffer of a task of the link step. It is dropped at the barrier after the step. What
/// is published from it is in the arena of the thread that ran the task.
#[derive(Default)]
struct Resolved<'s> {
    alias_links: FxHashMap<Sym, AliasSymbolLinks>,
    symbol_flags: FxHashMap<Sym, SymFlags>,
    module_links: FxHashMap<Sym, ModuleSymbolLinks<'s>>,
    decls: Vec<(Sym, &'s [(FileId, Decl)])>,
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
    if lib.is_empty() {
        return [&options.lib_dir[..], b"/lib.d.ts"].concat();
    }
    [&options.lib_dir[..], b"/lib.", lib, b".d.ts"].concat()
}

/// `GetLibFileName`: the `N` of the `lib.N.d.ts` that contains the library `lib`, a result of
/// `lib_name`.
fn lib_file_stem(lib: &[u8]) -> &[u8] {
    crate::resolve::LIB_FALLBACKS.get(lib).map_or(lib, |it| *it)
}

/// `GetLibFileName` of the name `written` in a `/// <reference lib>`. The library directory of
/// another version of TypeScript may lack the file: the name is then unknown as well.
fn referenced_lib(host: &dyn Host, options: &Options, written: &[u8]) -> Option<Vec<u8>> {
    get_lib_file_name(written).filter(|lib| host.is_file(&lib_file(options, lib)))
}

/// `ForEachDynamicImportOrRequireCall`: it looks at each `import` and `require` in the text, and
/// takes the node around it (`GetNodeAtPosition`, which does not descend into tokens). So a call
/// is found once more for each in its specifier or in a comment in it or before it.
fn dynamic_imports<'a>(hir: &'a hir::File) -> Vec<&'a SpecifierUse> {
    let text = &hir.text[..];
    let uses = hir.specifier_uses.iter().filter(|u| u.kind.is_dynamic());
    let mut uses: Vec<&SpecifierUse> = uses.collect();
    uses.sort_by_key(|u| u.pos);
    // `findImportOrRequire`: where each is, and where it ends.
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
    // From `node.Pos()` to the first child that is not a token. A call has none before the token
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

/// `file.ModuleAugmentations` (`collectModuleReferences`): the declarations that they are the names
/// of.
fn module_augmentations(hir: &hir::File, atoms: &Interner) -> Vec<ModuleId> {
    // `IsAmbientModule(node) && (inAmbientModule || HasSyntacticModifier(node, ModifierFlagsAmbient)
    // || file.IsDeclarationFile)`
    let ambient_module = |s: StmtId, is_in_ambient_module: bool| {
        let StmtKind::Module(m) = hir[s].kind else {
            return None;
        };
        let is_ambient = is_in_ambient_module
            || hir[m].flags.contains(Flags::AMBIENT)
            || hir.kind == FileKind::Declaration;
        (is_ambient && !matches!(hir[m].name, ModuleName::Ident(_))).then_some(m)
    };
    let mut augmentations = Vec::new();
    for s in hir.ids(hir.body) {
        let Some(m) = ambient_module(s, false) else {
            continue;
        };
        if hir.has_module_syntax {
            augmentations.push(m);
            continue;
        }
        let nested = hir.ids(hir[m].body);
        let nested = nested.filter_map(|s| ambient_module(s, true));
        augmentations.extend(nested.filter(|&nested| {
            !matches!(hir[nested].name, ModuleName::String(name) if is_relative(atoms.bytes(name)))
        }));
    }
    augmentations
}

/// Whether `mergeModuleAugmentation` merges `symbol`, which a `declare global` or a `declare module
/// "m"` declares. It does so for `symbol.Declarations[0]` alone, so that has to be one of
/// `collected`, the `module_augmentations` of the file.
fn merges_module_augmentation(bound: &Bound, collected: &[ModuleId], symbol: SymbolId) -> bool {
    matches!(
        bound.symbols[symbol.idx()].decls.first(),
        Some(Decl::Module(first)) if collected.contains(first)
    )
}

/// `getLibraryNameFromLibFileName` and `getInferredLibraryNameResolveFrom`
fn library_name_and_resolve_from(options: &Options, lib: &[u8]) -> (Vec<u8>, Vec<u8>) {
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
    (name, from)
}

/// `pathForLibFile`: the path `lib.<lib>.d.ts` is read from. The task for it has a `libFile`,
/// replaced or not.
fn lib_path(resolver: &Resolver, options: &Options, lib: &[u8]) -> Vec<u8> {
    // `name != "lib.d.ts"`
    if options.lib_replacement && !lib.is_empty() {
        let (name, from) = library_name_and_resolve_from(options, lib);
        // `resolveLibrary`: always resolved the way `require` resolves.
        if let Some(found) = resolver.resolve_module_name(&name, &from, ResolutionMode::Require) {
            return found.file_name.to_vec();
        }
    }
    lib_file(options, lib)
}

/// The tasks of `processAllProgramFiles` for the libraries: for each of `Options::libs` its reason,
/// `pathForLibFile`, and the error of `parseTask.load` for the extension of a file that replaces it.
/// Such a file is not read.
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

/// The first test of `getSourceFileFromReference` and of `parseTask.load`: the error code for a file name whose extension is not
/// supported (`isSupportedExtension` of `GetCanonicalFileName`). JavaScript needs `allowJs`, JSON needs `resolveJsonModule`. `None`
/// for a name without an extension.
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
        return Problem::new(code, &[&file_name], Place::Nowhere);
    }
    let extensions = supported_extensions(options).concat();
    let quoted = [b"'", &extensions.join(&b"', '"[..])[..], b"'"].concat();
    Problem::new(code, &[&file_name, &quoted], Place::Nowhere)
}

/// `resolveTripleslashPathReference`: the path that the `/// <reference path>` with the value
/// `written` in the file at `from` refers to.
fn referenced_path(written: &[u8], from: &[u8]) -> Vec<u8> {
    join(dirname::<Posix>(from), written)
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
    // With an extension, it is that file or none.
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
        names.sort_unstable();
        for name in names {
            let dir = [&root[..], b"/", &name[..]].concat();
            if name.starts_with(b".") || !host.is_dir(&dir) {
                continue;
            }
            // `Typings.Null`: `"typings": null` is how a package declares that it is not needed.
            // It holds whatever value follows for the same name.
            let is_not_needed_package = resolver.package_json(&dir).is_some_and(|fields| {
                let mut fields = fields.as_object().unwrap_or_default().iter();
                fields.any(|field| field.0 == b"typings" && field.1 == Json::Null)
            });
            if !is_not_needed_package {
                packages.push(name);
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

/// `GetPathComponents` of an absolute path: the root, then the names. The root is empty, or a drive: `/c:/a` is `c:/a` to TypeScript.
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
    /// The kinds for which `isReferencedFile`.
    Reference(Reference),
}

/// `referenceFileLocation`
struct Reference {
    target: FileId,
    /// Of the message, without a package id. `fileIncludeKindImport`: 1393, 1395 for the helpers,
    /// 1397 for the JSX runtime. `fileIncludeKindReferenceFile`: 1400.
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

/// One time that `collectFiles` comes to a file.
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

    /// Where it can be reported.
    fn location(&self) -> Option<(FileId, u32, u32)> {
        match &self.reason {
            IncludeReason::Reference(it) if !it.is_synthetic() => Some((it.from, it.start, it.end)),
            _ => None,
        }
    }
}

/// How many times `ForEachDynamicImportOrRequireCall` adds the specifier `u` of a call to
/// `file.Imports()`: once for each `import` and `require` in the text at which `GetNodeAtPosition`
/// finds the call. A token is not a node to it (`KindFirstNode`), so that is in the tokens of the
/// call, the specifier among them, and in the comments before and between them.
fn times_among_imports(hir: &File, calls: &ExprsByKind, text: &[u8], u: &SpecifierUse) -> usize {
    let is_it = |args: IdList<ExprId>| hir.ids(args).next().is_some_and(|it| hir[it].pos == u.pos);
    let of_kind = match u.kind {
        SpecifierKind::ImportCall => calls.of(ExprTag::ImportCall),
        _ => calls.of(ExprTag::Call),
    };
    let found = of_kind.iter().find_map(|&e| match hir[e].kind {
        ExprKind::ImportCall { args } if is_it(args) => Some((e, args)),
        ExprKind::Call(call) if is_it(hir[call].args) => Some((e, hir[call].args)),
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
        times += count_outside_jsdoc(&text[at..start as usize]);
        at = start as usize;
    }
    for (from, to) in hir.ids(args).filter(|e| !is_token(e)).map(range) {
        times += count_import_or_require(&text[at..from.max(at)]);
        at = to.max(at);
    }
    (times + count_import_or_require(&text[at..end.max(at)])).max(1)
}

/// `count_import_or_require` in `trivia`, but for the comments `/** */` in it.
fn count_outside_jsdoc(trivia: &[u8]) -> usize {
    let (mut at, mut count) = (0, 0);
    while let Some(next) = strings::index_of_char_usize(&trivia[at..], b'/') {
        at += next;
        let rest = &trivia[at..];
        let end = match rest.get(1) {
            Some(b'/') => strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len()),
            _ => {
                strings::index_of(&rest[2.min(rest.len())..], b"*/").map_or(rest.len(), |it| it + 4)
            }
        };
        // `/**/` is not one.
        if !(rest.starts_with(b"/**") && end > 4) {
            count += count_import_or_require(&rest[..end]);
        }
        at += end.max(1);
    }
    count
}

/// `findImportOrRequire`, until there is no more.
fn count_import_or_require(text: &[u8]) -> usize {
    let (mut at, mut count) = (0, 0);
    while let Some(next) = strings::index_of_any(&text[at..], b"ir") {
        at += next;
        let word: &[u8] = if text[at] == b'i' {
            b"import"
        } else {
            b"require"
        };
        let is_word = text[at..].starts_with(word);
        count += usize::from(is_word);
        at += if is_word { word.len() } else { 1 };
    }
    count
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
        // `getEmitSyntaxForUsageLocationWorker`: the argument of `require()` is resolved as CommonJS, whatever the file is emitted as.
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
    emit_module_kind: ModuleKind,
) -> ResolutionMode {
    let by_extension = format_by_extension(path);
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

/// `ResolvedModule.Extension`, as far as `GetResolutionDiagnostic` tells extensions apart.
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

/// `GetResolutionDiagnostic`: the code of the message. `file`: the one that has the import.
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
    options.import_helpers
        && (hir.is_js
            || hir.kind != FileKind::Declaration
                && (options.isolated_modules || hir.has_module_syntax))
}

/// `addRootFileTask`: the file that is read for the root file `root`, or else the error.
/// `Ok(None)`: a declaration file that has not been built.
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

/// What the `includeProcessor` reads of a program.
struct Included<'a, 's> {
    host: &'a dyn Host,
    options: &'a Options,
    atoms: &'a Interner<'s>,
    modules: &'a [ModuleCell<'s>],
    by_path: &'a ByPath<'s>,
    /// The names of the root files.
    roots: &'a [Vec<u8>],
    /// What `rootTasks` are for: the libraries up to `libs_end`, the root files up to `roots_end`,
    /// then what the automatic type directives resolve to.
    starts: &'a [FileId],
    libs_end: usize,
    roots_end: usize,
    /// Of each of those root files, its index in `roots`.
    root_of_start: &'a [u32],
}

/// Where a problem with the inclusion of a file is reported, if that is in a file.
type Explanation = (Option<(FileId, u32, u32)>, Problem);

/// Where `Included::visits` is in a file: the file, how many of its edges have been followed, and
/// its references that have not been passed, if it refers to a file that is asked about.
type Frame = (
    FileId,
    usize,
    Option<std::vec::IntoIter<(Reference, Vec<u8>)>>,
);

impl Included<'_, '_> {
    /// `referenceFileLocation` of each reference in `file` to a file of the program, with
    /// `task.normalizedFilePath`, in the order of `parseTask.subTasks`. Only a file that
    /// `is_asked` about has its package id.
    fn references_in(
        &self,
        program_resolver: &Resolver,
        file: FileId,
        is_asked: &[bool],
    ) -> Vec<(Reference, Vec<u8>)> {
        let &Included {
            host,
            options: of_program,
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
        for of_kind in [
            ReferenceKind::Path,
            ReferenceKind::Types,
            ReferenceKind::Lib,
        ] {
            for &(kind, value, pos, mode) in hir.references.iter() {
                // `noResolve`: only library references are still processed.
                if kind != of_kind || of_program.no_resolve && kind != ReferenceKind::Lib {
                    continue;
                }
                let value = atoms.bytes(value);
                let end = pos + value.len() as u32;
                let mut redirected_from = None;
                let (name, code) = match kind {
                    ReferenceKind::Path => {
                        let written = referenced_path(value, module.file_name());
                        let found =
                            referenced_file(host, of_program, &written, module.file_name()).ok();
                        let found =
                            found.and_then(|it| match of_program.parse_file_redirect(&it) {
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
                        let found = resolver.resolve_type_reference(value, from, mode, None);
                        (found.map(|it| it.0), 1402)
                    }
                    ReferenceKind::Lib if of_program.no_lib => (None, 1405),
                    ReferenceKind::Lib => {
                        let lib = referenced_lib(host, of_program, value);
                        let found = lib.map(|lib| lib_path(program_resolver, of_program, &lib));
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
        if (module.file_name().ends_with(b".tsx") || module.file_name().ends_with(b".jsx"))
            && let Some(runtime) = jsx_runtime_of(options, hir, atoms)
        {
            specifiers.push((atoms.intern(&runtime), module.default_mode, 1397, 0, 0));
        }
        // `file.Imports()`: the specifiers of statements, then those of `import()`, the call and the type.
        let mut uses = hir.specifier_uses.to_vec();
        uses.sort_by_key(|u| (u.kind.is_dynamic(), u.pos));
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
            // The name is that of the file, unless somebody asks.
            let asked = is_asked[target.idx()].then(|| {
                resolver.resolve_module_name_with_package_id(atoms.bytes(spec), from, mode)
            });
            match asked.flatten() {
                Some((found, id)) => {
                    // The reason belongs to `redirectedParseTask`.
                    let redirect = of_program.parse_file_redirect(found.file_name);
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

    /// `fileIncludeReasons` of the files that `is_asked` about, by file: `collectFiles` adds the
    /// reason of a task whenever it comes to the task, also if it has been to the file before.
    /// After the files, in both lists: the root files that are not found, which have a task too.
    fn visits(&self, resolver: &Resolver, is_asked: &[bool]) -> Vec<Vec<Visit>> {
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
                Some(start) if !is_asked[start.idx()] => None,
                Some(_) => root_file_name(host, options, root).ok().flatten(),
                None if !is_asked[no_file.idx()] => continue,
                None => root_file_name(host, options, root)
                    .is_err()
                    .then(|| root.clone()),
            };
            let reason = name.map(|name| (IncludeReason::RootFile(index), name));
            tasks.push((start.unwrap_or(no_file), reason));
        }
        let read = lib_tasks(host, resolver, options).filter(|task| task.2.is_none());
        for (&start, (reason, name, _)) in libs.iter().zip(read) {
            tasks.push((start, is_asked[start.idx()].then_some((reason, name))));
        }
        if automatic.iter().any(|start| is_asked[start.idx()]) {
            // `addAutomaticTypeDirectiveTasks`
            let from = inside(&options.base_dir, INFERRED_TYPES_CONTAINING_FILE);
            let found = (automatic_type_directives(host, resolver, options).into_iter())
                .filter_map(|name| {
                    let mode = ResolutionMode::None;
                    let found = resolver.resolve_type_reference_with_package_id(&name, &from, mode);
                    found.map(|(path, id)| {
                        (IncludeReason::AutomaticTypeDirectiveFile(name, id), path)
                    })
                });
            tasks.extend(automatic.iter().copied().zip(found.map(Some)));
        } else {
            tasks.extend(automatic.iter().map(|&start| (start, None)));
        }
        let refers_to_one =
            |file: FileId| (modules[file.idx()].edges.iter()).any(|edge| is_asked[edge.idx()]);
        let mut seen = vec![false; modules.len()];
        for (first, reason) in tasks {
            if let Some((reason, name)) = reason.filter(|_| is_asked[first.idx()]) {
                visit(first, reason, name);
            }
            if first == no_file {
                continue;
            }
            let frame = |file: FileId| -> Frame {
                let references = || self.references_in(resolver, file, is_asked).into_iter();
                (file, 0, refers_to_one(file).then(references))
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
                        && is_asked[reference.target.idx()]
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
            &IncludeReason::RootFile(index) => root_file_reason(
                options,
                &self.roots[index],
                self.host.is_case_sensitive(),
                to_file_name,
            ),
            IncludeReason::LibFile(Some(entry)) => (1422, vec![entry.clone()]),
            IncludeReason::LibFile(None) => (1425, vec![self.emit_script_target()]),
            IncludeReason::AutomaticTypeDirectiveFile(name, id) => {
                let code = if uses_wildcard { 1420 } else { 1417 };
                with_id(code, vec![name.clone()], id.as_ref())
            }
            IncludeReason::Reference(it) => {
                let from: &Module = &self.modules[it.from.idx()];
                // `referenceFileLocation.text`
                let written = match it.code {
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
                    vec![written, to_file_name(from.file_name())],
                    it.package_id.as_ref(),
                )
            }
        }
    }

    /// `toRelatedInfo`
    fn related_info(&self, visit: &Visit) -> Option<(FileId, u32, u32, u32)> {
        let options = self.options;
        let in_configuration = |place: Place, code: u32| {
            let text = self.host.read(&options.config_path)?;
            let session = Session::new();
            let file = crate::json::TsConfigSourceFile::parse(self.host, &session, text)?;
            let (start, end) = Problem::new(code, &[], place).span_in(&file)?;
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
                let is_case_sensitive = self.host.is_case_sensitive();
                let root = &self.roots[index];
                match root_file_reason(options, root, is_case_sensitive, &file_name_as_it_is) {
                    (1409, args) => {
                        in_configuration(Place::TopElement(b"files", args[0].clone()), 1410)
                    }
                    (1407, args) => {
                        in_configuration(Place::TopElement(b"include", args[0].clone()), 1408)
                    }
                    _ => None,
                }
            }
            IncludeReason::AutomaticTypeDirectiveFile(name, _) => {
                let place = Place::Element(b"types", name.clone());
                (!uses_wildcard_types(options)).then(|| in_configuration(place, 1419))?
            }
            IncludeReason::LibFile(Some(entry)) => {
                in_configuration(Place::Element(b"lib", entry.clone()), 1423)
            }
            IncludeReason::LibFile(None) => {
                in_configuration(Place::Element(b"target", self.emit_script_target()), 1426)
            }
        }
    }

    /// `fileIncludeReasons[path]` for each path that `visits`, which are those to one file, come by.
    /// A copy of a package file has a path of its own.
    fn by_path<'v>(&self, visits: &'v [Visit]) -> Vec<Vec<&'v Visit>> {
        let is_case_sensitive = self.host.is_case_sensitive();
        let mut by_path: Vec<Vec<&Visit>> = Vec::new();
        for visit in visits {
            let is_there =
                |it: &&mut Vec<&Visit>| is_same_path(&it[0].name, &visit.name, is_case_sensitive);
            match by_path.iter_mut().find(is_there) {
                Some(visits) => visits.push(visit),
                None => by_path.push(vec![visit]),
            }
        }
        by_path
    }

    /// Those of `visits` that come by the path of the file with this name.
    fn by_path_of<'v>(&self, visits: &'v [Visit], name: &[u8]) -> Vec<&'v Visit> {
        let is_case_sensitive = self.host.is_case_sensitive();
        let is_it = |visit: &&Visit| is_same_path(&visit.name, name, is_case_sensitive);
        visits.iter().filter(is_it).collect()
    }

    /// `createDiagnosticExplainingFile`: `visits` are those by one path, which stands for `file`.
    /// `because`: `diagnosticReason`.
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
        let mut problem = Problem::new(code, args, Place::Nowhere);
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
                let (code, args) = self.reason_message(visit, &file_name_as_it_is);
                let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
                problem = problem.with(2, code, &args);
            }
        }
        // `explainRedirectAndImpliedFormat`
        let location = preferred_location.and_then(Visit::location);
        let Some(module) = self.modules.get(file.idx()) else {
            return (location, problem);
        };
        let name = visits.first().map_or(module.path.pretty, |it| &it.name[..]);
        // `redirectFilesByPath`
        let is_redirects_file =
            !is_same_path(name, module.file_name(), self.host.is_case_sensitive());
        if !is_redirects_file && module.project_reference_source.is_some() {
            let source = self.atoms.bytes(module.project_reference_source);
            problem = problem.with(1, 1428, &[&displayed_path(source)]);
        }
        if is_redirects_file {
            problem = problem.with(1, 1429, &[&displayed_path(module.file_name())]);
        } else if let Some((code, args)) =
            implied_format_reason(resolver, self.options, module, &file_name_as_it_is)
        {
            let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
            problem = problem.with(1, code, &args);
        }
        (location, problem)
    }

    /// `createDiagnosticExplainingFile` for the `processingDiagnostics` of the tasks that read no
    /// file: of each `diagnosticReason`, and the message.
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

    /// `code`, with the file and the path `arg` as arguments, for each source file that would be
    /// emitted and for which `is_wrong` returns true. `is_wrong` receives whether it is a root file.
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

    /// `normalizedFilePath` of the task that `parseTask.redirect` has redirected to the task that
    /// `visit` comes to.
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
    /// files that it has come to by more than one spelling of a name. `alike`: the names that
    /// differ only in case, where that makes them the names of different files.
    fn file_casing_errors(
        &self,
        respelled: &[FileId],
        alike: &[Vec<(&[u8], FileId)>],
    ) -> Vec<Explanation> {
        if respelled.is_empty() && alike.is_empty() {
            return Vec::new();
        }
        let mut is_asked = vec![false; self.modules.len() + 1];
        let alike_files = alike.iter().flatten().map(|it| &it.1);
        for file in respelled.iter().chain(alike_files) {
            is_asked[file.idx()] = true;
        }
        let resolving = Session::new();
        let resolver = Resolver::new(&resolving, self.host, self.options);
        let visits = self.visits(&resolver, &is_asked);
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
                    // A different drive letter is no error.
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
        for alike in alike {
            let mut each: Vec<(FileId, Vec<&Visit>)> = (alike.iter())
                .map(|&(name, file)| (file, self.by_path_of(&visits[file.idx()], name)))
                .filter(|it| !it.1.is_empty())
                .collect();
            each.sort_by_key(|it| it.1[0].order);
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

/// `toFileName` of `computeDiagnostic` and `explainRedirectAndImpliedFormat`: what a message has for
/// the file with a name.
type ToFileName<'a> = &'a dyn Fn(&[u8]) -> Vec<u8>;

/// `toFileName` of `toDiagnostic` without `relativeFileName`.
fn file_name_as_it_is(file_name: &[u8]) -> Vec<u8> {
    displayed_path(file_name).into_owned()
}

/// `computeDiagnostic` of `fileIncludeKindRootFile`: the code and the arguments of the message that
/// explains why the file at `path` is a root file.
fn root_file_reason(
    options: &Options,
    path: &[u8],
    is_case_sensitive: bool,
    to_file_name: ToFileName<'_>,
) -> (u32, Vec<Vec<u8>>) {
    if options.config_path.is_empty() {
        return (1427, Vec::new());
    }
    if let Some(spec) =
        crate::config::matched_file_spec(&options.file_specs, path, is_case_sensitive)
    {
        return (1409, vec![spec.to_vec(), to_file_name(path)]);
    }
    if options.is_default_include_spec {
        return (1457, Vec::new());
    }
    match crate::config::matched_include_spec(
        &options.include_specs,
        &options.base_dir,
        path,
        is_case_sensitive,
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
    // `loadSourceFileMetaData`
    let scope = ancestors(dirname::<Posix>(module.file_name()))
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
    if module.is_lib || module.hir.kind == FileKind::Declaration || module.is_from_external_library
    {
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

/// The parts of `verifyCompilerOptions` that depend on which files are emitted and where. 6307 for
/// a source file that a composite project does not list, 6059 (`checkSourceFilesBelongToPath`) for
/// one that is not under `rootDir`, 5009 and 5011 for the common source directory, and
/// `GetSourceFilePathInNewDir`: the path under `dir` that mirrors the path of `path` relative to
/// the common source directory. A file outside that directory keeps its path.
fn source_file_path_in_new_dir(
    dir: &[u8],
    path: &[u8],
    common: Option<&[u8]>,
    is_case_sensitive: bool,
) -> Vec<u8> {
    match common {
        _ if dir.is_empty() => path.to_vec(),
        Some(common) if contains_path(common, path, is_case_sensitive) => join(
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

/// `getOwnEmitOutputFilePath`, with `GetOutputExtension`.
pub fn own_emit_output_file_path(
    options: &Options,
    path: &[u8],
    common: Option<&[u8]>,
    is_case_sensitive: bool,
) -> Vec<u8> {
    let is_one_of = |extensions: [&[u8]; 2]| file_extension_is_one_of(path, &extensions);
    let extension: &[u8] = if file_extension_is_one_of(path, &[b".json"]) {
        b".json"
    } else if options.jsx == JsxEmit::Preserve && is_one_of([b".jsx", b".tsx"]) {
        b".jsx"
    } else if is_one_of([b".mts", b".mjs"]) {
        b".mjs"
    } else if is_one_of([b".cts", b".cjs"]) {
        b".cjs"
    } else {
        b".js"
    };
    let moved = source_file_path_in_new_dir(&options.out_dir, path, common, is_case_sensitive);
    [remove_file_extension(&moved), extension].concat()
}

/// `UseCaseSensitiveFileNames` of `Program.comparePathsOptions`. Nothing assigns that field, so it
/// is Go's zero value on every file system.
pub const COMPARE_PATHS_CASE_SENSITIVE: bool = false;

/// `verifyEmitFilePath`: 5055 for an output file that is an input file, 5056 for one that two input
/// files are emitted to. Errors reported at a position in a file go to `include_errors`. With them,
/// `CommonSourceDirectory`, if anything depends on it.
fn output_path_errors(
    included: &Included,
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
    let sources: Vec<&Module> = modules
        .iter()
        .map(|module| &**module)
        .filter(|module| source_file_may_be_emitted(options, module, is_case_sensitive))
        .filter(|module| is_own(module))
        .collect();
    let paths: Vec<&[u8]> = sources.iter().map(|module| module.file_name()).collect();
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
            errors.push(Problem::new(5009, &[], Place::Key(b"outDir", b"")));
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
            Problem::new(5011, &[config_name, &relative], Place::Key(one, other)).with(
                1,
                5111,
                &[],
            ),
        );
    }
    if options.suppress_output_path_check {
        return (errors, common);
    }
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    let mut verify = |output: Vec<u8>| {
        if by_path.contains(&output) {
            let problem = Problem::new(5055, &[&displayed_path(&output)], Place::Nowhere);
            errors.push(if options.has_config_file {
                problem
            } else {
                problem.with(1, 5068, &[])
            });
        }
        let key = to_path(&output, is_case_sensitive).into_owned();
        if seen.contains(&key) {
            errors.push(Problem::new(
                5056,
                &[&displayed_path(&output)],
                Place::Nowhere,
            ));
        } else {
            seen.insert(key);
        }
    };
    for module in sources {
        let path = module.file_name();
        let is_json = module.hir.kind == FileKind::Json;
        if !options.emit_declaration_only {
            let output =
                own_emit_output_file_path(options, path, common.as_deref(), is_case_sensitive);
            // A JSON file whose output path equals its input path is not emitted.
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
    for (&e, &class) in &bound.private_class {
        if let ExprKind::Dot { name, .. } | ExprKind::PrivateIdentifier(name) =
            &mut hir.exprs[e.idx()].kind
        {
            *name = renamed(class.0, *name);
        }
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
    pub fn load(
        session: &'s Session,
        host: &dyn Host,
        options: Options,
        roots: &[Vec<u8>],
    ) -> Files<'s> {
        let arena = session.arena();
        // Nothing drops `Files`.
        let options: &'s Options = session.keep(options);
        let atoms = Interner::new_in(session);
        // Owns the paths that are only needed until every file is found. They are freed together
        // below, before the first file is checked: in `session` they would stay until the end.
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
        let mut modules: Vec<Option<Module>> = Vec::new();
        // `parseTaskData.lowestDepth`, indexed by `FoundFile::first`: the lowest number of steps
        // into packages (`increaseDepth`) that a task for the file has run at.
        let mut depths: Vec<u32> = Vec::new();
        // `taskDataByPath.LoadOrStore`
        let mut add = |path: &[u8],
                       is_lib: bool,
                       modules: &mut Vec<Option<Module>>,
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
            let of_file = file_path(path, is_case_sensitive, arena);
            let id = FileId(modules.len() as u32);
            let first = *by_path.files.entry(of_file.text).or_insert(id);
            // Of the copies of a package file, the one that `collectFiles` comes to first is in the
            // program. That is probably the one that is found first, so another one is only read
            // if it turns out to be the one, or for what its resolutions log.
            let (mut package, mut is_read) = (None, true);
            if !options.retains_duplicate_packages
                && let Some(package_id) = resolver.package_id(path)
            {
                let (index, is_first) = found.package(package_id);
                is_read = is_first
                    || options.trace_resolution
                    || found.is_collecting && found.kept[index as usize].is_none();
                package = Some(index);
            }
            modules.push(None);
            depths.push(u32::MAX);
            // Another spelling of a name is only read if `collectFiles` comes to it first.
            is_read &= first == id;
            if !is_case_sensitive {
                by_name.insert(path, id);
            }
            found.files.push(FoundFile {
                path: of_file,
                is_lib,
                package,
                first,
                is_read,
                is_loaded: false,
                named: None,
            });
            id
        };

        let mut starts: Vec<FileId> = Vec::new();
        // `processAllProgramFiles`: without root files there are no libraries and no automatic type directives.
        let has_root_files = !roots.is_empty();
        // `processingDiagnostics` of the tasks that read no file, in the order of `rootTasks`:
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
        // They have a task as well.
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
        let roots_end = starts.len();
        // `addAutomaticTypeDirectiveTasks`: the last of `rootTasks`, for this file name. There is
        // one `parseTaskData` for a path, and `collectFiles` goes on from the first of its tasks: a
        // root file or a library at this path takes the place of the directives.
        let containing_file = inside(&options.base_dir, INFERRED_TYPES_CONTAINING_FILE);
        let is_containing_file = |found: &FoundFile| {
            is_same_path(found.path.pretty, &containing_file, is_case_sensitive)
        };
        let directives = if has_root_files && !all_found.files.iter().any(is_containing_file) {
            automatic_type_directives(host, &resolver, options)
        } else {
            Vec::new()
        };
        let automatic_tracer = options.trace_resolution.then(Tracer::default);
        // `subTasks` of that task.
        let mut automatic: Vec<SubTask> = Vec::new();
        for name in &directives {
            match resolver.resolve_type_reference(
                name,
                &containing_file,
                ResolutionMode::None,
                automatic_tracer.as_ref(),
            ) {
                Some((path, is_external)) => automatic.push(SubTask {
                    file: add(&path, false, &mut modules, &mut depths, &mut all_found),
                    increases_depth: is_external,
                    is_elided_on_depth: false,
                }),
                // `*` matches whatever exists.
                None if name == b"*" => {}
                None => {
                    let reason = IncludeReason::AutomaticTypeDirectiveFile(name.clone(), None);
                    let message = Problem::new(2688, &[name], Place::Nowhere);
                    without_file.push((because(reason, b""), message));
                }
            }
        }
        starts.extend(automatic.iter().map(|task| task.file));

        // Imports that are resolved without adding the file to the program: they resolve if the
        // file is in the program for another reason.
        let mut only_found: Vec<(FileId, Atom, ResolutionMode, &[u8])> = Vec::new();
        // `processingDiagnostics` of the tasks for imported files with an extension that the
        // program does not support, each at the import: the file and the span.
        let mut unsupported: Vec<(FileId, u32, u32, Problem)> = Vec::new();
        // `singleThreadedWorkGroup.fns`: the tasks that `filesParser.start` has queued, each with
        // the `depth` it was called with. The task that is queued last runs first. With several
        // threads the original runs them in any order.
        let mut queued: Vec<(SubTask, u32)> = (starts[libs_end..roots_end].iter())
            .chain(&starts[..libs_end])
            .map(|&file| SubTask {
                file,
                increases_depth: false,
                is_elided_on_depth: false,
            })
            .chain(automatic)
            .map(|task| (task, 0))
            .collect();
        // `subTasks` of the tasks that are loaded and have not started them.
        let mut not_started: FxHashMap<FileId, Vec<SubTask>> = FxHashMap::default();
        // `subTasks` of one file. Reused for the next.
        let mut sub_tasks: Vec<SubTask> = Vec::new();
        let mut package_json_info_cache = PackageJsonInfoCache::default();
        // The last of `rootTasks` runs first.
        let mut automatic_traces = automatic_tracer
            .map(Tracer::into_traces)
            .unwrap_or_default();
        package_json_info_cache.get_package_json_infos(host, &mut automatic_traces);
        let seeds: Vec<(&[u8], bool)> = (all_found.files.iter())
            .filter(|found| found.is_read)
            .map(|found| (found.path.pretty, found.is_lib))
            .collect();
        let mut ahead: FxHashMap<&[u8], Box<Loaded>> = match seeds.is_empty() {
            true => FxHashMap::default(),
            false => Self::load_ahead(session, host, &resolver, options, &atoms, seeds),
        };
        // `Module::edges` of one file. Reused for the next.
        let mut edges: Vec<FileId> = Vec::new();
        // `Loaded::traces`, indexed by `FileId`.
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
        // The files that `collectFiles` comes to by more than one spelling of their name.
        let mut respelled: Vec<FileId> = Vec::new();
        // What `traceResolution` logs, in order.
        let mut log: Vec<DiagAndArgs> = Vec::new();
        'load: loop {
            // `singleThreadedWorkGroup.RunAndWait`: what `filesParser.start` queues for a task.
            while let Some((task, depth)) = queued.pop() {
                let is_elided = |task: SubTask, depth: u32| {
                    task.is_elided_on_depth && depth > options.max_node_module_js_depth
                };
                let data = all_found.files[task.file.idx()].first;
                let depth = depth + u32::from(task.increases_depth);
                // "If we're seeing this task at a lower depth than before, reprocess its subtasks to
                // ensure they are loaded." A task starts them once.
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
                    let is_ahead = |ahead: &FxHashMap<&[u8], Box<Loaded>>, found: &FoundFile| {
                        let loaded = ahead.get(found.path.pretty);
                        loaded.is_some_and(|loaded| loaded.module.is_lib == found.is_lib)
                    };
                    if !is_ahead(&ahead, &all_found.files[id.idx()]) {
                        // Files that could not be predicted to be part of the program: this one, and
                        // what the tasks in the queue load.
                        let mut missing: Vec<FileId> = (queued.iter())
                            .filter(|it| !is_elided(it.0, it.1 + u32::from(it.0.increases_depth)))
                            .map(|it| all_found.files[it.0.file.idx()].first)
                            .chain([*id])
                            .filter(|file| modules[file.idx()].is_none())
                            .collect();
                        missing.sort_unstable();
                        missing.dedup();
                        let missing: Vec<&FoundFile> = (missing.iter())
                            .map(|file| &all_found.files[file.idx()])
                            .filter(|&found| found.is_read && !is_ahead(&ahead, found))
                            .collect();
                        let results: Vec<Guarded<Option<Box<Loaded>>>> =
                            missing.iter().map(|_| Guarded::new(None)).collect();
                        let paths: Vec<&[u8]> = missing.iter().map(|it| it.path.pretty).collect();
                        read_and_work(host, &paths, &|at, text| {
                            *results[at].lock() = Some(Box::new(Self::load_one(
                                session.arena(),
                                host,
                                &resolver,
                                options,
                                &atoms,
                                paths[at],
                                missing[at].is_lib,
                                text,
                            )));
                        });
                        for (path, result) in paths.iter().zip(results) {
                            ahead.extend(result.lock().take().map(|loaded| (*path, loaded)));
                        }
                    }
                    let Some(loaded) = ahead.remove(path) else {
                        continue;
                    };
                    let mut loaded = *loaded;
                    let _linking = Spent::on(host, Phase::Link);
                    sub_tasks.clear();
                    for &(path, is_lib, increases_depth) in &loaded.references {
                        sub_tasks.push(SubTask {
                            file: add(path, is_lib, &mut modules, &mut depths, &mut all_found),
                            increases_depth,
                            is_elided_on_depth: false,
                        });
                    }
                    for &(start, end, path, code) in &loaded.unsupported_libs {
                        // One task loads the file, whoever else refers to it.
                        let file_name = displayed_path(path);
                        let is_about_it = |message: &Problem| message.args[0] == *file_name;
                        if !unsupported.iter().any(|it| is_about_it(&it.3))
                            && !without_file.iter().any(|it| is_about_it(&it.1))
                        {
                            let problem = reference_problem(options, code, path);
                            unsupported.push((*id, start, end, problem));
                        }
                    }
                    // The one that `load_one` created is empty, and belongs to another thread.
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
                        if let Some(code) = resolution.unsupported_extension {
                            // One task loads the file, whoever else refers to it.
                            let module = &loaded.module;
                            let of_file = module.redirect_for_resolution.unwrap_or(options);
                            let mode_of = |u: &SpecifierUse| {
                                mode_for_usage_location(of_file, module.default_mode, u)
                            };
                            let uses = module.hir.specifier_uses.iter();
                            let uses = uses.filter(|u| u.spec == spec && mode_of(u) == mode);
                            if let Some(u) = uses.min_by_key(|u| u.pos)
                                && !(unsupported.iter())
                                    .any(|it| it.3.args[0] == *displayed_path(path))
                            {
                                let end = end_of_string_literal(&module.hir.text, u.pos);
                                let problem = reference_problem(options, code, path);
                                unsupported.push((*id, u.pos, end, problem));
                            }
                            continue;
                        }
                        let file = add(path, false, &mut modules, &mut depths, &mut all_found);
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
                        });
                    }
                    edges.clear();
                    edges.extend(sub_tasks.iter().map(|task| task.file));
                    loaded.module.edges = slice_in(&edges, arena);
                    if options.trace_resolution {
                        // A library is given its `SourceFileMetaData` without a lookup.
                        if !is_lib {
                            package_json_info_cache.load_source_file_meta_data(host, path);
                        }
                        package_json_info_cache.get_package_json_infos(host, &mut loaded.traces);
                        traces.resize_with(traces.len().max(id.idx() + 1), Vec::new);
                        traces[id.idx()] = std::mem::take(&mut loaded.traces);
                    }
                    loaded.module.path = all_found.files[id.idx()].path;
                    modules[id.idx()] = Some(loaded.module);
                    // `w.start(loader, taskByFileName.subTasks, data.lowestDepth)`
                    if starts_sub_tasks {
                        queued.extend(sub_tasks.iter().map(|&task| (task, depth)));
                    } else {
                        not_started.insert(*id, std::mem::take(&mut sub_tasks));
                    }
                }
            }
            // `collectFiles`, as far as it decides which copy of a package file is in the program and
            // logs. `declaration_order` puts the files in order.
            all_found.is_collecting = true;
            seen.resize(modules.len(), false);
            traces.resize_with(modules.len(), Vec::new);
            loop {
                let file = match stack.last_mut() {
                    Some(top) => {
                        // Sub tasks that have not been started are not loaded.
                        let has_started = !not_started.contains_key(&top.0);
                        let module = modules[top.0.idx()].as_ref().filter(|_| has_started);
                        let edges = module.map_or(&[][..], |it| it.edges);
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
                    mut package,
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
                // "Propagate packageId to data if we have one and data doesn't yet": the first task
                // for the file may have none, a root file for one.
                if package.is_none()
                    && !options.retains_duplicate_packages
                    && let Some(package_id) = resolver.package_id(path)
                {
                    package = Some(all_found.package(package_id).0);
                    all_found.files[file.idx()].package = package;
                }
                if let Some(package) = package {
                    let kept = *all_found.kept[package as usize].get_or_insert(file);
                    if kept != file {
                        seen[file.idx()] = true;
                        redirects.push((file, kept));
                        package_copies.push((path, kept));
                        log.append(&mut traces[file.idx()]);
                        continue;
                    }
                }
                if modules[file.idx()].is_none() {
                    // It is the one after all. The step is taken again when it has been read: its
                    // task runs once more, as for the first time.
                    match stack.last_mut() {
                        Some(top) => top.1 -= 1,
                        None => next_root_task -= 1,
                    }
                    all_found.files[file.idx()].is_read = true;
                    let task = SubTask {
                        file,
                        increases_depth: false,
                        is_elided_on_depth: false,
                    };
                    queued.push((task, std::mem::replace(&mut depths[first.idx()], u32::MAX)));
                    continue 'load;
                }
                seen[file.idx()] = true;
                log.append(&mut traces[file.idx()]);
                stack.push((file, 0));
            }
        }
        drop(by_name);
        for file in not_started.into_keys() {
            if let Some(module) = &mut modules[file.idx()] {
                module.edges = &[];
            }
        }
        // A spelling that `collectFiles` has not come to is one of the file all the same.
        for (task, found) in all_found.files.iter().enumerate() {
            if let Some(named) = all_found.files[found.first.idx()].named
                && named.idx() != task
                && !std::mem::replace(&mut seen[task], true)
            {
                redirects.push((FileId(task as u32), named));
            }
        }
        respelled.sort_unstable();
        respelled.dedup();
        // Only the files that `collectFiles` came to are in the program, and of a package file only
        // one copy. The paths of the other copies stand for that one.
        if !redirects.is_empty() || !seen.iter().all(|&is_seen| is_seen) {
            let mut is_kept = seen;
            for &(copy, _) in &redirects {
                is_kept[copy.idx()] = false;
            }
            let mut renumbered: Vec<Option<FileId>> = vec![None; modules.len()];
            let kept = (0..modules.len()).filter(|&file| is_kept[file]);
            for (new, old) in kept.enumerate() {
                renumbered[old] = Some(FileId(new as u32));
            }
            for &(copy, kept) in &redirects {
                renumbered[copy.idx()] = renumbered[kept.idx()];
                // `lowestDepth` belongs to the path, however it is spelled. A copy of a package
                // file has its own.
                depths[kept.idx()] = depths[all_found.files[kept.idx()].first.idx()];
            }
            let renumber = |file: FileId| renumbered[file.idx()].unwrap_or(file);
            let mut file = 0;
            modules.retain_mut(|module| {
                file += 1;
                if let Some(module) = module.as_mut().filter(|_| is_kept[file - 1]) {
                    // A task that is elided loads nothing.
                    edges.clear();
                    edges.extend(
                        module
                            .edges
                            .iter()
                            .filter_map(|edge| renumbered[edge.idx()]),
                    );
                    module.edges = slice_in(&edges, arena);
                    (module.imports).retain(|_, target| match renumbered[target.idx()] {
                        Some(new) => {
                            *target = new;
                            true
                        }
                        None => false,
                    });
                }
                is_kept[file - 1]
            });
            let mut file = 0;
            depths.retain(|_| {
                file += 1;
                is_kept[file - 1]
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
                let is_in_program = is_kept[file.idx()];
                *file = renumber(*file);
                is_in_program
            });
            unsupported.retain_mut(|(file, ..)| {
                let is_in_program = is_kept[file.idx()];
                *file = renumber(*file);
                is_in_program
            });
            for start in &mut starts {
                *start = renumber(*start);
            }
        }
        // `pathForLibFileResolutions`, in the order of its keys.
        let mut lib_traces = Vec::new();
        if options.trace_resolution && options.lib_replacement && has_root_files {
            let mut libs: Vec<Vec<u8>> = (options.libs.iter())
                .map(|lib| lib_file_stem(lib).to_vec())
                .collect();
            for module in modules.iter().flatten().filter(|_| !options.no_lib) {
                for &(kind, value, ..) in &module.hir.references {
                    if kind != ReferenceKind::Lib {
                        continue;
                    }
                    libs.extend(referenced_lib(host, options, atoms.bytes(value)));
                }
            }
            let mut lookups: Vec<_> = (libs.iter())
                .filter(|lib| !lib.is_empty())
                .map(|lib| library_name_and_resolve_from(options, lib))
                .map(|(name, from)| {
                    let path = to_path(&from, host.is_case_sensitive()).into_owned();
                    (path, name, from)
                })
                .collect();
            lookups.sort();
            lookups.dedup();
            let tracer = Tracer::default();
            for (_, name, from) in &lookups {
                resolver.resolve_module_name_traced(
                    name,
                    from,
                    ResolutionMode::Require,
                    Some(&tracer),
                );
            }
            lib_traces = tracer.into_traces();
        }
        for (module, &depth) in modules.iter_mut().flatten().zip(&depths) {
            module.is_from_external_library = depth > 0;
        }
        program_errors.extend(resolver.resolution_problems());
        for (id, spec, mode, path) in only_found {
            if let Some(target) = by_path.get(path)
                && let Some(module) = &mut modules[id.idx()]
            {
                module.imports.insert((spec, mode), target);
            }
        }
        // A name of the source that each declaration file is read in place of.
        let mut redirected_from: FxHashMap<FileId, Atom> = FxHashMap::default();
        for (&start, &root) in starts[libs_end..roots_end].iter().zip(&root_of_start) {
            let root = &roots[root as usize];
            if options.parse_file_redirect(root).is_some() {
                redirected_from.insert(start, atoms.intern(root));
            }
        }
        // The task of a source has a `seen[data]` of its own: a second spelling of its name.
        let mut redirect = |source: Atom, target: FileId| {
            if *redirected_from.entry(target).or_insert(source) != source
                && !respelled.contains(&target)
            {
                respelled.push(target);
            }
        };
        let has_redirects = !options.referenced_sources.is_empty() && !options.no_resolve;
        for module in modules.iter().flatten().filter(|_| has_redirects) {
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
        // `GetSourceFileForResolvedModule`: an import of a source of a referenced project finds the
        // declaration file, if that is in the program.
        for module in modules.iter_mut().flatten() {
            if module.unbuilt_imports.is_empty() {
                continue;
            }
            let of_references = module.unbuilt_imports.iter().copied();
            let (built, unbuilt): (Vec<_>, Vec<_>) =
                of_references.partition(|it| module.imports.contains_key(&(it.0, it.1)));
            for &(spec, mode, _, source) in &built {
                redirect(source, module.imports[&(spec, mode)]);
            }
            let resolved_file_names = built.into_iter().map(|it| (it.0, it.1, it.3));
            module.redirected_imports = few(resolved_file_names.collect(), arena);
            module.unbuilt_imports = few(unbuilt, arena);
        }
        for (target, source) in redirected_from {
            if let Some(module) = &mut modules[target.idx()] {
                module.project_reference_source = source;
            }
        }

        // `redirectFilesByPath`: the paths that alias a file that is stored under another path.
        let kept: FxHashSet<FileId> = package_copies.iter().map(|it| it.1).collect();
        if !kept.is_empty() {
            for module in modules.iter_mut().flatten() {
                let mut redirected = module.redirected_imports.to_vec();
                for (&(spec, mode), target) in &module.imports {
                    let (resolver, from) = resolver.redirect_for_resolution(module.file_name());
                    if kept.contains(target)
                        && let Some(found) =
                            resolver.resolve_module_name(atoms.bytes(spec), from, mode)
                        && package_copies.iter().any(|it| it.0 == found.file_name)
                    {
                        redirected.push((spec, mode, atoms.intern(found.file_name)));
                    }
                }
                module.redirected_imports = few(redirected, arena);
            }
        }
        let mut redirect_targets: ArenaHashMap<'s, FileId, &'s [&'s [u8]]> = map_in(arena);
        if !kept.is_empty() {
            let mut duplicates: FxHashMap<FileId, Vec<&'s [u8]>> = FxHashMap::default();
            for &(path, id) in &package_copies {
                duplicates.entry(id).or_default().push(path);
            }
            for (id, mut paths) in duplicates {
                paths.sort();
                redirect_targets.insert(id, slice_in(&paths, arena));
            }
        }
        let mut package_jsons: FxHashMap<&'s [u8], Json> = FxHashMap::default();
        for module in modules.iter().flatten() {
            let path: &'s [u8] = module.file_name();
            if let Some((_, _, end)) = crate::resolve::node_module_path_parts(path)
                && !package_jsons.contains_key(&path[..end])
                && let Some(json) = resolver.package_json(&path[..end])
            {
                package_jsons.insert(&path[..end], json);
            }
        }
        let mut linked_directories: &'s [(&'s [u8], &'s [u8])] = &[];
        let emitted = (modules.iter().flatten())
            .filter(|module| source_file_may_be_emitted(options, module, is_case_sensitive));
        let found = resolver.linked_directories(emitted.map(|module| module.file_name()));
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
        let (directories, jsons): (Vec<&'s [u8]>, Vec<Json>) = package_jsons.into_iter().unzip();
        let mut package_jsons: ArenaHashMap<'s, &'s [u8], &'s Json> = map_in(arena);
        package_jsons.extend(directories.into_iter().zip(session.keep(jsons)));
        // Files that were predicted to be part of the program and are not.
        drop(ahead);
        drop(resolver);
        drop(resolving);
        let mut modules: ArenaVec<'s, ModuleCell<'s>> = vec_from_iter_in(
            (modules.into_iter()).map(|module| ModuleCell(module.unwrap().into())),
            arena,
        );
        keep_lists(session, &mut modules, |hir| &mut hir.text);
        keep_lists(session, &mut modules, |hir| &mut hir.diagnostics);
        keep_lists(session, &mut modules, |hir| &mut hir.jsdoc_member_comments);
        keep_lists(session, &mut modules, |hir| &mut hir.jsdoc_param_errors);
        // The merge adds symbols, on this thread. No other list of a module grows from here on.
        for module in &mut modules {
            transfer_arena(&mut module.bound.symbols, arena);
            transfer_arena(&mut module.transient_symbols, arena);
        }
        if options.drops_unreferenced {
            let mut is_referred_to = vec![false; modules.len()];
            // `Files::new_symbol`: the symbols that no file declares are stored with those of the
            // first file, which must therefore be retained.
            is_referred_to.iter_mut().take(1).for_each(|it| *it = true);
            for module in &modules {
                for &target in module.edges.iter().chain(module.imports.values()) {
                    is_referred_to[target.idx()] = true;
                }
            }
            // The ambient modules with `export .. from "./relative"` (2439). What else is reported
            // there depends on who imports from them (`Checker::modules_is_imported_by_name`).
            let is_relative_name = |spec: Atom| spec.is_some() && is_relative(atoms.bytes(spec));
            let mut with_relative_names: Vec<Atom> = Vec::new();
            for module in &modules {
                let hir = &module.hir;
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
                        with_relative_names.push(name);
                    }
                }
            }
            for (i, module) in modules.iter_mut().enumerate() {
                // `getAlternativeContainingModules` searches the exports of every module of the
                // program for a symbol.
                let hir = &module.hir;
                let is_alternative_container = options.emits_declarations
                    && hir.stmts.iter().any(|statement| match statement.kind {
                        StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => true,
                        StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                            expression_is_alias(hir, e)
                        }
                        StmtKind::ImportEquals(it) => hir[it].flags.contains(Flags::EXPORT),
                        _ => false,
                    });
                let is_one = |spec: Atom| with_relative_names.contains(&spec);
                let imports_from_one = !with_relative_names.is_empty()
                    && (module.hir.imports.iter().any(|it| is_one(it.spec))
                        || module.hir.exports.iter().any(|it| is_one(it.spec)));
                // `checkExternalModuleExports` for a file with an `export *` reports in other files,
                // which look for such a file (`Checker::is_export_of_file_checked_before`).
                module.is_leaf = module.adds_nothing
                    && !is_referred_to[i]
                    && !is_alternative_container
                    && !imports_from_one
                    && module.bound.export_stars.is_empty();
            }
        }
        // `tasksSeenByNameIgnoreCase`: only where they are different files.
        let mut alike: Vec<Vec<(&[u8], FileId)>> = Vec::new();
        let no_file = FileId(modules.len() as u32);
        let is_respelled = |(i, a): (usize, &&[u8])| {
            let mut before = missing_roots[..i].iter();
            before.any(|b| a != b && is_same_path(a, b, is_case_sensitive))
        };
        if missing_roots.iter().enumerate().any(is_respelled) {
            respelled.push(no_file);
        }
        if is_case_sensitive {
            let hash = |name: &[u8]| match name.is_ascii() {
                true => bun_wyhash::hash_ascii_lowercase(0, name),
                false => bun_wyhash::hash_ascii_lowercase(0, &to_file_name_lower_case(name)),
            };
            let names = || {
                let kept = modules.iter().enumerate();
                let kept = kept.map(|(i, module)| (module.file_name(), FileId(i as u32)));
                let missing = missing_roots.iter().map(|&name| (name, no_file));
                kept.chain(package_copies.iter().copied()).chain(missing)
            };
            let mut hashes: FxHashSet<u64> = FxHashSet::default();
            hashes.reserve(modules.len());
            let repeated: FxHashSet<u64> = (names().map(|it| hash(it.0)))
                .filter(|&hash| !hashes.insert(hash))
                .collect();
            if !repeated.is_empty() {
                let mut by_lower_case: FxHashMap<Vec<u8>, Vec<(&[u8], FileId)>> =
                    FxHashMap::default();
                for (name, file) in names().filter(|it| repeated.contains(&hash(it.0))) {
                    let names = by_lower_case.entry(to_file_name_lower_case(name));
                    names.or_default().push((name, file));
                }
                alike.extend(by_lower_case.into_values().filter(|names| names.len() > 1));
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
        };
        // None of their reasons is a reference in a file.
        let explained = included.explain_tasks_without_file(&without_file);
        let mut program_errors: Vec<Problem> = (explained.into_iter())
            .map(|explanation| explanation.1)
            .chain(program_errors)
            .collect();
        let (output_path_errors, common_source_directory) =
            output_path_errors(&included, &mut include_errors);
        program_errors.extend(output_path_errors);
        for (at, problem) in included.file_casing_errors(&respelled, &alike) {
            match at {
                Some((file, start, end)) => include_errors.push((file, start, end, problem)),
                None => program_errors.push(problem),
            }
        }
        let has_type_only_stars = modules.iter().any(|m| {
            m.bound.export_stars.iter().any(|&(_, star)| {
                matches!(
                    m.hir[star].kind,
                    StmtKind::ExportStar {
                        type_only: true,
                        ..
                    }
                )
            })
        });
        let symbols = Bases::new_in(modules.iter().map(|m| m.bound.symbols.len()), &session);
        let memo = Memo::new_in(&Bases::new_in(modules.iter().map(|_| 0), &session), session);
        let mut files = Files {
            session,
            arena,
            atoms,
            options,
            modules,
            by_path,
            globals: SymbolMap::new_in(arena),
            global_this_symbol: Sym {
                file: FileId(0),
                id: SymbolId::NONE,
            },
            undefined_symbol: Sym {
                file: FileId(0),
                id: SymbolId::NONE,
            },
            unknown_symbol: Sym {
                file: FileId(0),
                id: SymbolId::NONE,
            },
            common_source_directory: common_source_directory
                .map(|it| &*arena.alloc_slice_copy(&it)),
            is_case_sensitive: host.is_case_sensitive(),
            prototype_symbol: Sym {
                file: FileId(0),
                id: SymbolId::NONE,
            },
            ambient_modules: map_in(arena),
            ambient_patterns: ArenaVec::new_in(arena),
            pattern_augmentations: map_in(arena),
            merged_symbols: map_in(arena),
            merged_parts: map_in(arena),
            stand_ins: ArenaVec::new_in(arena),
            refused_exports: set_in(arena),
            merged_exports: map_in(arena),
            merged_members: map_in(arena),
            refused_merges: ArenaVec::new_in(arena),
            augmentations_of_non_modules: ArenaVec::new_in(arena),
            files_of_refused_merges: set_in(arena),
            circular_at_merge: ArenaVec::new_in(arena),
            resolved_at_merge: ArenaVec::new_in(arena),
            module_links_at_merge: Guarded::new(ArenaVec::new_in(arena)),
            modules_resolved_at_merge: &[],
            keeps_module_links: false,
            modules_with_nested_export_collisions: &[],
            parents_in_other_files: map_in(arena),

            has_type_only_stars,
            alias_symbol_links: ByNodeIndirect::new_in(&symbols, session),
            is_linked: false,
            no_module_links: ModuleSymbolLinks::empty_in(arena),
            is_merged: false,
            memo,
            order: &[],
            ranks: &[],
            components: Components::EMPTY,
            global_types: &[],
            program_errors: session.keep(program_errors),
            include_errors: session.keep(include_errors),
            package_jsons,
            linked_directories,
            redirect_targets,
            resolution_trace: &[],
            starts: slice_in(&starts, arena),
            libs_end,
            roots_end,
            root_of_start: slice_in(&root_of_start, arena),
            package_copies: slice_in(&package_copies, arena),
        };
        let merging = Spent::on(host, Phase::Merge);
        files.order = slice_in(&files.declaration_order(&starts), arena);
        if options.trace_resolution {
            package_json_info_cache.get_package_json_infos(host, &mut lib_traces);
            let mut all = log;
            all.extend(lib_traces);
            files.resolution_trace = session.keep(all);
        }
        let ranks = arena.alloc_slice_fill_copy(files.modules.len(), u32::MAX);
        for (rank, &file) in files.order.iter().enumerate() {
            ranks[file.idx()] = rank as u32;
        }
        files.ranks = ranks;
        let imports = |file: FileId| -> Vec<FileId> {
            let module = &files.modules[file.idx()];
            (module.edges.iter().chain(module.imports.values()).copied()).collect()
        };
        files.components = Components::new(files.order, &imports, arena);
        files.merge();
        drop(merging);
        let linking = Spent::on(host, Phase::Aliases);
        files.link(host);
        drop(linking);
        let known_names = (0..known::sym_iterator.0).map(Atom);
        files.global_types =
            arena.alloc_slice_fill_iter(known_names.map(|name| files.global_type(name)));
        files
    }

    /// Loads `seeds` (path, whether it is a lib) and every file that can be predicted from them to
    /// be part of the program, each file as soon as a reference to it is seen. The id a file gets,
    /// and which of two copies of the same package is used, depend on the order in which files
    /// refer to each other. That order is traversed afterwards, with all of these files already
    /// loaded.
    fn load_ahead<'r>(
        session: &'s Session,
        host: &dyn Host,
        resolver: &Resolver<'r>,
        options: &'s Options,
        atoms: &Interner<'s>,
        seeds: Vec<(&'r [u8], bool)>,
    ) -> FxHashMap<&'r [u8], Box<Loaded<'s, 'r>>> {
        /// Adjacent paths are in the same directory.
        const RUN: usize = 16;
        /// Contents that have been read occupy memory until they are processed.
        const AHEAD: usize = 256;
        struct Shared<'s, 'r> {
            to_read: std::collections::VecDeque<(&'r [u8], bool)>,
            ready: Vec<((&'r [u8], bool), Cow<'static, [u8]>)>,
            seen: FxHashSet<&'r [u8]>,
            seen_packages: FxHashSet<Vec<u8>>,
            /// Taken from `to_read` and not in `done` yet.
            in_progress: usize,
            done: FxHashMap<&'r [u8], Box<Loaded<'s, 'r>>>,
        }
        let shared = Guarded::new(Shared {
            seen: seeds.iter().map(|seed| seed.0).collect(),
            to_read: seeds.into(),
            ready: Vec::new(),
            seen_packages: FxHashSet::default(),
            in_progress: 0,
            done: FxHashMap::default(),
        });
        let has_changed = bun_threading::Condvar::new();
        // What a thread that only reads waits for: it has no use for a file that is ready.
        let has_to_read = bun_threading::Condvar::new();
        let load = |reads: bool, processes: bool| {
            // A thread that only reads allocates nothing for the session, so it gets no arena.
            let mut arena = None;
            let mut state = shared.lock();
            loop {
                if reads && !state.to_read.is_empty() && state.ready.len() <= AHEAD {
                    let count = state.to_read.len().min(RUN);
                    let run: Vec<_> = state.to_read.drain(..count).collect();
                    state.in_progress += count;
                    drop(state);
                    for file in run {
                        let text = host.read_source(file.0);
                        shared.lock().ready.push((file, text));
                        has_changed.notify_one();
                    }
                    state = shared.lock();
                } else if processes && let Some(((path, is_lib), text)) = state.ready.pop() {
                    let has_room_again = state.ready.len() == AHEAD;
                    drop(state);
                    if has_room_again {
                        has_to_read.notify_all();
                    }
                    let arena = *arena.get_or_insert_with(|| session.arena());
                    let loaded = Box::new(Self::load_one(
                        arena, host, resolver, options, atoms, path, is_lib, text,
                    ));
                    // The sub tasks, except for whatever depends on a file's depth in packages.
                    let found = loaded
                        .references
                        .iter()
                        .map(|&(path, is_lib, _)| (path, is_lib))
                        .chain(
                            loaded
                                .imports
                                .iter()
                                .filter(|it| {
                                    it.should_add_file
                                        && it.unsupported_extension.is_none()
                                        && !(is_javascript_file(host, it.path)
                                            && strings::contains(it.path, b"/node_modules/"))
                                })
                                .map(|it| (it.path, false)),
                        );
                    let found: Vec<(&'r [u8], bool, Option<Vec<u8>>)> = found
                        .map(|(path, is_lib)| (path, is_lib, resolver.package_id(path)))
                        .collect();
                    state = shared.lock();
                    let before = state.to_read.len();
                    for (path, is_lib, package) in found {
                        if !state.seen.contains(path)
                            && package.is_none_or(|package| state.seen_packages.insert(package))
                        {
                            state.seen.insert(path);
                            state.to_read.push_back((path, is_lib));
                        }
                    }
                    let has_more = state.to_read.len() > before;
                    state.done.insert(path, loaded);
                    state.in_progress -= 1;
                    if has_more || state.in_progress == 0 {
                        has_to_read.notify_all();
                    }
                    if has_more && reads || state.in_progress == 0 {
                        has_changed.notify_all();
                    }
                } else if state.in_progress == 0 && state.to_read.is_empty() {
                    has_changed.notify_all();
                    has_to_read.notify_all();
                    return;
                } else if processes {
                    has_changed.wait_guarded(&mut state);
                } else {
                    has_to_read.wait_guarded(&mut state);
                }
            }
        };
        let threads = host.threads();
        match host.io_pool() {
            Some(io) => {
                let _alone = WAITS_ACROSS_POOLS.lock();
                io.each_while(
                    (),
                    |(), (), _| load(true, false),
                    &mut vec![(); io.max_threads()],
                    || host.parallel(threads, &|_| load(false, true)),
                );
            }
            // Any one of these finishes the load by itself.
            None => host.parallel(threads, &|_| load(true, true)),
        }
        std::mem::take(&mut shared.lock().done)
    }

    /// Everything that depends on the file alone.
    fn parse_and_bind(
        arena: &'s Arena,
        host: &dyn Host,
        options: &Options,
        atoms: &Interner<'s>,
        path: &[u8],
        is_lib: bool,
        specifies_esm: bool,
        text: Cow<'static, [u8]>,
    ) -> (hir::File<'s>, Bound<'s>) {
        let mut hir = host.parse(arena, path, &text, atoms, options);
        // The source text of TypeScript's own libraries is only consulted where they are checked.
        // With `libReplacement` a library can be any file.
        if !is_lib
            || options.lib_replacement
            || !(options.skip_lib_check || options.skip_default_lib_check)
        {
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
            let is_shown = has_import_meta
                || options.module_detection == ModuleDetection::Auto
                    && has_jsx
                    && matches!(options.jsx, JsxEmit::ReactJsx | JsxEmit::ReactJsxDev);
            // `moduleDetection: force`, `isFileForcedToBeModuleByFormat`: the file itself is the
            // external module indicator.
            let is_decreed = match options.module_detection {
                ModuleDetection::Force => true,
                ModuleDetection::Legacy => false,
                ModuleDetection::Auto => {
                    specifies_esm || format_by_extension(path) != ResolutionMode::None
                }
            };
            hir.has_module_syntax = is_shown || is_decreed;
            hir.is_module_by_decree = !is_shown && is_decreed;
        }
        // `GetEmitScriptTarget`: an unspecified target means the latest.
        let is_before =
            |target: ScriptTarget| options.target != ScriptTarget::None && options.target < target;
        let _binding = Spent::on(host, Phase::Bind);
        let bind_options = bind::BindOptions {
            emit_standard_class_fields: options.emit_standard_class_fields,
            before_es2020: is_before(ScriptTarget::ES2020),
            before_es2017: is_before(ScriptTarget::ES2017),
        };
        let mut bound = bind::bind(&hir, bind_options, atoms, arena);
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
            bound = bind::bind(&hir, bind_options, atoms, arena);
        }
        rename_private_names(&mut hir, &bound, atoms, path);
        (hir, bound)
    }

    /// Frees the HIR of `file`, which `is_leaf`. Its text is retained for the report.
    ///
    /// # Safety
    /// Only the task that checks `file` calls it, at the end of the task: an entry of its buffer
    /// can hold a value that is bound to an earlier file of the task. No reference into `hir` or
    /// `bound` of the file is alive.
    pub unsafe fn free_tree(&self, file: FileId) {
        let cell = &self.modules[file.idx()];
        debug_assert!(cell.is_leaf);
        // SAFETY: no file refers to it, so no other task reads its HIR.
        let module = unsafe { &mut *cell.0.get() };
        module.hir = stub_of(&mut module.hir);
        module.bound = Bound::empty_in(module.hir.arena());
        module.transient_symbols.clear();
    }

    fn load_one<'r>(
        arena: &'s Arena,
        host: &dyn Host,
        resolver: &Resolver<'r>,
        options: &'s Options,
        atoms: &Interner<'s>,
        path: &[u8],
        is_lib: bool,
        text: Cow<'static, [u8]>,
    ) -> Loaded<'s, 'r> {
        // `GetImpliedNodeFormatForFile`: a JSON file is neither kind of module, regardless of its
        // package.
        let specifies_esm = !path.ends_with(b".json")
            && (options.resolves_like_node || strings::contains(path, b"/node_modules/"))
            && resolver.is_ecmascript_module(path);
        let is_esm = options.resolves_like_node && specifies_esm;
        let package_json_without_type =
            if matches!(options.module, ModuleKind::Node16 | ModuleKind::Node18) {
                resolver
                    .package_json_without_type(path)
                    .map_or(Atom::NONE, |found| atoms.intern(&found))
            } else {
                Atom::NONE
            };
        let (hir, bound) = Self::parse_and_bind(
            arena,
            host,
            options,
            atoms,
            path,
            is_lib,
            specifies_esm,
            text,
        );
        let _resolving = Spent::on(host, Phase::Resolve);
        // `optionsForFile`. Program-wide diagnostics still use the options of the program.
        let (of_program, program_resolver) = (options, resolver);
        let (resolver, from) = resolver.redirect_for_resolution(path);
        let options = resolver.options();
        let mut referenced = of_program.referenced_options.iter();
        let redirect_for_resolution = referenced.find(|&it| std::ptr::eq(it, options));
        let implied_format = implied_node_format_for_emit(program_resolver, path, options.module);
        let default_mode = options.default_mode(implied_format);
        let mut extensionless_imports = Vec::new();
        // `moduleNames`, each with the mode it is resolved in, and whether it is a synthetic import
        // or one of `file.Imports()`: a module augmentation adds no file to the program.
        let mut module_names: Vec<(Atom, ResolutionMode, bool)> = Vec::new();
        if imports_helpers(options, &hir) {
            module_names.push((known::tslib, default_mode, true));
        }
        // Interned whether or not it resolves: the checker passes it to `module_of_specifier`,
        // which only accepts published atoms.
        let runtime = jsx_runtime_of(options, &hir, atoms);
        let runtime = runtime.map(|runtime| (atoms.intern(&runtime), runtime));
        // Only a file that can contain JSX tags, according to its file name, imports their runtime.
        let runtime = runtime.filter(|_| path.ends_with(b".tsx") || path.ends_with(b".jsx"));
        // Each entry of `moduleNames` is resolved, also one that repeats another.
        let (types_tracer, tracer) = (Tracer::default(), Tracer::default());
        if of_program.trace_resolution {
            let trace = |name: &[u8], mode: ResolutionMode| {
                if !name.is_empty() {
                    resolver.resolve_module_name_traced(name, from, mode, Some(&tracer));
                }
            };
            if imports_helpers(options, &hir) {
                trace(b"tslib", default_mode);
            }
            if let Some((_, runtime)) = &runtime {
                trace(runtime, default_mode);
            }
            // `collectModuleReferences`
            let is_import = |u: &&SpecifierUse| {
                bound.specifiers.contains(&u.spec)
                    || bound.ambient_specifiers.contains(&u.spec)
                        && !is_relative(atoms.bytes(u.spec))
            };
            let statements = hir.specifier_uses.iter().filter(|u| !u.kind.is_dynamic());
            let mut statements: Vec<&SpecifierUse> = statements.collect();
            statements.sort_by_key(|u| u.pos);
            let uses = statements.into_iter().chain(dynamic_imports(&hir));
            for u in uses.filter(is_import) {
                let mode = mode_for_usage_location(options, default_mode, u);
                trace(atoms.bytes(u.spec), mode);
            }
            // `getModuleNames`: nothing is resolved for `declare global`.
            for augmentation in module_augmentations(&hir, atoms) {
                if let ModuleName::String(name) = hir[augmentation].name {
                    trace(atoms.bytes(name), default_mode);
                }
            }
        }
        if let Some((spec, _)) = runtime {
            module_names.push((spec, default_mode, true));
        }
        // `file.Imports()`, then `file.ModuleAugmentations`: each with its place there. The
        // specifiers of statements come before those of `import()`, the call and the type.
        const AFTER_IMPORTS: (bool, u32) = (true, u32::MAX);
        let mut written: Vec<((bool, u32), (Atom, ResolutionMode, bool))> = Vec::new();
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
            let text = atoms.bytes(spec);
            // `isExtensionlessRelativePathImport`. `HasExtension` uses `GetBaseFileName`, which
            // ignores one trailing slash.
            let base = text.strip_suffix(b"/").unwrap_or(text);
            let base = &base[strings::last_index_of_char(base, b'/').map_or(0, |i| i + 1)..];
            if options.resolves_like_node
                && (text.starts_with(b"./") || text.starts_with(b"../"))
                && !strings::contains_char(base, b'.')
            {
                let stem = join(dirname::<Posix>(path), text);
                // `getSuggestedImportExtension`
                let for_tsx: &[u8] = if options.jsx == JsxEmit::Preserve {
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
                extensionless_imports.push((spec, suggested.map(|found| found.1)));
            }
            // It is resolved in each mode that a use in the file requests. With each mode, where
            // the first use in it is in `file.Imports()`.
            let mut modes = [(default_mode, AFTER_IMPORTS); 3];
            let mut count = 0;
            for u in hir.specifier_uses.iter().filter(|u| u.spec == spec) {
                let mode = mode_for_usage_location(options, default_mode, u);
                let place = (u.kind.is_dynamic(), u.pos);
                match modes[..count].iter_mut().find(|known| known.0 == mode) {
                    Some(known) => known.1 = known.1.min(place),
                    None => {
                        modes[count] = (mode, place);
                        count += 1;
                    }
                }
            }
            let imported = count;
            // A module augmentation resolves the module the way the file itself would, regardless
            // of other uses of the specifier. It does not add the file to the program.
            let is_module_name = bound.ambient_modules.iter().any(|m| m.0 == spec);
            if (count == 0 || is_module_name && hir.has_module_syntax)
                && !modes[..count].iter().any(|known| known.0 == default_mode)
            {
                modes[count] = (default_mode, AFTER_IMPORTS);
                count += 1;
            }
            for (i, &(mode, place)) in modes[..count].iter().enumerate() {
                written.push((place, (spec, mode, i < imported || !is_module_name)));
            }
        }
        written.sort_by_key(|name| name.0);
        module_names.extend(written.into_iter().map(|name| name.1));
        let mut imports = Vec::new();
        let (mut untyped_imports, mut untyped_import_files) = (Vec::new(), Vec::new());
        let mut untyped_import_alternates = Vec::new();
        let mut resolved_packages: Vec<(Atom, bool)> = Vec::new();
        let (mut jsx_imports, mut json_imports) = (Vec::new(), Vec::new());
        let (mut arbitrary_extension_imports, mut arbitrary_extension_files) =
            (Vec::new(), Vec::new());
        let (mut ts_extension_imports, mut project_reference_imports) = (Vec::new(), Vec::new());
        let mut unbuilt_imports = Vec::new();
        for (spec, mode, is_import) in module_names {
            let text = atoms.bytes(spec);
            if text.is_empty() {
                continue;
            }
            let Some(resolved) = resolver.resolve_module_name(text, from, mode) else {
                continue;
            };
            let (key, found) = ((spec, mode), resolved.file_name);
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
            // `resolveExternalModule` asks with the options of the program.
            let diagnostic = get_resolution_diagnostic(of_program, extension, &hir);
            match diagnostic {
                Some(6142) => jsx_imports.push((spec, mode, atoms.intern(found))),
                Some(7042) => json_imports.push((spec, mode, atoms.intern(found))),
                Some(6263) => {
                    arbitrary_extension_imports.push(key);
                    arbitrary_extension_files.push(atoms.intern(found));
                }
                _ => {}
            }
            // "Don't treat redirected files as JS files."
            let is_js_file = is_javascript && !of_program.is_source_of_referenced_project(found);
            let should_add_file = is_import
                && get_resolution_diagnostic(options, extension, &hir).is_none()
                && !options.no_resolve
                && !(is_js_file && !options.allow_js);
            // `parseTask.load`: the declaration file is read in place of a source of a referenced
            // project. Any other file needs an extension that the program supports.
            let redirect = of_program.parse_file_redirect(found);
            if let Some(output) = redirect {
                let source = atoms.intern(found);
                unbuilt_imports.push((spec, mode, atoms.intern(output), source));
            }
            let unsupported_extension = if should_add_file && redirect.is_none() {
                unsupported_extension_error(of_program, found, host.is_case_sensitive())
                    .filter(|_| host.script_kind(found).is_none())
            } else {
                None
            };
            imports.push(Resolution {
                spec,
                mode,
                path: redirect.map_or(found, |output| resolver.keep(output)),
                should_add_file: should_add_file
                    && redirect.is_none_or(|output| host.is_file(output)),
                increases_depth: resolved.is_external_library_import,
                is_importable: matches!(diagnostic, None | Some(6142)),
                unsupported_extension,
            });
        }
        // They are processed by kind: paths, then types, then libraries.
        let (mut references, mut types, mut libs) = (Vec::new(), Vec::new(), Vec::new());
        let (mut missing_references, mut unsupported_libs) = (Vec::new(), Vec::new());
        for &(kind, value, pos, mode) in &hir.references {
            // `noResolve`: only library references are still processed.
            if of_program.no_resolve && matches!(kind, ReferenceKind::Path | ReferenceKind::Types) {
                continue;
            }
            let value = atoms.bytes(value);
            match kind {
                ReferenceKind::Path => {
                    match referenced_file(host, of_program, &referenced_path(value, path), path) {
                        Ok(found) => match of_program.parse_file_redirect(&found) {
                            Some(output) if host.is_file(output) => {
                                references.push((resolver.keep(output), false, false));
                            }
                            Some(_) => {}
                            None => references.push((resolver.keep(&found), false, false)),
                        },
                        Err(code) => missing_references.push((pos, code)),
                    }
                }
                ReferenceKind::Lib => {
                    if of_program.no_lib {
                        continue;
                    }
                    match referenced_lib(host, of_program, value) {
                        Some(lib) => {
                            let found = lib_path(program_resolver, of_program, &lib);
                            let found = resolver.keep(&found);
                            match unsupported_extension_of_lib(host, of_program, found) {
                                Some(code) => {
                                    let end = pos + value.len() as u32;
                                    unsupported_libs.push((pos, end, found, code));
                                }
                                None => libs.push((found, true, false)),
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
                    match resolver.resolve_type_reference(
                        value,
                        from,
                        mode,
                        of_program.trace_resolution.then_some(&types_tracer),
                    ) {
                        Some((found, is_external)) => {
                            types.push((resolver.keep(&found), false, is_external));
                        }
                        None => missing_references.push((pos, 2688)),
                    }
                }
            }
        }
        references.extend(types);
        references.extend(libs);
        let module = Module {
            hir,
            bound,
            is_lib,
            // `load` fills `path`, `imports` and `edges`.
            path: Path::init(b""),
            imports: map_in(arena),
            untyped_imports: few(untyped_imports, arena),
            untyped_import_files: few(untyped_import_files, arena),
            resolved_packages: few(resolved_packages, arena),
            untyped_import_alternates: few(untyped_import_alternates, arena),
            jsx_imports: few(jsx_imports, arena),
            json_imports: few(json_imports, arena),
            ts_extension_imports: few(ts_extension_imports, arena),
            arbitrary_extension_imports: few(arbitrary_extension_imports, arena),
            arbitrary_extension_files: few(arbitrary_extension_files, arena),
            extensionless_imports: few(extensionless_imports, arena),
            missing_references: few(missing_references, arena),
            is_esm,
            specifies_esm,
            implied_format,
            default_mode,
            package_json_without_type,
            package_json_directory: resolver
                .package_json_directory(path)
                .map_or(Atom::NONE, |directory| atoms.intern(directory)),
            edges: &[],
            redirected_imports: ArenaFew::default(),
            project_reference_imports: few(project_reference_imports, arena),
            unbuilt_imports: few(unbuilt_imports, arena),
            project_reference_source: Atom::NONE,
            redirect_for_resolution,
            is_from_external_library: false,
            is_leaf: false,
            adds_nothing: false,
            has_conditional_or_mapped_type: false,
            transient_symbols: ArenaVec::new_in(arena),
        };
        let mut module = module;
        module.has_conditional_or_mapped_type = module.hir.types.iter().any(|node| {
            matches!(
                node.kind,
                TypeNodeKind::Cond { .. } | TypeNodeKind::Mapped(_)
            )
        });
        module.adds_nothing = !is_lib
            && matches!(module.hir.kind, FileKind::Ts | FileKind::Tsx)
            && !module.hir.is_js
            && module.hir.has_module_syntax
            && module.bound.global_augmentations.is_empty()
            && module.bound.ambient_modules.is_empty()
            && module.bound.pattern_ambient_modules.is_empty()
            && module.bound.umd_globals.is_empty()
            // `make_module_clones`: it adds a symbol to the file of what it imports.
            && !(module.hir.imports.iter()).any(|import| import.namespace.is_some());
        let mut traces = types_tracer.into_traces();
        traces.extend(tracer.into_traces());
        Loaded {
            module,
            imports,
            references,
            unsupported_libs,
            traces,
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
        if !module.file_name().ends_with(b".tsx") && !module.file_name().ends_with(b".jsx") {
            return None;
        }
        let runtime = jsx_runtime_of(self.options, &module.hir, &self.atoms)?;
        self.atoms.lookup(&runtime)
    }

    // ───────────────────────────── merging ─────────────────────────────

    /// `fileIndexMap`: the index of `file` among the files of the program, which `compareNodes`
    /// uses.
    #[inline]
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

    /// `getProcessedFiles`: `collectFiles(rootTasks)`, from each task depth first, a file after everything it refers to. The
    /// files with a `libFile` come first, sorted (`sortLibs`).
    fn declaration_order(&self, starts: &[FileId]) -> Vec<FileId> {
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
                match self.modules[file.idx()].edges.get(next) {
                    Some(&edge) => {
                        top.1 += 1;
                        if !std::mem::replace(&mut seen[edge.idx()], true) {
                            stack.push((edge, 0));
                        }
                    }
                    None => {
                        if self.modules[file.idx()].is_lib {
                            libs.push(file)
                        } else {
                            others.push(file)
                        }
                        stack.pop();
                    }
                }
            }
        }
        libs.sort_by_cached_key(|&file| self.default_lib_file_priority(file));
        libs.extend(others);
        libs
    }

    /// Whether `mergeModuleAugmentation` merges `symbol` of `file`.
    pub fn merges_module_augmentation(&self, file: FileId, symbol: SymbolId) -> bool {
        let module = self.module(file);
        let collected = module_augmentations(&module.hir, &self.atoms);
        merges_module_augmentation(&module.bound, &collected, symbol)
    }

    fn merge(&mut self) {
        self.keeps_module_links = true;
        self.make_global_this_symbol();
        // `initializeChecker`: file by file, the declarations of scripts and the names under which
        // modules are globally visible; then the global augmentations of modules.
        let count = self.order.len();
        let passes = (0..count)
            .map(|at| (at, false))
            .chain((0..count).map(|at| (at, true)));
        for (at, augmentations) in passes {
            let id = self.order[at];
            let file = id.idx();
            let module = &self.modules[file];
            let mut additions: Vec<(Atom, Sym)> = Vec::new();
            if !augmentations && !module.is_module() {
                let locals = module.bound.scopes[0].locals;
                additions.extend(
                    module
                        .bound
                        .table(locals)
                        .iter()
                        .map(|&(name, s)| (name, Sym { file: id, id: s })),
                );
            }
            if augmentations && !module.bound.global_augmentations.is_empty() {
                let collected = module_augmentations(&module.hir, &self.atoms);
                for &augmentation in &module.bound.global_augmentations {
                    if !merges_module_augmentation(&module.bound, &collected, augmentation) {
                        continue;
                    }
                    let exports = module.bound.symbols[augmentation.idx()].exports;
                    additions.extend(
                        module
                            .bound
                            .table(exports)
                            .iter()
                            .map(|&(name, s)| (name, Sym { file: id, id: s })),
                    );
                }
            }
            for (name, sym) in additions {
                // `mergeSymbol`: "Do not report an error when merging `var globalThis` with the built-in `globalThis`". Nothing else is
                // done either.
                if name == known::globalThis
                    && SymFlags::MODULE.intersects(get_excluded_symbol_flags(self.flags(sym)))
                {
                    continue;
                }
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
        for &id in self.order {
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
                let (name, symbol, is_augmentation) = self.modules[file].bound.ambient_modules[at];
                let sym = Sym {
                    file: id,
                    id: symbol,
                };
                if is_augmentation {
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
        for (file, name, sym) in augmentations {
            match self.module_of_specifier_as(file, name, self.module(file).default_mode) {
                // An augmentation of a module that is `export = ns` is merged into `ns`.
                Some(main_module) => {
                    let main_module = self.external_module_symbol_to_augment(main_module);
                    // `mergeModuleAugmentation`: a module whose `export =` target is not a
                    // namespace cannot be augmented.
                    if !self.flags(main_module).intersects(SymFlags::NAMESPACE) {
                        self.augmentations_of_non_modules.push(sym);
                        continue;
                    }
                    // `mergeModuleAugmentation`: an augmentation of `a.svg`, which only the pattern
                    // `*.svg` declares, is not merged into the pattern. Instead the contents of the
                    // pattern are merged into the augmentation, which is registered under its own
                    // name. A pattern that several scripts declare is not the symbol of any of them
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
                            // `mergeSymbol`: symbols that cannot merge stay separate, and the
                            // module has the augmentation's symbol under the name.
                            if self
                                .flags(resolved)
                                .intersects(get_excluded_symbol_flags(self.flags(addition)))
                            {
                                // `reportMergeSymbolError(target, source)`, where `target` is the
                                // entry: an alias is not resolved.
                                let refused = match self.is_non_local_alias(found) {
                                    true => found,
                                    false => self.canonical(resolved),
                                };
                                self.refuse_merge(refused, addition);
                                continue;
                            }
                            self.merge_symbol(found, addition, false);
                        }
                    }
                    self.merge_symbol(main_module, sym, false);
                }
                // `mergeModuleAugmentation`: an augmentation of a module that does not exist is
                // ignored.
                None => {}
            }
        }
        self.keeps_module_links = false;
        let at_merge = self.module_links_at_merge.get_mut().iter();
        if at_merge.len() != 0 {
            self.modules_resolved_at_merge = self
                .arena
                .alloc_slice_fill_iter(at_merge.map(|links| links.0));
        }
        // Each file is visited once, however many of its names are redirected.
        let mut stand_ins = std::mem::replace(&mut self.stand_ins, ArenaVec::new_in(self.arena));
        stand_ins.sort_unstable();
        for of_file in stand_ins.chunk_by(|a, b| a.0.file == b.0.file) {
            let is_placeholder = |symbol: &mut SymbolId| {
                if let Ok(i) = of_file.binary_search_by_key(symbol, |s| s.0.id) {
                    *symbol = of_file[i].1;
                }
            };
            let bound = &mut self.modules[of_file[0].0.file.idx()].bound;
            bound.expr_symbol.iter_mut().for_each(is_placeholder);
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
        let globals = SymbolMap::from_iter_in(self.globals.iter().copied(), self.arena);
        self.merged_exports.insert(self.global_this_symbol, globals);
        self.make_transient_symbols();
        // The target an alias resolved to during the symbol merge may have become a part of a
        // merged symbol by now.
        let session = self.session;
        let symbols = Bases::new_in(self.modules.iter().map(|m| m.bound.symbols.len()), &session);
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

    /// `links`, whose `resolved_exports` are the entries of the tables, as they are stored once
    /// symbols are merged.
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

    fn symbol_mut(&mut self, sym: Sym) -> &mut Symbol<'s> {
        &mut self.modules[sym.file.idx()].bound.symbols[sym.id.idx()]
    }

    /// `newSymbol`: a symbol of the first file.
    fn new_symbol(&mut self, flags: SymFlags, name: Atom) -> Sym {
        let symbols = &mut self.modules[0].bound.symbols;
        symbols.push(Symbol {
            name,
            flags: flags | SymFlags::TRANSIENT,
            decls: bind::Decls::None,
            value_declaration: u32::MAX,
            parent: SymbolId::NONE,
            exports: bind::TableId::NONE,
            members: bind::TableId::NONE,
            export_symbol: SymbolId::NONE,
        });
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
        self.symbol_mut(source).flags |= SymFlags::MERGED;
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
            decls: bind::Decls::None,
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
        add_transient_symbols(module, created);
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

    /// `resolveExternalModuleSymbol(mainModule)` of `mergeModuleAugmentation`. If the `export =` of
    /// `module` resolves through an `import * as ns`, `resolveESModuleSymbol` creates the clone
    /// now, from the current contents. Whether it does is decided from the symbol tables: there are
    /// no types yet.
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
    /// `combineValueAndTypeSymbols` creates a symbol from it if `symbolFromVariable` is a property:
    /// it is not a value.
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
        let type_symbol = self.canonical(self.module_export(module, name)?);
        let is_type = !self.flags(type_symbol).intersects(SymFlags::VALUE);
        is_type.then_some(type_symbol)
    }

    /// The transient symbols to create for the aliases of `file`: one for each `import * as ns`,
    /// and one for each name for which `type_symbol_to_combine` returns a symbol.
    fn transient_symbols_of(&self, file: FileId) -> Vec<(TransientSymbol, Symbol<'s>)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut created = Vec::new();
        let modes = [
            ResolutionMode::Import,
            ResolutionMode::Require,
            ResolutionMode::None,
        ];
        if !hir.imports.iter().any(|import| import.namespace.is_some())
            && !bound.specifiers.iter().any(|&specifier| {
                modes.into_iter().any(|mode| {
                    self.module_of_specifier_as(file, specifier, mode)
                        .is_some_and(|m| self.export(m, known::export_equals).is_some())
                })
            })
        {
            return created;
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
            let import = symbol.decls.iter().find_map(|&decl| match decl {
                Decl::ImportNamespace(import) => Some(&hir[import]),
                _ => None,
            });
            let target = match import {
                Some(import) => {
                    let mode = self.mode_of_import(file, import.mode);
                    let module = self.module_of_specifier_as(file, import.spec, mode);
                    module.map(|module| self.module_value(module))
                }
                None => self.type_symbol_to_combine(alias),
            };
            if let Some(target) = target.filter(|&target| !self.is_non_local_alias(target)) {
                created.push(self.transient_symbol_for(id, target, import.is_none()));
            }
        }
        created
    }

    /// Nothing can be added to the shared state once the merge has ended.
    fn make_transient_symbols(&mut self) {
        for &file in self.order {
            let created = self.transient_symbols_of(file);
            add_transient_symbols(&mut self.modules[file.idx()], created);
        }
    }

    /// `cloneSymbol`. The clone is a symbol of the same file as `symbol`, so `decls`, `parent` and
    /// `exports` have the same meaning as for `symbol`. It takes over the table entries of
    /// `symbol`: from now on `canonical` redirects past `symbol`.
    fn clone_symbol(&mut self, symbol: Sym) -> Sym {
        let parts = self.merged_parts.remove(&symbol);
        let exports = self.merged_exports.remove(&symbol);
        let members = self.merged_members.remove(&symbol);
        let symbols = &mut self.modules[symbol.file.idx()].bound.symbols;
        let cloned = &symbols[symbol.id.idx()];
        let clone = Symbol {
            name: cloned.name,
            flags: cloned.flags | SymFlags::MERGED | SymFlags::TRANSIENT,
            decls: cloned.decls.clone_in(self.arena),
            value_declaration: cloned.value_declaration,
            parent: cloned.parent,
            exports: cloned.exports,
            members: cloned.members,
            export_symbol: cloned.export_symbol,
        };
        let result = Sym {
            file: symbol.file,
            id: SymbolId(symbols.len() as u32),
        };
        symbols.push(clone);
        let arena = self.arena;
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
            self.symbol_mut(merged).parent = parent.id;
        } else if self.parent_of_symbol(merged) != Some(parent) {
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
                    .table(bound.symbols[sym.id.idx()].members)
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
                let member = bound.lookup(bound.symbols[sym.id.idx()].members, name)?;
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
    fn refuse_merge(&mut self, target: Sym, source: Sym) {
        let refused = RefusedMerge {
            target,
            source,
            target_flags: self.flags(target),
            source_flags: self.flags(source),
            target_parts: slice_in(&self.parts(target), self.arena),
            source_parts: slice_in(&self.parts(source), self.arena),
        };
        self.refused_merges.push(refused);
    }

    /// Whether `file` declares one of `refused_merges`. There may be thousands of those, and every
    /// file queries this.
    pub fn has_refused_merges(&self, file: FileId) -> bool {
        self.files_of_refused_merges.contains(&file)
    }

    /// `symbol.Exports`
    fn exports_in_table(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        let sym = self.holder_of_exports(sym);
        match self.merged_exports.get(&sym) {
            Some(table) => table.to_vec(),
            None => {
                let (file, bound) = (sym.file, self.bound(sym.file));
                bound
                    .table(bound.symbols[sym.id.idx()].exports)
                    .iter()
                    .map(|&(n, id)| (n, Sym { file, id }))
                    .collect()
            }
        }
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
            self.refuse_merge(target, source);
            // A symbol that cannot merge with the existing symbol of the name contributes nothing
            // to it: two classes, a class and a variable. It remains the symbol of its own
            // declarations, and the name continues to resolve to the first symbol wherever it is
            // used. Two aliases never merge, and nothing refers to a member by its name alone.
            if !is_alias && !unidirectional && !source_flags.intersects(SymFlags::CLASS_MEMBER) {
                for part in self.parts(source).into_vec() {
                    // `declareModuleMember`: the `locals` of the declaring block hold an `ExportValue` symbol whose
                    // `exportSymbol` is `part`, so there the name still resolves to `part` as a value.
                    match self.symbol(part).parent.is_some() {
                        true => _ = self.refused_exports.insert(part),
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
                    // If the two cannot merge, the added symbol takes the name.
                    Some(found) if is_excluded(self.flags(found)) => {
                        self.refuse_merge(target, source);
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
                    // If the alias cannot be resolved (`unknownSymbol`), the added symbol takes the
                    // name as well.
                    None => {
                        self.keep_circular_aliases(target);
                        return source;
                    }
                }
            }
            target = self.clone_symbol(resolved);
        }
        // The name resolver hides an export only if `moduleExport.Flags == SymbolFlagsAlias`, and
        // `target` has `SymbolFlagsTransient`.
        let flags = &mut self.symbol_mut(target).flags;
        *flags = (*flags | source_flags).difference(SymFlags::EXPORT_ONLY);
        // `SetValueDeclaration(target, source.ValueDeclaration)`
        let own = self.value_declaration(target).map(|it| it.1);
        if let Some((_, declaration)) = self.value_declaration(source)
            && bind::takes_over_as_value_declaration(own, declaration)
        {
            let parts = self.parts(target);
            let before: usize = parts.iter().map(|&it| self.symbol(it).decls.len()).sum();
            let index = before as u32 + self.symbol(source).value_declaration;
            self.symbol_mut(target).value_declaration = index;
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
    /// The binder resolved the names in the file of `refused` to `refused`. Those names get a
    /// placeholder symbol for `target` there, and the declarations of `refused` keep their symbol.
    fn redirect_name_to(&mut self, refused: Sym, target: Sym) {
        let bound = &mut self.modules[refused.file.idx()].bound;
        let placeholder = SymbolId(bound.symbols.len() as u32);
        let (name, parent) = {
            let symbol = &bound.symbols[refused.id.idx()];
            (symbol.name, symbol.parent)
        };
        bound.symbols.push(Symbol {
            name,
            flags: SymFlags::MERGED,
            decls: bind::Decls::None,
            value_declaration: u32::MAX,
            parent,
            exports: bind::TableId::NONE,
            members: bind::TableId::NONE,
            export_symbol: SymbolId::NONE,
        });
        self.stand_ins.push((refused, placeholder));
        self.merged_symbols.insert(
            Sym {
                file: refused.file,
                id: placeholder,
            },
            target,
        );
    }

    /// Records the aliases that `resolveAlias(start)` found to be circular, a result that must
    /// persist after the merge.
    fn keep_circular_aliases(&mut self, start: Sym) {
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

    /// The arena of the calling thread, for what a `&self` method stores. It is a search: a caller
    /// that allocates more than once keeps the result.
    fn thread_arena(&self) -> &'s Arena {
        let session: &'s Session = self.session;
        session.arena()
    }

    #[inline]
    pub fn module(&self, file: FileId) -> &Module<'s> {
        &self.modules[file.idx()]
    }

    /// `GetSourceFileFromReference` for a `/// <reference path>` in `origin`.
    pub fn source_file_from_reference(&self, origin: FileId, written: &[u8]) -> Option<FileId> {
        let name = referenced_path(written, self.module(origin).file_name());
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

    #[inline]
    pub fn symbol(&self, sym: Sym) -> &Symbol<'s> {
        &self.modules[sym.file.idx()].bound.symbols[sym.id.idx()]
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

    #[inline]
    pub fn flags(&self, sym: Sym) -> SymFlags {
        self.symbol(sym).flags
    }

    /// Every declaration of `sym`, which is canonical.
    pub fn decls(&self, sym: Sym) -> Vec<(FileId, Decl)> {
        self.decls_of(sym).into_vec()
    }

    /// `decls`, cached permanently if there are several.
    pub fn decls_of(&self, sym: Sym) -> List<'_, (FileId, Decl)> {
        let symbol = self.symbol(sym);
        if !symbol.flags.contains(SymFlags::MERGED) {
            match symbol.decls.as_slice() {
                [] => return List::Kept(&[]),
                [decl] => return List::One((sym.file, *decl)),
                _ => {}
            }
        }
        match self.memo.decls.get_ref(&sym) {
            Some(&kept) => List::Kept(kept),
            // `link` has not reached it yet.
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
            if let Some(table) = self.merged_exports.get(&sym) {
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
        // one that is not transient.
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
            self.merged_exports.get(&sym)
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

    /// `symbol.ValueDeclaration`
    #[inline]
    pub fn value_declaration(&self, sym: Sym) -> Option<(FileId, Decl)> {
        let symbol = self.symbol(sym);
        let index = symbol.value_declaration as usize;
        if symbol.flags.contains(SymFlags::MERGED) {
            return self.value_declaration_of_merged(sym, index);
        }
        symbol.decls.get(index).map(|&decl| (sym.file, decl))
    }

    #[inline(never)]
    fn value_declaration_of_merged(&self, sym: Sym, mut index: usize) -> Option<(FileId, Decl)> {
        for &part in self.parts(sym).iter() {
            let decls = &self.symbol(part).decls;
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
                return List::Kept(parts);
            }
            // `slices.Clone(symbol.Declarations)`
            if let Some(created) = self.transient_symbol(sym) {
                return self.parts(created.target);
            }
        }
        List::One(sym)
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
    /// `Err`: what it reports with `reportErrors`, at `global_type_declaration` of the symbol that
    /// has the name. 2318 is in no file.
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

    /// Whether `file` contains a conditional or a mapped type node.
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
        if let Some((file, params)) = self.only_type_param_list(sym) {
            let hir = self.hir(file);
            return (
                params
                    .iter()
                    .rposition(|tp| hir[tp].default.is_none())
                    .map_or(0, |last| last + 1),
                params.len(),
            );
        }
        let lists = self.type_param_lists(sym);
        // `getMinTypeArgumentCount`, `hasTypeParameterDefault`: a parameter has a default if any of
        // its declarations has one.
        let mut all: SmallVec<[(Atom, bool); 4]> = SmallVec::new();
        for (file, params) in lists {
            let hir = self.hir(file);
            for tp in params.iter() {
                let (name, has_default) = (hir[tp].name, hir[tp].default.is_some());
                match all.iter_mut().find(|known| known.0 == name) {
                    Some(known) => known.1 |= has_default,
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
        if !self.parents_in_other_files.is_empty()
            && let Some(&parent) = self.parents_in_other_files.get(&sym)
        {
            return Some(self.canonical(parent));
        }
        let parent = self.symbol(sym).parent;
        parent.is_some().then(|| self.sym(sym.file, parent))
    }

    /// The raw `symbol.Parent` field, unlike `getParentOfSymbol`, which returns the merged parent. `mergeSymbolTable` only
    /// re-parents symbols that were actually merged. A symbol that exists only in the source table keeps its parent, for example
    /// the `declare module "m"` block that contains it.
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
                let held = bound.lookup(locals, name).map(|id| self.sym(file, id));
                let table = SymbolTable::Locals(file, container);
                if lookup(table, held, SymFlags::TYPE_PARAMETER).is_some() {
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
                let held = bound.lookup(s.locals, name).map(|id| self.sym(file, id));
                let is_export_value_only =
                    held.is_some_and(|sym| self.refused_exports.contains(&sym));
                let meaning = match is_export_value_only {
                    true => meaning & SymFlags::VALUE,
                    false => meaning,
                };
                if let Some(sym) = lookup(SymbolTable::Locals(file, scope), held, meaning)
                    && bound.is_seen_from(from, self.flags(sym), meaning)
                {
                    return Ok(Some(sym));
                }
            }
            // The exports of a module, a namespace or an enum are in scope inside it, wherever they
            // were declared. `default` is not a name.
            if s.symbol.is_some() && name != known::default {
                // Enum members are in scope in the enum, but not in a namespace merged with it.
                let visible = match s.kind {
                    ScopeKind::Enum(_) => meaning & SymFlags::ENUM_MEMBER,
                    _ => meaning & SymFlags::MODULE_MEMBER,
                };
                let container = self.sym(file, s.symbol);
                // `IsSourceFile(location) || IsModuleDeclaration(location) &&
                // location.Flags&NodeFlagsAmbient != 0 && !IsGlobalScopeAugmentation(location)`
                let is_external_module = || match s.kind {
                    ScopeKind::File => true,
                    ScopeKind::Module(m) => {
                        let hir = self.hir(file);
                        let mut around = std::iter::successors(Some(scope), |&at| {
                            Some(bound.scopes[at.idx()].parent).filter(|parent| parent.is_some())
                        });
                        !matches!(hir[m].name, ModuleName::Global)
                            && (hir.kind == FileKind::Declaration
                                || around.any(|at| {
                                    matches!(bound.scopes[at.idx()].kind, ScopeKind::Module(it)
                                        if hir[it].flags.contains(Flags::AMBIENT))
                                }))
                    }
                    _ => false,
                };
                // "First see if the module has an export default and if the local name of that export default matches."
                if let Some(default) = self.export(container, known::default)
                    && self.flags(default).intersects(meaning)
                    && self.name_of_local_symbol_for_export_default(default) == Some(name)
                    && is_external_module()
                {
                    return Ok(Some(default));
                }
                let held = self.export(container, name);
                // There, an entry that only an export specifier created is not in scope. That is
                // decided before the alias is resolved, because its target may be the very name
                // being resolved.
                let is_purely_an_export_specifier = held
                    .is_some_and(|sym| self.flags(sym).contains(SymFlags::EXPORT_ONLY))
                    && is_external_module();
                // A symbol found in the exports of a CommonJS module is only in scope if it is a type.
                let is_commonjs = s.kind == ScopeKind::File && bound.commonjs_indicator.is_some();
                if !is_purely_an_export_specifier
                    && let Some(sym) = lookup(SymbolTable::Exports(container), held, visible)
                    && !(is_commonjs && !self.flags(sym).intersects(SymFlags::TYPE))
                {
                    return Ok(Some(sym));
                }
            }
            from = s.kind;
            scope = s.parent;
        }
        let held = self.globals.get(name).copied();
        Ok(lookup(SymbolTable::Globals, held, meaning))
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
    /// `written` is the mode it specifies.
    pub fn mode_of_import(&self, file: FileId, written: ResolutionMode) -> ResolutionMode {
        if written == ResolutionMode::None {
            self.module(file).default_mode
        } else {
            written
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

    /// `resolveExternalModule`: the module that `spec` resolves to in `file` in `mode`.
    pub fn module_of_specifier_as(
        &self,
        file: FileId,
        spec: Atom,
        mode: ResolutionMode,
    ) -> Option<Sym> {
        // The specifier is not a string literal (1141). No ambient pattern may match it.
        if spec.is_none() {
            return None;
        }
        // `tryFindAmbientModule`: a relative name never matches.
        if let Some(&ambient) = self.ambient_modules.get(&spec)
            && !is_relative(self.atoms.bytes(spec))
        {
            return Some(self.canonical(ambient));
        }
        // A file that is not a module ends the search anyway.
        if let Some(&target) = self.module(file).imports.get(&(spec, mode)) {
            return self
                .module(target)
                .is_module()
                .then(|| self.file_symbol(target));
        }
        if !self.ambient_patterns.is_empty() {
            let text = self.atoms.bytes(spec);
            // `FindBestPatternMatch`: the one with the longest prefix, and of those the first.
            let mut best: Option<(usize, Sym)> = None;
            for &(prefix, suffix, sym) in &self.ambient_patterns {
                if best.is_none_or(|b| prefix.len() > b.0)
                    && text.len() >= prefix.len() + suffix.len()
                    && text.starts_with(prefix)
                    && text.ends_with(suffix)
                {
                    best = Some((prefix.len(), sym));
                }
            }
            if let Some((_, pattern)) = best {
                return Some(
                    self.canonical(
                        self.pattern_augmentations
                            .get(&spec)
                            .copied()
                            .unwrap_or(pattern),
                    ),
                );
            }
        }
        None
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
    /// else `has_syntactic_default`. For a module that is `export =` it is a property of the type
    /// of the value, which the symbol tables cannot answer.
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
                // `GetEmitModuleFormatOfFile`: a referenced project says what its declaration
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
        let can = if !is_file || self.hir(module.file).kind == FileKind::Declaration {
            // A module that is only declared may have a synthetic default, unless it declares its
            // default or declares that it is an ECMAScript module.
            resolve_export_by_name(known::default) != Some(true)
                && self
                    .atoms
                    .lookup(b"__esModule")
                    .is_none_or(|name| resolve_export_by_name(name).is_none())
        } else if self.hir(module.file).is_js {
            // A JavaScript file has one if it has no ECMAScript module syntax and does not declare
            // that it is an ECMAScript module.
            let of = self.hir(module.file);
            (!of.has_module_syntax || of.is_module_by_decree)
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
            && self
                .symbol(module)
                .decls
                .iter()
                .any(|d| matches!(d, Decl::File))
            && self.is_json_module(module.file)
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

    /// The import is emitted as `require` (`getEmitSyntaxForModuleSpecifierExpression`, see `synthetic_default` for `usage`), and
    /// `module` is a file that is emitted as an ECMAScript module (`GetImpliedNodeFormatForEmit`).
    pub fn is_commonjs_import_of_esm_file(&self, usage: impl Usage, module: Sym) -> bool {
        self.symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && usage.mode(self) == ResolutionMode::Require
            && self.module(module.file).implied_format == ResolutionMode::Import
    }

    /// `InternalSymbolNameModuleExports`. From Node 20 on, `require` of an ECMAScript module returns its export named `"module.exports"`,
    /// if it has one. `None` unless `module` is `node20` .. `nodenext`.
    pub fn module_exports_name(&self) -> Option<Atom> {
        if !(ModuleKind::Node20..=ModuleKind::NodeNext).contains(&self.options.module) {
            return None;
        }
        self.atoms.lookup(b"module.exports")
    }

    /// The link step: resolves the aliases and the exports of every module. `Files` is immutable
    /// afterwards.
    ///
    /// Proceeds level by level of the import graph. A task reads the tables and its own buffer. At
    /// the barrier after a level the buffers are published in task order, and the first entry for a
    /// key wins. So the result is a function of the program, regardless of thread scheduling.
    ///
    /// The levels only save work. An alias can depend on a file that its own file does not import:
    /// through an ambient module, a UMD global, an `import a = b.c` in a script, a module
    /// augmentation. A task resolves for itself whatever is not published.
    fn link(&mut self, host: &dyn Host) {
        /// Not a function of the number of threads: which components share a buffer is part of the plan.
        const COMPONENTS_OF_A_TASK: usize = 64;
        let files_of = |components: &[u32]| -> Vec<FileId> {
            let components = components
                .iter()
                .map(|&at| &self.components.all[at as usize]);
            components
                .flat_map(|component| component.files)
                .copied()
                .collect()
        };
        let mut steps: Vec<Vec<Vec<FileId>>> = (self.components.by_level().iter())
            .map(|level| level.chunks(COMPONENTS_OF_A_TASK).map(files_of).collect())
            .collect();
        // A file that is unreachable from every starting point is in `modules` and not in `order`.
        let unordered = (0..self.modules.len() as u32).map(FileId);
        steps.push(vec![
            unordered
                .filter(|file| self.ranks[file.idx()] == u32::MAX)
                .collect(),
        ]);
        let is_nested = |&(module, links): &(&Sym, &ModuleSymbolLinks)| {
            let mut collisions = links.export_collisions.iter();
            collisions.any(|it| it.duplicate.0 != module.file)
        };
        let at_merge = self.modules_resolved_at_merge.iter();
        let at_merge = at_merge.filter_map(|module| {
            let links = self.memo.module_links.get_ref(module)?;
            Some((module, links))
        });
        let mut nested: Vec<Sym> = at_merge.filter(is_nested).map(|it| *it.0).collect();
        for tasks in &steps {
            let resolved: Vec<Guarded<Resolved>> = tasks
                .iter()
                .map(|_| Guarded::new(Resolved::default()))
                .collect();
            host.parallel(tasks.len(), &|at| {
                *resolved[at].lock() = self.resolve_files(&tasks[at]);
            });
            for resolved in &resolved {
                let resolved = std::mem::take(&mut *resolved.lock());
                let links = resolved.module_links.iter();
                nested.extend(links.filter(is_nested).map(|it| *it.0));
                self.publish(resolved);
            }
        }
        nested.retain(|&module| self.canonical(module) == module);
        nested.sort_unstable();
        nested.dedup();
        self.modules_with_nested_export_collisions = slice_in(&nested, self.arena);
        let refused = self.refused_merges.iter();
        let parts = refused.flat_map(|it| it.target_parts.iter().chain(it.source_parts.iter()));
        self.files_of_refused_merges
            .extend(parts.map(|part| part.file));
        self.is_linked = true;
    }

    /// A task of the link step. First the links of every alias of `files`, in that order, by
    /// symbol: the order determines where a cycle is entered. Then, with nothing in progress,
    /// everything else.
    fn resolve_files(&self, files: &[FileId]) -> Resolved<'s> {
        let resolver = AliasResolver::new(self, Some(Resolved::default()));
        let arena = resolver.arena();
        let files = files.iter();
        let symbols = |&file: &FileId| {
            let ids = 0..self.bound(file).symbols.len() as u32;
            ids.map(move |id| Sym {
                file,
                id: SymbolId(id),
            })
        };
        for sym in files.clone().flat_map(symbols) {
            if self.flags(sym).contains(SymFlags::ALIAS) {
                resolver.alias_links(sym);
            }
        }
        let mut decls = Vec::new();
        let mut of_symbol = Vec::new();
        for sym in files.flat_map(symbols) {
            let symbol = self.symbol(sym);
            if symbol.flags.contains(SymFlags::ALIAS) {
                resolver.symbol_flags(sym);
            }
            if symbol.flags.intersects(SymFlags::MODULE) {
                resolver.with_module_links(sym, |_| ());
            }
            let has_several = symbol.flags.contains(SymFlags::MERGED) || symbol.decls.len() > 1;
            if has_several && self.canonical(sym) == sym {
                of_symbol.clear();
                self.collect_decls(sym, &mut of_symbol);
                decls.push((sym, slice_in(&of_symbol, arena)));
            }
        }
        let mut resolved = resolver
            .buffer
            .map(|it| it.into_inner())
            .unwrap_or_default();
        resolved.decls = decls;
        resolved
    }

    /// At a barrier, on one thread.
    fn publish(&self, resolved: Resolved<'s>) {
        for (sym, links) in resolved.alias_links {
            self.alias_symbol_links.insert(sym, links);
        }
        for (sym, flags) in resolved.symbol_flags {
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
        // `link` has them for every symbol with a flag of `SymFlags::MODULE`.
        debug_assert!(links.is_some() || !self.flags(module).intersects(SymFlags::MODULE));
        links.unwrap_or(&self.no_module_links)
    }

    /// `getExportsOfModule`
    pub fn exports_of_module(&self, module: Sym) -> &[(Atom, Sym)] {
        &self.module_links(module).resolved_exports
    }

    /// The entries of `getExportsOfModule(module)` that are not their own merged symbol, which is
    /// what `exports_of_module` has in their place.
    pub fn unmerged_exports_of_module(&self, module: Sym) -> &[(Atom, Sym)] {
        self.module_links(module).unmerged_exports
    }

    /// `symbol.Exports[InternalSymbolNameExportStar].Declarations`
    fn export_stars_of(&self, symbol: Sym) -> SmallVec<[(FileId, StmtId); 4]> {
        let mut stars = SmallVec::new();
        for &part in self.parts(symbol).iter() {
            let of_file = self.bound(part.file).export_stars.iter();
            stars.extend(
                of_file
                    .filter(|star| star.0 == part.id)
                    .map(|star| (part.file, star.1)),
            );
        }
        stars
    }

    pub fn is_type_only_star_export(&self, module: Sym, name: Atom) -> bool {
        self.type_only_export_star(module, name).is_some()
    }

    /// The end of the alias chain from `sym`: a symbol that is not an alias at all, merged. tsgo
    /// has no such function: its callers want a meaning, which `resolve_alias_as` handles.
    #[inline]
    pub fn resolve_alias_if_needed(&self, sym: Sym) -> Option<Sym> {
        let target = self.resolve_alias_as(sym, SymFlags::empty())?;
        // `mergeSymbol` wants `resolveSymbol(target)`.
        Some(if self.is_merged {
            self.canonical(target)
        } else {
            target
        })
    }

    /// `getTypeOnlyAliasDeclarationEx`
    pub fn type_only_alias_declaration_ex(
        &self,
        mut symbol: Sym,
        meaning: SymFlags,
    ) -> Option<TypeOnlyDeclaration> {
        for _ in 0..32 {
            let flags = self.flags(symbol);
            if !flags.contains(SymFlags::ALIAS) || flags.intersects(meaning) {
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

    /// The result of `resolveESModuleSymbol` for the alias of an `import * as ns`, if it is not the
    /// module symbol itself.
    pub fn module_clone(&self, originating_import: Sym) -> Option<Sym> {
        self.transient_symbol_of_alias(originating_import, false)
    }

    /// The result of `combineValueAndTypeSymbols` for `alias`, if the `export =` value has a
    /// property of that name.
    pub fn combined_symbol(&self, alias: Sym) -> Option<Sym> {
        self.transient_symbol_of_alias(alias, true)
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

    /// The symbol whose table serves as `Exports` of `sym`. `maps.Clone(symbol.Exports)`: a clone
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
        let e = match decl {
            Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
            | Decl::ImportEquals(_)
            | Decl::ExportSpec(_)
            | Decl::ExportStarAs(_)
            | Decl::UmdGlobal(_)
            | Decl::Require(_) => return true,
            Decl::ExportExpr(stmt) => match hir[stmt].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => e,
                _ => return false,
            },
            Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => {
                match hir[assignment].kind {
                    ExprKind::Assign { value, .. } => value,
                    _ => return false,
                }
            }
            _ => return false,
        };
        expression_is_alias(hir, e)
    }

    /// `getDeclarationOfAliasSymbol`: the last alias declaration of `sym`, in whichever file it is. `Symbol::decls` also lists the
    /// declarations `declareSymbolEx` refused, which are not declarations of the symbol: an import excludes every other alias
    /// (`AliasExcludes`), so an import that follows an alias declaration was refused.
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
            let is_refused = is_import
                && decls[..i].iter().any(|&(other, earlier)| {
                    other == file && self.is_alias_symbol_declaration(other, earlier)
                });
            (!is_refused).then_some((file, decl))
        })
    }

    /// `isShorthandAmbientModuleSymbol`: `ValueDeclaration`, which of several module declarations is the first, is
    /// `declare module "m";`.
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
        }
    }
}

impl<'s> Resolve<'s> for AliasResolver<'_, 's> {
    fn arena(&self) -> &'s Arena {
        self.arena.get_or_init(|| self.files.thread_arena())
    }

    fn alias_links(&self, sym: Sym) -> AliasSymbolLinks {
        if let Some(known) = self.alias_symbol_links.get(&sym) {
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
        // The flags of an alias in progress are not its final flags.
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
        if let Some(published) = self.memo.module_links.get_ref(&module) {
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
}

/// The public methods of `Files` that resolve aliases: the methods of `Resolve` of the same names.
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
    pub fn default_of_module(file: FileId, module: Sym) -> Option<Sym>;
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
