//! `DevServer.IncrementalGraph(side)` — data-oriented module graph with
//! perfect incremental tracking. Full body (2.5 kL: edge lists, chunk
//! receipt, dependency tracing) lives in the gated
//! `../DevServer/IncrementalGraph.rs` draft and is blocked on
//! `bun_bundler::Chunk` field access + `bun_js_parser::ast`.
//!
//! Only the storage shape and the two accessors `is_file_cached` needs are
//! un-gated here.

use bun_collections::{bit_set::DynamicBitSetUnmanaged, MultiArrayList, StringArrayHashMap};

use super::{packed_map, route_bundle, FileKind};
use crate::bake;

// Re-export body types so `DevServer.rs` (in `crate::bake::dev_server_body`) can
// name them via `incremental_graph::*` without seeing the private `_body` mod.
pub use super::incremental_graph_body::{
    ProcessMode, ReceiveChunkContent, ReceiveChunkSourceMap, TakeJSBundleOptionsClient,
    TakeJSBundleOptionsServer, TraceDependencyGoal,
};

/// `bun.GenericIndex(u32, File)` — file index into `bundled_files`.
///
/// Const-generic over `bake::Side` so that `IncrementalGraph(.server).FileIndex`
/// and `IncrementalGraph(.client).FileIndex` are distinct types as in the Zig
/// spec. A default of `Server` is provided so the many call sites that have not
/// yet been side-annotated continue to resolve while the port catches up.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct FileIndex<const SIDE: bake::Side = { bake::Side::Server }>(pub u32);
impl<const SIDE: bake::Side> FileIndex<SIDE> {
    #[inline] pub const fn init(v: u32) -> Self { Self(v) }
    #[inline] pub const fn get(self) -> u32 { self.0 }
}
/// Alias used by `DevServer.route_lookup` (Zig: `IncrementalGraph(.server).FileIndex`).
pub type ServerFileIndex = FileIndex<{ bake::Side::Server }>;
pub type ClientFileIndex = FileIndex<{ bake::Side::Client }>;

/// `bun.GenericIndex(u32, Edge)`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct EdgeIndex(pub u32);

/// One edge in the import graph (doubly-linked per direction so removal is O(1)).
#[derive(Copy, Clone)]
pub struct Edge {
    pub source: FileIndex,
    pub target: FileIndex,
    pub next_import: Option<EdgeIndex>,
    pub prev_import: Option<EdgeIndex>,
    pub next_dependency: Option<EdgeIndex>,
    pub prev_dependency: Option<EdgeIndex>,
}

/// Per-file metadata. Zig defines this as `packed struct` with the field set
/// varying by `comptime side: bake.Side` (server stores `is_rsc/is_ssr/...`;
/// client stores `Content` + `source_map`). Rust has no const-generic-enum
/// struct selection on stable, so the union is folded here and the
/// side-specific fields are `Option`-wrapped.
// TODO(port): split back into `ServerFile`/`ClientFile` once `IncrementalGraph`
// is const-generic over `Side` (needs `adt_const_params` or a trait shim).
pub struct File {
    pub kind: FileKind,
    pub failed: bool,
    // server-side
    pub is_rsc: bool,
    pub is_ssr: bool,
    pub is_client_component_boundary: bool,
    pub is_route: bool,
    // client-side
    pub is_hmr_root: bool,
    pub is_special_framework_file: bool,
    pub html_route_bundle_index: Option<route_bundle::Index>,
    pub source_map: packed_map::Shared,
    pub content: Content,
}

#[derive(Default)]
pub enum Content {
    #[default]
    Unknown,
    Js(Box<[u8]>),
    Asset(Box<[u8]>),
    CssRoot(u64),
    CssChild,
}

