use crate::BundledAst as JSAst;
use bun_alloc::Arena as ThreadLocalArena;
use bun_alloc::{AstAlloc, AstVec};
use bun_ast::server_component_boundary;
use bun_collections::MultiArrayList;
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

    /// Mapping user-specified entry points to their Source Index
    pub entry_points: Vec<Index>,
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

    /// onResolve / onLoad requests a plugin currently holds (dispatched to its
    /// VM, not yet answered). Bundle thread only. Failed wholesale when that
    /// VM shuts down mid-build (`BundleV2::is_done`).
    pub(crate) outstanding_resolves: OutstandingList<crate::bundle_v2::api::JSBundler::Resolve>,
    pub(crate) outstanding_loads: OutstandingList<crate::bundle_v2::api::JSBundler::Load>,
    /// The owning VM cancelled this pass; plugin requests were failed and no
    /// deferred batch will run.
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
        const IS_PLUGIN_FILE = 1 << 0;
        /// Set when a barrel-eligible file has `export * from` this file.
        const IS_EXPORT_STAR_TARGET = 1 << 1;
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
            entry_point_original_names: IndexStringMap::default(),
            input_files: MultiArrayList::default(),
            ast: MultiArrayList::default(),
            pending_items: 0,
            deferred_pending: 0,
            outstanding_resolves: OutstandingList::default(),
            outstanding_loads: OutstandingList::default(),
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

    /// Schedule a task to be run on the JS thread which resolves the promise of
    /// each `.defer()` called in an onLoad plugin.
    ///
    /// Returns true if there were more tasks queued.
    pub(crate) fn drain_deferred_tasks(&mut self, transpiler: &mut BundleV2) -> bool {
        transpiler.thread_lock.assert_locked();

        if self.deferred_pending > 0 {
            self.pending_items += self.deferred_pending;
            self.deferred_pending = 0;
            // Their units are back in `pending_items`.
            let mut load = self.outstanding_loads.head;
            while !load.is_null() {
                // SAFETY: linked ⇒ arena-live; bundle thread.
                unsafe {
                    (*load).deferred = false;
                    load = (*load).outstanding.next;
                }
            }

            transpiler.drain_defer_task.init();
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

/// Intrusive doubly-linked membership in an [`OutstandingList`].
pub struct OutstandingLink<T> {
    prev: *mut T,
    pub(crate) next: *mut T,
    linked: bool,
}
impl<T> Default for OutstandingLink<T> {
    fn default() -> Self {
        Self {
            prev: core::ptr::null_mut(),
            next: core::ptr::null_mut(),
            linked: false,
        }
    }
}
pub trait OutstandingNode: Sized {
    fn link(&mut self) -> &mut OutstandingLink<Self>;
}
/// A bundle pass's outstanding plugin requests; single-threaded (bundle thread).
pub struct OutstandingList<T: OutstandingNode> {
    head: *mut T,
}
impl<T: OutstandingNode> Default for OutstandingList<T> {
    fn default() -> Self {
        Self {
            head: core::ptr::null_mut(),
        }
    }
}
impl<T: OutstandingNode> OutstandingList<T> {
    pub(crate) fn push(&mut self, node: *mut T) {
        // SAFETY: `node` is arena-live and unlinked; bundle thread.
        unsafe {
            let l = (*node).link();
            debug_assert!(!l.linked);
            l.linked = true;
            l.prev = core::ptr::null_mut();
            l.next = self.head;
            if !self.head.is_null() {
                (*self.head).link().prev = node;
            }
        }
        self.head = node;
    }
    /// No-op if `node` is not linked (already answered / never dispatched).
    pub(crate) fn unlink(&mut self, node: &mut T) {
        let node_ptr: *mut T = node;
        let l = node.link();
        if !l.linked {
            return;
        }
        l.linked = false;
        let (prev, next) = (l.prev, l.next);
        l.prev = core::ptr::null_mut();
        l.next = core::ptr::null_mut();
        // SAFETY: neighbours are linked ⇒ arena-live; bundle thread.
        unsafe {
            if prev.is_null() {
                debug_assert!(core::ptr::eq(self.head, node_ptr));
                self.head = next;
            } else {
                (*prev).link().next = next;
            }
            if !next.is_null() {
                (*next).link().prev = prev;
            }
        }
    }
    pub(crate) fn pop(&mut self) -> Option<*mut T> {
        let head = self.head;
        if head.is_null() {
            return None;
        }
        // SAFETY: linked ⇒ arena-live.
        self.unlink(unsafe { &mut *head });
        Some(head)
    }
}
