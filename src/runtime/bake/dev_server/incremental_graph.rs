//! `DevServer.IncrementalGraph(side)` — data-oriented module graph with
//! perfect incremental tracking. Edge lists, chunk receipt, dependency
//! tracing, and bundle emission ported from `IncrementalGraph.zig`.
//!
//! The Zig original is `comptime side: bake.Side`-parameterized so `File`
//! resolves to either `ServerFile` (boundary flags) or `ClientFile` (code +
//! source map). Stable Rust has no const-generic-enum struct selection, so the
//! `File` payload is folded into a single struct carrying both field sets and
//! per-side behaviour is dispatched on the `SIDE` const parameter.

use bun_collections::VecExt;
use core::mem::offset_of;
use std::io::Write as _;

use bun_collections::{ArrayHashMap, StringArrayHashMap, bit_set::DynamicBitSetUnmanaged};
use bun_core::strings;

use super::{
    CLIENT_PREFIX, ChunkKind, DevServer, EntryPointList, FileKind, GraphTraceState,
    SerializedFailure, TraceImportGoal, packed_map, route_bundle, serialized_failure,
    source_map_store,
};
use crate::bake::dev_server_body::{CachedFileIndex, HotUpdateContext};
use crate::bake::{self, Side};

/// `bun.GenericIndex(u30, File)` — file index into `bundled_files`.
///
/// Const-generic over `bake::Side` so that `IncrementalGraph(.server).FileIndex`
/// and `IncrementalGraph(.client).FileIndex` are distinct types as in the Zig
/// spec.
pub struct SideMarker<const SIDE: bake::Side>;
pub type FileIndex<const SIDE: bake::Side> = bun_core::GenericIndex<u32, SideMarker<SIDE>>;
/// Alias used by `DevServer.route_lookup` (Zig: `IncrementalGraph(.server).FileIndex`).
pub type ServerFileIndex = FileIndex<{ bake::Side::Server }>;
pub type ClientFileIndex = FileIndex<{ bake::Side::Client }>;

/// Return shape for `IncrementalGraph::insert_empty`.
pub struct InsertEmptyResult<const SIDE: bake::Side> {
    pub index: FileIndex<SIDE>,
    /// Borrow of the interned key in `bundled_files`. The key `Box<[u8]>` lives
    /// until `disconnect_and_delete_file` frees it, and
    /// `remove_dependencies_for_file` is called first — so every holder
    /// outlives no read past that point (`RawSlice` invariant). Callers compare
    /// it by pointer identity.
    pub key: bun_ptr::RawSlice<u8>,
}

/// `bun.GenericIndex(u32, Edge)`.
pub enum EdgeMarker {}
pub type EdgeIndex = bun_core::GenericIndex<u32, EdgeMarker>;

/// One edge in the import graph. `File` objects act as nodes in a directional
/// many-to-many graph, where edges represent the imports between modules. A
/// `dependency` is a file that must be notified when `imported` changes. This
/// is implemented using an array of `Edge` objects that act as linked-list
/// nodes; each file stores the first import and dependency.
#[derive(Copy, Clone)]
pub struct Edge<const SIDE: bake::Side> {
    /// The file with the import statement.
    pub dependency: FileIndex<SIDE>,
    /// The file the import statement references.
    pub imported: FileIndex<SIDE>,
    /// Next edge in the "imports" linked list for the `dependency` file.
    pub next_import: Option<EdgeIndex>,
    /// Next edge in the "dependencies" linked list for the `imported` file.
    pub next_dependency: Option<EdgeIndex>,
    /// Previous edge in the "dependencies" linked list for the `imported` file.
    /// Enables O(1) removal from the middle of the list.
    pub prev_dependency: Option<EdgeIndex>,
}

#[derive(Default)]
pub enum Content {
    #[default]
    Unknown,
    /// When stale, the code is "", otherwise it contains at least one
    /// non-whitespace character (empty chunks contain a function wrapper).
    Js(Box<[u8]>),
    Asset(Box<[u8]>),
    /// First file in a CSS bundle (the one HTML/JS points into). Re-bundles
    /// of any downstream `CssChild` re-queue the root.
    CssRoot(u64),
    CssChild,
}

impl Content {
    #[inline]
    fn js_code(&self) -> Option<&[u8]> {
        match self {
            Content::Js(c) | Content::Asset(c) => Some(c),
            _ => None,
        }
    }
    #[inline]
    fn kind(&self) -> FileKind {
        match self {
            Content::Unknown => FileKind::Unknown,
            Content::Js(_) => FileKind::Js,
            Content::Asset(_) => FileKind::Asset,
            Content::CssRoot(_) | Content::CssChild => FileKind::Css,
        }
    }
}

/// Per-file metadata. Zig defines this as `File = ServerFile | ClientFile`
/// selected by `comptime side`. Rust folds the union here; per-side fields are
/// simply unused on the other side.
// TODO(port): split back into `ServerFile`/`ClientFile` once a trait shim
// over `Side` selects the per-side layout (saves ~24 bytes/file on server).
pub struct File {
    /// Server-side `kind`. For client side this mirrors `content.kind()`.
    pub kind: FileKind,
    /// If the file has an error, the failure can be looked up in `dev.bundling_failures`.
    pub failed: bool,
    // ── server-side ────────────────────────────────────────────────────
    pub is_rsc: bool,
    pub is_ssr: bool,
    pub is_client_component_boundary: bool,
    pub is_route: bool,
    // ── client-side ────────────────────────────────────────────────────
    pub is_hmr_root: bool,
    pub is_special_framework_file: bool,
    pub html_route_bundle_index: Option<route_bundle::Index>,
    pub source_map: packed_map::Shared,
    pub content: Content,
}

impl File {
    #[inline]
    pub fn file_kind(&self) -> FileKind {
        self.kind
    }

    /// `ServerFile.stopsDependencyTrace` / `ClientFile.stopsDependencyTrace`.
    #[inline]
    fn stops_dependency_trace(&self, side: Side) -> bool {
        match side {
            Side::Server => self.is_client_component_boundary,
            Side::Client => false,
        }
    }
}

impl Default for File {
    /// Only exists to satisfy `StringArrayHashMap::get_or_put`'s `V: Default`
    /// bound; the slot is always overwritten on `!found_existing`.
    fn default() -> Self {
        Self {
            kind: FileKind::Unknown,
            failed: false,
            is_rsc: false,
            is_ssr: false,
            is_client_component_boundary: false,
            is_route: false,
            is_hmr_root: false,
            is_special_framework_file: false,
            html_route_bundle_index: None,
            source_map: Default::default(),
            content: Content::Unknown,
        }
    }
}

/// `IncrementalGraph(.server).CurrentChunkSourceMapData`
/// (IncrementalGraph.zig:305).
pub struct CurrentChunkSourceMapData {
    pub file_index: ServerFileIndex,
    pub source_map: packed_map::Shared,
}

