//! `DevServer.IncrementalGraph(side)` — data-oriented module graph with
//! perfect incremental tracking: edge lists, chunk receipt, dependency
//! tracing, and bundle emission.
//!
//! The graph is parameterized over `bake::Side`; `File` would resolve to
//! either `ServerFile` (boundary flags) or `ClientFile` (code + source map),
//! but stable Rust has no const-generic-enum struct selection, so the `File`
//! payload is folded into a single struct carrying both field sets and
//! per-side behaviour is dispatched on the `SIDE` const parameter.

use core::ops::ControlFlow;
use std::io::Write as _;

use bun_collections::{ArrayHashMap, StringArrayHashMap, bit_set::DynamicBitSetUnmanaged};
use bun_core::strings;

use super::{
    Assets, CLIENT_PREFIX, ChunkKind, DevServer, EntryPointList, FileKind, GraphTraceState,
    IncrementalResult, RouteIndexAndRecurseFlag, SerializedFailure, TraceImportGoal, packed_map,
    relative_path, route_bundle, serialized_failure, source_map_store,
};
use crate::bake::dev_server::{CachedFileIndex, HotUpdateContext};
use crate::bake::{self, Side};

/// `bun.GenericIndex(u30, File)` — file index into `bundled_files`.
///
/// Const-generic over `bake::Side` so that the server and client graphs'
/// `FileIndex` are distinct types.
pub(crate) struct SideMarker<const SIDE: bake::Side>;
pub(crate) type FileIndex<const SIDE: bake::Side> = bun_core::GenericIndex<u32, SideMarker<SIDE>>;
/// Alias used by `Graphs::route_lookup`.
pub(crate) type ServerFileIndex = FileIndex<{ bake::Side::Server }>;
pub(crate) type ClientFileIndex = FileIndex<{ bake::Side::Client }>;

/// Return shape for `IncrementalGraph::insert_empty`.
pub(crate) struct InsertEmptyResult<const SIDE: bake::Side> {
    pub(crate) index: FileIndex<SIDE>,
    /// Borrow of the interned key in `bundled_files`. The key `Box<[u8]>` lives
    /// until `disconnect_and_delete_client_file` frees it, and
    /// `remove_dependencies_for_file` is called first — so every holder
    /// outlives no read past that point (`RawSlice` invariant). Callers compare
    /// it by pointer identity.
    pub(crate) key: bun_ptr::RawSlice<u8>,
}

/// `bun.GenericIndex(u32, Edge)`.
pub(crate) enum EdgeMarker {}
pub(crate) type EdgeIndex = bun_core::GenericIndex<u32, EdgeMarker>;

/// One edge in the import graph. `File` objects act as nodes in a directional
/// many-to-many graph, where edges represent the imports between modules. A
/// `dependency` is a file that must be notified when `imported` changes. This
/// is implemented using an array of `Edge` objects that act as linked-list
/// nodes; each file stores the first import and dependency (`EdgeLists`).
#[derive(Copy, Clone)]
pub(crate) struct Edge<const SIDE: bake::Side> {
    /// The file with the import statement.
    pub(crate) dependency: FileIndex<SIDE>,
    /// The file the import statement references.
    pub(crate) imported: FileIndex<SIDE>,
    /// Next edge in the "imports" linked list for the `dependency` file.
    pub(crate) next_import: Option<EdgeIndex>,
    /// Next edge in the "dependencies" linked list for the `imported` file.
    pub(crate) next_dependency: Option<EdgeIndex>,
    /// Previous edge in the "dependencies" linked list for the `imported` file.
    /// Enables O(1) removal from the middle of the list.
    pub(crate) prev_dependency: Option<EdgeIndex>,
}

/// Heads of one file's two edge linked lists.
#[derive(Copy, Clone, Default)]
pub(crate) struct EdgeLists {
    /// Start of the "dependencies" linked list (files that import this file).
    pub(crate) first_dep: Option<EdgeIndex>,
    /// Start of the "imports" linked list (files this file imports).
    pub(crate) first_import: Option<EdgeIndex>,
}

#[derive(Default)]
pub(crate) enum Content {
    #[default]
    Unknown,
    /// When stale, the code is "", otherwise it contains at least one
    /// non-whitespace character (empty chunks contain a function wrapper).
    Js(Box<[u8]>),
    /// A module whose loader isn't JavaScript-like. Only copied files are in `Graphs::assets`.
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

/// Per-file metadata, folded across both sides; per-side fields are simply
/// unused on the other side (costs ~24 bytes/file on the server graph versus
/// a per-side layout).
pub(crate) struct File {
    /// Server-side `kind`. For client side this mirrors `content.kind()`.
    pub(crate) kind: FileKind,
    /// If the file has an error, the failure can be looked up in `Graphs::bundling_failures`.
    pub(crate) failed: bool,
    // ── server-side ────────────────────────────────────────────────────
    pub(crate) is_rsc: bool,
    pub(crate) is_ssr: bool,
    pub(crate) is_client_component_boundary: bool,
    pub(crate) is_route: bool,
    // ── client-side ────────────────────────────────────────────────────
    pub(crate) is_hmr_root: bool,
    pub(crate) is_special_framework_file: bool,
    pub(crate) html_route_bundle_index: Option<route_bundle::Index>,
    pub(crate) source_map: packed_map::Shared,
    pub(crate) content: Content,
}

impl File {
    #[inline]
    pub(crate) fn file_kind(&self) -> FileKind {
        self.kind
    }

    /// True if a rebuild must enqueue this file for the SSR graph. Parsing a client component
    /// boundary for the server already queues its SSR copy.
    #[inline]
    fn rebundles_for_ssr_graph(&self) -> bool {
        self.is_ssr && !self.is_client_component_boundary
    }

    /// `ServerFile.stopsDependencyTrace` / `ClientFile.stopsDependencyTrace`.
    #[inline]
    fn stops_dependency_trace(&self, side: Side) -> bool {
        match side {
            Side::Server => self.is_client_component_boundary,
            Side::Client => false,
        }
    }

