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

/// `bun.GenericIndex(u32, File)` — file index into `bundled_files`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct FileIndex(pub u32);
impl FileIndex {
    #[inline] pub const fn init(v: u32) -> Self { Self(v) }
    #[inline] pub const fn get(self) -> u32 { self.0 }
}
/// Alias used by `DevServer.route_lookup` (Zig: `IncrementalGraph(.server).FileIndex`).
pub type ServerFileIndex = FileIndex;
pub type ClientFileIndex = FileIndex;

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
/// `bake.Side` so `File` resolves to `ServerFile`/`ClientFile`; the Rust
/// shape is monomorphic until `adt_const_params` (or a trait dispatch) lands.
#[derive(Default)]
pub struct IncrementalGraph {
    /// Keys are absolute paths (owned). Index = `FileIndex`.
    pub bundled_files: StringArrayHashMap<File>,
    /// Parallel to `bundled_files`; bit set = file is stale and must rebundle.
    pub stale_files: DynamicBitSetUnmanaged,
    pub edges: MultiArrayList<Edge>,
    pub first_import: Vec<Option<EdgeIndex>>,
    pub first_dependency: Vec<Option<EdgeIndex>>,
    pub free_edge_head: Option<EdgeIndex>,
}

impl IncrementalGraph {
    /// Helper for `DevServer::is_file_cached`.
    #[inline]
    pub fn file_kind_at(&self, index: usize) -> FileKind {
        self.bundled_files.values()[index].kind
    }
}
