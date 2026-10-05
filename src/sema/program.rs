//! Every file of the program, and its symbols once the files are linked together: which file an
//! import resolves to, which declarations in different files merge into one symbol, what an alias
//! resolves to.

use crate::atom::{Atom, Interner, known};
use crate::bind::{self, Bound, Decl, ScopeId, ScopeKind, SymFlags, Symbol, SymbolId};
use crate::check::spans::{skip_trivia, skip_trivia_back};
use crate::components::Components;
use crate::hir::{self, *};
use crate::json::Json;
use crate::resolve::{
    DiagAndArgs, Host, INFERRED_TYPES_CONTAINING_FILE, JsxEmit, ModuleDetection, ModuleKind,
    Options, Phase, Resolver, ScriptTarget, Spent, Tracer, ancestors, contains_path,
    file_extension_is_one_of, format_by_extension, has_ts_implementation_extension, inside,
    is_javascript, is_relative, join, lib_name, remove_file_extension, supported_extensions,
    to_file_name_lower_case,
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
    pub path: &'s [u8],
    pub hir: hir::File<'s>,
    pub bound: Bound<'s>,
    /// Lives as long as `bound`. Whether an alias resolves to the symbol synthesized for it can
    /// only be decided from types.
    transient_symbols: ArenaVec<'s, TransientSymbol>,
    /// One of TypeScript's own `lib.*.d.ts`.
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
    /// `getEmitSyntaxForUsageLocationWorker` for a plain `import` in it: the syntax that is emitted
    /// for it, which is also the mode it is resolved in.
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
    /// Those of `untyped_imports` that resolve to a file inside a package. With `allowJs` such a file is loaded only up to
    /// `maxNodeModuleJsDepth` (`elideOnDepth`).
    pub untyped_package_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
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
    /// `ResolvedFileName` for those of `imports` that resolve to a duplicate of a package file that
    /// is in the program under another path.
    pub redirected_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom)>,
    /// Those of `imports` that resolve to a declaration file of a referenced project, for which its source is loaded.
    pub project_reference_imports: ArenaFew<'s, (Atom, ResolutionMode)>,
    /// The specifiers that resolve to one of `Options::referenced_sources` whose declaration file
    /// does not exist, with `OutputDts` and `Source`. They resolve to no file (6305).
    pub unbuilt_imports: ArenaFew<'s, (Atom, ResolutionMode, Atom, Atom)>,
    /// The files it refers to, in order of reference: `/// <reference>`s, then imports.
    pub edges: &'s [FileId],
    /// `IsSourceFileFromExternalLibrary`: `lowestDepth > 0`, every path to it from a root file
    /// passes through a `node_modules`.
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

/// `Files::by_path`
type ByPath<'s> = ArenaHashMap<'s, &'s [u8], FileId>;

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
    /// The errors `getExportsOfModuleWorker` reports for the `export *` declarations of the module
    /// itself.
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

