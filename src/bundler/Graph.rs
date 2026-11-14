use crate::BundledAst as JSAst;
use bun_alloc::Arena as ThreadLocalArena;
use bun_alloc::{AstAlloc, AstVec};
use bun_ast::server_component_boundary;
use bun_collections::MultiArrayList;
use enum_map::EnumMap;

use crate::IndexStringMap::IndexStringMap;
use crate::PathToSourceIndexMap::{GetOrPutResult, PathToSourceIndexMap};
use crate::options;
use crate::{AdditionalFile, BundleV2, ThreadPool};

use bun_ast::Index;

// `bun.ast.Index.Int` — the underlying integer repr of `Index`.
pub(crate) use crate::IndexInt;

pub struct Graph<'a> {
    // `BundleV2::init` allocates this from the `self.heap` arena and
    // `BundleV2::deinit` calls `pool.deinit()`, so this is arena-owned but self-referential
    // (sibling field). `BackRef` (not raw `NonNull`) so the read accessor `pool()` is
    // safe — the BACKREF invariant (pointee outlives holder) holds for the entire
    // bundle pass.
    pub pool: bun_ptr::BackRef<ThreadPool, bun_ptr::Mut>,
    pub(crate) heap: &'a ThreadLocalArena,

    /// Mapping user-specified entry points to their Source Index
    pub entry_points: Vec<Index>,
    /// Maps entry point source indices to their original specifiers (for virtual entries resolved by plugins)
    pub(crate) entry_point_original_names: IndexStringMap,
    /// Every source index has an associated InputFile
    pub input_files: MultiArrayList<InputFile<'a>>,
    /// Every source index has an associated Ast
    /// When a parse is in progress / queued, it is `Ast.empty`
    // `JSAst<'a>` borrows from the arena behind `self.heap`; `'a` ties the AST
    // entries to that arena's lifetime (sibling-field relationship).
    pub ast: MultiArrayList<JSAst<'a>>,

    /// During the scan + parse phase, this value keeps a count of the remaining
    /// tasks. Once it hits zero, the scan phase ends and linking begins. Note
    /// that if `deferred_pending > 0`, it means there are plugin callbacks
    /// to invoke before linking, which can initiate another scan phase.
    ///
    /// Increment and decrement this via `incrementScanCounter` and
    /// `decrementScanCounter`, as asynchronous bundles check for `0` in the
    /// decrement function, instead of at the top of the event loop.
    ///
    /// - Parsing a file (ParseTask and ServerComponentParseTask)
    /// - onResolve and onLoad functions
    /// - Resolving an onDefer promise
    pub(crate) pending_items: u32,
    /// When an `onLoad` plugin calls `.defer()`, the count from `pending_items`
    /// is "moved" into this counter (pending_items -= 1; deferred_pending += 1)
    ///
    /// When `pending_items` hits zero and there are deferred pending tasks, those
    /// tasks will be run, and the count is "moved" back to `pending_items`
    pub(crate) deferred_pending: u32,

    /// Which deferred batch is being collected: bumped each time `drain_deferred_tasks` moves the parked
    /// units back, so a `Load` can tell whether its own unit is still parked. Bundle thread only.
    pub(crate) defer_epoch: u32,
    /// The VM that owns the plugins is shutting down: `dispatch()` hands it nothing further (what it
    /// holds comes back answered as cancelled) and the pass fails at its next checkpoint.
    pub(crate) cancelled: bool,

    /// The module graphs of the build, see `BuildGraphs`.
    pub build_graphs: BuildGraphs,

    /// When Server Components is enabled, this holds a list of all boundary
    /// files. This happens for all files with a "use <side>" directive.
    pub server_component_boundaries: server_component_boundary::List,

    /// Track HTML imports from server-side code
    /// Each entry represents a server file importing an HTML file that needs a client build
    ///
    /// OutputPiece.Kind.HTMLManifest corresponds to indices into the array.
    pub(crate) html_imports: HtmlImports,

    pub(crate) estimated_file_loader_count: usize,

    /// For Bake, a count of the CSS asts is used to make precise
    /// pre-allocations without re-iterating the file listing.
    pub(crate) css_file_count: usize,

    pub(crate) additional_output_files: Vec<options::OutputFile>,

    pub(crate) kit_referenced_server_data: bool,
    pub(crate) kit_referenced_client_data: bool,

    /// Do any input_files have a secondary_path.len > 0?
    ///
    /// Helps skip a loop.
    pub(crate) has_any_secondary_paths: bool,
}

#[derive(Default)]
pub struct HtmlImports {
    /// Source index of the server file doing the import
    pub(crate) server_source_indices: Vec<IndexInt>,
    /// Source index of the HTML file being imported
    pub(crate) html_source_indices: Vec<IndexInt>,
}

