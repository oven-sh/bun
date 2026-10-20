use crate::BundledAst as JSAst;
use bun_alloc::Arena as ThreadLocalArena;
use bun_alloc::{AstAlloc, AstVec};
use bun_ast::server_component_boundary;
use bun_ast::server_component_boundary::ServerComponentBoundaryColumns as _;
use bun_collections::{DynamicBitSetUnmanaged, MultiArrayList, index_sort};
use enum_map::EnumMap;

use crate::IndexStringMap::IndexStringMap;
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
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

    /// The source index of each entry point: the ones the user listed, in that
    /// order, then the ones the build found. The link step numbers entry points by
    /// their position here, and gives shared output to the first one that uses it.
    /// So nothing is added in the order that the scan comes to files in.
    /// [`Self::add_user_entry_point`] writes the user's part before the scan and
    /// [`Self::add_derived_entry_points`] the other part after it.
    entry_points: Vec<Index>,
    #[cfg(debug_assertions)]
    entry_point_list: EntryPointList,
    /// Maps entry point source indices to their original specifiers (for virtual entries resolved by plugins)
    pub(crate) entry_point_original_names: IndexStringMap,
    /// Every source index has an associated InputFile
    pub input_files: MultiArrayList<InputFile>,
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

    /// A map of build targets to their corresponding module graphs.
    pub build_graphs: EnumMap<options::Target, PathToSourceIndexMap>,

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

/// Whether [`Graph::add_user_entry_point`] may run. Debug builds check it.
#[cfg(debug_assertions)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum EntryPointList {
    Closed,
    /// See [`Graph::open_user_entry_points`].
    Open,
    /// See [`Graph::keep_user_entry_points_open_for_dev_server`].
    OpenForDevServer,
}

/// See [`Graph::server_imported_pages`].
pub(crate) struct ServerImportedPages {
    /// The page of each stub of [`HtmlImports::server_source_indices`].
    pub(crate) html_source_indices: Vec<IndexInt>,
    /// The pages that are not entry points yet.
    pub(crate) new_entry_points: Vec<Index>,
}

#[derive(Default)]
pub struct HtmlImports {
    /// Source index of the server file doing the import
    pub(crate) server_source_indices: Vec<IndexInt>,
    /// Source index of the HTML file being imported
    pub(crate) html_source_indices: Vec<IndexInt>,
}

