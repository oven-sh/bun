use core::ptr::NonNull;

use crate::BundledAst as JSAst;
use bun_alloc::Arena as ThreadLocalArena;
use bun_ast::server_component_boundary;
use bun_collections::{MultiArrayList, VecExt};
use enum_map::EnumMap;

use crate::IndexStringMap::IndexStringMap;
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
use crate::options;
use crate::{AdditionalFile, BundleV2, ThreadPool};

use bun_ast::Index;
use bun_ast::Ref;

// `bun.ast.Index.Int` — the underlying integer repr of `Index`.
pub(crate) use crate::IndexInt;

pub struct Graph {
    // TODO(port): lifetime — no direct LIFETIMES.tsv row for Graph.pool, but row 170
    // (ThreadPool.v2, BACKREF) evidence states "BundleV2.graph.pool owns ThreadPool".
    // bundle_v2.zig:992 allocates it from `this.arena()` (the `self.heap` arena) and
    // bundle_v2.zig:2248 calls `pool.deinit()`, so this is arena-owned but self-referential
    // (sibling field). `BackRef` (not raw `NonNull`) so the read accessor `pool()` is
    // safe — the BACKREF invariant (pointee outlives holder) holds for the entire
    // bundle pass.
    pub pool: bun_ptr::BackRef<ThreadPool>,
    pub heap: ThreadLocalArena,

    /// Mapping user-specified entry points to their Source Index
    // PERF(port): arena-fed ArrayList (self.heap) — self-referential, revisit in Phase B
    pub entry_points: Vec<Index>,
    /// Maps entry point source indices to their original specifiers (for virtual entries resolved by plugins)
    pub entry_point_original_names: IndexStringMap,
    /// Every source index has an associated InputFile
    pub input_files: MultiArrayList<InputFile>,
    /// Every source index has an associated Ast
    /// When a parse is in progress / queued, it is `Ast.empty`
    // PORT NOTE: BundledAst<'arena> borrows from self.heap (sibling-field self-ref);
    // 'static here is a placeholder — Phase-B lifetime threading via raw ptr or Ouroboros.
    pub ast: MultiArrayList<JSAst<'static>>,

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
    pub pending_items: u32,
    /// When an `onLoad` plugin calls `.defer()`, the count from `pending_items`
    /// is "moved" into this counter (pending_items -= 1; deferred_pending += 1)
    ///
    /// When `pending_items` hits zero and there are deferred pending tasks, those
    /// tasks will be run, and the count is "moved" back to `pending_items`
    pub deferred_pending: u32,

    /// A map of build targets to their corresponding module graphs.
    pub build_graphs: EnumMap<options::Target, PathToSourceIndexMap>,

    /// When Server Components is enabled, this holds a list of all boundary
    /// files. This happens for all files with a "use <side>" directive.
    pub server_component_boundaries: server_component_boundary::List,

    /// Track HTML imports from server-side code
    /// Each entry represents a server file importing an HTML file that needs a client build
    ///
    /// OutputPiece.Kind.HTMLManifest corresponds to indices into the array.
    pub html_imports: HtmlImports,

    pub estimated_file_loader_count: usize,

    /// For Bake, a count of the CSS asts is used to make precise
    /// pre-allocations without re-iterating the file listing.
    pub css_file_count: usize,

    // PERF(port): arena-fed ArrayList (self.heap) — self-referential, revisit in Phase B
    pub additional_output_files: Vec<options::OutputFile>,

    pub kit_referenced_server_data: bool,
    pub kit_referenced_client_data: bool,

    /// Do any input_files have a secondary_path.len > 0?
    ///
    /// Helps skip a loop.
    pub has_any_secondary_paths: bool,
}

#[derive(Default)]
pub struct HtmlImports {
    /// Source index of the server file doing the import
    pub server_source_indices: Vec<IndexInt>,
    /// Source index of the HTML file being imported
    pub html_source_indices: Vec<IndexInt>,
}