    /// Frees what a client file holds; a css root stays one. Returns whether it was a css child.
    fn free_content(&mut self) -> bool {
        let _ = self.source_map.take();
        if let Content::CssRoot(_) = self.content {
            self.kind = FileKind::Css;
            return false;
        }
        self.kind = FileKind::Unknown;
        matches!(core::mem::take(&mut self.content), Content::CssChild)
    }
}

impl Default for File {
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

/// Pairs a server file with its source map for the chunk currently being
/// assembled.
pub(crate) struct CurrentChunkSourceMapData {
    pub(crate) file_index: ServerFileIndex,
    pub(crate) source_map: packed_map::Shared,
}

// ──────────────────────────────────────────────────────────────────────────
// Method-argument types (formerly re-exported from `incremental_graph_body`)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum ProcessMode {
    Normal,
    Css,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum TraceDependencyGoal {
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

/// `Route` on the server must also be registered in `Graphs::route_lookup`.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum RouteKind {
    NotRoute,
    Route,
}

#[derive(Copy, Clone)]
pub(crate) enum InsertFailureKey<'a> {
    /// A file that may not be in the graph yet, plus the graph the failed task was queued for.
    AbsPath(&'a [u8], bake::Graph),
    /// Raw file index into the `bundled_files` of `SIDE`. The record keeps its graph flags.
    Index(u32),
}

pub(crate) struct ReceiveChunkSourceMap {
    pub(crate) chunk: bun_sourcemap::Chunk,
    pub(crate) escaped_source: Option<Box<[u8]>>,
}

pub(crate) enum ReceiveChunkContent {
    Js {
        /// Allocated by `dev.arena()`; ownership transferred to the graph
        /// (client) or to `current_chunk_code` (server).
        code: Box<[u8]>,
        source_map: Option<ReceiveChunkSourceMap>,
    },
    Css(u64),
}

pub(crate) struct TakeJSBundleOptionsClient<'a> {
    pub(crate) kind: ChunkKind,
    pub(crate) script_id: source_map_store::Key,
    /// `Graphs::root`. Only read for `ChunkKind::InitialResponse`.
    pub(crate) root: &'a [u8],
    /// `DevServer::configuration_hash_key`. Only read for `ChunkKind::InitialResponse`.
    pub(crate) configuration_hash_key: &'a [u8; 16],
    pub(crate) initial_response_entry_point: &'a [u8],
    pub(crate) react_refresh_entry_point: &'a [u8],
    pub(crate) console_log: bool,
    /// The page and layouts of a route whose pages also run in the browser: `config.route`.
    pub(crate) route_page_files: Option<&'a super::router_glue::ClientPageFiles>,
}
impl Default for TakeJSBundleOptionsClient<'_> {
    fn default() -> Self {
        Self {
            kind: ChunkKind::InitialResponse,
            script_id: source_map_store::Key::init(0),
            root: b"",
            configuration_hash_key: &[0; 16],
            initial_response_entry_point: b"",
            react_refresh_entry_point: b"",
            route_page_files: None,
            console_log: false,
        }
    }
}

pub(crate) struct TakeJSBundleOptionsServer {
    pub(crate) kind: ChunkKind,
}

#[repr(C)]
#[derive(Default)]
struct TempLookup {
    edge_index: EdgeIndex,
    seen: bool,
}

/// Parameterized via `adt_const_params` on `bake::Side`; `File` itself is
/// still the folded union (see TODO above) until a trait dispatch picks the
/// per-side layout.
#[derive(Default)]
pub(crate) struct IncrementalGraph<const SIDE: bake::Side> {
    /// Keys are absolute paths for the "file" namespace (owned). Index = `FileIndex`.
    pub(crate) bundled_files: StringArrayHashMap<File>,
    /// Parallel to `bundled_files`; bit set = file is stale and must rebundle.
    pub(crate) stale_files: DynamicBitSetUnmanaged,
    /// Parallel to `bundled_files`; the heads of each file's lists in `edges`.
    pub(crate) edge_lists: Vec<EdgeLists>,
    /// Edge storage; indices into this are `EdgeIndex`.
    pub(crate) edges: Vec<Edge<SIDE>>,
    /// Freed edge slots for reuse by `new_edge`.
    pub(crate) edges_free_list: Vec<EdgeIndex>,
    // ── per-bundle scratch (`current_chunk_*`) ─────────────────────────
    /// Total byte length of the current JS chunk being assembled.
    pub(crate) current_chunk_len: usize,
    /// Client side: file indices contributing to the current chunk (emit order).
    /// Server side: unused (server stores code slices in `current_chunk_code`).
    pub(crate) current_chunk_parts: Vec<FileIndex<SIDE>>,
    /// Server side: owned code slices contributing to the current chunk.
    /// Client side: unused.
    pub(crate) current_chunk_code: Vec<Box<[u8]>>,
    /// Server side: `{file_index, source_map}` parallel to `current_chunk_code`.
    pub(crate) current_chunk_source_maps: Vec<CurrentChunkSourceMapData>,
    /// Client side: CSS asset content-hashes referenced by the current chunk.
    pub(crate) current_css_files: Vec<u64>,
}

/// The client and server graphs, and the state their methods share.
pub(crate) struct Graphs {
    /// Absolute path to the project root. The HMR runtime's module IDs are relative to it.
    pub(crate) root: Box<[u8]>,
    pub(crate) client: IncrementalGraph<{ Side::Client }>,
    pub(crate) server: IncrementalGraph<{ Side::Server }>,
    /// State populated during bundling and hot updates. Often cleared
    pub(crate) incremental_result: IncrementalResult,
    /// Route index by file, including layouts and unbundled routes.
    pub(crate) route_lookup: ArrayHashMap<ServerFileIndex, RouteIndexAndRecurseFlag>,
    /// Accessible via `/_bun/asset/<key>`.
    pub(crate) assets: Assets,
    /// Kept until the file is rebuilt, in the wire format that the HMR runtime expects.
    pub(crate) bundling_failures: ArrayHashMap<serialized_failure::OwnerPacked, SerializedFailure>,
}

impl AsMut<IncrementalGraph<{ Side::Client }>> for Graphs {
    fn as_mut(&mut self) -> &mut IncrementalGraph<{ Side::Client }> {
        &mut self.client
    }
}

impl AsMut<IncrementalGraph<{ Side::Server }>> for Graphs {
    fn as_mut(&mut self) -> &mut IncrementalGraph<{ Side::Server }> {
        &mut self.server
    }
}

/// Byte-count breakdown of an incremental graph's memory usage (graph
/// structures, cached code, source maps).
#[derive(Default, Clone, Copy)]
pub(crate) struct GraphMemoryCost {
    pub(crate) graph: usize,
    pub(crate) code: usize,
    pub(crate) source_maps: usize,
}

impl<const SIDE: bake::Side> IncrementalGraph<SIDE> {
    /// `IncrementalGraph(side).getFileByIndex` — direct value-slot accessor.
    #[inline]
    pub(crate) fn get_file_by_index(&self, index: FileIndex<SIDE>) -> &File {
        &self.bundled_files.values()[index.get() as usize]
    }

    /// `IncrementalGraph(side).getFileIndex(abs_path)` — path → `FileIndex` lookup.
    #[inline]
    pub(crate) fn get_file_index(&self, abs_path: &[u8]) -> Option<FileIndex<SIDE>> {
        self.bundled_files
            .get_index(abs_path)
            .map(|i| FileIndex::init(i as u32))
    }

    /// `None` for an html file that is not the file of a route.
    pub(crate) fn html_route_bundle_index(
        &self,
        index: FileIndex<SIDE>,
    ) -> Option<route_bundle::Index> {
        self.bundled_files.values()[index.get() as usize].html_route_bundle_index
    }

    // ── per-bundle scratch accessors (kept for existing call sites) ────────

