use core::ptr::NonNull;

use bun_alloc::Arena as ThreadLocalArena;
use bun_collections::{BabyList, MultiArrayList};
use bun_js_parser::server_component_boundary;
use bun_js_parser::BundledAst as JSAst;
use bun_logger as logger;
use bun_resolver as resolver;
use enum_map::EnumMap;

use crate::options;
use crate::IndexStringMap;
use crate::{AdditionalFile, BundleV2, PathToSourceIndexMap, ThreadPool};

pub use bun_js_parser::Index;
pub use bun_js_parser::Ref;

// TODO(port): `bun.ast.Index.Int` is a nested `pub const Int = u32;` on the Zig
// `Index` struct; Rust cannot hang a type alias off a struct, so the parser
// crate should expose this as `bun_js_parser::index::Int` (or re-export `u32`).
type IndexInt = bun_js_parser::index::Int;

pub struct Graph {
    // TODO(port): lifetime — no direct LIFETIMES.tsv row for Graph.pool, but row 170
    // (ThreadPool.v2, BACKREF) evidence states "BundleV2.graph.pool owns ThreadPool".
    // bundle_v2.zig:992 allocates it from `this.allocator()` (the `self.heap` arena) and
    // bundle_v2.zig:2248 calls `pool.deinit()`, so this is arena-owned but self-referential
    // (sibling field). Phase B: decide between `Box<ThreadPool>` vs arena handle.
    pub pool: NonNull<ThreadPool>,
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
    pub ast: MultiArrayList<JSAst>,

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
    pub server_source_indices: BabyList<IndexInt>,
    /// Source index of the HTML file being imported
    pub html_source_indices: BabyList<IndexInt>,
}

pub struct InputFile {
    pub source: logger::Source,
    pub secondary_path: Box<[u8]>,
    pub loader: options::Loader,
    pub side_effects: resolver::SideEffects,
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator = bun.default_allocator`
    // here so deinit could free `source`/`secondary_path` with the right alloc.
    // In Rust the owned fields (Box/Vec) carry their allocator; field dropped.
    pub additional_files: BabyList<AdditionalFile>,
    pub unique_key_for_additional_file: Box<[u8]>,
    pub content_hash_for_additional_file: u64,
    pub flags: InputFileFlags,
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub struct InputFileFlags: u8 {
        const IS_PLUGIN_FILE = 1 << 0;
        /// Set when a barrel-eligible file has `export * from` this file.
        const IS_EXPORT_STAR_TARGET = 1 << 1;
    }
}

impl Graph {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/Graph.zig (140 lines)
//   confidence: medium
//   todos:      2
//   notes:      `pool` is arena-owned (self.heap) per LIFETIMES.tsv:170 transitive evidence — self-referential, kept as NonNull; nested Zig types `Index.Int` / `ServerComponentBoundary.List` mapped to module paths Phase B must verify.
// ──────────────────────────────────────────────────────────────────────────