/// `'r`: the paths belong to the `Resolver`.
struct Loaded<'s, 'r> {
    module: Module<'s>,
    /// (specifier, resolution mode, resolved path, whether that file is added to the program
    /// because of it, `increaseDepth`)
    imports: Vec<(Atom, ResolutionMode, &'r [u8], bool, bool)>,
    /// (path, is a lib, `increaseDepth`)
    references: Vec<(&'r [u8], bool, bool)>,
    /// `typeResolutionsTrace`, then `resolutionsTrace`
    traces: Vec<DiagAndArgs>,
}

/// A file that `Files::load` has found.
#[derive(Copy, Clone)]
struct FoundFile<'s> {
    path: &'s [u8],
    is_lib: bool,
    /// `parseTaskData.packageId`, as an index into `Found::kept`.
    package: Option<u32>,
}

/// What `Files::load` knows about the files it has found, besides the files themselves.
#[derive(Default)]
struct Found<'s> {
    /// By `FileId`.
    files: Vec<FoundFile<'s>>,
    /// `packageIdToSourceFile`: the copy of a package file that `collectFiles` came to first.
    kept: Vec<Option<FileId>>,
    /// Whether `collectFiles` has begun.
    is_collecting: bool,
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
            // `resolveSymbolEx`: only a symbol that is purely an alias (`IsNonLocalAlias`) is
            // followed.
            Some(equals)
                if self
                    .flags(equals)
                    .intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE) =>
            {
                equals
            }
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
        if is_resolved_at_merge && !self.is_merged {
            return self.module_export_at_merge(module, name);
        }
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
        if self.is_merged {
            self.with_module_links(module, |links| links.export_in_table(name))
        } else {
            self.exports_of_module_worker(module).export_in_table(name)
        }
    }

    /// `module_export_in_table` during the symbol merge: see `Files::module_links_at_merge`.
    fn module_export_at_merge(&self, module: Sym, name: Atom) -> Option<Sym> {
        {
            let stored = self.module_links_at_merge.lock();
            if let Some(links) = stored.iter().find(|links| links.0 == module) {
                return links.1.export_in_table(name);
            }
        }
        // Not under the lock: it resolves aliases, which leads back here.
        let links = self.exports_of_module_worker(module);
        let found = links.export_in_table(name);
        let mut stored = self.module_links_at_merge.lock();
        if !stored.iter().any(|links| links.0 == module) {
            stored.push((module, links));
        }
        found
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
                if export_star.is_none()
                    && name != known::export_equals
                    && !symbols.contains_key(name)
                    && self.resolve_symbol(target) != self.resolve_symbol(source)
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
        let flags = self.flags(symbol);
        // `IsNonLocalAlias`
        if flags.contains(SymFlags::ALIAS)
            && !flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
        {
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
        // `getSymbol`
        let lookup = &mut |_: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
            held.filter(|&sym| self.means(sym, meaning))
        };
        self.resolve_entity_with(file, scope, names, meaning, false, lookup)
    }

    /// `lookup`: `getSymbol`, as for `resolve_with`. `reports_errors`: `!ignoreErrors`.
    fn resolve_entity_with(
        &self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags,
        reports_errors: bool,
        lookup: &mut dyn FnMut(SymbolTable, Option<Sym>, SymFlags) -> Option<Sym>,
    ) -> Option<Sym> {
        let (&last, qualifiers) = names.split_last()?;
        let scope = self.bound(file).scope_to_resolve_from(scope, names[0]);
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
        let mut container = self.resolve_alias_as(first, namespace)?;
        for &name in &qualifiers[1..] {
            container = self.member_as(container, name, namespace, lookup)?;
            container = self.resolve_alias_as(container, namespace)?;
        }
        self.member_as(container, last, meaning, lookup)
    }

    /// `resolveQualifiedName`: the export `name` of `namespace`, accepted only if it has the
    /// requested meaning.
    fn member_as(
        &self,
        namespace: Sym,
        name: Atom,
        meaning: SymFlags,
        lookup: &mut dyn FnMut(SymbolTable, Option<Sym>, SymFlags) -> Option<Sym>,
    ) -> Option<Sym> {
        let mut find = |namespace: Sym| {
            let held = self.namespace_member(namespace, name);
            lookup(SymbolTable::Exports(namespace), held, meaning)
        };
        find(namespace).or_else(|| {
            // A namespace that is merged with a re-export can be resolved further (`resolveAlias`).
            if !self.flags(namespace).contains(SymFlags::ALIAS) {
                return None;
            }
            find(self.resolve_alias(namespace)?)
        })
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

    /// The loop at the end of `resolveEntityName`: the first symbol on the alias chain from `sym`
    /// that has `meaning` itself; the end of the chain if none has.
    fn resolve_alias_as(&self, mut sym: Sym, meaning: SymFlags) -> Option<Sym> {
        for _ in 0..32 {
            let flags = self.flags(sym);
            if flags.intersects(meaning) || !flags.contains(SymFlags::ALIAS) {
                return Some(sym);
            }
            let next = self.alias_links(sym).alias_target?;
            if next == sym {
                return None;
            }
            sym = next;
        }
        None
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

    /// `onFailedToResolveSymbol`, limited to its side effects on aliases:
    /// `getSpellingSuggestionForName` resolves every alias it inspects.
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
        // `checkAndReportErrorForExportingPrimitiveType`, `checkAndReportErrorForUsingTypeAsValue`
        if matches!(
            self.atoms.bytes(name),
            b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown"
        ) {
            return;
        }
        let asking = (file, self.start_of_declaration(file, decl));
        let try_resolve_alias = &mut |sym| {
            let target = self.try_resolve_alias(asking, sym)?.alias_target;
            Some(target.map_or(SymFlags::all(), |target| self.flags(target)))
        };
        let name = (name, self.atoms.bytes(name));
        // For the aliases that the search resolves. The suggestion is for the error, which the
        // checker reports.
        let _ = self.suggested_symbol_for_nonexistent_symbol(
            file,
            scope,
            name,
            meaning,
            try_resolve_alias,
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
    fn resolve_es_module_symbol(
        &self,
        module: Sym,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Option<Sym> {
        let symbol = self.external_module_symbol(module);
        if self.is_non_local_alias(symbol) {
            // Where the tables cannot resolve further, types may: a caller that continues from here
            // does so one step at a time.
            self.resolve_indirection_alias(symbol, type_only)
                .or(Some(symbol))
        } else {
            Some(symbol)
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
                    self.resolve_es_module_symbol(module, type_only);
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
                .and_then(|module| {
                    let symbol = self.resolve_es_module_symbol(module, type_only)?;
                    if self.is_commonjs_import_of_esm_file(file, module)
                        && let Some(found) = self.module_exports_export(symbol)
                    {
                        return Some(found);
                    }
                    Some(symbol)
                }),
            Decl::ImportEquals(import) => match hir[import].target {
                ImportEqualsTarget::Require(spec) => self
                    .module_of_specifier_as(file, spec, ResolutionMode::Require)
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
            // Without `from`.
            Decl::ExportSpec(spec) => {
                let scope = bound.export_scope[hir[spec].export.idx()];
                let target = self.resolve_name(file, scope, hir[spec].local, all);
                if target.is_none() {
                    self.on_failed_to_resolve_symbol(file, decl, scope, hir[spec].local, all);
                }
                target
            }
            // `getTargetOfNamespaceExportDeclaration`
            Decl::UmdGlobal(_) => Some(self.external_module_symbol(self.file_symbol(file))),
            // `getTargetOfNamespaceExport`
            Decl::ExportStarAs(stmt) => {
                let StmtKind::ExportStar { spec, mode, .. } = hir[stmt].kind else {
                    return None;
                };
                self.module_of_specifier_as(file, spec, self.mode_of_import(file, mode))
                    .and_then(|module| self.resolve_es_module_symbol(module, type_only))
            }
            // `getTargetOfImportEqualsDeclaration`: the whole required module.
            Decl::Require(pat) => {
                let (spec, _) = bound.required_by(hir, pat)?;
                self.module_of_specifier_as(file, spec, ResolutionMode::Require)
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
                self.resolve_entity(file, *bound.expr_scope.get(&e)?, &names, all)
            }
            _ => None,
        }
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
    /// The number of times an alias was read while in progress, or was rejected because the alias
    /// chain is too long.
    cycles: std::cell::Cell<u32>,
    /// `None`: results are written to the tables immediately. For the merge, which is
    /// single-threaded.
    buffer: Option<std::cell::RefCell<Resolved<'s>>>,
    /// `Resolve::arena`, once it has been asked for.
    arena: std::cell::OnceCell<&'s Arena>,
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
        files.module(self).default_mode
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
/// `lib_name`. The library directory of a TypeScript version that has not moved the library yet has
/// it under the name itself.
fn lib_file_stem<'a>(host: &dyn Host, options: &Options, lib: &'a [u8]) -> &'a [u8] {
    match crate::resolve::LIB_FALLBACKS.get(lib) {
        Some(&moved_to) if !host.is_file(&lib_file(options, lib)) => moved_to,
        _ => lib,
    }
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

/// `file.ModuleAugmentations`, without `declare global` (`collectModuleReferences`).
fn module_augmentations(hir: &hir::File, atoms: &Interner) -> Vec<Atom> {
    let ambient_module = |s: StmtId, is_in_ambient_module: bool| {
        let StmtKind::Module(m) = hir[s].kind else {
            return None;
        };
        let is_ambient = is_in_ambient_module
            || hir[m].flags.contains(Flags::AMBIENT)
            || hir.kind == FileKind::Declaration;
        match hir[m].name {
            ModuleName::String(name) if is_ambient => Some((m, name)),
            _ => None,
        }
    };
    let mut names = Vec::new();
    for s in hir.ids(hir.body) {
        let Some((m, name)) = ambient_module(s, false) else {
            continue;
        };
        if hir.has_module_syntax {
            names.push(name);
            continue;
        }
        let nested = hir.ids(hir[m].body);
        let nested = nested.filter_map(|s| Some(ambient_module(s, true)?.1));
        names.extend(nested.filter(|&name| !is_relative(atoms.bytes(name))));
    }
    names
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

/// `pathForLibFile`: the path `lib.<lib>.d.ts` is read from, and whether that is TypeScript's own
/// file.
fn lib_path(resolver: &Resolver, options: &Options, lib: &[u8]) -> (Vec<u8>, bool) {
    if options.lib_replacement {
        let (name, from) = library_name_and_resolve_from(options, lib);
        // `resolveLibrary`: always resolved the way `require` resolves.
        if let Some(found) = resolver.resolve_module_name(&name, &from, ResolutionMode::Require)
            && !is_javascript(found.file_name)
        {
            return (found.file_name.to_vec(), false);
        }
    }
    (lib_file(options, lib), true)
}

/// `HasExtension`
fn has_extension(path: &[u8]) -> bool {
    strings::contains_char(
        &path[strings::last_index_of_char(path, b'/').map_or(0, |i| i + 1)..],
        b'.',
    )
}

/// The first test of `getSourceFileFromReference`: the error code for a file name whose extension is not supported
/// (`isSupportedExtension`). JavaScript needs `allowJs`, JSON needs `resolveJsonModule`. `None` for a name without an extension.
fn unsupported_extension_error(options: &Options, path: &[u8]) -> Option<u32> {
    let is_supported = has_ts_implementation_extension(path)
        || options.allow_js && is_javascript(path)
        || options.resolve_json_module && path.ends_with(b".json");
    if !has_extension(path) || is_supported {
        return None;
    }
    Some(if is_javascript(path) { 6504 } else { 6054 })
}

/// The full diagnostic for the error `code` that `referenced_file` returns for the file at `path`.
fn reference_problem(options: &Options, code: u32, path: &[u8]) -> Problem {
    if code == 6504 || code == 6053 {
        return Problem::new(code, &[path], Place::Nowhere);
    }
    let extensions = supported_extensions(options).concat();
    let quoted = [b"'", &extensions.join(&b"', '"[..])[..], b"'"].concat();
    Problem::new(code, &[path, &quoted], Place::Nowhere)
}

/// `resolveTripleslashPathReference`: the path that the `/// <reference path>` with the value
/// `written` in the file at `from` refers to.
fn referenced_path(written: &[u8], from: &[u8]) -> Vec<u8> {
    let written = strings::replace_owned(written, b"\\", b"/");
    match written[..] {
        // `c:/a` is `/c:/a` here.
        [drive, b':', b'/', ..] if drive.is_ascii_alphabetic() => join(b"/", &written),
        _ => join(dirname::<Posix>(from), &written),
    }
}

/// `getSourceFileFromReference`: the file that a `/// <reference path>` in `from` resolves to,
/// where `name` is the referenced path; or else the error reported for it.
fn referenced_file(
    host: &dyn Host,
    options: &Options,
    name: &[u8],
    from: &[u8],
) -> Result<Vec<u8>, u32> {
    // With an extension, it is that file or none.
    if has_extension(name) {
        if let Some(code) = unsupported_extension_error(options, name) {
            return Err(code);
        }
        if !host.is_file(name) {
            return Err(6053);
        }
        if name == from {
            return Err(1006);
        }
        return Ok(name.to_vec());
    }
    supported_extensions(options)[0]
        .iter()
        .map(|e| [name, &e[..]].concat())
        .find(|c| host.is_file(c))
        .ok_or(6231)
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
    if !types.iter().any(|t| t == b"*") {
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
            // `"typings": null` is how a package declares that it is not needed.
            let package = resolver.package_json(&dir);
            if package.is_none_or(|p| p.get(b"typings") != Some(&Json::Null)) {
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

/// `GetCanonicalFileName` of both.
fn is_same_name(a: &[u8], b: &[u8], is_case_sensitive: bool) -> bool {
    if is_case_sensitive {
        a == b
    } else {
        to_file_name_lower_case(a) == to_file_name_lower_case(b)
    }
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
            .take_while(|(a, b)| is_same_name(a, b, is_case_sensitive))
            .count();
        if shared == 0 {
            return None;
        }
        common.truncate(shared);
    }
    Some(join(b"/", &common.join(&b"/"[..])))
}

/// `FileIncludeReason` for a file that `checkSourceFilesBelongToPath` reports.
#[derive(Copy, Clone)]
enum IncludeReason {
    /// `fileIncludeKindRootFile`
    RootFile,
    /// `fileIncludeKindImport` (1393) or `fileIncludeKindReferenceFile` (1400): the file that
    /// refers to it, and the span of the reference.
    Reference {
        code: u32,
        from: FileId,
        start: u32,
        end: u32,
    },
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
        // `getEmitSyntaxForUsageLocationWorker`: the argument of `require()` is resolved as CommonJS, whatever the file is emitted as.
        SpecifierKind::Require | SpecifierKind::RequireCall => ResolutionMode::Require,
        SpecifierKind::ImportCall => options.import_call_mode(default_mode),
        _ => default_mode,
    }
}

/// `referenceFileLocation` of each `/// <reference path>` and each import in `module` that resolves
/// to a file of the program: that file, the code of the corresponding message, and the span. In the
/// order of `parseTask.subTasks`.
fn reference_locations(
    host: &dyn Host,
    options: &Options,
    atoms: &Interner,
    by_path: &ByPath,
    module: &Module,
) -> Vec<(FileId, u32, u32, u32)> {
    let hir = &module.hir;
    let text: &[u8] = &module.hir.text;
    let mut locations = Vec::new();
    for &(kind, value, pos, _) in hir.references.iter() {
        if matches!(kind, ReferenceKind::Path)
            && !options.no_resolve
            && let Ok(found) = referenced_file(
                host,
                options,
                &referenced_path(atoms.bytes(value), module.path),
                module.path,
            )
            && let Some(&target) = by_path.get(found.as_slice())
        {
            let end = pos + atoms.bytes(value).len() as u32;
            locations.push((target, 1400, pos, end));
        }
    }
    // `resolveImportsAndModuleAugmentations`: the synthetic import of the JSX runtime comes first.
    if (module.path.ends_with(b".tsx") || module.path.ends_with(b".jsx"))
        && let Some(runtime) = jsx_runtime_of(options, hir, atoms)
        && let Some(&target) = module
            .imports
            .get(&(atoms.intern(&runtime), module.default_mode))
    {
        locations.push((target, 1397, 0, 0));
    }
    // `file.Imports()`: the specifiers of statements, then those of `import()`, the call and the type.
    let mut uses = hir.specifier_uses.to_vec();
    uses.sort_by_key(|u| (u.kind.is_dynamic(), u.pos));
    for u in &uses {
        let mode = mode_for_usage_location(options, module.default_mode, u);
        if let Some(&target) = module.imports.get(&(u.spec, mode)) {
            locations.push((target, 1393, u.pos, end_of_string_literal(text, u.pos)));
        }
    }
    locations
}

/// `computeDiagnostic` of `fileIncludeKindRootFile`: the code and the arguments of the message that
/// explains why the file at `path` is a root file.
fn root_file_reason(
    options: &Options,
    path: &[u8],
    is_case_sensitive: bool,
) -> (u32, Vec<Vec<u8>>) {
    if options.config_path.is_empty() {
        return (1427, Vec::new());
    }
    if options
        .file_specs
        .iter()
        .any(|spec| is_same_name(spec, path, is_case_sensitive))
    {
        return (1409, Vec::new());
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
        Some(spec) => (1407, vec![spec.to_vec(), options.config_path.clone()]),
        None => (1427, Vec::new()),
    }
}

/// `explainRedirectAndImpliedFormat`: the code and the arguments of the message that explains the
/// module format `module` is emitted as.
fn implied_format_reason(
    resolver: &Resolver,
    options: &Options,
    module: &Module,
) -> Option<(u32, Vec<Vec<u8>>)> {
    if !module.is_module() {
        return None;
    }
    // `loadSourceFileMetaData`
    let scope = ancestors(dirname::<Posix>(module.path))
        .find_map(|dir| Some((resolver.package_json(dir)?, dir)))
        .map(|(json, dir)| (join(dir, b"package.json"), json));
    let is_type_recorded = options.resolves_like_node
        && format_by_extension(module.path) == ResolutionMode::None
        || strings::contains(module.path, b"/node_modules/");
    let package_type = scope
        .as_ref()
        .filter(|_| is_type_recorded)
        .and_then(|scope| scope.1.get(b"type"))
        .and_then(Json::as_str)
        .unwrap_or(b"");
    let package_json = scope.as_ref().map(|scope| scope.0.clone());
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

/// `sourceFileMayBeEmitted`. `GetProjectReferenceFromSource` is checked in `explain_source_files`.
fn source_file_may_be_emitted(options: &Options, module: &Module, is_case_sensitive: bool) -> bool {
    if module.is_lib || module.hir.kind == FileKind::Declaration || module.is_from_external_library
    {
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
                || contains_path(common, module.path, is_case_sensitive)
                    && !is_same_name(&options.out_dir, common, is_case_sensitive))
}

/// `createDiagnosticExplainingFile`: `code`, with the file and `arg` as arguments, for each source
/// file that would be emitted and for which `is_wrong` returns true; `is_wrong` receives whether it
/// is a root file. Each comes with the first import or `/// <reference path>` that adds the file to
/// the program (`preferredLocation`: the file and the span), which is where it is reported.
#[allow(clippy::too_many_arguments)]
fn explain_source_files(
    host: &dyn Host,
    options: &Options,
    atoms: &Interner,
    modules: &[ModuleCell],
    by_path: &ByPath,
    roots: &[Vec<u8>],
    starts: &[FileId],
    code: u32,
    arg: &[u8],
    is_wrong: &dyn Fn(&Module, bool) -> bool,
) -> Vec<(Option<(FileId, u32, u32)>, Problem)> {
    let is_case_sensitive = host.is_case_sensitive();
    let mut is_root = vec![false; modules.len()];
    for root in roots {
        if let Some(&id) = by_path.get(root.as_slice()) {
            is_root[id.idx()] = true;
        }
    }
    let mut is_reported: Vec<bool> = modules
        .iter()
        .zip(&is_root)
        .map(|(module, &is_root)| {
            let module: &Module = module;
            source_file_may_be_emitted(options, module, is_case_sensitive)
                && is_wrong(module, is_root)
        })
        .collect();
    if !is_reported.contains(&true) {
        return Vec::new();
    }
    for (i, reported) in is_reported.iter_mut().enumerate() {
        // `GetProjectReferenceFromSource`: which files belong to a referenced project is not known here.
        *reported &= is_root[i] || !options.has_project_references;
    }
    if !is_reported.contains(&true) {
        return Vec::new();
    }
    // `collectFiles`: the reason of a sub task is added before the traversal descends into it.
    let mut reasons: Vec<Vec<IncludeReason>> = vec![Vec::new(); modules.len()];
    let mut locations: FxHashMap<FileId, Vec<(FileId, u32, u32, u32)>> = FxHashMap::default();
    let mut seen = vec![false; modules.len()];
    for &first in starts {
        if is_reported[first.idx()] && is_root[first.idx()] {
            reasons[first.idx()].push(IncludeReason::RootFile);
        }
        // (file, how many of its edges have been followed, how many of its references have been
        // passed, whether it refers to a reported file)
        let refers_to_reported =
            |file: FileId| (modules[file.idx()].edges.iter()).any(|edge| is_reported[edge.idx()]);
        let mut stack: Vec<(FileId, usize, usize, bool)> = Vec::new();
        if !std::mem::replace(&mut seen[first.idx()], true) {
            stack.push((first, 0, 0, refers_to_reported(first)));
        }
        while let Some(top) = stack.last_mut() {
            let (file, next, _, refers_to_reported_file) = *top;
            let edges = modules[file.idx()].edges;
            let edge = edges.get(next).copied();
            // `subTasks` has a task for each reference. The reason of one that repeats an earlier
            // reference of the file is added when the traversal gets to it.
            if refers_to_reported_file {
                let found = locations.entry(file).or_insert_with(|| {
                    reference_locations(host, options, atoms, by_path, &modules[file.idx()])
                });
                while let Some(&(target, code, start, end)) = found.get(top.2) {
                    let is_repeated = edges[..next].contains(&target);
                    if !is_repeated && Some(target) != edge {
                        break;
                    }
                    top.2 += 1;
                    if is_reported[target.idx()] {
                        reasons[target.idx()].push(IncludeReason::Reference {
                            code,
                            from: file,
                            start,
                            end,
                        });
                    }
                    if !is_repeated {
                        break;
                    }
                }
            }
            let Some(edge) = edge else {
                stack.pop();
                continue;
            };
            top.1 += 1;
            if !std::mem::replace(&mut seen[edge.idx()], true) {
                stack.push((edge, 0, 0, refers_to_reported(edge)));
            }
        }
    }
    let resolving = Session::new();
    let resolver = Resolver::new(&resolving, host, options);
    let mut problems = Vec::new();
    for (i, module) in modules.iter().enumerate() {
        let reasons = &reasons[i];
        if !is_reported[i] || reasons.is_empty() {
            continue;
        }
        let preferred_location = reasons.iter().find_map(|reason| match *reason {
            // `isSynthetic`
            IncludeReason::Reference { code: 1397, .. } => None,
            IncludeReason::Reference {
                from, start, end, ..
            } => Some((from, start, end)),
            IncludeReason::RootFile => None,
        });
        let mut problem = Problem::new(code, &[module.path, arg], Place::Nowhere);
        if preferred_location.is_none() || reasons.len() != 1 {
            problem = problem.with(1, 1430, &[]);
            for reason in reasons {
                problem = match *reason {
                    IncludeReason::RootFile => {
                        let (code, args) =
                            root_file_reason(options, module.path, is_case_sensitive);
                        let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
                        problem.with(2, code, &args)
                    }
                    IncludeReason::Reference {
                        code,
                        from,
                        start,
                        end,
                    } => {
                        let from = &modules[from.idx()];
                        let synthetic = (code == 1397)
                            .then(|| jsx_runtime_of(options, &from.hir, atoms))
                            .flatten()
                            .map(|runtime| [&b"\""[..], &runtime[..], b"\""].concat());
                        let written = match &synthetic {
                            Some(specifier) => specifier.as_slice(),
                            None => from
                                .hir
                                .text
                                .get(start as usize..end as usize)
                                .unwrap_or_default(),
                        };
                        problem.with(2, code, &[written, from.path])
                    }
                };
            }
        }
        if let Some((code, args)) = implied_format_reason(&resolver, options, module) {
            let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
            problem = problem.with(1, code, &args);
        }
        problems.push((preferred_location, problem));
    }
    problems
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
fn declaration_emit_output_file_path(
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

/// `verifyEmitFilePath`: 5055 for an output file that is an input file, 5056 for one that two input
/// files are emitted to. Errors reported at a position in a file go to `include_errors`. With them,
/// `CommonSourceDirectory`, if anything depends on it.
#[allow(clippy::too_many_arguments)]
fn output_path_errors(
    host: &dyn Host,
    options: &Options,
    atoms: &Interner,
    modules: &[ModuleCell],
    by_path: &ByPath,
    roots: &[Vec<u8>],
    starts: &[FileId],
    include_errors: &mut Vec<(FileId, u32, u32, Problem)>,
) -> (Vec<Problem>, Option<Vec<u8>>) {
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
        let mut pending: Vec<FileId> = (own.filter_map(|it| by_path.get(it.as_slice())))
            .copied()
            .collect();
        let mut is_reached = vec![false; modules.len()];
        while let Some(file) = pending.pop() {
            if !std::mem::replace(&mut is_reached[file.idx()], true) {
                pending.extend(modules[file.idx()].edges);
            }
        }
        is_reached
    });
    let is_own = |module: &Module| match &reached_from_own_roots {
        Some(is_reached) => (by_path.get(module.path)).is_some_and(|file| is_reached[file.idx()]),
        None => true,
    };
    let sources: Vec<&Module> = modules
        .iter()
        .map(|module| &**module)
        .filter(|module| source_file_may_be_emitted(options, module, is_case_sensitive))
        .filter(|module| is_own(module))
        .collect();
    let paths: Vec<&[u8]> = sources.iter().map(|module| module.path).collect();
    let explain = |code: u32, arg: &[u8], is_wrong: &dyn Fn(&Module, bool) -> bool| {
        explain_source_files(
            host, options, atoms, modules, by_path, roots, starts, code, arg, is_wrong,
        )
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
                !contains_path(specified, module.path, is_case_sensitive) && is_own(module)
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
        && !is_same_name(
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
        let relative = crate::verify::relative_from_file(&options.config_path, &computed);
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
        if by_path.contains_key(output.as_slice()) {
            let problem = Problem::new(5055, &[&output], Place::Nowhere);
            errors.push(if options.has_config_file {
                problem
            } else {
                problem.with(1, 5068, &[])
            });
        }
        let key = if is_case_sensitive {
            output.clone()
        } else {
            to_file_name_lower_case(&output)
        };
        if seen.contains(&key) {
            errors.push(Problem::new(5056, &[&output], Place::Nowhere));
        } else {
            seen.insert(key);
        }
    };
    for module in sources {
        let path = module.path;
        let is_json = module.hir.kind == FileKind::Json;
        let is_one_of = |extensions: [&[u8]; 2]| file_extension_is_one_of(path, &extensions);
        if !options.emit_declaration_only {
            // `GetOutputExtension`
            let extension: &[u8] = if is_json {
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
            let moved = source_file_path_in_new_dir(
                &options.out_dir,
                path,
                common.as_deref(),
                is_case_sensitive,
            );
            let output = [remove_file_extension(&moved), extension].concat();
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
    (errors, common)
}

/// `GetSymbolNameForPrivateIdentifier`: `#x` is scoped to the class that declares it. From here on
/// it is spelled `#x@<hash of the path>.<class>`, at its declaration and at every reference. An
/// `#x` that no enclosing class declares stays `#x`, which resolves to nothing.
fn rename_private_names(hir: &mut hir::File, bound: &Bound, atoms: &Interner, path: &[u8]) {
    let file = crate::util::spread_hash(path);
    let renamed = |class: u32, name: Atom| {
        let mut spelled = atoms.bytes(name).to_vec();
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
    for (&e, &class) in &bound.private_class {
        if let ExprKind::Dot { name, .. } | ExprKind::String(name) = &mut hir.exprs[e.idx()].kind {
            *name = renamed(class.0, *name);
        }
    }
}

/// `collectModuleReferences`: whether the `declare global` of `symbol` augments the global scope.
/// It does at the top level of a module, and directly inside a `declare module "m"` at the top
/// level of a script.
fn is_global_augmentation(module: &Module, symbol: SymbolId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_it = |s: StmtId| matches!(hir[s].kind, StmtKind::Module(m) if bound.module_symbol[m.idx()] == symbol);
    if module.is_module() {
        return hir.ids(hir.body).any(is_it);
    }
    hir.ids(hir.body).any(|s| {
        let StmtKind::Module(m) = hir[s].kind else {
            return false;
        };
        !matches!(hir[m].name, ModuleName::Ident(_))
            && (hir[m].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration)
            && hir.ids(hir[m].body).any(is_it)
    })
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
        let mut by_path: ByPath<'s> = map_in(arena);
        let mut by_package_id: FxHashMap<Vec<u8>, u32> = FxHashMap::default();
        let mut all_found = Found::default();
        let mut modules: Vec<Option<Module>> = Vec::new();
        // `parseTaskData.lowestDepth`, indexed by `FileId`: the minimum number of steps into
        // packages (`increaseDepth`) on a path from a root file.
        let mut depths: Vec<u32> = Vec::new();
        let mut frontier: Vec<(FileId, &'s [u8], bool)> = Vec::new();
        let mut add = |path: &[u8],
                       is_lib: bool,
                       depth: u32,
                       modules: &mut Vec<Option<Module>>,
                       depths: &mut Vec<u32>,
                       frontier: &mut Vec<(FileId, &'s [u8], bool)>,
                       found: &mut Found<'s>|
         -> FileId {
            if let Some(&id) = by_path.get(path) {
                depths[id.idx()] = depths[id.idx()].min(depth);
                return id;
            }
            let path = slice_in(path, arena);
            // Of the copies of a package file, the one that `collectFiles` comes to first is in the
            // program. That is probably the one that is found first, so another one is only read
            // if it turns out to be the one.
            let (mut package, mut is_read) = (None, true);
            if !options.retains_duplicate_packages
                && let Some(package_id) = resolver.package_id(path)
            {
                let new = found.kept.len() as u32;
                let index = *by_package_id.entry(package_id).or_insert(new);
                if index == new {
                    found.kept.push(None);
                } else {
                    is_read = found.is_collecting && found.kept[index as usize].is_none();
                }
                package = Some(index);
            }
            let id = FileId(modules.len() as u32);
            modules.push(None);
            depths.push(depth);
            by_path.insert(path, id);
            found.files.push(FoundFile {
                path,
                is_lib,
                package,
            });
            if is_read {
                frontier.push((id, path, is_lib));
            }
            id
        };

        let mut starts: Vec<FileId> = Vec::new();
        // `processAllProgramFiles`: without root files there are no libraries and no automatic type directives.
        let has_root_files = !roots.is_empty();
        for lib in options.libs.iter().filter(|_| has_root_files) {
            let lib = lib_file_stem(host, options, lib);
            let (path, is_lib) = lib_path(&resolver, options, lib);
            starts.push(add(
                &path,
                is_lib,
                0,
                &mut modules,
                &mut depths,
                &mut frontier,
                &mut all_found,
            ));
        }
        let libs_end = starts.len();
        let mut program_errors = Vec::new();
        for root in roots {
            // `addRootFileTask`
            let found = referenced_file(host, options, root, b"").map(|found| {
                match options.parse_file_redirect(&found) {
                    Some(output) => host.is_file(output).then(|| output.to_vec()),
                    None => Some(found),
                }
            });
            match found {
                // The declaration file has not been built: nothing is read.
                Ok(None) => {}
                Ok(Some(found)) => starts.push(add(
                    &found,
                    false,
                    0,
                    &mut modules,
                    &mut depths,
                    &mut frontier,
                    &mut all_found,
                )),
                Err(code) => {
                    let (reason, args) = root_file_reason(options, root, host.is_case_sensitive());
                    let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
                    let problem = reference_problem(options, code, root);
                    program_errors.push(problem.with(1, 1430, &[]).with(2, reason, &args));
                }
            }
        }
        let roots_end = starts.len();
        let directives = if has_root_files {
            automatic_type_directives(host, &resolver, options)
        } else {
            Vec::new()
        };
        let mut automatic_tracer = options.trace_resolution.then(Tracer::default);
        // `addAutomaticTypeDirectiveTasks`
        let containing_file = inside(&options.base_dir, INFERRED_TYPES_CONTAINING_FILE);
        for name in &directives {
            match resolver.resolve_type_reference(
                name,
                &containing_file,
                ResolutionMode::None,
                automatic_tracer.as_ref(),
            ) {
                Some((path, is_external)) => {
                    let depth = u32::from(is_external);
                    starts.push(add(
                        &path,
                        false,
                        depth,
                        &mut modules,
                        &mut depths,
                        &mut frontier,
                        &mut all_found,
                    ));
                }
                // `*` matches whatever exists.
                None if name == b"*" => {}
                None => program_errors.push(
                    Problem::new(2688, &[name], Place::Nowhere)
                        .with(1, 1430, &[])
                        .with(
                            2,
                            if options.types.is_some() { 1417 } else { 1420 },
                            &[name],
                        ),
                ),
            }
        }

        // Imports that are resolved without adding the file to the program: they resolve if the
        // file is in the program for another reason.
        let mut only_found: Vec<(FileId, Atom, ResolutionMode, &[u8])> = Vec::new();
        // The sub tasks: from which file to which, and `increaseDepth`.
        let mut steps: Vec<(FileId, FileId, bool)> = Vec::new();
        let mut is_first = true;
        let mut ahead: FxHashMap<&[u8], Box<Loaded>> = FxHashMap::default();
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
        // What `traceResolution` logs, in order.
        let mut log: Vec<DiagAndArgs> = Vec::new();
        'load: loop {
            while !frontier.is_empty() {
                let batch = std::mem::take(&mut frontier);
                if is_first {
                    is_first = false;
                    let seeds = batch
                        .iter()
                        .map(|&(_, path, is_lib)| (path, is_lib))
                        .collect();
                    ahead = Self::load_ahead(session, host, &resolver, options, &atoms, seeds);
                }
                let results: Vec<Guarded<Option<Box<Loaded>>>> = batch
                    .iter()
                    .map(|&(_, path, is_lib)| {
                        let loaded = ahead.remove(path);
                        Guarded::new(loaded.filter(|loaded| loaded.module.is_lib == is_lib))
                    })
                    .collect();
                // Files that could not be predicted to be part of the program.
                let missing: Vec<usize> = (0..batch.len())
                    .filter(|&i| results[i].lock().is_none())
                    .collect();
                let paths: Vec<&[u8]> = missing.iter().map(|&i| batch[i].1).collect();
                read_and_work(host, &paths, &|at, text| {
                    let (_, path, is_lib) = batch[missing[at]];
                    *results[missing[at]].lock() = Some(Box::new(Self::load_one(
                        session.arena(),
                        host,
                        &resolver,
                        options,
                        &atoms,
                        path,
                        is_lib,
                        text,
                    )));
                });
                let _linking = Spent::on(host, Phase::Link);
                for ((id, _, _), result) in batch.iter().zip(results) {
                    let mut loaded = *result.lock().take().unwrap();
                    // `filesParser.start`: the sub tasks of a file start once, at the lowest depth the file has been reached at by then.
                    let depth = depths[id.idx()];
                    edges.clear();
                    for &(path, is_lib, increases_depth) in &loaded.references {
                        let target = add(
                            path,
                            is_lib,
                            depth + u32::from(increases_depth),
                            &mut modules,
                            &mut depths,
                            &mut frontier,
                            &mut all_found,
                        );
                        edges.push(target);
                        steps.push((*id, target, increases_depth));
                    }
                    // The one that `load_one` created is empty, and belongs to another thread.
                    loaded.module.imports = ArenaHashMap::with_capacity_and_hasher_in(
                        loaded.imports.len(),
                        FxBuild,
                        arena,
                    );
                    for &(spec, mode, path, brings_in, increases_depth) in &loaded.imports {
                        let depth = depth + u32::from(increases_depth);
                        // `elideOnDepth`, `isJsFileFromNodeModules`: JavaScript deeper inside packages than `maxNodeModuleJsDepth` is not loaded.
                        let is_elided = increases_depth
                            && is_javascript(path)
                            && strings::contains(path, b"/node_modules/")
                            && depth > options.max_node_module_js_depth;
                        // `shouldAddFile`: with `noResolve` no import adds a file.
                        if !brings_in || is_elided || options.no_resolve {
                            only_found.push((*id, spec, mode, path));
                            continue;
                        }
                        let target = add(
                            path,
                            false,
                            depth,
                            &mut modules,
                            &mut depths,
                            &mut frontier,
                            &mut all_found,
                        );
                        loaded.module.imports.insert((spec, mode), target);
                        edges.push(target);
                        steps.push((*id, target, increases_depth));
                    }
                    loaded.module.edges = slice_in(&edges, arena);
                    if options.trace_resolution {
                        traces.resize_with(traces.len().max(id.idx() + 1), Vec::new);
                        traces[id.idx()] = std::mem::take(&mut loaded.traces);
                    }
                    modules[id.idx()] = Some(loaded.module);
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
                        let edges = modules[top.0.idx()].as_ref().map_or(&[][..], |it| it.edges);
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
                            let automatic = automatic_tracer.take();
                            log.extend(automatic.map(Tracer::into_traces).unwrap_or_default());
                            continue;
                        };
                        start
                    }
                };
                if seen[file.idx()] {
                    continue;
                }
                let FoundFile {
                    path,
                    is_lib,
                    package,
                } = all_found.files[file.idx()];
                if let Some(package) = package {
                    let kept = *all_found.kept[package as usize].get_or_insert(file);
                    if kept != file {
                        seen[file.idx()] = true;
                        redirects.push((file, kept));
                        // It has been parsed, and what it imports has been resolved.
                        if options.trace_resolution && modules[file.idx()].is_none() {
                            let text = host.read_source(path);
                            let arena = session.arena();
                            let loaded = Self::load_one(
                                arena, host, &resolver, options, &atoms, path, is_lib, text,
                            );
                            log.extend(loaded.traces);
                        }
                        log.append(&mut traces[file.idx()]);
                        continue;
                    }
                }
                if modules[file.idx()].is_none() {
                    // It is the one after all. The step is taken again when it has been read.
                    match stack.last_mut() {
                        Some(top) => top.1 -= 1,
                        None => next_root_task -= 1,
                    }
                    frontier.push((file, path, is_lib));
                    continue 'load;
                }
                seen[file.idx()] = true;
                log.append(&mut traces[file.idx()]);
                stack.push((file, 0));
            }
        }
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
                depths[kept.idx()] = depths[kept.idx()].min(depths[copy.idx()]);
            }
            // What a file in the program refers to has been come to.
            let renumber = |file: FileId| renumbered[file.idx()].unwrap_or(file);
            let mut file = 0;
            modules.retain_mut(|module| {
                file += 1;
                if let Some(module) = module.as_mut().filter(|_| is_kept[file - 1]) {
                    edges.clear();
                    edges.extend(module.edges.iter().map(|&edge| renumber(edge)));
                    module.edges = slice_in(&edges, arena);
                    for target in module.imports.values_mut() {
                        *target = renumber(*target);
                    }
                }
                is_kept[file - 1]
            });
            let mut file = 0;
            depths.retain(|_| {
                file += 1;
                is_kept[file - 1]
            });
            by_path.retain(|_, file| match renumbered[file.idx()] {
                Some(new) => {
                    *file = new;
                    true
                }
                None => false,
            });
            steps.retain_mut(|(from, to, _)| {
                let is_in_program = is_kept[from.idx()];
                (*from, *to) = (renumber(*from), renumber(*to));
                is_in_program
            });
            only_found.retain_mut(|(file, ..)| {
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
                .map(|lib| lib_file_stem(host, options, lib).to_vec())
                .collect();
            for module in modules.iter().flatten().filter(|_| !options.no_lib) {
                for &(kind, value, ..) in &module.hir.references {
                    if kind != ReferenceKind::Lib {
                        continue;
                    }
                    let name = lib_name(atoms.bytes(value));
                    let name = lib_file_stem(host, options, &name);
                    if host.is_file(&lib_file(options, name)) {
                        libs.push(name.to_vec());
                    }
                }
            }
            let mut lookups: Vec<_> = (libs.iter())
                .map(|lib| library_name_and_resolve_from(options, lib))
                .map(|(name, from)| match host.is_case_sensitive() {
                    true => (from.clone(), name, from),
                    false => (to_file_name_lower_case(&from), name, from),
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
        // `lowestDepth`: the minimum over all paths to a file. ("If we're seeing this task at a
        // lower depth than before, reprocess its subtasks": `filesParser.start` of 7.0.2 starts
        // them once, so there it depends on which thread came first.)
        loop {
            let mut is_lower = false;
            for &(from, to, increases_depth) in &steps {
                let depth = depths[from.idx()] + u32::from(increases_depth);
                is_lower |= depth < depths[to.idx()];
                depths[to.idx()] = depths[to.idx()].min(depth);
            }
            if !is_lower {
                break;
            }
        }
        for (module, &depth) in modules.iter_mut().flatten().zip(&depths) {
            module.is_from_external_library = depth > 0;
        }
        program_errors.extend(resolver.resolution_problems());
        for (id, spec, mode, path) in only_found {
            if let Some(&target) = by_path.get(path)
                && let Some(module) = &mut modules[id.idx()]
            {
                module.imports.insert((spec, mode), target);
            }
        }

        // `redirectFilesByPath`: the paths that alias a file that is stored under another path.
        let kept: FxHashMap<FileId, &[u8]> = by_path
            .iter()
            .filter_map(|(&path, &id)| {
                let kept = modules[id.idx()].as_ref()?.path;
                (kept != path).then_some((id, kept))
            })
            .collect();
        if !kept.is_empty() {
            for module in modules.iter_mut().flatten() {
                let mut redirected = Vec::new();
                for (&(spec, mode), target) in &module.imports {
                    let (resolver, from) = resolver.redirect_for_resolution(module.path);
                    if let Some(kept) = kept.get(target)
                        && let Some(found) =
                            resolver.resolve_module_name(atoms.bytes(spec), from, mode)
                        && found.file_name != *kept
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
            for (&path, id) in &by_path {
                if kept.get(id).is_some_and(|&kept| kept != path) {
                    duplicates.entry(*id).or_default().push(path);
                }
            }
            for (id, mut paths) in duplicates {
                paths.sort();
                redirect_targets.insert(id, slice_in(&paths, arena));
            }
        }
        let mut package_jsons: FxHashMap<&'s [u8], Json> = FxHashMap::default();
        for module in modules.iter().flatten() {
            let path: &'s [u8] = module.path;
            if let Some((_, _, end)) = crate::resolve::node_module_path_parts(path)
                && !package_jsons.contains_key(&path[..end])
                && let Some(json) = resolver.package_json(&path[..end])
            {
                package_jsons.insert(&path[..end], json);
            }
        }
        let mut linked_directories: &'s [(&'s [u8], &'s [u8])] = &[];
        // `SourceFileMayBeEmitted`
        let emitted = modules.iter().flatten().filter(|module| {
            matches!(module.hir.kind, hir::FileKind::Ts | hir::FileKind::Tsx)
                && !module.is_lib
                && !strings::contains(module.path, b"/node_modules/")
        });
        let found = resolver.linked_directories(emitted.map(|module| module.path));
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
                let is_alternative_container = options.emits_declarations
                    && (module.hir.stmts.iter()).any(|statement| {
                        matches!(
                            statement.kind,
                            StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. }
                        )
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
        let mut include_errors = Vec::new();
        let (output_path_errors, common_source_directory) = output_path_errors(
            host,
            options,
            &atoms,
            &modules,
            &by_path,
            roots,
            &starts,
            &mut include_errors,
        );
        program_errors.extend(output_path_errors);
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
            files_of_refused_merges: set_in(arena),
            circular_at_merge: ArenaVec::new_in(arena),
            resolved_at_merge: ArenaVec::new_in(arena),
            module_links_at_merge: Guarded::new(ArenaVec::new_in(arena)),
            modules_resolved_at_merge: &[],
            keeps_module_links: false,
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
        };
        let merging = Spent::on(host, Phase::Merge);
        files.order = slice_in(&files.declaration_order(&starts), arena);
        if options.trace_resolution {
            let mut all = log;
            all.extend(lib_traces);
            // `packageJsonInfoCache`. `loadSourceFileMetaData` looks for the scope of a file before
            // anything in the file is resolved.
            let key = |path: &[u8]| match host.is_case_sensitive() {
                true => path.to_vec(),
                false => to_file_name_lower_case(path),
            };
            let mut cached: FxHashSet<Vec<u8>> = FxHashSet::default();
            let mut with_scope: FxHashSet<Vec<u8>> = FxHashSet::default();
            for trace in &mut all {
                match trace.code {
                    6086 | 6116 => {
                        let from = &trace.args[1][..];
                        if !files.by_path.contains_key(from) {
                            continue;
                        }
                        for dir in ancestors(dirname::<Posix>(from)) {
                            if !with_scope.insert(dir.to_vec()) {
                                break;
                            }
                            let path = inside(dir, b"package.json");
                            cached.insert(key(&path));
                            if host.is_file(&path) {
                                break;
                            }
                        }
                    }
                    6239 if cached.insert(key(&trace.args[0])) => trace.code = 6099,
                    6240 if cached.insert(key(&trace.args[0])) => trace.code = 6096,
                    _ => {}
                }
            }
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
        options: &Options,
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
                    // Same as in the waves, except for whatever depends on a file's depth in
                    // packages.
                    let found = loaded
                        .references
                        .iter()
                        .map(|&(path, is_lib, _)| (path, is_lib))
                        .chain(
                            loaded
                                .imports
                                .iter()
                                .filter(|(_, _, path, brings_in, _)| {
                                    *brings_in
                                        && !options.no_resolve
                                        && !(is_javascript(path)
                                            && strings::contains(path, b"/node_modules/"))
                                })
                                .map(|&(_, _, path, ..)| (path, false)),
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
    #[allow(clippy::too_many_arguments)]
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
        // The source text of the default library is only consulted where it is checked.
        if !is_lib || !(options.skip_lib_check || options.skip_default_lib_check) {
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

    #[allow(clippy::too_many_arguments)]
    fn load_one<'r>(
        arena: &'s Arena,
        host: &dyn Host,
        resolver: &Resolver<'r>,
        options: &Options,
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
        let implied_format = resolver.implied_format(path);
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
        let default_mode = options.default_mode(implied_format);
        let mut imports = Vec::new();
        let (mut untyped_imports, mut jsx_imports, mut untyped_package_imports) =
            (Vec::new(), Vec::new(), Vec::new());
        let mut untyped_import_files = Vec::new();
        let mut resolved_packages: Vec<(Atom, bool)> = Vec::new();
        let note_package =
            |packages: &mut Vec<(Atom, bool)>, resolved: &crate::resolve::ResolvedModule<'_>| {
                if let Some(name) = resolved.package_name {
                    let package = (atoms.intern(name), resolved.file_name.ends_with(b".d.ts"));
                    if !packages.contains(&package) {
                        packages.push(package);
                    }
                }
            };
        let mut untyped_import_alternates = Vec::new();
        let mut ts_extension_imports = Vec::new();
        let mut project_reference_imports = Vec::new();
        let mut unbuilt_imports = Vec::new();
        let mut arbitrary_extension_imports = Vec::new();
        let mut arbitrary_extension_files = Vec::new();
        let mut extensionless_imports = Vec::new();
        // `resolveImportsAndModuleAugmentations`: with `importHelpers`, a file that can be emitted with helpers imports `tslib`.
        let imports_helpers = options.import_helpers
            && (hir.is_js
                || hir.kind != FileKind::Declaration
                    && (options.isolated_modules || hir.has_module_syntax));
        if imports_helpers
            && let Some(resolved) = resolver.resolve_module_name(b"tslib", from, default_mode)
        {
            note_package(&mut resolved_packages, &resolved);
            let found = resolved.file_name;
            let tslib = known::tslib;
            if is_javascript(found) {
                untyped_imports.push((tslib, default_mode));
                let package = resolved.package_name.map(|name| atoms.intern(name));
                untyped_import_files.push((atoms.intern(found), package));
            } else {
                let increases_depth = resolved.is_external_library_import;
                imports.push((tslib, default_mode, found, true, increases_depth));
            }
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
            if imports_helpers {
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
            for name in module_augmentations(&hir, atoms) {
                trace(atoms.bytes(name), default_mode);
            }
        }
        if let Some((spec, runtime)) = runtime
            && let Some(resolved) = resolver.resolve_module_name(&runtime, from, default_mode)
        {
            note_package(&mut resolved_packages, &resolved);
            let found = resolved.file_name;
            let is_untyped = is_javascript(found);
            if is_untyped {
                untyped_imports.push((spec, default_mode));
                if let Some(types) = resolved.alternate_result {
                    let types = atoms.intern(types);
                    untyped_import_alternates.push((spec, default_mode, types));
                }
                let package = resolved.package_name.map(|name| atoms.intern(name));
                untyped_import_files.push((atoms.intern(found), package));
                if strings::contains(found, b"/node_modules/") {
                    untyped_package_imports.push((spec, default_mode));
                }
            }
            if !is_untyped || options.allow_js {
                let increases_depth = resolved.is_external_library_import;
                imports.push((spec, default_mode, found, true, increases_depth));
            }
        }

        // `collectModuleReferences`: of the imports in the body of a `declare module "m"` in a
        // script, only non-relative specifiers are resolved. Statements come before `import()` and
        // the like.
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
            // It is resolved in each mode that a use in the file requests, in the order of the
            // uses, calls last.
            let uses = || hir.specifier_uses.iter().filter(move |u| u.spec == spec);
            let written = uses().filter(|u| !u.kind.is_call());
            let written = written.chain(uses().filter(|u| u.kind.is_call()));
            let mut modes = [default_mode; 3];
            let mut count = 0;
            for mode in written.map(|u| mode_for_usage_location(options, default_mode, u)) {
                if !modes[..count].contains(&mode) {
                    modes[count] = mode;
                    count += 1;
                }
            }
            let imported = count;
            // A module augmentation resolves the module the way the file itself would, regardless
            // of other uses of the specifier. It does not add the file to the program.
            let is_module_name = bound.ambient_modules.iter().any(|m| m.0 == spec);
            if (count == 0 || is_module_name && hir.has_module_syntax)
                && !modes[..count].contains(&default_mode)
            {
                modes[count] = default_mode;
                count += 1;
            }
            for (i, &mode) in modes[..count].iter().enumerate() {
                let Some(resolved) = resolver.resolve_module_name(text, from, mode) else {
                    continue;
                };
                note_package(&mut resolved_packages, &resolved);
                let increases_depth = resolved.is_external_library_import;
                // `GetResolutionDiagnostic`, `needAllowJs`: the file is not added, so it is not redirected either.
                let needs_allow_js = is_javascript(resolved.file_name)
                    && !options.allow_js
                    && options.no_implicit_any;
                // `getParseFileRedirect`: the declaration file is read in place of a source of a referenced project.
                if !needs_allow_js
                    && let Some(output) = of_program.parse_file_redirect(resolved.file_name)
                {
                    if host.is_file(output) {
                        let brings_in = i < imported || !is_module_name;
                        let output = resolver.keep(output);
                        imports.push((spec, mode, output, brings_in, increases_depth));
                    } else {
                        let source = atoms.intern(resolved.file_name);
                        unbuilt_imports.push((spec, mode, atoms.intern(output), source));
                    }
                    continue;
                }
                match resolved.file_name {
                    found if is_javascript(found) => {
                        untyped_imports.push((spec, mode));
                        if let Some(types) = resolved.alternate_result {
                            let types = atoms.intern(types);
                            untyped_import_alternates.push((spec, mode, types));
                        }
                        let package = resolved.package_name.map(|name| atoms.intern(name));
                        untyped_import_files.push((atoms.intern(found), package));
                        let needs_jsx = options.jsx == JsxEmit::None && found.ends_with(b".jsx");
                        if needs_jsx {
                            jsx_imports.push((spec, mode, atoms.intern(found)));
                        }
                        if strings::contains(found, b"/node_modules/") {
                            untyped_package_imports.push((spec, mode));
                        }
                        // `shouldAddFile`: with `allowJs`, JavaScript is loaded like any other file. `Files::load` skips files too deep
                        // inside packages. A file that is not loaded for this import is still linked if it is in the program for
                        // another reason.
                        if options.allow_js {
                            let brings_in = !needs_jsx && (i < imported || !is_module_name);
                            imports.push((spec, mode, found, brings_in, increases_depth));
                        }
                    }
                    // `needAllowArbitraryExtensions`: the file is rejected, even if it is in the
                    // program for another reason.
                    found
                        if resolved.has_arbitrary_extension
                            && hir.kind != FileKind::Declaration
                            && !options.allow_arbitrary_extensions =>
                    {
                        arbitrary_extension_imports.push((spec, mode));
                        arbitrary_extension_files.push(atoms.intern(found));
                    }
                    found => {
                        if resolved.using_ts_extension {
                            ts_extension_imports.push((spec, mode));
                        }
                        let is_redirect = resolved.is_project_reference_redirect;
                        if is_redirect {
                            project_reference_imports.push((spec, mode));
                        }
                        let needs_jsx = options.jsx == JsxEmit::None
                            && !is_redirect
                            && found.ends_with(b".tsx");
                        if needs_jsx {
                            jsx_imports.push((spec, mode, atoms.intern(found)));
                        }
                        let brings_in = !needs_jsx && (i < imported || !is_module_name);
                        imports.push((spec, mode, found, brings_in, increases_depth));
                    }
                }
            }
        }
        // They are processed by kind: paths, then types, then libraries.
        let (mut references, mut types, mut libs) = (Vec::new(), Vec::new(), Vec::new());
        let mut missing_references = Vec::new();
        for &(kind, value, pos, mode) in &hir.references {
            // `noResolve`: only library references are still processed.
            if options.no_resolve && matches!(kind, ReferenceKind::Path | ReferenceKind::Types) {
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
                    let name = lib_name(value);
                    let name = lib_file_stem(host, of_program, &name);
                    // `GetLibFileName`: whether such a library exists does not depend on what
                    // replaces it.
                    if host.is_file(&lib_file(of_program, name)) {
                        let (found, is_lib) = lib_path(program_resolver, of_program, name);
                        libs.push((resolver.keep(&found), is_lib, false));
                    } else {
                        missing_references.push((pos, 2726));
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
            path: slice_in(path, arena),
            hir,
            bound,
            is_lib,
            // `load` fills `imports` and `edges`.
            imports: map_in(arena),
            untyped_imports: few(untyped_imports, arena),
            untyped_import_files: few(untyped_import_files, arena),
            resolved_packages: few(resolved_packages, arena),
            untyped_import_alternates: few(untyped_import_alternates, arena),
            jsx_imports: few(jsx_imports, arena),
            untyped_package_imports: few(untyped_package_imports, arena),
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
            && module.bound.umd_globals.is_empty()
            // `make_module_clones`: it adds a symbol to the file of what it imports.
            && !(module.hir.imports.iter()).any(|import| import.namespace.is_some());
        let mut traces = types_tracer.into_traces();
        traces.extend(tracer.into_traces());
        Loaded {
            module,
            imports,
            references,
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
        if !module.path.ends_with(b".tsx") && !module.path.ends_with(b".jsx") {
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
        let path = self.modules[file.idx()].path;
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

    /// `getProcessedFiles`: the libraries first, sorted (`sortLibs`); then from each starting point depth first, a file after
    /// everything it refers to.
    fn declaration_order(&self, starts: &[FileId]) -> Vec<FileId> {
        let mut seen = vec![false; self.modules.len()];
        let mut libs = Vec::new();
        let mut others = Vec::new();
        for &start in starts {
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
            if augmentations {
                for &augmentation in &module.bound.global_augmentations {
                    if !is_global_augmentation(module, augmentation) {
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
            for at in 0..self.modules[file].bound.ambient_modules.len() {
                let (name, symbol, is_augmentation) = self.modules[file].bound.ambient_modules[at];
                let sym = Sym {
                    file: id,
                    id: symbol,
                };
                if is_augmentation {
                    augmentations.push((id, name, sym));
                    continue;
                }
                // `TryParsePattern`: exactly one `*` makes the name a pattern. It is also an
                // ordinary name.
                let text = self.atoms.bytes(name);
                if let Some(star) = strings::index_of_char_usize(text, b'*')
                    && !strings::contains_char(&text[star + 1..], b'*')
                {
                    let prefix = slice_in(&text[..star], self.arena);
                    let suffix = slice_in(&text[star + 1..], self.arena);
                    self.ambient_patterns.push((prefix, suffix, sym));
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
        // `IsNonLocalAlias`
        let meanings = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let is_alias = target_flags.contains(SymFlags::ALIAS) && !target_flags.intersects(meanings);
        // `reportMergeSymbolError`. "Assignment declarations are allowed to merge with variables, no matter what other flags they have."
        if target_flags.intersects(get_excluded_symbol_flags(source_flags))
            && !(source_flags | target_flags).contains(SymFlags::ASSIGNMENT)
        {
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
                match self.resolve_alias_as(target, meanings) {
                    Some(found) if found == source => return source,
                    // If the two cannot merge, the added symbol takes the name.
                    Some(found)
                        if self
                            .flags(found)
                            .intersects(get_excluded_symbol_flags(source_flags)) =>
                    {
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
        let name = referenced_path(written, self.module(origin).path);
        if has_extension(&name) {
            if unsupported_extension_error(self.options, &name).is_some() {
                return None;
            }
            return self.by_path.get(&name[..]).copied();
        }
        let mut extensions = supported_extensions(self.options)[0].iter();
        extensions.find_map(|it| {
            self.by_path
                .get(&[&name[..], &it[..]].concat()[..])
                .copied()
        })
    }

    /// `GetOutputPathsFor(file).DeclarationFilePath()`
    pub fn declaration_file_path(&self, file: FileId) -> Vec<u8> {
        declaration_emit_output_file_path(
            self.options,
            self.module(file).path,
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
    #[inline]
    pub fn global_type_of_arity(&self, name: Atom, arity: usize) -> Option<Sym> {
        let global = match self.global_types.get(name.0 as usize) {
            Some(&known) => known,
            None => self.global_type(name),
        };
        let has_arity = global.arity != u8::MAX && usize::from(global.arity) == arity;
        global.symbol.filter(|_| has_arity)
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
        let symbol = self.symbol(sym);
        if symbol.flags.contains(SymFlags::MERGED) {
            return self.parent_of_symbol(sym);
        }
        symbol.parent.is_some().then_some(Sym {
            file: sym.file,
            id: symbol.parent,
        })
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
                    .spec
                    .is_some()
                    .then_some((export.spec, mode, hir[s].local))
            }
            Decl::Require(pat) => {
                let (spec, name) = self.bound(file).required_by(hir, pat)?;
                Some((spec, ResolutionMode::Require, name?))
            }
            _ => None,
        }
    }

    /// The same. `lookup`: `NameResolver.Lookup`, which receives the table, its entry for `name`,
    /// and the meaning.
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
            if let Some(code) = bound.type_parameter_out_of_reach(scope, name, meaning) {
                return Err((code, MemberId::NONE));
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
                // An entry that only an export specifier created is not in scope. That is decided
                // before the alias is resolved, because its target may be the very name being
                // resolved.
                let container = self.sym(file, s.symbol);
                // "First see if the module has an export default and if the local name of that export default matches."
                let of_local = bound.export_symbol_of_local(scope, name);
                if of_local.is_some() {
                    let default = self.sym(file, of_local);
                    if self.export(container, known::default) == Some(default)
                        && self.flags(default).intersects(meaning)
                    {
                        return Ok(Some(default));
                    }
                }
                let held = self.export(container, name);
                // A symbol found in the exports of a CommonJS module is only in scope if it is a type.
                let is_commonjs = s.kind == ScopeKind::File && bound.commonjs_indicator.is_some();
                if !held.is_some_and(|sym| self.flags(sym).contains(SymFlags::EXPORT_ONLY))
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
        self.options
            .import_call_mode(self.module(file).default_mode)
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
            match self.module(module.file).implied_format {
                // For Node a CommonJS module is its own default, regardless of what it declares.
                ResolutionMode::Require if self.options.module.is_node() => {
                    return Some(self.external_module_symbol(module));
                }
                // Between ECMAScript modules there is no synthetic default.
                ResolutionMode::Import => return None,
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
            && (self.hir(module.file).kind == FileKind::Json
                || self.module(module.file).path.ends_with(b".d.json.ts"))
    }

    /// `isESMFormatImportImportingCommonjsFormatFile` for a plain `import` in `from`: a file that
    /// is emitted as CommonJS, imported by a file whose `import`s are emitted as `import`s.
    pub fn is_commonjs_to_node(&self, from: FileId, module: Sym) -> bool {
        self.symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && self.module(from).default_mode == ResolutionMode::Import
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
        for tasks in &steps {
            let resolved: Vec<Guarded<Resolved>> = tasks
                .iter()
                .map(|_| Guarded::new(Resolved::default()))
                .collect();
            host.parallel(tasks.len(), &|at| {
                *resolved[at].lock() = self.resolve_files(&tasks[at]);
            });
            for resolved in &resolved {
                self.publish(std::mem::take(&mut *resolved.lock()));
            }
        }
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

    /// `lookup`: `getSymbol`, as for `resolve_with`. `reports_errors`: `!ignoreErrors`.
    pub fn resolve_entity_with(
        &self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags,
        reports_errors: bool,
        lookup: &mut dyn FnMut(SymbolTable, Option<Sym>, SymFlags) -> Option<Sym>,
    ) -> Option<Sym> {
        resolve!(self, resolver => {
            resolver.resolve_entity_with(file, scope, names, meaning, reports_errors, lookup)
        })
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

    /// `IsNonLocalAlias`: an alias and nothing else.
    pub fn is_non_local_alias(&self, sym: Sym) -> bool {
        let flags = self.flags(sym);
        flags.contains(SymFlags::ALIAS)
            && !flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
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
            cycles: Default::default(),
            buffer: buffer.map(std::cell::RefCell::new),
            arena: Default::default(),
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
            let is_pushed = start.is_none() && in_flight.len() < 100;
            if is_pushed {
                in_flight.push((sym, true));
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
            // `getExternalModuleMember` returns the symbol as stored in the table of the module.
            // `resolveEntityName` and `resolveExternalModuleSymbol` end with `getMergedSymbol`.
            let is_as_in_table = self.external_module_member_of(file, decl).is_some();
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
        if !begun.is_some_and(|begun| begun.1) {
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