pub struct InputFile<'a> {
    pub(crate) source: bun_ast::Source<'a>,
    pub(crate) secondary_path: AstVec<u8>,
    pub(crate) loader: options::Loader,
    pub side_effects: SideEffects,
    // No `arena` field — the owned fields
    // (Box/Vec) carry their allocator.
    pub additional_files: AstVec<AdditionalFile>,
    pub unique_key_for_additional_file: Box<[u8], AstAlloc>,
    pub content_hash_for_additional_file: u64,
    pub flags: InputFileFlags,
}

impl Default for InputFile<'_> {
    fn default() -> Self {
        Self {
            source: bun_ast::Source::default(),
            secondary_path: AstAlloc::vec(),
            loader: options::Loader::default(),
            side_effects: SideEffects::default(),
            additional_files: AstAlloc::vec(),
            unique_key_for_additional_file: AstAlloc::vec().into_boxed_slice(),
            content_hash_for_additional_file: 0,
            flags: InputFileFlags::default(),
        }
    }
}

// SoA column accessors on `MultiArrayList<InputFile>` and `Slice<InputFile>`.
// Field name + type are checked against `InputFile`'s reflected layout at
// compile time by the underlying `items::<"name", T>()`.
bun_collections::multi_array_columns! {
    pub trait InputFileColumns ['a] for InputFile<'a> {
        source: bun_ast::Source<'a>,
        secondary_path: AstVec<u8>,
        loader: options::Loader,
        side_effects: SideEffects,
        additional_files: AstVec<AdditionalFile>,
        unique_key_for_additional_file: Box<[u8], AstAlloc>,
        content_hash_for_additional_file: u64,
        flags: InputFileFlags,
    }
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub struct InputFileFlags: u8 {
        /// Set when a barrel-eligible file has `export * from` this file.
        const IS_EXPORT_STAR_TARGET = 1 << 1;
        /// `source.contents` is what an `onLoad` plugin returned, not what is in the file.
        const IS_LOADED_BY_PLUGIN = 1 << 2;
    }
}

impl<'a> Graph<'a> {
    /// `target` is the target of the build's main transpiler.
    pub(crate) fn new(heap: &'a ThreadLocalArena, target: options::Target) -> Self {
        Self {
            // Self-referential arena pointer; real value wired in
            // `BundleV2::init` before any use.
            pool: bun_ptr::BackRef::dangling(),
            heap,
            entry_points: Vec::new(),
            entry_point_original_names: IndexStringMap::default(),
            input_files: MultiArrayList::default(),
            ast: MultiArrayList::default(),
            pending_items: 0,
            deferred_pending: 0,
            defer_epoch: 0,
            cancelled: false,
            build_graphs: BuildGraphs::new(target),
            server_component_boundaries: server_component_boundary::List::default(),
            html_imports: HtmlImports::default(),
            estimated_file_loader_count: 0,
            css_file_count: 0,
            additional_output_files: Vec::new(),
            kit_referenced_server_data: false,
            kit_referenced_client_data: false,
            has_any_secondary_paths: false,
        }
    }
}

impl<'a> Graph<'a> {
    /// Shared borrow of the bundler `ThreadPool`.
    ///
    /// `pool` is arena-allocated in `BundleV2::init` and
    /// torn down in `BundleV2::deinit`. It is non-null
    /// and valid for the entire bundle pass; see LIFETIMES.tsv row 170
    /// (BACKREF). All `ThreadPool` driver methods (`schedule`, `start`,
    /// `worker_pool`, `schedule_inside_thread_pool`) take `&self`, so callers
    /// can use this in place of the prior open-coded
    /// `unsafe { self.pool.as_ref() }` / `as_mut()`.
    #[inline]
    pub(crate) fn pool(&self) -> &ThreadPool {
        // BackRef invariant: `pool` is set in `BundleV2::init` to an
        // arena-owned `ThreadPool` and remains valid until `BundleV2::deinit`;
        // no `&mut ThreadPool` is live across any `pool()` borrow (the only
        // `&mut` site is `deinit`, called after all schedule/worker activity
        // has drained).
        self.pool.get()
    }

    /// Exclusive borrow of the bundler `ThreadPool`. Only needed for
    /// `ThreadPool::deinit` during teardown; prefer [`Self::pool`] for
    /// scheduling.
    #[inline]
    pub(crate) fn pool_mut(&mut self) -> &mut ThreadPool {
        // SAFETY: see `pool()`. `&mut self` excludes other safe borrows of
        // `Graph`, so no aliasing `&ThreadPool` is live.
        unsafe { self.pool.get_mut() }
    }

    #[inline]
    pub(crate) fn path_to_source_index_map(
        &mut self,
        target: options::Target,
    ) -> &mut PathToSourceIndexMap {
        &mut self.build_graphs[target]
    }

    /// `BuildGraphs::get` for a record with `loader`. An HTML import of a server-side file gets a manifest module, not the HTML file of a browser graph.
    pub(crate) fn find_import(
        &self,
        target: options::Target,
        loader: Option<options::Loader>,
        path: &[u8],
    ) -> Option<IndexInt> {
        let found = self.build_graphs.get(target, path)?;
        let is_html_file_of_graph = loader.is_none_or(|loader| loader == options::Loader::Html)
            && self.build_graphs.keeps_manifests_apart(target)
            && self.input_files.items_loader()[found as usize] == options::Loader::Html;
        (!is_html_file_of_graph).then_some(found)
    }
}

/// One path map per module graph. A `Target` picks its graph as `BundleV2::transpiler_for_target` picks its transpiler.
pub struct BuildGraphs {
    maps: EnumMap<options::Target, PathToSourceIndexMap>,
    /// The target of the build's main transpiler.
    main: options::Target,
}

impl BuildGraphs {
    fn new(main: options::Target) -> Self {
        Self {
            maps: EnumMap::default(),
            main,
        }
    }

    /// The target of the graph that the imports of a file for `target` are in.
    #[inline]
    pub(crate) fn graph(&self, target: options::Target) -> options::Target {
        match target {
            options::Target::Browser | options::Target::ServerComponentsSsr => target,
            _ => self.main,
        }
    }

    /// True if the manifest modules of the files for `target` have a map of their own: a manifest module has the path of its HTML file, and a browser graph has that file.
    #[inline]
    fn keeps_manifests_apart(&self, target: options::Target) -> bool {
        let graph = self.graph(target);
        graph != target && !graph.is_server_side()
    }

    /// The map with the manifest modules of the HTML files that the files for `target` import.
    pub(crate) fn manifests(&mut self, target: options::Target) -> &mut PathToSourceIndexMap {
        if self.keeps_manifests_apart(target) {
            &mut self.maps[target]
        } else {
            &mut self[target]
        }
    }

    /// What an import of `path` gets in a file for `target`: the manifest module of an HTML file, else the file of the graph.
    pub(crate) fn get(&self, target: options::Target, path: &[u8]) -> Option<IndexInt> {
        if self.keeps_manifests_apart(target)
            && let Some(manifest) = self.maps[target].get(path)
        {
            return Some(manifest);
        }
        self[target].get(path)
    }

    /// `get`, or a new entry for `path` in the graph of `target`.
    pub(crate) fn get_or_put(
        &mut self,
        target: options::Target,
        path: &[u8],
    ) -> Result<GetOrPutResult<'_>, bun_alloc::AllocError> {
        if self.keeps_manifests_apart(target) && self.maps[target].get(path).is_some() {
            return self.maps[target].get_or_put(path);
        }
        self[target].get_or_put(path)
    }

    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut PathToSourceIndexMap> {
        self.maps.values_mut()
    }
}