    /// Does NOT count `size_of::<Self>()`.
    pub(crate) fn memory_cost_detailed(&self) -> GraphMemoryCost {
        use core::mem::size_of;
        let mut graph: usize = 0;
        let mut code: usize = 0;
        let mut source_maps: usize = 0;
        // Approximate the map's memory usage via key+value slice cost.
        graph += self.bundled_files.count() * (size_of::<Box<[u8]>>() + size_of::<File>());
        graph += self.stale_files.bytes().len();
        graph += self.edge_lists.capacity() * size_of::<EdgeLists>();
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

    /// Clears the per-bundle mutation tracking (`current_chunk_*`) without
    /// touching the persisted file/edge storage.
    pub(crate) fn reset(&mut self) {
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

    /// Grows `stale_files` to cover all currently-known files, filling new
    /// bits with `are_new_files_stale`.
    pub(crate) fn ensure_stale_bit_capacity(
        &mut self,
        are_new_files_stale: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        let want = self.bundled_files.count().max(self.stale_files.bit_length);
        // Align forward to 8 usize words (8*64 bits).
        const STEP: usize = core::mem::size_of::<usize>() * 8 * 8;
        let aligned = want.div_ceil(STEP) * STEP;
        self.stale_files.resize(aligned, are_new_files_stale)
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
            // No prev → must be the head of the `imported` file's dependency list.
            let first_dep = &mut self.edge_lists[edge.imported.get() as usize].first_dep;
            debug_assert_eq!(*first_dep, Some(edge_index));
            if let Some(next) = edge.next_dependency {
                self.edges[next.get() as usize].prev_dependency = None;
                *first_dep = Some(next);
            } else {
                *first_dep = None;
            }
        }
    }
}

impl DevServer {
    fn disconnect_and_delete_client_file(&mut self, file_index: ClientFileIndex) {
        let graph = &mut self.graphs.client;
        let lists = &mut graph.edge_lists[file_index.get() as usize];
        debug_assert!(lists.first_dep.is_none()); // must have no dependencies

        // Disconnect all imports.
        let mut it = lists.first_import.take();
        while let Some(edge_index) = it {
            let dep = graph.edges[edge_index.get() as usize];
            it = dep.next_import;
            debug_assert_eq!(dep.dependency.get(), file_index.get());
            graph.disconnect_edge_from_dependency_list(edge_index);
            graph.free_edge(edge_index);
        }

        // DirectoryWatchStore.Dep.source_file_path borrows this key; remove
        // any such dependencies before freeing it so they do not dangle.
        self.remove_dependencies_for_file(file_index);

        // Free the key string and tombstone the slot. Cannot swap-remove since
        // FrameworkRouter / SerializedFailure hold FileIndices into this graph.
        // Tombstoned slots are not reused; a free-list is a pending idea.
        let graph = &mut self.graphs.client;
        graph.bundled_files.keys_mut()[file_index.get() as usize] = Box::default();
        let lists = &graph.edge_lists[file_index.get() as usize];
        debug_assert!(lists.first_dep.is_none());
        debug_assert!(lists.first_import.is_none());
    }
}

impl<const SIDE: bake::Side> IncrementalGraph<SIDE> {
    // ────────────────────────────────────────────────────────────────────────
    // receiveChunk
    // ────────────────────────────────────────────────────────────────────────

    /// Ensures a bundled chunk has an entry in `bundled_files`. Returns whether it already had one.
    fn get_or_put_chunk_file(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        index: bun_ast::Index,
        content: &ReceiveChunkContent,
    ) -> Result<(FileIndex<SIDE>, bool), bun_alloc::AllocError> {
        let path = &ctx.sources[index.get() as usize].path;
        let key = path.key_for_incremental_graph();

        if cfg!(debug_assertions) {
            if let ReceiveChunkContent::Js { code, .. } = content {
                if strings::is_all_whitespace(code) {
                    bun_core::Output::panic(format_args!(
                        "Empty chunk is impossible: {} {}",
                        bstr::BStr::new(key),
                        match SIDE {
                            Side::Client => "client",
                            Side::Server => "server",
                        },
                    ));
                }
            }
        }

        let gop = self.bundled_files.get_or_put(key)?;
        let file_index = FileIndex::<SIDE>::init(gop.index as u32);
        let found_existing = gop.found_existing;
        if !found_existing {
            *gop.key_ptr = Box::<[u8]>::from(key);
        }
        // Note: drop `gop` borrow before pushing to other Vecs / re-borrowing.
        if !found_existing {
            self.edge_lists.push(EdgeLists::default());
        }

        if self.stale_files.bit_length > file_index.get() as usize {
            self.stale_files.unset(file_index.get() as usize);
        }

        *ctx.get_cached_index(SIDE, index) =
            CachedFileIndex::from(Some::<FileIndex<SIDE>>(file_index));

        Ok((file_index, found_existing))
    }
}

impl DevServer {
    /// The code is kept in `current_chunk_code` until `reset`.
    pub(crate) fn receive_server_chunk(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        index: bun_ast::Index,
        content: ReceiveChunkContent,
        is_ssr_graph: bool,
    ) -> Result<(), crate::Error> {
        self.graph_safety_lock.assert_locked();
        let graph = &mut self.graphs.server;
        let (file_index, found_existing) = graph.get_or_put_chunk_file(ctx, index, &content)?;

        let new_kind = match &content {
            ReceiveChunkContent::Js { .. } => FileKind::Js,
            ReceiveChunkContent::Css(_) => FileKind::Css,
        };
        let scb = ctx.server_to_client_bitset.is_set(index.get() as usize);
        let f = &mut graph.bundled_files.values_mut()[file_index.get() as usize];
        let result = &mut self.graphs.incremental_result;
        if !found_existing {
            *f = File {
                kind: new_kind,
                failed: false,
                is_rsc: !is_ssr_graph,
                is_ssr: is_ssr_graph,
                is_client_component_boundary: scb,
                is_route: false,
                ..Default::default()
            };
            if scb {
                result.client_components_added.push(file_index);
            }
        } else {
            f.kind = new_kind;
            if is_ssr_graph {
                f.is_ssr = true;
            } else {
                f.is_rsc = true;
            }

            if core::mem::take(&mut f.failed) {
                let owner = serialized_failure::OwnerPacked::new(Side::Server, file_index.get());
                let kv = self.graphs.bundling_failures.fetch_swap_remove(&owner);
                let kv = kv.unwrap_or_else(|| {
                    bun_core::Output::panic(format_args!("Missing failure in IncrementalGraph",))
                });
                result.failures_removed.push(kv.1);
            }

            if scb {
                f.is_client_component_boundary = true;
                result.client_components_added.push(file_index);
            } else if !is_ssr_graph && core::mem::take(&mut f.is_client_component_boundary) {
                result.client_components_removed.push(file_index);
                let key = &graph.bundled_files.keys()[file_index.get() as usize];
                let client = &mut self.graphs.client;
                if let Some(client_index) = client.get_file_index(key) {
                    let i = client_index.get() as usize;
                    if client.edge_lists[i].first_dep.is_some() {
                        // Another client component imports it.
                        client.bundled_files.values_mut()[i].is_hmr_root = false;
                    } else {
                        self.disconnect_and_delete_client_file(client_index);
                    }
                }
            }
        }

        let graph = &mut self.graphs.server;
        if let ReceiveChunkContent::Js { code, source_map } = content {
            let code_len = code.len();
            let line_count = strings::count_char(&code, b'\n') as u32;
            graph.current_chunk_code.push(code);
            graph.current_chunk_len += code_len;

            let packed = match source_map {
                Some(mut sm) if sm.chunk.buffer.len() > 0 && sm.escaped_source.is_some() => {
                    packed_map::Shared::Some(packed_map::PackedMap::new_non_empty(
                        &mut sm.chunk,
                        sm.escaped_source.take().unwrap(),
                    ))
                }
                _ => packed_map::Shared::LineCount(packed_map::LineCount::init(line_count)),
            };
            graph
                .current_chunk_source_maps
                .push(CurrentChunkSourceMapData {
                    file_index,
                    source_map: packed,
                });
        }
        Ok(())
    }