pub struct InputFile {
    pub(crate) source: bun_ast::Source,
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

impl Default for InputFile {
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
    pub trait InputFileColumns for InputFile {
        source: bun_ast::Source,
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
    pub(crate) fn new(heap: &'a ThreadLocalArena) -> Self {
        Self {
            // Self-referential arena pointer; real value wired in
            // `BundleV2::init` before any use.
            pool: bun_ptr::BackRef::dangling(),
            heap,
            entry_points: Vec::new(),
            #[cfg(debug_assertions)]
            entry_point_list: EntryPointList::Closed,
            entry_point_original_names: IndexStringMap::default(),
            input_files: MultiArrayList::default(),
            ast: MultiArrayList::default(),
            pending_items: 0,
            deferred_pending: 0,
            defer_epoch: 0,
            cancelled: false,
            build_graphs: EnumMap::default(),
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

    #[inline]
    pub fn entry_points(&self) -> &[Index] {
        &self.entry_points
    }

    pub(crate) fn reserve_entry_points(&mut self, additional: usize) {
        self.entry_points.reserve(additional);
    }

    /// The build goes through the user's list of entry points from here to
    /// [`Self::close_user_entry_points`].
    #[inline]
    pub(crate) fn open_user_entry_points(&mut self) {
        #[cfg(debug_assertions)]
        {
            debug_assert_eq!(self.entry_point_list, EntryPointList::Closed);
            self.entry_point_list = EntryPointList::Open;
        }
    }

    #[inline]
    pub(crate) fn close_user_entry_points(&mut self) {
        #[cfg(debug_assertions)]
        {
            debug_assert_eq!(self.entry_point_list, EntryPointList::Open);
            self.entry_point_list = EntryPointList::Closed;
        }
    }

    /// The dev server hands an entry point to the `onResolve` plugins and adds it
    /// when their answer arrives, so its list stays open while the bundle scans.
    #[inline]
    pub(crate) fn keep_user_entry_points_open_for_dev_server(&mut self) {
        #[cfg(debug_assertions)]
        {
            debug_assert_eq!(self.entry_point_list, EntryPointList::Closed);
            self.entry_point_list = EntryPointList::OpenForDevServer;
        }
    }

    /// An entry point from the user's list. The callers add them in the order of
    /// that list.
    pub(crate) fn add_user_entry_point(&mut self, source_index: Index) {
        #[cfg(debug_assertions)]
        debug_assert_ne!(
            self.entry_point_list,
            EntryPointList::Closed,
            "an entry point that the scan finds goes through add_derived_entry_points"
        );
        self.entry_points.push(source_index);
    }

    /// The entry points that the build found. `find_reachable_files` gives them
    /// after the scan, in an order that follows from the sources alone.
    pub(crate) fn add_derived_entry_points(&mut self, source_indices: Vec<Index>) {
        #[cfg(debug_assertions)]
        debug_assert_eq!(self.entry_point_list, EntryPointList::Closed);
        self.entry_points.extend(source_indices);
    }

    /// The positions of `files`, in the order that `reachable` came to each file.
    /// `reachable` is the walk from the entry points, which follows the import
    /// records of a file in source order. A file that the walk did not come to
    /// goes after the others, by path.
    fn in_walk_order(&self, reachable: &[Index], files: &[IndexInt]) -> Vec<u32> {
        let sources = self.input_files.items_source();
        let mut walked_at = vec![u32::MAX; sources.len()];
        for (at, source_index) in reachable.iter().enumerate() {
            walked_at[source_index.get() as usize] = at as u32;
        }
        let mut order = index_sort::identity(files.len());
        index_sort::sort_indices(&mut order, &mut |a, b| {
            let (a, b) = (files[a as usize] as usize, files[b as usize] as usize);
            (walked_at[a].cmp(&walked_at[b]))
                .then_with(|| sources[a].path.pretty.cmp(sources[b].path.pretty))
        });
        order
    }

    /// The pages that server code imports, in the order that `reachable` came to
    /// their stubs. See [`Self::in_walk_order`].
    pub(crate) fn server_imported_pages(
        &self,
        reachable: &[Index],
    ) -> Result<ServerImportedPages, bun_alloc::AllocError> {
        let sources = self.input_files.items_source();
        let stubs = self.html_imports.server_source_indices.as_slice();
        let browser_files = &self.build_graphs[options::Target::Browser];
        let html_source_indices: Vec<IndexInt> = (stubs.iter())
            .map(|&stub| {
                browser_files
                    .get(sources[stub as usize].path.text)
                    .expect("the scan made a browser file for each page that server code imports")
            })
            .collect();

        let mut is_entry_point = DynamicBitSetUnmanaged::init_empty(sources.len())?;
        for entry_point in &self.entry_points {
            is_entry_point.set(entry_point.get() as usize);
        }
        let mut new_entry_points = Vec::with_capacity(stubs.len());
        for stub in self.in_walk_order(reachable, stubs) {
            let page = html_source_indices[stub as usize];
            if !is_entry_point.is_set(page as usize) {
                is_entry_point.set(page as usize);
                new_entry_points.push(Index::init(page));
            }
        }
        Ok(ServerImportedPages {
            html_source_indices,
            new_entry_points,
        })
    }

    /// Each server component boundary is two entry points: the file and its
    /// server-side render twin. They go in the order that `reachable` came to the
    /// boundaries. See [`Self::in_walk_order`]. They are not grouped by the user's
    /// entry points (bake passes each route as one), so two component files of one
    /// route make two chunks.
    pub(crate) fn server_component_boundary_entry_points(
        &self,
        reachable: &[Index],
        entry_points: &mut Vec<Index>,
    ) {
        let boundaries = self.server_component_boundaries.list.slice();
        let source_indices = boundaries.items_source_index();
        let ssr_source_indices = boundaries.items_ssr_source_index();
        // An import record names the boundary file or its reference module. The
        // walk goes from the file to the reference module before anything else, so
        // the reference module is where the walk first came to the boundary.
        let order = self.in_walk_order(reachable, boundaries.items_reference_source_index());
        entry_points.reserve(order.len() * 2);
        for boundary in order {
            let boundary = boundary as usize;
            for source_index in [source_indices[boundary], ssr_source_indices[boundary]] {
                entry_points.push(Index::init(source_index));
            }
        }
    }

    /// Schedule a task to be run on the JS thread which resolves the promise of
    /// each `.defer()` called in an onLoad plugin.
    ///
    /// Returns true if there were more tasks queued.
    pub(crate) fn drain_deferred_tasks(&mut self, transpiler: &mut BundleV2) -> bool {
        transpiler.thread_lock.assert_locked();

        if self.deferred_pending > 0 {
            // Their units are back in `pending_items` (a new epoch: those loads' own units are no longer
            // parked), plus one for the hop itself: the pass is not done until it is back (see
            // `DeferredBatchTask`).
            self.pending_items += self.deferred_pending + 1;
            self.deferred_pending = 0;
            self.defer_epoch += 1;
            transpiler.drain_defer_task.schedule();

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