impl core::ops::Index<options::Target> for BuildGraphs {
    type Output = PathToSourceIndexMap;

    #[inline]
    fn index(&self, target: options::Target) -> &PathToSourceIndexMap {
        &self.maps[self.graph(target)]
    }
}

impl core::ops::IndexMut<options::Target> for BuildGraphs {
    #[inline]
    fn index_mut(&mut self, target: options::Target) -> &mut PathToSourceIndexMap {
        let graph = self.graph(target);
        &mut self.maps[graph]
    }
}

impl BundleV2<'_> {
    /// Schedule a task to be run on the JS thread which resolves the promise of
    /// each `.defer()` called in an onLoad plugin.
    ///
    /// Returns true if there were more tasks queued.
    pub(crate) fn drain_deferred_tasks(&mut self) -> bool {
        self.thread_lock.assert_locked();

        if self.graph.deferred_pending > 0 {
            // Their units are back in `pending_items` (a new epoch: those loads' own units are no longer
            // parked), plus one for the hop itself: the pass is not done until it is back (see
            // `DeferredBatchTask`).
            self.graph.pending_items += self.graph.deferred_pending + 1;
            self.graph.deferred_pending = 0;
            self.graph.defer_epoch += 1;
            self.drain_defer_task.schedule();

            return true;
        }

        false
    }
}

// The resolver
// crate re-exports the canonical enum from `bun_options_types`; re-export it
// here so `InputFile` and the derived `items_side_effects()` SoA accessor share
// the same type that `LinkerContext::mark_file_live_for_tree_shaking` expects.
use bun_ast::SideEffects;