    /// The graph takes ownership of the code.
    pub(crate) fn receive_client_chunk(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        index: bun_ast::Index,
        content: ReceiveChunkContent,
    ) -> Result<(), crate::Error> {
        self.graph_safety_lock.assert_locked();
        let graph = &mut self.graphs.client;
        let (file_index, _) = graph.get_or_put_chunk_file(ctx, index, &content)?;

        let File {
            failed,
            html_route_bundle_index,
            is_special_framework_file,
            ..
        } = graph.bundled_files.values()[file_index.get() as usize];

        if failed {
            let owner = serialized_failure::OwnerPacked::new(Side::Client, file_index.get());
            let kv = self.graphs.bundling_failures.fetch_swap_remove(&owner);
            let kv = kv.unwrap_or_else(|| {
                bun_core::Output::panic(format_args!(
                    "Missing SerializedFailure in IncrementalGraph",
                ))
            });
            self.graphs.incremental_result.failures_removed.push(kv.1);
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
                        // Source-map concatenation needs to know how many newlines to skip.
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

        graph.bundled_files.values_mut()[file_index.get() as usize] = File {
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
            graph.current_chunk_parts.push(file_index);
            graph.current_chunk_len += len;
        }
        Ok(())
    }
}

impl Graphs {
    // ────────────────────────────────────────────────────────────────────────
    // processChunkDependencies
    // ────────────────────────────────────────────────────────────────────────

    /// Second pass of IncrementalGraph indexing: updates dependency information
    /// for each file and resolves what the HMR roots are.
    pub(crate) fn process_chunk_dependencies<const SIDE: Side>(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        mode: ProcessMode,
        bundle_graph_index: impl Into<bun_ast::Index>,
    ) -> Result<(), crate::Error>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        let bundle_graph_index: bun_ast::Index = bundle_graph_index.into();
        let file_index: FileIndex<SIDE> = ctx
            .get_cached_index(SIDE, bundle_graph_index)
            .unwrap::<SIDE>()
            .expect("unresolved index"); // do not process for failed chunks

        // Build a map from the existing import list. Later, entries that
        // were not marked as `.seen = true` will be freed.
        let mut quick_lookup: ArrayHashMap<FileIndex<SIDE>, TempLookup> = ArrayHashMap::default();
        let graph = self.as_mut();
        {
            let mut it = graph.edge_lists[file_index.get() as usize].first_import;
            while let Some(edge_index) = it {
                let dep = graph.edges[edge_index.get() as usize];
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
                graph.edge_lists[file_index.get() as usize].first_import = new_imports;
                return Ok(());
            }
            // RSC+SSR dual-index dispatch (`ctx.scbs.getSSRIndex`) is
            // intentionally not implemented.
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

        // Clear the old head before freeing so `check_edge_removal` wouldn't
        // see a stale reference.
        self.as_mut().edge_lists[file_index.get() as usize].first_import = None;

        // '.seen = false' means an import was removed and should be freed.
        for val in &quick_lookup.values()[0..quick_lookup_values_to_care_len] {
            if !val.seen {
                self.incremental_result.had_adjusted_edges = true;
                let graph = self.as_mut();
                graph.disconnect_edge_from_dependency_list(val.edge_index);
                graph.free_edge(val.edge_index);
            }
        }

        self.as_mut().edge_lists[file_index.get() as usize].first_import = new_imports;

        // Follow this file to the route / HMR root to mark it stale.
        self.trace_dependencies(
            file_index,
            ctx.gts,
            TraceDependencyGoal::StopAtBoundary,
            file_index,
        )
    }

    fn process_chunk_import_records<const SIDE: Side>(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        quick_lookup: &mut ArrayHashMap<FileIndex<SIDE>, TempLookup>,
        new_imports: &mut Option<EdgeIndex>,
        file_index: FileIndex<SIDE>,
        index: bun_ast::Index,
    ) -> Result<(), crate::Error>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        debug_assert!(index.is_valid());
        debug_assert!(!ctx.loaders[index.get() as usize].is_css());