// ──────────────────────────────────────────────────────────────────────────
// Method-argument types (formerly re-exported from `incremental_graph_body`)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ProcessMode {
    Normal,
    Css,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TraceDependencyGoal {
    StopAtBoundary,
    NoStop,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum EdgeAttachmentMode {
    JsOrHtml,
    Css,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum EdgeAttachmentResult {
    Continue,
    Stop,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum FreeCssMode {
    UnrefCss,
    IgnoreCss,
}

pub enum InsertFailureKey<'a> {
    AbsPath(&'a [u8]),
    /// Raw file index into `bundled_files` (side is implied by the graph the
    /// caller is invoking `insert_failure` on).
    Index(u32),
}

pub struct ReceiveChunkSourceMap {
    pub chunk: bun_sourcemap::Chunk,
    pub escaped_source: Option<Box<[u8]>>,
}

pub enum ReceiveChunkContent {
    Js {
        /// Allocated by `dev.arena()`; ownership transferred to the graph
        /// (client) or to `current_chunk_code` (server).
        code: Box<[u8]>,
        source_map: Option<ReceiveChunkSourceMap>,
    },
    Css(u64),
}

pub struct TakeJSBundleOptionsClient<'a> {
    pub kind: ChunkKind,
    pub script_id: source_map_store::Key,
    pub initial_response_entry_point: &'a [u8],
    pub react_refresh_entry_point: &'a [u8],
    pub console_log: bool,
}
impl Default for TakeJSBundleOptionsClient<'_> {
    fn default() -> Self {
        Self {
            kind: ChunkKind::InitialResponse,
            script_id: source_map_store::Key::init(0),
            initial_response_entry_point: b"",
            react_refresh_entry_point: b"",
            console_log: false,
        }
    }
}

pub struct TakeJSBundleOptionsServer {
    pub kind: ChunkKind,
    pub script_id: source_map_store::Key,
}

#[repr(C)]
#[derive(Default)]
struct TempLookup {
    edge_index: EdgeIndex,
    seen: bool,
}

/// `IncrementalGraph(side)`. The Zig original is comptime-parameterized over
/// `bake.Side` so `File` resolves to `ServerFile`/`ClientFile`. Mirrored here
/// via `adt_const_params` on `bake::Side`; `File` itself is still the folded
/// union (see TODO above) until a trait dispatch picks the per-side layout.
#[derive(Default)]
pub struct IncrementalGraph<const SIDE: bake::Side> {
    /// Keys are absolute paths for the "file" namespace (owned). Index = `FileIndex`.
    pub bundled_files: StringArrayHashMap<File>,
    /// Parallel to `bundled_files`; bit set = file is stale and must rebundle.
    pub stale_files: DynamicBitSetUnmanaged,
    /// Start of a file's "dependencies" linked list (files that import this file).
    pub first_dep: Vec<Option<EdgeIndex>>,
    /// Start of a file's "imports" linked list (files this file imports).
    pub first_import: Vec<Option<EdgeIndex>>,
    /// Edge storage; indices into this are `EdgeIndex`.
    pub edges: Vec<Edge<SIDE>>,
    /// Freed edge slots for reuse by `new_edge`.
    pub edges_free_list: Vec<EdgeIndex>,
    // ── per-bundle scratch (`current_chunk_*`) ─────────────────────────
    /// Total byte length of the current JS chunk being assembled.
    pub current_chunk_len: usize,
    /// Client side: file indices contributing to the current chunk (emit order).
    /// Server side: unused (server stores code slices in `current_chunk_code`).
    pub current_chunk_parts: Vec<FileIndex<SIDE>>,
    /// Server side: owned code slices contributing to the current chunk.
    /// Client side: unused.
    pub current_chunk_code: Vec<Box<[u8]>>,
    /// Server side: `{file_index, source_map}` parallel to `current_chunk_code`.
    pub current_chunk_source_maps: Vec<CurrentChunkSourceMapData>,
    /// Client side: CSS asset content-hashes referenced by the current chunk.
    pub current_css_files: Vec<u64>,
}

/// `IncrementalGraph(side).MemoryCost` (IncrementalGraph.zig:414).
#[derive(Default, Clone, Copy)]
pub struct GraphMemoryCost {
    pub graph: usize,
    pub code: usize,
    pub source_maps: usize,
}

impl<const SIDE: bake::Side> IncrementalGraph<SIDE> {
    /// Helper for `DevServer::is_file_cached`.
    #[inline]
    pub fn file_kind_at(&self, index: usize) -> FileKind {
        self.bundled_files.values()[index].kind
    }

    /// `@fieldParentPtr(@tagName(side) ++ "_graph", g)` — recover the owning
    /// `DevServer` from this inline field. Returns a raw pointer because the
    /// caller already holds `&mut self` (a sub-borrow of `*dev`); forming
    /// `&mut DevServer` would alias. Callers must only touch *sibling* fields.
    ///
    /// SAFETY: `self` must be the `client_graph` / `server_graph` field of a
    /// heap-allocated `DevServer` (guaranteed by `Box<DevServer>` ownership).
    #[inline]
    unsafe fn owner(&mut self) -> *mut DevServer {
        let offset = match SIDE {
            Side::Client => offset_of!(DevServer, client_graph),
            Side::Server => offset_of!(DevServer, server_graph),
        };
        // SAFETY: `self` is the `<side>_graph` field of `DevServer`.
        unsafe { bun_core::container_of::<DevServer, Self>(std::ptr::from_mut(self), offset) }
    }

    /// Safe sibling-projection: borrow the owning [`DevServer`]'s
    /// `incremental_result` while holding `&mut self`. The two fields are
    /// disjoint, so the returned `&mut` does not alias `self`.
    #[inline]
    fn dev_incremental_result(&mut self) -> &mut super::IncrementalResult {
        // SAFETY: `owner()` recovers the heap-allocated `DevServer`;
        // `incremental_result` is field-disjoint from both `client_graph` and
        // `server_graph`, so the returned borrow and `&mut self` cover
        // non-overlapping memory.
        unsafe { &mut (*self.owner()).incremental_result }
    }

    /// Safe sibling-projection: borrow the owning [`DevServer`]'s
    /// `bundling_failures` while holding `&mut self` (same disjoint-field
    /// rationale as [`dev_incremental_result`](Self::dev_incremental_result)).
    #[inline]
    fn dev_bundling_failures(
        &mut self,
    ) -> &mut ArrayHashMap<serialized_failure::OwnerPacked, SerializedFailure> {
        // SAFETY: `owner()` recovers the heap-allocated `DevServer`;
        // `bundling_failures` is field-disjoint from both `client_graph` and
        // `server_graph`, so the returned borrow and `&mut self` cover
        // non-overlapping memory.
        unsafe { &mut (*self.owner()).bundling_failures }
    }

    /// Safe sibling-projection: borrow the owning [`DevServer`]'s `dump_dir`
    /// while holding `&mut self` (same disjoint-field rationale as
    /// [`dev_incremental_result`](Self::dev_incremental_result)).
    #[cfg(feature = "bake_debugging_features")]
    #[inline]
    fn dev_dump_dir(&mut self) -> Option<&mut bun_sys::Dir> {
        // SAFETY: `owner()` recovers the heap-allocated `DevServer`; `dump_dir`
        // is field-disjoint from both `client_graph` and `server_graph`, so the
        // returned borrow and `&mut self` cover non-overlapping memory.
        unsafe { (*self.owner()).dump_dir.as_mut() }
    }

    /// `IncrementalGraph(side).getFileByIndex` — direct value-slot accessor.
    #[inline]
    pub fn get_file_by_index(&self, index: FileIndex<SIDE>) -> &File {
        &self.bundled_files.values()[index.get() as usize]
    }

    /// `IncrementalGraph(side).getFileIndex(abs_path)` — path → `FileIndex` lookup.
    #[inline]
    pub fn get_file_index(&self, abs_path: &[u8]) -> Option<FileIndex<SIDE>> {
        self.bundled_files
            .get_index(abs_path)
            .map(|i| FileIndex::init(i as u32))
    }

    /// `IncrementalGraph(.client).htmlRouteBundleIndex`.
    pub fn html_route_bundle_index(&self, index: FileIndex<SIDE>) -> route_bundle::Index {
        self.bundled_files.values()[index.get() as usize]
            .html_route_bundle_index
            .expect("html_route_bundle_index on non-HTML file")
    }

    // ── per-bundle scratch accessors (kept for existing call sites) ────────
    #[inline]
    pub fn current_chunk_parts_len(&self) -> usize {
        match SIDE {
            Side::Client => self.current_chunk_parts.len(),
            Side::Server => self.current_chunk_code.len(),
        }
    }
    #[inline]
    pub fn current_chunk_source_maps_is_empty(&self) -> bool {
        self.current_chunk_source_maps.is_empty()
    }

    /// `IncrementalGraph(side).memoryCostDetailed` (IncrementalGraph.zig:420).
    /// Does NOT count `size_of::<Self>()`.
    pub fn memory_cost_detailed(&self) -> GraphMemoryCost {
        use core::mem::size_of;
        let mut graph: usize = 0;
        let mut code: usize = 0;
        let mut source_maps: usize = 0;
        // PERF(port): bun_collections::StringArrayHashMap::capacity_in_bytes —
        // approximate via key+value slice cost.
        graph += self.bundled_files.count() * (size_of::<Box<[u8]>>() + size_of::<File>());
        graph += self.stale_files.bytes().len();
        graph += self.first_dep.capacity() * size_of::<Option<EdgeIndex>>();
        graph += self.first_import.capacity() * size_of::<Option<EdgeIndex>>();
        graph += self.edges.capacity() * size_of::<Edge<SIDE>>();
        graph += self.edges_free_list.capacity() * size_of::<EdgeIndex>();
        match SIDE {
            Side::Client => {
                graph += self.current_chunk_parts.capacity() * size_of::<FileIndex<SIDE>>();
                graph += self.current_css_files.capacity() * size_of::<u64>();
                for f in self.bundled_files.values() {
                    if let Some(c) = f.content.js_code() {
                        code += c.len();
                    }
                    source_maps += f.source_map.memory_cost();
                }
            }
            Side::Server => {
                graph += self.current_chunk_code.capacity() * size_of::<Box<[u8]>>();
                graph += self.current_chunk_source_maps.capacity()
                    * size_of::<CurrentChunkSourceMapData>();
                for item in &self.current_chunk_source_maps {
                    source_maps += item.source_map.memory_cost();
                }
            }
        }
        GraphMemoryCost {
            graph,
            code,
            source_maps,
        }
    }

    /// `IncrementalGraph(side).reset` (IncrementalGraph.zig:1673).
    /// Clears the per-bundle mutation tracking (`current_chunk_*`) without
    /// touching the persisted file/edge storage.
    pub fn reset(&mut self) {
        self.current_chunk_len = 0;
        match SIDE {
            Side::Client => {
                self.current_css_files.clear();
            }
            Side::Server => {
                // `Box<[u8]>` drops on clear; ditto `Shared` in source_maps.
                self.current_chunk_code.clear();
                self.current_chunk_source_maps.clear();
            }
        }
        self.current_chunk_parts.clear();
    }

    /// `IncrementalGraph(side).ensureStaleBitCapacity` — DevServer.zig:1573.
    /// Grows `stale_files` to cover all currently-known files, filling new
    /// bits with `are_new_files_stale`.
    pub fn ensure_stale_bit_capacity(
        &mut self,
        are_new_files_stale: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        let want = self.bundled_files.count().max(self.stale_files.bit_length);
        // Align forward to 8 usize words (8*64 bits).
        const STEP: usize = core::mem::size_of::<usize>() * 8 * 8;
        let aligned = want.div_ceil(STEP) * STEP;
        self.stale_files.resize(aligned, are_new_files_stale)
    }

    /// `IncrementalGraph(side).freeFileContent` (client only).
    /// Frees the file's `source_map` + `content`, optionally unref'ing the
    /// associated CSS asset. Leaves `content = .Unknown`.
    fn free_file_content(&mut self, key: &[u8], file: &mut File, css: FreeCssMode) {
        debug_assert!(matches!(SIDE, Side::Client));
        let _ = file.source_map.take(); // Rc drop releases backing PackedMap
        match core::mem::replace(&mut file.content, Content::Unknown) {
            Content::Js(_) | Content::Asset(_) => {
                // Box<[u8]> dropped here.
            }
            Content::CssRoot(_) | Content::CssChild => {
                if css == FreeCssMode::UnrefCss {
                    // SAFETY: see `owner()`; touches `assets` sibling only.
                    unsafe { (*self.owner()).assets.unref_by_path(key) };
                }
            }
            Content::Unknown => {}
        }
    }

    fn new_edge(&mut self, edge: Edge<SIDE>) -> Result<EdgeIndex, bun_alloc::AllocError> {
        if let Some(index) = self.edges_free_list.pop() {
            self.edges[index.get() as usize] = edge;
            return Ok(index);
        }
        let index = EdgeIndex::init(u32::try_from(self.edges.len()).expect("int cast"));
        self.edges.push(edge);
        Ok(index)
    }

    /// Does nothing besides release the `Edge` for reallocation by `new_edge`.
    /// Caller must detach the dependency from the linked list it is in.
    fn free_edge(&mut self, edge_index: EdgeIndex) {
        if edge_index.get() as usize == self.edges.len() - 1 {
            self.edges.pop();
        } else {
            // Leak on OOM is fine; next GC cycle reclaims it.
            self.edges_free_list.push(edge_index);
        }
    }

    /// When we delete an edge, connect its `prev_dependency` to its
    /// `next_dependency` (and vice versa). Does NOT touch the import list.
    fn disconnect_edge_from_dependency_list(&mut self, edge_index: EdgeIndex) {
        let edge = self.edges[edge_index.get() as usize];
        if let Some(prev) = edge.prev_dependency {
            self.edges[prev.get() as usize].next_dependency = edge.next_dependency;
            if let Some(next) = edge.next_dependency {
                self.edges[next.get() as usize].prev_dependency = edge.prev_dependency;
            }
        } else {
            // No prev → must be the head of `first_dep[imported]`.
            debug_assert_eq!(
                self.first_dep[edge.imported.get() as usize],
                Some(edge_index),
            );
            if let Some(next) = edge.next_dependency {
                self.edges[next.get() as usize].prev_dependency = None;
                self.first_dep[edge.imported.get() as usize] = Some(next);
            } else {
                self.first_dep[edge.imported.get() as usize] = None;
            }
        }
    }

    pub(super) fn disconnect_and_delete_file(&mut self, file_index: FileIndex<SIDE>) {
        debug_assert!(self.first_dep[file_index.get() as usize].is_none()); // must have no dependencies

        // Disconnect all imports.
        let mut it = self.first_import[file_index.get() as usize].take();
        while let Some(edge_index) = it {
            let dep = self.edges[edge_index.get() as usize];
            it = dep.next_import;
            debug_assert_eq!(dep.dependency.get(), file_index.get());
            self.disconnect_edge_from_dependency_list(edge_index);
            self.free_edge(edge_index);
        }

        // DirectoryWatchStore.Dep.source_file_path borrows this key; remove
        // any such dependencies before freeing it so they do not dangle.
        {
            // PORT NOTE: reshaped for borrowck — re-derive the key slice via raw
            // ptr so the `&mut DevServer.directory_watchers` borrow does not
            // overlap the `&mut self.bundled_files` borrow.
            let key_ptr: *const [u8] =
                &raw const *self.bundled_files.keys()[file_index.get() as usize];
            // SAFETY: see `owner()`; touches `directory_watchers` sibling only,
            // and `key_ptr` points into `bundled_files` which is not mutated
            // by `remove_dependencies_for_file`.
            unsafe {
                (*self.owner())
                    .directory_watchers
                    .remove_dependencies_for_file(&*key_ptr);
            }
        }

        // Free the key string and tombstone the slot. Cannot swap-remove since
        // FrameworkRouter / SerializedFailure hold FileIndices into this graph.
        // TODO(port): freed FileIndex should go on a free-list for reuse.
        self.bundled_files.keys_mut()[file_index.get() as usize] = Box::default();
        debug_assert!(self.first_dep[file_index.get() as usize].is_none());
        debug_assert!(self.first_import[file_index.get() as usize].is_none());
    }

    // ────────────────────────────────────────────────────────────────────────
    // receiveChunk
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(side).receiveChunk` (IncrementalGraph.zig:475).
    /// Tracks a bundled code chunk for cross-bundle chunks, ensuring it has an
    /// entry in `bundled_files`. For client, takes ownership of the code slice;
    /// for server, the code is kept in `current_chunk_code` until
    /// `take_js_bundle` consumes it.
    pub fn receive_chunk(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        index: impl Into<bun_ast::Index>,
        content: ReceiveChunkContent,
        is_ssr_graph: bool,
    ) -> Result<(), bun_core::Error> {
        let index: bun_ast::Index = index.into();
        // SAFETY: see `owner()`.
        let dev = unsafe { self.owner() };
        // SAFETY: `graph_safety_lock` is a sibling field; debug-assert only.
        unsafe { (*dev).graph_safety_lock.assert_locked() };

        let path = &ctx.sources[index.get() as usize].path;
        let key = path.key_for_incremental_graph();

        if cfg!(debug_assertions) {
            if let ReceiveChunkContent::Js { code, .. } = &content {
                if strings::is_all_whitespace(code) {
                    bun_core::Output::panic(format_args!(
                        "Empty chunk is impossible: {} {}",
                        bstr::BStr::new(key),
                        match SIDE {
                            Side::Client => "client",
                            Side::Server =>
                                if is_ssr_graph {
                                    "ssr"
                                } else {
                                    "server"
                                },
                        },
                    ));
                }
            }
        }

        // Dump to filesystem if enabled (Zig: `bun.FeatureFlags.bake_debugging_features`).
        #[cfg(feature = "bake_debugging_features")]
        if let ReceiveChunkContent::Js { code, .. } = &content {
            if let Some(dump_dir) = self.dev_dump_dir() {
                // SAFETY: sibling-field access via `owner()`; `root` is
                // disjoint from `dump_dir` and from `self` (the graph field).
                crate::bake::dev_server_body::dump_bundle_for_chunk(
                    unsafe { &*dev },
                    dump_dir,
                    SIDE,
                    key,
                    code,
                    true,
                    is_ssr_graph,
                );
            }
        }

        let gop = self.bundled_files.get_or_put(key)?;
        let file_index = FileIndex::<SIDE>::init(gop.index as u32);
        let found_existing = gop.found_existing;
        if !found_existing {
            *gop.key_ptr = Box::<[u8]>::from(key);
        }
        // PORT NOTE: drop `gop` borrow before pushing to other Vecs / re-borrowing.
        if !found_existing {
            self.first_dep.push(None);
            self.first_import.push(None);
        }

        if self.stale_files.bit_length > file_index.get() as usize {
            self.stale_files.unset(file_index.get() as usize);
        }

        *ctx.get_cached_index(SIDE, index) =
            CachedFileIndex::from(Some::<FileIndex<SIDE>>(file_index));

        match SIDE {
            Side::Client => {
                let mut html_route_bundle_index: Option<route_bundle::Index> = None;
                let mut is_special_framework_file = false;

                if found_existing {
                    // PORT NOTE: take the existing slot out so `free_file_content`
                    // can borrow `&mut self` while we hold the `File` by value.
                    let mut existing = core::mem::take(
                        &mut self.bundled_files.values_mut()[file_index.get() as usize],
                    );
                    self.free_file_content(key, &mut existing, FreeCssMode::IgnoreCss);

                    if existing.failed {
                        let owner =
                            serialized_failure::OwnerPacked::new(Side::Client, file_index.get());
                        let kv = self.dev_bundling_failures().fetch_swap_remove(&owner);
                        let kv = kv.unwrap_or_else(|| {
                            bun_core::Output::panic(format_args!(
                                "Missing SerializedFailure in IncrementalGraph",
                            ))
                        });
                        self.dev_incremental_result().failures_removed.push(kv.1);
                    }

                    html_route_bundle_index = existing.html_route_bundle_index;
                    is_special_framework_file = existing.is_special_framework_file;
                }

                let (new_content, new_source_map, code_len) = match content {
                    ReceiveChunkContent::Css(css) => {
                        (Content::CssRoot(css), packed_map::Shared::None, None)
                    }
                    ReceiveChunkContent::Js { code, source_map } => {
                        let len = code.len();
                        let kind = if ctx.loaders[index.get() as usize].is_javascript_like() {
                            Content::Js(code)
                        } else {
                            Content::Asset(code)
                        };
                        if source_map.is_some() {
                            debug_assert!(html_route_bundle_index.is_none()); // suspect behind #17956
                        }
                        let sm = match source_map {
                            Some(mut sm) if sm.chunk.buffer.len() > 0 => {
                                packed_map::Shared::Some(packed_map::PackedMap::new_non_empty(
                                    &mut sm.chunk,
                                    sm.escaped_source.take().expect("escaped_source"),
                                ))
                            }
                            _ => {
                                // Must precompute line count so source-map
                                // concatenation knows how many newlines to skip.
                                let count = match &kind {
                                    Content::Js(c) | Content::Asset(c) => {
                                        strings::count_char(&c[..], b'\n') as u32
                                    }
                                    _ => 0,
                                };
                                packed_map::Shared::LineCount(packed_map::LineCount::init(count))
                            }
                        };
                        (kind, sm, Some(len))
                    }
                };

                self.bundled_files.values_mut()[file_index.get() as usize] = File {
                    kind: new_content.kind(),
                    failed: false,
                    is_rsc: false,
                    is_ssr: false,
                    is_client_component_boundary: false,
                    is_route: false,
                    is_hmr_root: ctx.server_to_client_bitset.is_set(index.get() as usize),
                    is_special_framework_file,
                    html_route_bundle_index,
                    source_map: new_source_map,
                    content: new_content,
                };

                if let Some(len) = code_len {
                    self.current_chunk_parts.push(file_index);
                    self.current_chunk_len += len;
                }
            }
            Side::Server => {
                let new_kind = match &content {
                    ReceiveChunkContent::Js { .. } => FileKind::Js,
                    ReceiveChunkContent::Css(_) => FileKind::Css,
                };
                if !found_existing {
                    let scb = ctx.server_to_client_bitset.is_set(index.get() as usize);
                    self.bundled_files.values_mut()[file_index.get() as usize] = File {
                        kind: new_kind,
                        failed: false,
                        is_rsc: !is_ssr_graph,
                        is_ssr: is_ssr_graph,
                        is_client_component_boundary: scb,
                        is_route: false,
                        ..Default::default()
                    };
                    if scb {
                        self.dev_incremental_result()
                            .client_components_added
                            .push(ServerFileIndex::init(file_index.get()));
                    }
                } else {
                    let scb = ctx.server_to_client_bitset.is_set(index.get() as usize);
                    {
                        let f = &mut self.bundled_files.values_mut()[file_index.get() as usize];
                        f.kind = new_kind;
                        if is_ssr_graph {
                            f.is_ssr = true;
                        } else {
                            f.is_rsc = true;
                        }
                    }
                    if scb {
                        self.bundled_files.values_mut()[file_index.get() as usize]
                            .is_client_component_boundary = true;
                        self.dev_incremental_result()
                            .client_components_added
                            .push(ServerFileIndex::init(file_index.get()));
                    } else if self.bundled_files.values()[file_index.get() as usize]
                        .is_client_component_boundary
                    {
                        // SAFETY: cross-graph access via `owner()`. We hold
                        // `&mut self` (server_graph); `client_graph` is a
                        // disjoint sibling field.
                        let client_graph = unsafe { &mut (*dev).client_graph };
                        let key = bun_ptr::RawSlice::new(
                            &*self.bundled_files.keys()[file_index.get() as usize],
                        );
                        let client_index =
                            client_graph.get_file_index(key.slice()).unwrap_or_else(|| {
                                bun_core::Output::panic(format_args!(
                                    "Client graph's SCB was already deleted",
                                ))
                            });
                        client_graph.disconnect_and_delete_file(client_index);
                        self.bundled_files.values_mut()[file_index.get() as usize]
                            .is_client_component_boundary = false;
                        self.dev_incremental_result()
                            .client_components_removed
                            .push(ServerFileIndex::init(file_index.get()));
                    }

                    if self.bundled_files.values()[file_index.get() as usize].failed {
                        self.bundled_files.values_mut()[file_index.get() as usize].failed = false;
                        let owner =
                            serialized_failure::OwnerPacked::new(Side::Server, file_index.get());
                        let kv = self.dev_bundling_failures().fetch_swap_remove(&owner);
                        let kv = kv.unwrap_or_else(|| {
                            bun_core::Output::panic(format_args!(
                                "Missing failure in IncrementalGraph",
                            ))
                        });
                        self.dev_incremental_result().failures_removed.push(kv.1);
                    }
                }

                if let ReceiveChunkContent::Js { code, source_map } = content {
                    let code_len = code.len();
                    let line_count = strings::count_char(&code, b'\n') as u32;
                    self.current_chunk_code.push(code);
                    self.current_chunk_len += code_len;

                    let packed = match source_map {
                        Some(mut sm)
                            if sm.chunk.buffer.len() > 0 && sm.escaped_source.is_some() =>
                        {
                            packed_map::Shared::Some(packed_map::PackedMap::new_non_empty(
                                &mut sm.chunk,
                                sm.escaped_source.take().unwrap(),
                            ))
                        }
                        _ => packed_map::Shared::LineCount(packed_map::LineCount::init(line_count)),
                    };
                    self.current_chunk_source_maps
                        .push(CurrentChunkSourceMapData {
                            file_index: ServerFileIndex::init(file_index.get()),
                            source_map: packed,
                        });
                }
            }
        }
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // processChunkDependencies
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(side).processChunkDependencies` (IncrementalGraph.zig:726).
    /// Second pass of IncrementalGraph indexing: updates dependency information
    /// for each file and resolves what the HMR roots are.
    pub fn process_chunk_dependencies(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        mode: ProcessMode,
        bundle_graph_index: impl Into<bun_ast::Index>,
    ) -> Result<(), bun_core::Error> {
        let bundle_graph_index: bun_ast::Index = bundle_graph_index.into();
        let file_index: FileIndex<SIDE> = ctx
            .get_cached_index(SIDE, bundle_graph_index)
            .unwrap::<SIDE>()
            .expect("unresolved index"); // do not process for failed chunks

        // Build a map from the existing import list. Later, entries that
        // were not marked as `.seen = true` will be freed.
        let mut quick_lookup: ArrayHashMap<FileIndex<SIDE>, TempLookup> = ArrayHashMap::default();
        {
            let mut it = self.first_import[file_index.get() as usize];
            while let Some(edge_index) = it {
                let dep = self.edges[edge_index.get() as usize];
                it = dep.next_import;
                debug_assert_eq!(dep.dependency.get(), file_index.get());
                quick_lookup.put_no_clobber(
                    dep.imported,
                    TempLookup {
                        seen: false,
                        edge_index,
                    },
                )?;
            }
        }

        // `process_chunk_import_records` appends new entries (always seen=true).
        // Snapshot the length so the new ones are ignored when removing edges.
        let quick_lookup_values_to_care_len = quick_lookup.count();

        // A new import linked list is constructed from scratch.
        let mut new_imports: Option<EdgeIndex> = None;

        if mode == ProcessMode::Normal && matches!(SIDE, Side::Server) {
            if ctx.server_seen_bit_set.is_set(file_index.get() as usize) {
                self.first_import[file_index.get() as usize] = new_imports;
                return Ok(());
            }
            // TODO(port): RSC+SSR dual-index dispatch (`ctx.scbs.getSSRIndex`)
            // is dead in the Zig spec (commented out at IncrementalGraph.zig:782).
        }

        match mode {
            ProcessMode::Normal => self.process_chunk_import_records(
                ctx,
                &mut quick_lookup,
                &mut new_imports,
                file_index,
                bundle_graph_index,
            )?,
            ProcessMode::Css => self.process_css_chunk_import_records(
                ctx,
                &mut quick_lookup,
                &mut new_imports,
                file_index,
                bundle_graph_index,
            )?,
        }

        // Clear the old head before freeing so `check_edge_removal` (debug-only
        // in Zig) wouldn't see a stale reference.
        self.first_import[file_index.get() as usize] = None;

        // '.seen = false' means an import was removed and should be freed.
        for val in &quick_lookup.values()[0..quick_lookup_values_to_care_len] {
            if !val.seen {
                self.dev_incremental_result().had_adjusted_edges = true;
                self.disconnect_edge_from_dependency_list(val.edge_index);
                self.free_edge(val.edge_index);
            }
        }

        self.first_import[file_index.get() as usize] = new_imports;

        // Follow this file to the route / HMR root to mark it stale.
        self.trace_dependencies(
            file_index,
            ctx.gts,
            TraceDependencyGoal::StopAtBoundary,
            file_index,
        )
    }

    fn process_chunk_import_records(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        quick_lookup: &mut ArrayHashMap<FileIndex<SIDE>, TempLookup>,
        new_imports: &mut Option<EdgeIndex>,
        file_index: FileIndex<SIDE>,
        index: bun_ast::Index,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(index.is_valid());
        debug_assert!(!ctx.loaders[index.get() as usize].is_css());

        let records_len = ctx.import_records[index.get() as usize].slice().len();
        for i in 0..records_len {
            // PORT NOTE: snapshot the three fields we need so the shared borrow
            // on `ctx.import_records` ends before `process_edge_attachment`
            // takes `&mut ctx`.
            let (flags, src, key) = {
                let ir = &ctx.import_records[index.get() as usize].slice()[i];
                (
                    ir.flags,
                    ir.source_index,
                    ir.path.key_for_incremental_graph(),
                )
            };
            let _ = self.process_edge_attachment(
                ctx,
                quick_lookup,
                new_imports,
                file_index,
                flags,
                src,
                key,
                EdgeAttachmentMode::JsOrHtml,
            )?;
        }
        Ok(())
    }

    fn process_css_chunk_import_records(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        quick_lookup: &mut ArrayHashMap<FileIndex<SIDE>, TempLookup>,
        new_imports: &mut Option<EdgeIndex>,
        file_index: FileIndex<SIDE>,
        bundler_index: bun_ast::Index,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(bundler_index.is_valid());
        debug_assert!(ctx.loaders[bundler_index.get() as usize].is_css());

        // Queue avoids stack overflow; tracing bits in `process_edge_attachment`
        // prevent infinite recursion.
        // PERF(port): was stackFallback(64*u32) — profile in Phase B.
        let mut queue: Vec<bun_ast::Index> = Vec::new();
        queue.push(bundler_index);

        while let Some(idx) = queue.pop() {
            let records_len = ctx.import_records[idx.get() as usize].slice().len();
            for i in 0..records_len {
                let (flags, src, key) = {
                    let ir = &ctx.import_records[idx.get() as usize].slice()[i];
                    (
                        ir.flags,
                        ir.source_index,
                        ir.path.key_for_incremental_graph(),
                    )
                };
                let result = self.process_edge_attachment(
                    ctx,
                    quick_lookup,
                    new_imports,
                    file_index,
                    flags,
                    src,
                    key,
                    EdgeAttachmentMode::Css,
                )?;
                if result == EdgeAttachmentResult::Continue && src.is_valid() {
                    queue.push(src.into());
                }
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn process_edge_attachment(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        quick_lookup: &mut ArrayHashMap<FileIndex<SIDE>, TempLookup>,
        new_imports: &mut Option<EdgeIndex>,
        file_index: FileIndex<SIDE>,
        ir_flags: bun_ast::ImportRecordFlags,
        ir_source_index: bun_ast::Index,
        key: &[u8],
        mode: EdgeAttachmentMode,
    ) -> Result<EdgeAttachmentResult, bun_core::Error> {
        // Duplicated import records are marked unused by `ConvertESMExportsForHmr`.
        if ir_flags.contains(bun_ast::ImportRecordFlags::IS_UNUSED) {
            return Ok(EdgeAttachmentResult::Stop);
        }
        if ir_source_index.is_runtime() {
            return Ok(EdgeAttachmentResult::Stop);
        }

        // Locate the FileIndex from bundle_v2's Source.Index.
        let (imported_file_index, kind): (FileIndex<SIDE>, FileKind) = 'brk: {
            if ir_source_index.is_valid() {
                let kind = if mode == EdgeAttachmentMode::Css {
                    if ctx.loaders[ir_source_index.get() as usize].is_css() {
                        FileKind::Css
                    } else {
                        FileKind::Asset
                    }
                } else {
                    FileKind::Unknown
                };
                if let Some(i) = ctx.get_cached_index(SIDE, ir_source_index).unwrap::<SIDE>() {
                    break 'brk (i, kind);
                } else if mode == EdgeAttachmentMode::Css {
                    let index = self.insert_empty(key, kind)?.index;
                    ctx.gts.resize(SIDE, index.get() as usize + 1)?;
                    break 'brk (index, kind);
                }
            }
            match mode {
                // Invalid source indices in CSS are external URLs.
                EdgeAttachmentMode::Css => return Ok(EdgeAttachmentResult::Stop),
                // Check IncrementalGraph for a file from a prior build.
                EdgeAttachmentMode::JsOrHtml => match self.bundled_files.get_index(key) {
                    Some(i) => (FileIndex::<SIDE>::init(i as u32), FileKind::Unknown),
                    None => return Ok(EdgeAttachmentResult::Continue),
                },
            }
        };

        debug_assert!((imported_file_index.get() as usize) < self.bundled_files.count());

        // For CSS visiting CSS, prevent infinite recursion via tracing bits.
        if mode == EdgeAttachmentMode::Css && kind == FileKind::Css {
            if ctx
                .gts
                .bits(SIDE)
                .is_set(imported_file_index.get() as usize)
            {
                return Ok(EdgeAttachmentResult::Stop);
            }
            ctx.gts.bits(SIDE).set(imported_file_index.get() as usize);
        }

        let gop = quick_lookup.get_or_put(imported_file_index)?;
        if gop.found_existing {
            if gop.value_ptr.seen {
                return Ok(EdgeAttachmentResult::Continue);
            }
            gop.value_ptr.seen = true;
            let ei = gop.value_ptr.edge_index;
            self.edges[ei.get() as usize].next_import = *new_imports;
            *new_imports = Some(ei);
        } else {
            // A new edge is needed to represent the dependency and import.
            let first_dep = self.first_dep[imported_file_index.get() as usize];
            let edge = self.new_edge(Edge {
                next_import: *new_imports,
                next_dependency: first_dep,
                prev_dependency: None,
                imported: imported_file_index,
                dependency: file_index,
            })?;
            if let Some(dep) = first_dep {
                self.edges[dep.get() as usize].prev_dependency = Some(edge);
            }
            *new_imports = Some(edge);
            self.first_dep[imported_file_index.get() as usize] = Some(edge);

            self.dev_incremental_result().had_adjusted_edges = true;

            *gop.value_ptr = TempLookup {
                edge_index: edge,
                seen: true,
            };
        }
        Ok(EdgeAttachmentResult::Continue)
    }

    // ────────────────────────────────────────────────────────────────────────
    // traceDependencies / traceImports
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(side).traceDependencies` (IncrementalGraph.zig:1120).
    pub fn trace_dependencies(
        &mut self,
        file_index: FileIndex<SIDE>,
        gts: &mut GraphTraceState,
        goal: TraceDependencyGoal,
        from_file_index: FileIndex<SIDE>,
    ) -> Result<(), bun_core::Error> {
        if gts.bits(SIDE).is_set(file_index.get() as usize) {
            return Ok(());
        }
        gts.bits(SIDE).set(file_index.get() as usize);

        // SAFETY: see `owner()`.
        let dev = unsafe { self.owner() };

        match SIDE {
            Side::Server => {
                let (is_route, is_scb) = {
                    let file = &self.bundled_files.values()[file_index.get() as usize];
                    (file.is_route, file.is_client_component_boundary)
                };
                if is_route {
                    // SAFETY: sibling-field access.
                    let route_index = unsafe {
                        (*dev)
                            .route_lookup
                            .get(&ServerFileIndex::init(file_index.get()))
                    }
                    .copied()
                    .unwrap_or_else(|| {
                        bun_core::Output::panic(format_args!(
                            "Route not in lookup index: {} {:?}",
                            file_index.get(),
                            bstr::BStr::new(&self.bundled_files.keys()[file_index.get() as usize]),
                        ))
                    });
                    self.dev_incremental_result()
                        .framework_routes_affected
                        .push(route_index);
                }
                if is_scb {
                    self.dev_incremental_result()
                        .client_components_affected
                        .push(ServerFileIndex::init(file_index.get()));
                }
            }
            Side::Client => {
                let (is_hmr_root, html_rbi) = {
                    let file = &self.bundled_files.values()[file_index.get() as usize];
                    (file.is_hmr_root, file.html_route_bundle_index)
                };
                if is_hmr_root {
                    let key = bun_ptr::RawSlice::new(
                        &*self.bundled_files.keys()[file_index.get() as usize],
                    );
                    // SAFETY: cross-graph sibling access; `server_graph` disjoint.
                    let server_graph = unsafe { &mut (*dev).server_graph };
                    let index = server_graph.get_file_index(key.slice()).unwrap_or_else(|| {
                        bun_core::Output::panic(format_args!(
                            "Server Incremental Graph is missing component for {:?}",
                            bstr::BStr::new(key.slice()),
                        ))
                    });
                    server_graph.trace_dependencies(index, gts, goal, index)?;
                } else if let Some(route_bundle_index) = html_rbi {
                    // HTML modified or asset modified → hard reload; else soft.
                    let hard = from_file_index == file_index
                        || matches!(
                            self.bundled_files.values()[from_file_index.get() as usize].content,
                            Content::Asset(_),
                        );
                    let ir = self.dev_incremental_result();
                    if hard {
                        ir.html_routes_hard_affected.push(route_bundle_index);
                    } else {
                        ir.html_routes_soft_affected.push(route_bundle_index);
                    }
                    if goal == TraceDependencyGoal::StopAtBoundary {
                        return Ok(());
                    }
                }
            }
        }

        // Certain files do not propagate updates to dependencies.
        if goal == TraceDependencyGoal::StopAtBoundary {
            if self.bundled_files.values()[file_index.get() as usize].stops_dependency_trace(SIDE) {
                return Ok(());
            }
        }

        // Recurse.
        let mut it = self.first_dep[file_index.get() as usize];
        while let Some(dep_index) = it {
            let edge = self.edges[dep_index.get() as usize];
            it = edge.next_dependency;
            self.trace_dependencies(edge.dependency, gts, goal, file_index)?;
        }
        Ok(())
    }

    /// `IncrementalGraph(side).traceImports` (IncrementalGraph.zig:1206).
    pub fn trace_imports(
        &mut self,
        file_index: FileIndex<SIDE>,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> Result<(), bun_core::Error> {
        if gts.bits(SIDE).is_set(file_index.get() as usize) {
            return Ok(());
        }
        gts.bits(SIDE).set(file_index.get() as usize);

        // SAFETY: see `owner()`.
        let dev = unsafe { self.owner() };

        match SIDE {
            Side::Server => {
                let (is_scb, kind, failed) = {
                    let f = &self.bundled_files.values()[file_index.get() as usize];
                    (f.is_client_component_boundary, f.kind, f.failed)
                };
                if is_scb || kind == FileKind::Css {
                    let key = bun_ptr::RawSlice::new(
                        &*self.bundled_files.keys()[file_index.get() as usize],
                    );
                    // SAFETY: disjoint sibling `client_graph`.
                    let client_graph = unsafe { &mut (*dev).client_graph };
                    let index = client_graph.get_file_index(key.slice()).unwrap_or_else(|| {
                        bun_core::Output::panic(format_args!(
                            "Client Incremental Graph is missing component for {:?}",
                            bstr::BStr::new(key.slice()),
                        ))
                    });
                    client_graph.trace_imports(index, gts, goal)?;

                    if cfg!(debug_assertions) && kind == FileKind::Css {
                        // Server CSS files never have imports.
                        debug_assert!(self.first_import[file_index.get() as usize].is_none());
                    }
                }
                if goal == TraceImportGoal::FindErrors && failed {
                    let owner =
                        serialized_failure::OwnerPacked::new(Side::Server, file_index.get());
                    let fail = self
                        .dev_bundling_failures()
                        .get(&owner)
                        .cloned()
                        .expect("Failed to get bundling failure");
                    self.dev_incremental_result().failures_added.push(fail);
                }
            }
            Side::Client => {
                {
                    let f = &self.bundled_files.values()[file_index.get() as usize];
                    match &f.content {
                        Content::CssChild => {
                            debug_assert!(false, "only CSS roots should be found by tracing");
                        }
                        Content::CssRoot(id) => {
                            if goal == TraceImportGoal::FindCss {
                                self.current_css_files.push(*id);
                            }
                            // CSS can't import JS; trace is done.
                            return Ok(());
                        }
                        _ => {}
                    }
                }

                if goal == TraceImportGoal::FindClientModules {
                    let len = self.bundled_files.values()[file_index.get() as usize]
                        .content
                        .js_code()
                        .map(|c| c.len())
                        .unwrap_or(0);
                    self.current_chunk_parts.push(file_index);
                    self.current_chunk_len += len;
                }

                if goal == TraceImportGoal::FindErrors
                    && self.bundled_files.values()[file_index.get() as usize].failed
                {
                    let owner =
                        serialized_failure::OwnerPacked::new(Side::Client, file_index.get());
                    let fail = self
                        .dev_bundling_failures()
                        .get(&owner)
                        .cloned()
                        .expect("Failed to get bundling failure");
                    self.dev_incremental_result().failures_added.push(fail);
                    return Ok(());
                }
            }
        }

        // Recurse.
        let mut it = self.first_import[file_index.get() as usize];
        while let Some(dep_index) = it {
            let edge = self.edges[dep_index.get() as usize];
            it = edge.next_import;
            self.trace_imports(edge.imported, gts, goal)?;
        }
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // insertStale / insertEmpty / insertCssFileOnServer / insertFailure
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(side).insertStale` — adds a file to the graph in the
    /// stale state without bundled content. Thin forwarder (spec :1295).
    pub fn insert_stale(
        &mut self,
        abs_path: &[u8],
        is_ssr_graph: bool,
    ) -> Result<FileIndex<SIDE>, bun_alloc::AllocError> {
        self.insert_stale_extra(abs_path, is_ssr_graph, false)
    }

    /// `IncrementalGraph(side).insertStaleExtra` (spec :1300).
    pub fn insert_stale_extra(
        &mut self,
        abs_path: &[u8],
        is_ssr_graph: bool,
        is_route: bool,
    ) -> Result<FileIndex<SIDE>, bun_alloc::AllocError> {
        let gop = self.bundled_files.get_or_put(abs_path)?;
        let idx = gop.index;
        let found_existing = gop.found_existing;
        if found_existing {
            if matches!(SIDE, Side::Server) && is_route {
                gop.value_ptr.is_route = true;
            }
        } else {
            *gop.key_ptr = Box::<[u8]>::from(abs_path);
        }
        if !found_existing {
            self.first_dep.push(None);
            self.first_import.push(None);
        }
        if self.stale_files.bit_length > idx {
            self.stale_files.set(idx);
        }

        match SIDE {
            Side::Client => {
                if found_existing {
                    let mut existing = core::mem::take(&mut self.bundled_files.values_mut()[idx]);
                    // PORT NOTE: re-derive owned key via `RawSlice` so
                    // `free_file_content` can borrow `&mut self`.
                    let key = bun_ptr::RawSlice::new(&*self.bundled_files.keys()[idx]);
                    self.free_file_content(key.slice(), &mut existing, FreeCssMode::UnrefCss);
                    existing.kind = FileKind::Unknown;
                    self.bundled_files.values_mut()[idx] = existing;
                } else {
                    self.bundled_files.values_mut()[idx] = File::default();
                }
            }
            Side::Server => {
                if !found_existing {
                    self.bundled_files.values_mut()[idx] = File {
                        kind: FileKind::Unknown,
                        failed: false,
                        is_rsc: !is_ssr_graph,
                        is_ssr: is_ssr_graph,
                        is_route,
                        is_client_component_boundary: false,
                        ..Default::default()
                    };
                } else if is_ssr_graph {
                    self.bundled_files.values_mut()[idx].is_ssr = true;
                } else {
                    self.bundled_files.values_mut()[idx].is_rsc = true;
                }
            }
        }
        Ok(FileIndex::init(idx as u32))
    }

    /// `IncrementalGraph(side).insertEmpty(abs_path, kind)` (spec :1354).
    pub fn insert_empty(
        &mut self,
        abs_path: &[u8],
        kind: FileKind,
    ) -> Result<InsertEmptyResult<SIDE>, bun_alloc::AllocError> {
        let gop = self.bundled_files.get_or_put(abs_path)?;
        let idx = gop.index;
        let found_existing = gop.found_existing;
        if !found_existing {
            *gop.key_ptr = Box::<[u8]>::from(abs_path);
            *gop.value_ptr = match SIDE {
                Side::Client => File {
                    kind,
                    content: match kind {
                        FileKind::Unknown => Content::Unknown,
                        FileKind::Js => Content::Js(Box::default()),
                        FileKind::Asset => Content::Asset(Box::default()),
                        FileKind::Css => Content::CssChild,
                    },
                    ..Default::default()
                },
                Side::Server => File {
                    kind,
                    ..Default::default()
                },
            };
        }
        // Capture the interned-key fat ptr now so the `gop` borrow on
        // `bundled_files` ends before `ensure_stale_bit_capacity` reborrows.
        let key = bun_ptr::RawSlice::new(&**gop.key_ptr);
        if !found_existing {
            self.first_dep.push(None);
            self.first_import.push(None);
            self.ensure_stale_bit_capacity(true)?;
        }
        Ok(InsertEmptyResult {
            index: FileIndex::init(idx as u32),
            key,
        })
    }

    /// `IncrementalGraph(.server).insertCssFileOnServer` (spec :1390).
    /// Server CSS files are just targets for graph traversal; content lives
    /// only on the client.
    pub fn insert_css_file_on_server(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        index: bun_ast::Index,
        abs_path: &[u8],
    ) -> Result<(), bun_core::Error> {
        debug_assert!(matches!(SIDE, Side::Server));
        let gop = self.bundled_files.get_or_put(abs_path)?;
        let file_index = FileIndex::<SIDE>::init(gop.index as u32);
        let found_existing = gop.found_existing;
        if !found_existing {
            *gop.key_ptr = Box::<[u8]>::from(abs_path);
        }
        *gop.value_ptr = File {
            kind: FileKind::Css,
            ..Default::default()
        };
        if !found_existing {
            self.first_dep.push(None);
            self.first_import.push(None);
        }
        *ctx.get_cached_index(Side::Server, index) =
            CachedFileIndex::from(Some::<FileIndex<SIDE>>(file_index));
        Ok(())
    }

    /// `IncrementalGraph(side).insertFailure` (spec :1419).
    pub fn insert_failure(
        &mut self,
        key: InsertFailureKey<'_>,
        log: &bun_ast::Log,
        is_ssr_graph: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        let (idx, found_existing) = match key {
            InsertFailureKey::AbsPath(abs_path) => {
                let gop = self.bundled_files.get_or_put(abs_path)?;
                if !gop.found_existing {
                    *gop.key_ptr = Box::<[u8]>::from(abs_path);
                }
                let (i, fe) = (gop.index, gop.found_existing);
                if !fe {
                    self.first_dep.push(None);
                    self.first_import.push(None);
                }
                (i, fe)
            }
            InsertFailureKey::Index(i) => (i as usize, true),
        };
        self.ensure_stale_bit_capacity(true)?;
        self.stale_files.set(idx);

        match SIDE {
            Side::Client => {
                if found_existing {
                    let mut existing = core::mem::take(&mut self.bundled_files.values_mut()[idx]);
                    let key = bun_ptr::RawSlice::new(&*self.bundled_files.keys()[idx]);
                    self.free_file_content(key.slice(), &mut existing, FreeCssMode::UnrefCss);
                    existing.failed = true;
                    existing.kind = FileKind::Unknown;
                    self.bundled_files.values_mut()[idx] = existing;
                } else {
                    self.bundled_files.values_mut()[idx] = File {
                        failed: true,
                        ..Default::default()
                    };
                }
            }
            Side::Server => {
                if !found_existing {
                    self.bundled_files.values_mut()[idx] = File {
                        failed: true,
                        is_rsc: !is_ssr_graph,
                        is_ssr: is_ssr_graph,
                        ..Default::default()
                    };
                } else {
                    let f = &mut self.bundled_files.values_mut()[idx];
                    if is_ssr_graph {
                        f.is_ssr = true;
                    } else {
                        f.is_rsc = true;
                    }
                    f.failed = true;
                }
            }
        }

        // SAFETY: see `owner()`.
        let dev = unsafe { self.owner() };
        let fail_owner = serialized_failure::OwnerPacked::new(SIDE, idx as u32);

        // TODO(port): DevServer should get a stdio manager which can process
        // the error list as it changes while also supporting a REPL.
        let _ = log.print(std::ptr::from_mut(bun_core::Output::error_writer()));

        let failure = {
            let mut buf = bun_paths::path_buffer_pool::get();
            let key = bun_ptr::RawSlice::new(&*self.bundled_files.keys()[idx]);
            // SAFETY: sibling-field `relative_path` reads `dev.root` only.
            let owner_display_name = unsafe { (*dev).relative_path(&mut *buf, key.slice()) };
            SerializedFailure::init_from_log(
                match SIDE {
                    Side::Server => serialized_failure::Owner::Server(FileIndex::init(idx as u32)),
                    Side::Client => serialized_failure::Owner::Client(FileIndex::init(idx as u32)),
                },
                owner_display_name,
                &log.msgs,
            )?
        };
        // SAFETY: sibling-field access.
        unsafe {
            let fail_gop = (*dev).bundling_failures.get_or_put(fail_owner)?;
            (*dev)
                .incremental_result
                .failures_added
                .push(failure.clone());
            if fail_gop.found_existing {
                (*dev)
                    .incremental_result
                    .failures_removed
                    .push(core::mem::replace(fail_gop.value_ptr, failure));
            } else {
                *fail_gop.value_ptr = failure;
            }
        }
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // onFileDeleted / invalidate
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(side).onFileDeleted` (spec :1528).
    pub fn on_file_deleted(
        &mut self,
        abs_path: &[u8],
        bv2: &mut bun_bundler::BundleV2<'_>,
    ) -> Result<(), bun_alloc::AllocError> {
        let Some(index) = self.get_file_index(abs_path) else {
            return Ok(());
        };

        // Disconnect all imports.
        let mut it = self.first_import[index.get() as usize].take();
        while let Some(edge_index) = it {
            let dep = self.edges[edge_index.get() as usize];
            it = dep.next_import;
            debug_assert_eq!(dep.dependency.get(), index.get());
            self.disconnect_edge_from_dependency_list(edge_index);
            self.free_edge(edge_index);
        }

        // Rebuild all dependencies.
        let target = match SIDE {
            Side::Client => bun_ast::Target::Browser,
            Side::Server => bun_ast::Target::Bun,
        };
        let mut it = self.first_dep[index.get() as usize];
        while let Some(edge_index) = it {
            let dep = self.edges[edge_index.get() as usize];
            it = dep.next_dependency;
            debug_assert_eq!(dep.imported.get(), index.get());
            let key = &self.bundled_files.keys()[dep.dependency.get() as usize];
            bun_core::handle_oom(
                bv2.enqueue_file_from_dev_server_incremental_graph_invalidation(key, target),
            );
        }

        // Bust the resolution cache of the dir containing this file.
        let dirname = bun_paths::dirname(abs_path).unwrap_or(abs_path);
        let _ = bv2.transpiler.resolver.bust_dir_cache(dirname);

        // Clear the cached entry from the path→source-index maps.
        for map in bv2.graph.build_graphs.values_mut() {
            map.remove(abs_path);
        }
        Ok(())
    }

    /// `IncrementalGraph(side).invalidate` (spec :1589). Given a set of paths,
    /// mark the relevant files as stale and append them into `entry_points`.
    pub fn invalidate(
        &mut self,
        paths: &[Box<[u8]>],
        entry_points: &mut EntryPointList,
    ) -> Result<(), bun_core::Error> {
        for path in paths {
            let Some(index) = self.bundled_files.get_index(path) else {
                continue;
            };
            self.stale_files.set(index);
            // Store the graph-owned key, not the incoming `path` (which may be
            // freed before `entry_points` is consumed).
            // PORT NOTE: re-derive via `RawSlice` so the immutable key borrow
            // does not conflict with the `&mut entry_points` push below.
            let owned_path = bun_ptr::RawSlice::new(&*self.bundled_files.keys()[index]);
            let owned_path = owned_path.slice();
            match SIDE {
                Side::Client => match &self.bundled_files.values()[index].content {
                    Content::CssRoot(_) | Content::CssChild => {
                        if matches!(
                            self.bundled_files.values()[index].content,
                            Content::CssRoot(_),
                        ) {
                            entry_points.append_css(owned_path)?;
                        }
                        let mut it = self.first_dep[index];
                        while let Some(edge_index) = it {
                            let entry = self.edges[edge_index.get() as usize];
                            let dep = entry.dependency;
                            self.stale_files.set(dep.get() as usize);
                            if matches!(
                                self.bundled_files.values()[dep.get() as usize].content,
                                Content::CssRoot(_),
                            ) {
                                let k = bun_ptr::RawSlice::new(
                                    &*self.bundled_files.keys()[dep.get() as usize],
                                );
                                entry_points.append_css(k.slice())?;
                            }
                            it = entry.next_dependency;
                        }
                    }
                    Content::Asset(_) => {
                        let mut it = self.first_dep[index];
                        while let Some(edge_index) = it {
                            let entry = self.edges[edge_index.get() as usize];
                            let dep = entry.dependency;
                            self.stale_files.set(dep.get() as usize);
                            let k = bun_ptr::RawSlice::new(
                                &*self.bundled_files.keys()[dep.get() as usize],
                            );
                            let k = k.slice();
                            if matches!(
                                self.bundled_files.values()[dep.get() as usize].content,
                                Content::CssRoot(_),
                            ) {
                                entry_points.append_css(k)?;
                            } else {
                                entry_points.append_js(k, bake::Graph::Client)?;
                            }
                            it = entry.next_dependency;
                        }
                        entry_points.append_js(owned_path, bake::Graph::Client)?;
                    }
                    // When re-bundling SCBs, only bundle the server.
                    Content::Js(_) | Content::Unknown => {
                        if !self.bundled_files.values()[index].is_hmr_root {
                            entry_points.append_js(owned_path, bake::Graph::Client)?;
                        }
                    }
                },
                Side::Server => {
                    let f = &self.bundled_files.values()[index];
                    if f.is_rsc {
                        entry_points.append_js(owned_path, bake::Graph::Server)?;
                    }
                    if f.is_ssr && !f.is_client_component_boundary {
                        entry_points.append_js(owned_path, bake::Graph::Ssr)?;
                    }
                }
            }
        }
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // takeJSBundle / takeSourceMap
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(.server).takeJSBundle` — server-side overload.
    pub fn take_js_bundle_server(
        &mut self,
        opts: &TakeJSBundleOptionsServer,
    ) -> Result<Vec<u8>, bun_core::Error> {
        let mut chunk = Vec::new();
        self.take_js_bundle_to_list_server(&mut chunk, opts)?;
        Ok(chunk)
    }

    /// `IncrementalGraph(.client).takeJSBundle` — client-side overload (kept
    /// under the side-agnostic name for existing call sites).
    pub fn take_js_bundle(
        &mut self,
        opts: &TakeJSBundleOptionsClient,
    ) -> Result<Vec<u8>, bun_core::Error> {
        let mut chunk = Vec::new();
        self.take_js_bundle_to_list(&mut chunk, opts)?;
        Ok(chunk)
    }

    /// `IncrementalGraph(.client).takeJSBundleToList` (spec :1713).
    pub fn take_js_bundle_to_list(
        &mut self,
        list: &mut Vec<u8>,
        options: &TakeJSBundleOptionsClient,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(matches!(SIDE, Side::Client));
        debug_assert!(self.current_chunk_len > 0);
        let kind = options.kind;

        let runtime: bake::HmrRuntime = match kind {
            ChunkKind::InitialResponse => bake::get_hmr_runtime(Side::Client),
            ChunkKind::HmrChunk => bake::HmrRuntime {
                code: bun_core::ZStr::from_static(b"self[Symbol.for(\"bun:hmr\")]({\n\0"),
                line_count: 1,
            },
        };

        // PERF(port): was std.heap.stackFallback(65536) — profile in Phase B.
        let mut end_list: Vec<u8> = Vec::with_capacity(256);
        // SAFETY: see `owner()`.
        let dev = unsafe { self.owner() };
        match kind {
            ChunkKind::InitialResponse => {
                end_list.extend_from_slice(b"}, {\n  main: ");
                if !options.initial_response_entry_point.is_empty() {
                    let mut buf = bun_paths::path_buffer_pool::get();
                    // SAFETY: `relative_path` reads `dev.root` only.
                    let rel = unsafe {
                        (*dev).relative_path(&mut *buf, options.initial_response_entry_point)
                    };
                    bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
                        rel,
                        &mut end_list,
                    )?;
                } else {
                    end_list.extend_from_slice(b"null");
                }
                end_list.extend_from_slice(b",\n  bun: \"");
                end_list.extend_from_slice(
                    bun_core::Global::package_json_version_with_canary.as_bytes(),
                );
                end_list.extend_from_slice(b"\"");
                end_list.extend_from_slice(b",\n  generation: \"");
                let generation: u32 = (options.script_id.get() >> 32) as u32;
                let _ = write!(end_list, "{}", bun_core::fmt::hex_lower(&generation.to_ne_bytes()));
                end_list.extend_from_slice(b"\",\n  version: \"");
                // SAFETY: sibling-field read.
                end_list.extend_from_slice(unsafe { &(*dev).configuration_hash_key });
                if options.console_log {
                    end_list.extend_from_slice(b"\",\n  console: true");
                } else {
                    end_list.extend_from_slice(b"\",\n  console: false");
                }
                if !options.react_refresh_entry_point.is_empty() {
                    end_list.extend_from_slice(b",\n  refresh: ");
                    let mut buf = bun_paths::path_buffer_pool::get();
                    let rel = unsafe {
                        (*dev).relative_path(&mut *buf, options.react_refresh_entry_point)
                    };
                    bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
                        rel,
                        &mut end_list,
                    )?;
                }
                end_list.extend_from_slice(b"\n})");
            }
            ChunkKind::HmrChunk => {
                end_list.extend_from_slice(b"}, \"");
                let _ = write!(
                    end_list,
                    "{}",
                    bun_core::fmt::hex_lower(&options.script_id.get().to_ne_bytes())
                );
                end_list.extend_from_slice(b"\")");
            }
        }
        // sourceMappingURL footer (client only).
        end_list.extend_from_slice(b"\n//# sourceMappingURL=");
        end_list.extend_from_slice(CLIENT_PREFIX.as_bytes());
        end_list.push(b'/');
        let _ = write!(
            end_list,
            "{}",
            bun_core::fmt::hex_lower(&options.script_id.get().to_ne_bytes())
        );
        end_list.extend_from_slice(b".js.map\n");

        let runtime_code = runtime.code.as_bytes();
        let start = list.len();
        let need = self.current_chunk_len + runtime_code.len() + end_list.len();
        if start == 0 {
            list.reserve_exact(need);
        } else {
            list.reserve(need);
        }
        list.extend_from_slice(runtime_code);
        for entry in &self.current_chunk_parts {
            if let Some(code) = self.bundled_files.values()[entry.get() as usize]
                .content
                .js_code()
            {
                list.extend_from_slice(code);
            }
        }
        list.extend_from_slice(&end_list);

        #[cfg(feature = "bake_debugging_features")]
        if let Some(dump_dir) = self.dev_dump_dir() {
            let rel_path_escaped: &[u8] = match kind {
                ChunkKind::InitialResponse => b"latest_chunk.js",
                ChunkKind::HmrChunk => b"latest_hmr.js",
            };
            if let Err(err) = crate::bake::dev_server_body::dump_bundle(
                dump_dir,
                bake::Graph::Client,
                rel_path_escaped,
                &list[start..],
                false,
            ) {
                bun_core::Output::warn(format_args!("Could not dump bundle: {}", err));
            }
        }
        let _ = start;
        Ok(())
    }

    /// `IncrementalGraph(.server).takeJSBundleToList` (spec :1713).
    fn take_js_bundle_to_list_server(
        &mut self,
        list: &mut Vec<u8>,
        options: &TakeJSBundleOptionsServer,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(matches!(SIDE, Side::Server));
        debug_assert!(self.current_chunk_len > 0);

        let runtime: bake::HmrRuntime = match options.kind {
            ChunkKind::InitialResponse => bake::get_hmr_runtime(Side::Server),
            ChunkKind::HmrChunk => bake::HmrRuntime {
                code: bun_core::ZStr::from_static(b"({\0"),
                line_count: 0,
            },
        };
        // Server `.InitialResponse` is unreachable per spec; only HmrChunk hits
        // the end-builder.
        let end: &[u8] = b"})";

        let runtime_code = runtime.code.as_bytes();
        let start = list.len();
        list.reserve_exact(self.current_chunk_len + runtime_code.len() + end.len());
        list.extend_from_slice(runtime_code);
        for code in &self.current_chunk_code {
            list.extend_from_slice(code);
        }
        list.extend_from_slice(end);

        #[cfg(feature = "bake_debugging_features")]
        if let Some(dump_dir) = self.dev_dump_dir() {
            let rel_path_escaped: &[u8] = match options.kind {
                ChunkKind::InitialResponse => b"latest_chunk.js",
                ChunkKind::HmrChunk => b"latest_hmr.js",
            };
            if let Err(err) = crate::bake::dev_server_body::dump_bundle(
                dump_dir,
                bake::Graph::Server,
                rel_path_escaped,
                &list[start..],
                false,
            ) {
                bun_core::Output::warn(format_args!("Could not dump bundle: {}", err));
            }
        }
        let _ = start;
        Ok(())
    }

    /// `IncrementalGraph(side).takeSourceMap` (spec :1843).
    /// Fills in all fields of `out` except `ref_count`.
    pub fn take_source_map(
        &mut self,
        out: &mut source_map_store::Entry,
    ) -> Result<(), bun_core::Error> {
        let paths = self.bundled_files.keys();
        match SIDE {
            Side::Client => {
                let mut file_paths: Vec<Box<[u8]>> =
                    Vec::with_capacity(self.current_chunk_parts.len());
                let mut contained_maps: Vec<packed_map::Shared> =
                    Vec::with_capacity(self.current_chunk_parts.len());
                let mut overlapping_memory_cost: usize = 0;

                for file_index in &self.current_chunk_parts {
                    // PERF(port): Zig stored borrowed slice headers into
                    // `bundled_files.keys()`; that is self-referential w.r.t.
                    // `DevServer`, so the port owns a copy. Paths are short and
                    // source-map entries are infrequent — profile in Phase B.
                    file_paths.push(Box::<[u8]>::from(&*paths[file_index.get() as usize]));
                    let sm = self.bundled_files.values()[file_index.get() as usize]
                        .source_map
                        .clone();
                    if let Some(map) = sm.get() {
                        overlapping_memory_cost += map.memory_cost();
                    }
                    contained_maps.push(sm);
                }
                overlapping_memory_cost += contained_maps.capacity()
                    * core::mem::size_of::<packed_map::Shared>()
                    + file_paths.len() * core::mem::size_of::<Box<[u8]>>();

                let ref_count = out.ref_count;
                *out = source_map_store::Entry {
                    ref_count,
                    paths: file_paths.into_boxed_slice(),
                    files: contained_maps,
                    overlapping_memory_cost: overlapping_memory_cost as u32,
                };
            }
            Side::Server => {
                let mut file_paths: Vec<Box<[u8]>> =
                    Vec::with_capacity(self.current_chunk_source_maps.len());
                let mut contained_maps: Vec<packed_map::Shared> =
                    Vec::with_capacity(self.current_chunk_source_maps.len());
                let mut overlapping_memory_cost: u32 = 0;

                for item in &self.current_chunk_source_maps {
                    file_paths.push(Box::<[u8]>::from(&*paths[item.file_index.get() as usize]));
                    contained_maps.push(item.source_map.clone());
                    overlapping_memory_cost += item.source_map.memory_cost() as u32;
                }
                overlapping_memory_cost += (contained_maps.capacity()
                    * core::mem::size_of::<packed_map::Shared>()
                    + file_paths.len() * core::mem::size_of::<Box<[u8]>>())
                    as u32;

                *out = source_map_store::Entry {
                    ref_count: out.ref_count,
                    paths: file_paths.into_boxed_slice(),
                    files: contained_maps,
                    overlapping_memory_cost,
                };
            }
        }
        Ok(())
    }
}
