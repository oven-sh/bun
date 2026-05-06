use core::ptr::NonNull;

use bun_alloc::Arena as ThreadLocalArena;
use bun_collections::{BabyList, MultiArrayList};
use bun_js_parser::ServerComponentBoundary;
use bun_js_parser::BundledAst as JSAst;
use bun_logger as logger;
use enum_map::EnumMap;

use crate::options;
use crate::IndexStringMap::IndexStringMap;
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
use crate::{AdditionalFile, BundleV2, ThreadPool};

pub use bun_js_parser::Index;
pub use bun_js_parser::Ref;

// `bun.ast.Index.Int` — the underlying integer repr of `Index`.
type IndexInt = u32;

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
    // TODO(b2-blocked): bun_js_parser::server_component_boundary::List — stub
    // surface only exposes the singular `ServerComponentBoundary`. Retyped to a
    // Vec until the real `List` lands.
    pub server_component_boundaries: Vec<ServerComponentBoundary>,

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

#[derive(bun_collections::MultiArrayElement)]
pub struct InputFile {
    pub source: logger::Source,
    pub secondary_path: Box<[u8]>,
    pub loader: options::Loader,
    pub side_effects: SideEffects,
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator = bun.default_allocator`
    // here so deinit could free `source`/`secondary_path` with the right alloc.
    // In Rust the owned fields (Box/Vec) carry their allocator; field dropped.
    pub additional_files: BabyList<AdditionalFile>,
    pub unique_key_for_additional_file: Box<[u8]>,
    pub content_hash_for_additional_file: u64,
    pub flags: InputFileFlags,
}

/// SoA column accessors on `MultiArrayList<InputFile>` matching the Zig
/// `.items(.field)` calling convention used by LinkerContext / Chunk. The
/// derive emits a `Slice`-based ext trait with bare field names; the bundler
/// port consistently spells these `items_<field>()` directly on the list, so
/// this trait bridges that.
pub trait InputFileListExt {
    fn items_source(&self) -> &[logger::Source];
    fn items_source_mut(&self) -> &mut [logger::Source];
    fn items_loader(&self) -> &[options::Loader];
    fn items_side_effects(&self) -> &[SideEffects];
    fn items_additional_files(&self) -> &[BabyList<AdditionalFile>];
    fn items_unique_key_for_additional_file(&self) -> &[Box<[u8]>];
}

impl InputFileListExt for MultiArrayList<InputFile> {
    #[inline]
    fn items_source(&self) -> &[logger::Source] {
        // SAFETY: `logger::Source` is exactly the column type for `InputFileField::source`.
        unsafe { self.items::<logger::Source>(InputFileField::source) }
    }
    #[inline]
    fn items_source_mut(&self) -> &mut [logger::Source] {
        // SAFETY: see above. `MultiArrayList::items` already hands back `&mut [F]`.
        unsafe { self.items::<logger::Source>(InputFileField::source) }
    }
    #[inline]
    fn items_loader(&self) -> &[options::Loader] {
        // SAFETY: column type matches.
        unsafe { self.items::<options::Loader>(InputFileField::loader) }
    }
    #[inline]
    fn items_side_effects(&self) -> &[SideEffects] {
        // SAFETY: column type matches.
        unsafe { self.items::<SideEffects>(InputFileField::side_effects) }
    }
    #[inline]
    fn items_additional_files(&self) -> &[BabyList<AdditionalFile>] {
        // SAFETY: column type matches.
        unsafe { self.items::<BabyList<AdditionalFile>>(InputFileField::additional_files) }
    }
    #[inline]
    fn items_unique_key_for_additional_file(&self) -> &[Box<[u8]>] {
        // SAFETY: column type matches.
        unsafe { self.items::<Box<[u8]>>(InputFileField::unique_key_for_additional_file) }
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
        #[cfg(any())]
        {
            transpiler.thread_lock.assert_locked();

            if self.deferred_pending > 0 {
                self.pending_items += self.deferred_pending;
                self.deferred_pending = 0;

                transpiler.drain_defer_task.init();
                transpiler.drain_defer_task.schedule();

                return true;
            }

            return false;
        }
        // TODO(b2-blocked): crate::bundle_v2::BundleV2 fields (`thread_lock`,
        // `drain_defer_task`) — bundle_v2 module is still gated.
        let _ = transpiler;
        unimplemented!("b2-blocked: BundleV2 fields")
    }
}

// TODO(b2-blocked): bun_resolver::SideEffects — `bun_resolver` is not in this
// crate's dependency set (tier-ordering cycle with bundler per resolver
// Cargo.toml). Local mirror of the public enum so `InputFile` compiles.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum SideEffects {
    #[default]
    HasSideEffects,
    NoSideEffectsPackageJson,
    NoSideEffectsEmptyAst,
    NoSideEffectsPureData,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/Graph.zig (140 lines)
//   confidence: medium
//   todos:      2
//   notes:      `pool` is arena-owned (self.heap) per LIFETIMES.tsv:170 transitive evidence — self-referential, kept as NonNull; nested Zig types `Index.Int` / `ServerComponentBoundary.List` mapped to module paths Phase B must verify.
// ──────────────────────────────────────────────────────────────────────────