        let records_len = ctx.import_records[index.get() as usize].len();
        for i in 0..records_len {
            // Note: snapshot the three fields we need so the shared borrow
            // on `ctx.import_records` ends before `process_edge_attachment`
            // takes `&mut ctx`.
            let (flags, src, key) = {
                let ir = &ctx.import_records[index.get() as usize].as_slice()[i];
                // If an `onResolve` plugin resolved the import, `ir.path` is still the specifier.
                let path = if ir.source_index.is_valid() {
                    &ctx.sources[ir.source_index.get() as usize].path
                } else {
                    &ir.path
                };
                (ir.flags, ir.source_index, path.key_for_incremental_graph())
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

    fn process_css_chunk_import_records<const SIDE: Side>(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        quick_lookup: &mut ArrayHashMap<FileIndex<SIDE>, TempLookup>,
        new_imports: &mut Option<EdgeIndex>,
        file_index: FileIndex<SIDE>,
        bundler_index: bun_ast::Index,
    ) -> Result<(), crate::Error>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        debug_assert!(bundler_index.is_valid());
        debug_assert!(ctx.loaders[bundler_index.get() as usize].is_css());

        // Queue avoids stack overflow; `process_edge_attachment` stops at a file
        // this walk has already seen.
        let mut queue: Vec<bun_ast::Index> = Vec::new();
        queue.push(bundler_index);

        while let Some(idx) = queue.pop() {
            let records_len = ctx.import_records[idx.get() as usize].len();
            for i in 0..records_len {
                let (flags, src, key) = {
                    let ir = &ctx.import_records[idx.get() as usize].as_slice()[i];
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
                    queue.push(src);
                }
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn process_edge_attachment<const SIDE: Side>(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        quick_lookup: &mut ArrayHashMap<FileIndex<SIDE>, TempLookup>,
        new_imports: &mut Option<EdgeIndex>,
        file_index: FileIndex<SIDE>,
        ir_flags: bun_ast::ImportRecordFlags,
        ir_source_index: bun_ast::Index,
        key: &[u8],
        mode: EdgeAttachmentMode,
    ) -> Result<EdgeAttachmentResult, crate::Error>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        // Duplicated import records are marked unused by `ConvertESMExportsForHmr`.
        if ir_flags.contains(bun_ast::ImportRecordFlags::IS_UNUSED) {
            return Ok(EdgeAttachmentResult::Stop);
        }
        if ir_source_index.is_runtime() {
            return Ok(EdgeAttachmentResult::Stop);
        }

        // Locate the FileIndex from bundle_v2's Source.Index.
        let imported_file_index: FileIndex<SIDE> = 'brk: {
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
                    break 'brk i;
                } else if mode == EdgeAttachmentMode::Css {
                    let index = self.as_mut().insert_empty(key, kind)?.index;
                    ctx.gts.resize(SIDE, index.get() as usize + 1)?;
                    if kind == FileKind::Css {
                        self.receive_css_child(index);
                    }
                    break 'brk index;
                }
            }
            match mode {
                // Invalid source indices in CSS are external URLs.
                EdgeAttachmentMode::Css => return Ok(EdgeAttachmentResult::Stop),
                // Check IncrementalGraph for a file from a prior build.
                EdgeAttachmentMode::JsOrHtml => match self.as_mut().get_file_index(key) {
                    Some(i) => i,
                    None => return Ok(EdgeAttachmentResult::Continue),
                },
            }
        };

        let graph = self.as_mut();
        debug_assert!((imported_file_index.get() as usize) < graph.bundled_files.count());

        let gop = quick_lookup.get_or_put(imported_file_index)?;
        if gop.found_existing {
            // Ends the walk of circular `@import`s. Each css root walks on its own, because two roots
            // of one bundle can import the same file and both need the edge.
            if gop.value_ptr.seen {
                return Ok(EdgeAttachmentResult::Stop);
            }
            gop.value_ptr.seen = true;
            let ei = gop.value_ptr.edge_index;
            graph.edges[ei.get() as usize].next_import = *new_imports;
            *new_imports = Some(ei);
        } else {
            // A new edge is needed to represent the dependency and import.
            let first_dep = graph.edge_lists[imported_file_index.get() as usize].first_dep;
            let edge = graph.new_edge(Edge {
                next_import: *new_imports,
                next_dependency: first_dep,
                prev_dependency: None,
                imported: imported_file_index,
                dependency: file_index,
            })?;
            if let Some(dep) = first_dep {
                graph.edges[dep.get() as usize].prev_dependency = Some(edge);
            }
            *new_imports = Some(edge);
            graph.edge_lists[imported_file_index.get() as usize].first_dep = Some(edge);

            self.incremental_result.had_adjusted_edges = true;

            *gop.value_ptr = TempLookup {
                edge_index: edge,
                seen: true,
            };
        }
        Ok(EdgeAttachmentResult::Continue)
    }

    /// An `@import`ed stylesheet gets no `receive_client_chunk`, so the pass over its root's imports
    /// keeps it a css child and clears a failure that this bundle did not repeat.
    fn receive_css_child<const SIDE: Side>(&mut self, index: FileIndex<SIDE>)
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        let file = &mut self.as_mut().bundled_files.values_mut()[index.get() as usize];
        match file.content {
            Content::Unknown => {
                file.kind = FileKind::Css;
                file.content = Content::CssChild;
            }
            Content::CssChild => {}
            _ => return,
        }
        if !file.failed {
            return;
        }
        let failed_in_this_bundle = |failure: &SerializedFailure| {
            matches!(
                failure.get_owner(),
                serialized_failure::Owner::Client(owner) if owner.get() == index.get()
            )
        };
        if self
            .incremental_result
            .failures_added
            .iter()
            .any(failed_in_this_bundle)
        {
            return;
        }
        self.as_mut().bundled_files.values_mut()[index.get() as usize].failed = false;
        let owner = serialized_failure::OwnerPacked::new(Side::Client, index.get());
        if let Some(kv) = self.bundling_failures.fetch_swap_remove(&owner) {
            self.incremental_result.failures_removed.push(kv.1);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // traceDependencies / traceImports
    // ────────────────────────────────────────────────────────────────────────

    /// Walks dependents (importers) outward from `file_index`, marking
    /// visited files in `gts` to find the routes/HMR roots affected by a
    /// change.
    pub(crate) fn trace_dependencies<const SIDE: Side>(
        &mut self,
        file_index: FileIndex<SIDE>,
        gts: &mut GraphTraceState,
        goal: TraceDependencyGoal,
        from_file_index: FileIndex<SIDE>,
    ) -> Result<(), crate::Error>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        if gts.bits(SIDE).is_set(file_index.get() as usize) {
            return Ok(());
        }
        gts.bits(SIDE).set(file_index.get() as usize);

        match SIDE {
            Side::Server => self.visit_server_dependency(ServerFileIndex::init(file_index.get())),
            Side::Client => {
                let file = ClientFileIndex::init(file_index.get());
                let from = ClientFileIndex::init(from_file_index.get());
                if self
                    .visit_client_dependency(file, gts, goal, from)?
                    .is_break()
                {
                    return Ok(());
                }
            }
        }

        let graph = self.as_mut();

        // Certain files do not propagate updates to dependencies.
        if goal == TraceDependencyGoal::StopAtBoundary {
            if graph.bundled_files.values()[file_index.get() as usize].stops_dependency_trace(SIDE)
            {
                return Ok(());
            }
        }

        // Recurse.
        let mut it = graph.edge_lists[file_index.get() as usize].first_dep;
        while let Some(dep_index) = it {
            let edge = self.as_mut().edges[dep_index.get() as usize];
            it = edge.next_dependency;
            self.trace_dependencies(edge.dependency, gts, goal, file_index)?;
        }
        Ok(())
    }

    fn visit_server_dependency(&mut self, file_index: ServerFileIndex) {
        let (is_route, is_scb) = {
            let file = &self.server.bundled_files.values()[file_index.get() as usize];
            (file.is_route, file.is_client_component_boundary)
        };
        if is_route {
            let route_index = self
                .route_lookup
                .get(&file_index)
                .copied()
                .unwrap_or_else(|| {
                    bun_core::Output::panic(format_args!(
                        "Route not in lookup index: {} {:?}",
                        file_index.get(),
                        bstr::BStr::new(
                            &self.server.bundled_files.keys()[file_index.get() as usize]
                        ),
                    ))
                });
            self.incremental_result
                .framework_routes_affected
                .push(route_index);
        }
        if is_scb {
            self.incremental_result
                .client_components_affected
                .push(file_index);
        }
    }

    fn visit_client_dependency(
        &mut self,
        file_index: ClientFileIndex,
        gts: &mut GraphTraceState,
        goal: TraceDependencyGoal,
        from_file_index: ClientFileIndex,
    ) -> Result<ControlFlow<()>, crate::Error> {
        let (is_hmr_root, html_rbi) = {
            let file = &self.client.bundled_files.values()[file_index.get() as usize];
            (file.is_hmr_root, file.html_route_bundle_index)
        };
        if is_hmr_root {
            let key = &self.client.bundled_files.keys()[file_index.get() as usize];
            if let Some(index) = self.server.get_file_index(key) {
                self.trace_dependencies(index, gts, goal, index)?;
            }
        } else if let Some(route_bundle_index) = html_rbi {
            // HTML modified or asset modified → hard reload; else soft.
            let hard = from_file_index == file_index
                || matches!(
                    self.client.bundled_files.values()[from_file_index.get() as usize].content,
                    Content::Asset(_),
                );
            let ir = &mut self.incremental_result;
            if hard {
                ir.html_routes_hard_affected.push(route_bundle_index);
            } else {
                ir.html_routes_soft_affected.push(route_bundle_index);
            }
            if goal == TraceDependencyGoal::StopAtBoundary {
                return Ok(ControlFlow::Break(()));
            }
        }
        Ok(ControlFlow::Continue(()))
    }