#[derive(Default)]
pub struct InputFile {
    pub source: bun_ast::Source,
    pub secondary_path: Box<[u8]>,
    pub loader: options::Loader,
    pub side_effects: SideEffects,
    // PORT NOTE: Zig stored `arena: std.mem.Allocator = bun.default_allocator`
    // here so deinit could free `source`/`secondary_path` with the right alloc.
    // In Rust the owned fields (Box/Vec) carry their arena; field dropped.
    pub additional_files: Vec<AdditionalFile>,
    pub unique_key_for_additional_file: Box<[u8]>,
    pub content_hash_for_additional_file: u64,
    pub flags: InputFileFlags,
}

// SoA column accessors on `MultiArrayList<InputFile>` and `Slice<InputFile>`.
// Field name + type are checked against `InputFile`'s reflected layout at
// compile time by the underlying `items::<"name", T>()`.
bun_collections::multi_array_columns! {
    pub trait InputFileColumns for InputFile {
        source: bun_ast::Source,
        secondary_path: Box<[u8]>,
        loader: options::Loader,
        side_effects: SideEffects,
        additional_files: Vec<AdditionalFile>,
        unique_key_for_additional_file: Box<[u8]>,
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

impl Default for Graph {
    fn default() -> Self {
        Self {
            // Self-referential arena pointer; real value wired in
            // `BundleV2::init` before any use (Graph.zig has `= undefined`).
            pool: bun_ptr::BackRef::from(NonNull::<ThreadPool>::dangling()),
            heap: ThreadLocalArena::new(),
            entry_points: Vec::new(),
            entry_point_original_names: IndexStringMap::default(),
            input_files: MultiArrayList::default(),
            ast: MultiArrayList::default(),
            pending_items: 0,
            deferred_pending: 0,
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

impl Graph {
    /// Shared borrow of the bundler `ThreadPool`.
    ///
    /// `pool` is arena-allocated in `BundleV2::init` (bundle_v2.zig:992) and
    /// torn down in `BundleV2::deinit` (bundle_v2.zig:2248). It is non-null
    /// and valid for the entire bundle pass; see LIFETIMES.tsv row 170
    /// (BACKREF). All `ThreadPool` driver methods (`schedule`, `start`,
    /// `worker_pool`, `schedule_inside_thread_pool`) take `&self`, so callers
    /// can use this in place of the prior open-coded
    /// `unsafe { self.pool.as_ref() }` / `as_mut()`.
    #[inline]
    pub fn pool(&self) -> &ThreadPool {
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
    pub fn pool_mut(&mut self) -> &mut ThreadPool {
        // SAFETY: see `pool()`. `&mut self` excludes other safe borrows of
        // `Graph`, so no aliasing `&ThreadPool` is live.
        unsafe { self.pool.get_mut() }
    }

    #[inline]
    pub fn path_to_source_index_map(
        &mut self,
        target: options::Target,
    ) -> &mut PathToSourceIndexMap {
        &mut self.build_graphs[target]
    }

    /// Schedule a task to be run on the JS thread which resolves the promise of
    /// each `.defer()` called in an onLoad plugin.
    ///
    /// Returns true if there were more tasks queued.
    pub fn drain_deferred_tasks(&mut self, transpiler: &mut BundleV2) -> bool {
        transpiler.thread_lock.assert_locked();

        if self.deferred_pending > 0 {
            self.pending_items += self.deferred_pending;
            self.deferred_pending = 0;

            transpiler.drain_defer_task.init();
            transpiler.drain_defer_task.schedule();

            return true;
        }

        false
    }
}

// Spec: `side_effects: _resolver.SideEffects` (Graph.zig:74). The resolver
// crate re-exports the canonical enum from `bun_options_types`; re-export it
// here so `InputFile` and the derived `items_side_effects()` SoA accessor share
// the same type that `LinkerContext::mark_file_live_for_tree_shaking` expects.
use bun_ast::SideEffects;

// ported from: src/bundler/Graph.zig