/// `IncrementalGraph(side)`. The Zig original is comptime-parameterized over
/// `bake.Side` so `File` resolves to `ServerFile`/`ClientFile`. Mirrored here
/// via `adt_const_params` on `bake::Side`; `File` itself is still the folded
/// union (see TODO above) until a trait dispatch picks the per-side layout.
/// Default `SIDE = Server` keeps not-yet-annotated call sites compiling.
#[derive(Default)]
pub struct IncrementalGraph<const SIDE: bake::Side = { bake::Side::Server }> {
    /// Keys are absolute paths (owned). Index = `FileIndex`.
    pub bundled_files: StringArrayHashMap<File>,
    /// Parallel to `bundled_files`; bit set = file is stale and must rebundle.
    pub stale_files: DynamicBitSetUnmanaged,
    pub edges: MultiArrayList<Edge>,
    pub first_import: Vec<Option<EdgeIndex>>,
    pub first_dependency: Vec<Option<EdgeIndex>>,
    pub free_edge_head: Option<EdgeIndex>,
}

impl<const SIDE: bake::Side> IncrementalGraph<SIDE> {
    /// Helper for `DevServer::is_file_cached`.
    #[inline]
    pub fn file_kind_at(&self, index: usize) -> FileKind {
        self.bundled_files.values()[index].kind
    }

    /// `IncrementalGraph(side).reset()` — DevServer.zig:IncrementalGraph.reset.
    /// Clears the per-bundle mutation tracking (`current_chunk_*`) without
    /// touching the persisted file/edge storage. Full body (which also resets
    /// the source-map shared-ptr arena and `current_chunk_parts`) lives in the
    /// gated `../DevServer/IncrementalGraph.rs` draft; only the storage that
    /// is un-gated here is touched.
    pub fn reset(&mut self) {
        // No-op: the un-gated struct shape carries no per-bundle scratch
        // (`current_chunk_len`, `current_css_files`, …) yet. Called from
        // `start_async_bundle` to mirror the Zig call sequence so the call
        // site is real once those fields land.
        // TODO(b2): clear `current_chunk_*` once those fields are un-gated.
    }

    /// `IncrementalGraph(side).insertStale(abs_path, is_ssr)` — adds a file
    /// to the graph in the stale state without bundled content. Returns its
    /// `FileIndex`. Full body (with `is_route` / `is_special_framework_file`
    /// flag handling and edge initialization) is in the gated draft; this
    /// implements only what `init()` needs (file identity + stale bit).
    pub fn insert_stale(
        &mut self,
        abs_path: &[u8],
        is_ssr: bool,
    ) -> Result<FileIndex<SIDE>, bun_alloc::AllocError> {
        let gop = self.bundled_files.get_or_put(abs_path)?;
        let idx = gop.index;
        if !gop.found_existing {
            *gop.value_ptr = File {
                kind: FileKind::Unknown,
                failed: false,
                // Server-side: spec IncrementalGraph.zig:1332-1346 sets exactly
                // one of `is_rsc`/`is_ssr` on miss based on `is_ssr_graph`.
                is_rsc: !is_ssr,
                is_ssr,
                is_client_component_boundary: false,
                is_route: false,
                is_hmr_root: false,
                is_special_framework_file: false,
                html_route_bundle_index: None,
                source_map: Default::default(),
                content: Content::Unknown,
            };
            self.first_import.push(None);
            self.first_dependency.push(None);
        } else {
            // On hit, OR in the appropriate flag (spec :1340-1346).
            if is_ssr {
                gop.value_ptr.is_ssr = true;
            } else {
                gop.value_ptr.is_rsc = true;
            }
        }
        // Spec :1318-1320 only sets the bit when capacity already covers
        // `idx`; growth is deferred to `ensureStaleBitCapacity` so the
        // are-new-files-stale fill value is decided once per bundle.
        if self.stale_files.bit_length > idx {
            self.stale_files.set(idx);
        }
        Ok(FileIndex(idx as u32))
    }

    /// `IncrementalGraph(side).ensureStaleBitCapacity` — DevServer.zig:1573.
    /// Grows `stale_files` to cover all currently-known files, filling new
    /// bits with `are_new_files_stale`.
    pub fn ensure_stale_bit_capacity(
        &mut self,
        are_new_files_stale: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        self.stale_files
            .resize(self.bundled_files.count(), are_new_files_stale)
    }
}