    /// Walks imports inward from `file_index`, marking visited files in
    /// `gts` to collect everything a bundle for this file must include.
    pub(crate) fn trace_imports<const SIDE: Side>(
        &mut self,
        file_index: FileIndex<SIDE>,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> Result<(), crate::Error>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        if gts.bits(SIDE).is_set(file_index.get() as usize) {
            return Ok(());
        }
        gts.bits(SIDE).set(file_index.get() as usize);

        match SIDE {
            Side::Server => {
                self.visit_server_import(ServerFileIndex::init(file_index.get()), gts, goal)?
            }
            Side::Client => {
                let file = ClientFileIndex::init(file_index.get());
                if self.visit_client_import(file, gts, goal).is_break() {
                    return Ok(());
                }
            }
        }

        // Recurse.
        let mut it = self.as_mut().edge_lists[file_index.get() as usize].first_import;
        while let Some(dep_index) = it {
            let edge = self.as_mut().edges[dep_index.get() as usize];
            it = edge.next_import;
            self.trace_imports(edge.imported, gts, goal)?;
        }
        Ok(())
    }

    fn visit_server_import(
        &mut self,
        file_index: ServerFileIndex,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> Result<(), crate::Error> {
        let (is_scb, kind, failed) = {
            let f = &self.server.bundled_files.values()[file_index.get() as usize];
            (f.is_client_component_boundary, f.kind, f.failed)
        };
        if is_scb || kind == FileKind::Css {
            let key = &self.server.bundled_files.keys()[file_index.get() as usize];
            if let Some(index) = self.client.get_file_index(key) {
                self.trace_imports(index, gts, goal)?;
            }

            if cfg!(debug_assertions) && kind == FileKind::Css {
                // Server CSS files never have imports.
                let lists = &self.server.edge_lists[file_index.get() as usize];
                debug_assert!(lists.first_import.is_none());
            }
        }
        if goal == TraceImportGoal::FindErrors && failed {
            let owner = serialized_failure::OwnerPacked::new(Side::Server, file_index.get());
            let fail = self
                .bundling_failures
                .get(&owner)
                .cloned()
                .expect("Failed to get bundling failure");
            gts.failures.push(fail);
        }
        Ok(())
    }

    fn visit_client_import(
        &mut self,
        file_index: ClientFileIndex,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> ControlFlow<()> {
        // A failed css root keeps its `CssRoot` content, so check for failures before the css check.
        if goal == TraceImportGoal::FindErrors
            && self.client.bundled_files.values()[file_index.get() as usize].failed
        {
            let owner = serialized_failure::OwnerPacked::new(Side::Client, file_index.get());
            let fail = self
                .bundling_failures
                .get(&owner)
                .cloned()
                .expect("Failed to get bundling failure");
            gts.failures.push(fail);
            return ControlFlow::Break(());
        }

        {
            let f = &self.client.bundled_files.values()[file_index.get() as usize];
            match &f.content {
                Content::CssChild => {
                    debug_assert!(
                        goal == TraceImportGoal::FindErrors,
                        "only CSS roots should be found by tracing"
                    );
                }
                Content::CssRoot(id) => {
                    if goal == TraceImportGoal::FindCss {
                        self.client.current_css_files.push(*id);
                    }
                    // CSS can't import JS, but an `@import` can fail to parse.
                    if goal != TraceImportGoal::FindErrors {
                        return ControlFlow::Break(());
                    }
                }
                _ => {}
            }
        }

        if goal == TraceImportGoal::FindClientModules {
            let len = self.client.bundled_files.values()[file_index.get() as usize]
                .content
                .js_code()
                .map(|c| c.len())
                .unwrap_or(0);
            self.client.current_chunk_parts.push(file_index);
            self.client.current_chunk_len += len;
        }
        ControlFlow::Continue(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // insertStale / insertEmpty / insertCssFileOnServer / insertFailure
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(side).insertStale` — adds a file to the graph in the
    /// stale state without bundled content. Thin forwarder (spec :1295).
    pub(crate) fn insert_stale<const SIDE: Side>(
        &mut self,
        abs_path: &[u8],
        bake_graph: bake::Graph,
    ) -> Result<FileIndex<SIDE>, bun_alloc::AllocError>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        self.insert_stale_extra(abs_path, bake_graph, RouteKind::NotRoute)
    }

    /// `IncrementalGraph(side).insertStaleExtra` (spec :1300).
    pub(crate) fn insert_stale_extra<const SIDE: Side>(
        &mut self,
        abs_path: &[u8],
        bake_graph: bake::Graph,
        route: RouteKind,
    ) -> Result<FileIndex<SIDE>, bun_alloc::AllocError>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        debug_assert!(match SIDE {
            Side::Client => bake_graph == bake::Graph::Client,
            Side::Server => bake_graph != bake::Graph::Client,
        });
        let graph = self.as_mut();
        let gop = graph.bundled_files.get_or_put(abs_path)?;
        let idx = gop.index;
        let found_existing = gop.found_existing;
        if found_existing {
            if matches!(SIDE, Side::Server) && route == RouteKind::Route {
                gop.value_ptr.is_route = true;
            }
        } else {
            *gop.key_ptr = Box::<[u8]>::from(abs_path);
        }
        if !found_existing {
            graph.edge_lists.push(EdgeLists::default());
        }
        graph.ensure_stale_bit_capacity(true)?;
        graph.stale_files.set(idx);

        match SIDE {
            Side::Client => {
                // The rebuild replaces a css root's asset (`replace_asset_path`) or drops it (`insert_failure`).
                if graph.bundled_files.values_mut()[idx].free_content() {
                    self.assets.unref_by_path(abs_path);
                }
            }
            Side::Server => {
                let is_ssr_graph = bake_graph == bake::Graph::Ssr;
                if !found_existing {
                    graph.bundled_files.values_mut()[idx] = File {
                        kind: FileKind::Unknown,
                        failed: false,
                        is_rsc: !is_ssr_graph,
                        is_ssr: is_ssr_graph,
                        is_route: route == RouteKind::Route,
                        is_client_component_boundary: false,
                        ..Default::default()
                    };
                } else if is_ssr_graph {
                    graph.bundled_files.values_mut()[idx].is_ssr = true;
                } else {
                    graph.bundled_files.values_mut()[idx].is_rsc = true;
                }
            }
        }
        Ok(FileIndex::init(idx as u32))
    }
}

impl<const SIDE: bake::Side> IncrementalGraph<SIDE> {
    /// `IncrementalGraph(side).insertEmpty(abs_path, kind)` (spec :1354).
    pub(crate) fn insert_empty(
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
            self.edge_lists.push(EdgeLists::default());
            self.ensure_stale_bit_capacity(true)?;
            self.stale_files.set(idx);
        }
        Ok(InsertEmptyResult {
            index: FileIndex::init(idx as u32),
            key,
        })
    }

    /// `IncrementalGraph(.server).insertCssFileOnServer` (spec :1390).
    /// Server CSS files are just targets for graph traversal; content lives
    /// only on the client.
    pub(crate) fn insert_css_file_on_server(
        &mut self,
        ctx: &mut HotUpdateContext<'_>,
        index: bun_ast::Index,
        abs_path: &[u8],
    ) -> Result<(), crate::Error> {
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
            self.edge_lists.push(EdgeLists::default());
        }
        *ctx.get_cached_index(Side::Server, index) =
            CachedFileIndex::from(Some::<FileIndex<SIDE>>(file_index));
        Ok(())
    }

    /// Makes the entry point of a chunk that failed to print a css root again, so a trace
    /// still finds the stylesheet. `id` is the hash of its path.
    pub(crate) fn restore_failed_css_root(&mut self, index: FileIndex<SIDE>, id: u64) {
        debug_assert!(matches!(SIDE, Side::Client));
        let f = &mut self.bundled_files.values_mut()[index.get() as usize];
        debug_assert!(f.failed);
        f.kind = FileKind::Css;
        f.content = Content::CssRoot(id);
    }
}

impl Graphs {
    /// `IncrementalGraph(side).insertFailure` (spec :1419).
    pub(crate) fn insert_failure<const SIDE: Side>(
        &mut self,
        key: InsertFailureKey<'_>,
        log: &bun_ast::Log,
    ) -> Result<(), bun_alloc::AllocError>
    where
        Self: AsMut<IncrementalGraph<SIDE>>,
    {
        let graph = self.as_mut();
        let (idx, parsed_for) = match key {
            InsertFailureKey::AbsPath(abs_path, bake_graph) => {
                let gop = graph.bundled_files.get_or_put(abs_path)?;
                if !gop.found_existing {
                    *gop.key_ptr = Box::<[u8]>::from(abs_path);
                }
                let (i, fe) = (gop.index, gop.found_existing);
                if !fe {
                    graph.edge_lists.push(EdgeLists::default());
                }
                (i, Some(bake_graph))
            }
            InsertFailureKey::Index(i) => (i as usize, None),
        };
        graph.ensure_stale_bit_capacity(true)?;
        graph.stale_files.set(idx);

        let file = &mut graph.bundled_files.values_mut()[idx];
        file.failed = true;
        match SIDE {
            Side::Client => {
                if file.free_content() || file.kind == FileKind::Css {
                    self.assets
                        .unref_by_path(&self.client.bundled_files.keys()[idx]);
                }
            }
            Side::Server => match parsed_for {
                Some(bake::Graph::Ssr) => file.is_ssr = true,
                Some(_) => file.is_rsc = true,
                None => {}
            },
        }

        let fail_owner = serialized_failure::OwnerPacked::new(SIDE, idx as u32);

        // Errors print straight to the terminal; a stdio manager that could
        // re-render the error list alongside a REPL is a pending idea.
        let _ = log.print(bun_core::Output::error_writer());

        let failure = {
            let mut buf = bun_paths::path_buffer_pool::get();
            let key = match SIDE {
                Side::Server => &self.server.bundled_files.keys()[idx],
                Side::Client => &self.client.bundled_files.keys()[idx],
            };
            let owner_display_name = relative_path(&self.root, &mut *buf, key);
            SerializedFailure::init_from_log(
                match SIDE {
                    Side::Server => serialized_failure::Owner::Server(FileIndex::init(idx as u32)),
                    Side::Client => serialized_failure::Owner::Client(FileIndex::init(idx as u32)),
                },
                owner_display_name,
                &log.msgs,
            )?
        };
        let fail_gop = self.bundling_failures.get_or_put(fail_owner)?;
        self.incremental_result.failures_added.push(failure.clone());
        if fail_gop.found_existing {
            self.incremental_result
                .failures_removed
                .push(core::mem::replace(fail_gop.value_ptr, failure));
        } else {
            *fail_gop.value_ptr = failure;
        }
        Ok(())
    }
}

impl<const SIDE: bake::Side> IncrementalGraph<SIDE> {
    // ────────────────────────────────────────────────────────────────────────
    // onFileDeleted / invalidate
    // ────────────────────────────────────────────────────────────────────────

    /// `IncrementalGraph(side).onFileDeleted` (spec :1528).
    pub(crate) fn on_file_deleted(
        &mut self,
        abs_path: &[u8],
        bv2: &mut bun_bundler::BundleV2<'_>,
    ) -> Result<(), bun_alloc::AllocError> {
        let Some(index) = self.get_file_index(abs_path) else {
            return Ok(());
        };

        // Disconnect all imports.
        let mut it = self.edge_lists[index.get() as usize].first_import.take();
        while let Some(edge_index) = it {
            let dep = self.edges[edge_index.get() as usize];
            it = dep.next_import;
            debug_assert_eq!(dep.dependency.get(), index.get());
            self.disconnect_edge_from_dependency_list(edge_index);
            self.free_edge(edge_index);
        }

        // Rebuild all dependencies.
        let mut it = self.edge_lists[index.get() as usize].first_dep;
        while let Some(edge_index) = it {
            let dep = self.edges[edge_index.get() as usize];
            it = dep.next_dependency;
            debug_assert_eq!(dep.imported.get(), index.get());
            let key = &self.bundled_files.keys()[dep.dependency.get() as usize];
            let file = &self.bundled_files.values()[dep.dependency.get() as usize];
            let loader = file
                .html_route_bundle_index
                .is_some()
                .then_some(bun_ast::Loader::Html);
            let mut enqueue = |target| {
                bun_core::handle_oom(
                    bv2.enqueue_file_from_dev_server_incremental_graph_invalidation(
                        key, target, loader,
                    ),
                )
            };
            match SIDE {
                Side::Client => enqueue(bun_ast::Target::Browser),
                Side::Server => {
                    if file.is_rsc {
                        enqueue(bun_ast::Target::Bun);
                    }
                    if file.rebundles_for_ssr_graph() {
                        enqueue(bun_ast::Target::ServerComponentsSsr);
                    }
                }
            }
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

    /// See `EntryPointList::append_html`.
    fn append_client_entry_point(
        &self,
        entry_points: &mut EntryPointList,
        index: usize,
    ) -> Result<(), crate::Error> {
        debug_assert!(matches!(SIDE, Side::Client));
        let abs_path = &self.bundled_files.keys()[index];
        if self.bundled_files.values()[index]
            .html_route_bundle_index
            .is_some()
        {
            entry_points.append_html(abs_path)
        } else {
            entry_points.append_js(abs_path, bake::Graph::Client)
        }
    }

    /// `IncrementalGraph(side).invalidate` (spec :1589). Given a set of paths,
    /// mark the relevant files as stale and append them into `entry_points`.
    pub(crate) fn invalidate(
        &mut self,
        paths: &[Box<[u8]>],
        entry_points: &mut EntryPointList,
    ) -> Result<(), crate::Error> {
        for path in paths {
            let Some(index) = self.bundled_files.get_index(path) else {
                continue;
            };
            self.stale_files.set(index);
            // Store the graph-owned key, not the incoming `path` (which may be
            // freed before `entry_points` is consumed).
            let owned_path = &self.bundled_files.keys()[index];
            match SIDE {
                Side::Client => match &self.bundled_files.values()[index].content {
                    Content::CssRoot(_) | Content::CssChild => {
                        if matches!(
                            self.bundled_files.values()[index].content,
                            Content::CssRoot(_),
                        ) {
                            entry_points.append_css(owned_path)?;
                        }
                        let mut it = self.edge_lists[index].first_dep;
                        while let Some(edge_index) = it {
                            let entry = self.edges[edge_index.get() as usize];
                            let dep = entry.dependency;
                            self.stale_files.set(dep.get() as usize);
                            if matches!(
                                self.bundled_files.values()[dep.get() as usize].content,
                                Content::CssRoot(_),
                            ) {
                                let k = &self.bundled_files.keys()[dep.get() as usize];
                                entry_points.append_css(k)?;
                            }
                            it = entry.next_dependency;
                        }
                    }
                    Content::Asset(_) => {
                        let mut it = self.edge_lists[index].first_dep;
                        while let Some(edge_index) = it {
                            let entry = self.edges[edge_index.get() as usize];
                            let dep = entry.dependency;
                            self.stale_files.set(dep.get() as usize);
                            let k = &self.bundled_files.keys()[dep.get() as usize];
                            if matches!(
                                self.bundled_files.values()[dep.get() as usize].content,
                                Content::CssRoot(_),
                            ) {
                                entry_points.append_css(k)?;
                            } else {
                                self.append_client_entry_point(entry_points, dep.get() as usize)?;
                            }
                            it = entry.next_dependency;
                        }
                        self.append_client_entry_point(entry_points, index)?;
                    }
                    // When re-bundling SCBs, only bundle the server.
                    Content::Js(_) | Content::Unknown => {
                        if !self.bundled_files.values()[index].is_hmr_root {
                            self.append_client_entry_point(entry_points, index)?;
                        }
                    }
                },
                Side::Server => {
                    let f = &self.bundled_files.values()[index];
                    if f.is_rsc {
                        entry_points.append_js(owned_path, bake::Graph::Server)?;
                    }
                    if f.rebundles_for_ssr_graph() {
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
    pub(crate) fn take_js_bundle_server(
        &mut self,
        opts: &TakeJSBundleOptionsServer,
    ) -> Result<Vec<u8>, crate::Error> {
        let mut chunk = Vec::new();
        self.take_js_bundle_to_list_server(&mut chunk, opts)?;
        Ok(chunk)
    }

    /// `IncrementalGraph(.client).takeJSBundle` — client-side overload (kept
    /// under the side-agnostic name for existing call sites).
    pub(crate) fn take_js_bundle(
        &self,
        opts: &TakeJSBundleOptionsClient,
    ) -> Result<Vec<u8>, crate::Error> {
        let mut chunk = Vec::new();
        self.take_js_bundle_to_list(&mut chunk, opts)?;
        Ok(chunk)
    }

    /// `IncrementalGraph(.client).takeJSBundleToList` (spec :1713).
    pub(crate) fn take_js_bundle_to_list(
        &self,
        list: &mut Vec<u8>,
        options: &TakeJSBundleOptionsClient,
    ) -> Result<(), crate::Error> {
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

        let mut end_list: Vec<u8> = Vec::with_capacity(256);
        match kind {
            ChunkKind::InitialResponse => {
                end_list.extend_from_slice(b"}, {\n  main: ");
                if !options.initial_response_entry_point.is_empty() {
                    let mut buf = bun_paths::path_buffer_pool::get();
                    let rel = relative_path(
                        options.root,
                        &mut *buf,
                        options.initial_response_entry_point,
                    );
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
                let _ = write!(
                    end_list,
                    "{}",
                    bun_core::fmt::hex_lower(&generation.to_ne_bytes())
                );
                end_list.extend_from_slice(b"\",\n  version: \"");
                end_list.extend_from_slice(options.configuration_hash_key);
                if options.console_log {
                    end_list.extend_from_slice(b"\",\n  console: true");
                } else {
                    end_list.extend_from_slice(b"\",\n  console: false");
                }
                if !options.react_refresh_entry_point.is_empty() {
                    end_list.extend_from_slice(b",\n  refresh: ");
                    let mut buf = bun_paths::path_buffer_pool::get();
                    let rel =
                        relative_path(options.root, &mut *buf, options.react_refresh_entry_point);
                    bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
                        rel,
                        &mut end_list,
                    )?;
                }
                if let Some(files) = options.route_page_files {
                    let write_id = |end_list: &mut Vec<u8>, abs: &[u8]| -> crate::Result<()> {
                        let mut buf = bun_paths::path_buffer_pool::get();
                        let rel = relative_path(options.root, &mut *buf, abs);
                        bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
                            rel, end_list,
                        )?;
                        Ok(())
                    };
                    end_list.extend_from_slice(b",\n  route: { page: ");
                    match &files.page {
                        Some(page) => write_id(&mut end_list, page)?,
                        None => end_list.extend_from_slice(b"null"),
                    }
                    end_list.extend_from_slice(b", layouts: [");
                    for (i, layout) in files.layouts.iter().enumerate() {
                        if i > 0 {
                            end_list.extend_from_slice(b", ");
                        }
                        write_id(&mut end_list, layout)?;
                    }
                    end_list.extend_from_slice(b"] }");
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

        let _ = start;
        Ok(())
    }

    /// `IncrementalGraph(.server).takeJSBundleToList` (spec :1713).
    fn take_js_bundle_to_list_server(
        &mut self,
        list: &mut Vec<u8>,
        options: &TakeJSBundleOptionsServer,
    ) -> Result<(), crate::Error> {
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

        let _ = start;
        Ok(())
    }

    /// `IncrementalGraph(side).takeSourceMap` (spec :1843).
    /// Fills in all fields of `out` except `ref_count`.
    pub(crate) fn take_source_map(
        &mut self,
        out: &mut source_map_store::Entry,
    ) -> Result<(), crate::Error> {
        let paths = self.bundled_files.keys();
        match SIDE {
            Side::Client => {
                let mut file_paths: Vec<Box<[u8]>> =
                    Vec::with_capacity(self.current_chunk_parts.len());
                let mut contained_maps: Vec<packed_map::Shared> =
                    Vec::with_capacity(self.current_chunk_parts.len());
                let mut overlapping_memory_cost: usize = 0;

                for file_index in &self.current_chunk_parts {
                    // Borrowing slice headers from `bundled_files.keys()`
                    // would be self-referential w.r.t. `DevServer`, so own a
                    // copy. Paths are short and source-map entries are
                    // infrequent — profile if hot.
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
