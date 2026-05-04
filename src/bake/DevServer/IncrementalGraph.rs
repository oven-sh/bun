use core::mem::offset_of;

use bun_collections::{ArrayHashMap, AutoArrayHashMap, DynamicBitSet, MultiArrayList};
use bun_core::{Output, fmt as bun_fmt};
use bun_logger::Log;
use bun_paths::path_buffer_pool;
use bun_sourcemap::{self as SourceMap, VLQ};
use bun_str::strings;

use bun_bake::{self as bake, Side, HmrRuntime};
use bun_bake::dev_server::{
    self as DevServer, ChunkKind, DevAllocator, EntryPointList, FileKind, GraphTraceState,
    HotUpdateContext, PackedMap, RouteBundle, SerializedFailure, SourceMapStore, TraceImportGoal,
};
use bun_bake::dev_server::packed_map::LineCount;
use bun_bake::framework_router::{self as FrameworkRouter, Route};
use bun_bundler::{self as bundle_v2, BundleV2, Chunk};
use bun_options_types::ImportRecord;
use bun_js_parser::ast;

bun_output::declare_scope!(IncrementalGraph, hidden);
bun_output::declare_scope!(IncrementalGraphReceiveChunk, visible);
bun_output::declare_scope!(processChunkDependencies, visible);
bun_output::declare_scope!(processEdgeAttachment, visible);
bun_output::declare_scope!(disconnectEdgeFromDependencyList, hidden);

type JsCode = Box<[u8]>;
type CssAssetId = u64;

// The server's incremental graph does not store previously bundled code because there is
// only one instance of the server. Instead, it stores which module graphs it is a part of.
// This makes sure that recompilation knows what bundler options to use.
#[derive(Clone, Copy)]
pub struct ServerFile {
    /// Is this file built for the Server graph.
    pub is_rsc: bool,
    /// Is this file built for the SSR graph.
    pub is_ssr: bool,
    /// If set, the client graph contains a matching file.
    /// The server
    pub is_client_component_boundary: bool,
    /// If this file is a route root, the route can be looked up in
    /// the route list. This also stops dependency propagation.
    pub is_route: bool,
    /// If the file has an error, the failure can be looked up
    /// in the `.failures` map.
    pub failed: bool,
    /// CSS and Asset files get special handling
    pub kind: FileKind,
}

impl ServerFile {
    // `ClientFile` has a separate packed version, but `ServerFile` is already packed.
    // We still need to define a `Packed` type, though, so we can write `File::Packed`
    // regardless of `side`.
    pub type Packed = ServerFile;

    pub fn pack(&self) -> Self::Packed {
        *self
    }

    pub fn unpack(self) -> ServerFile {
        self
    }

    fn stops_dependency_trace(self) -> bool {
        self.is_client_component_boundary
    }

    pub fn file_kind(&self) -> FileKind {
        self.kind
    }
}

// TODO(port): verify `freeFileContent(.ignore_css)` semantics are preserved by
// `ClientFilePacked`'s Drop in Phase B (it must NOT call `assets.unrefByPath`).
#[derive(Clone)]
pub enum Content {
    Unknown,
    /// When stale, the code is "", otherwise it contains at least one non-whitespace
    /// character, as empty chunks contain at least a function wrapper.
    Js(JsCode),
    Asset(JsCode),
    /// A CSS root is the first file in a CSS bundle, aka the one that the JS or HTML file
    /// points into.
    ///
    /// There are many complicated rules when CSS files reference each other, none of which
    /// are modelled in IncrementalGraph. Instead, any change to downstream files will find
    /// the CSS root, and queue it for a re-bundle. Additionally, CSS roots only have one
    /// level of imports, as the code in `finalizeBundle` will add all referenced files as
    /// edges directly to the root, creating a flat list instead of a tree. Those downstream
    /// files remaining empty; only present so that invalidation can trace them to this
    /// root.
    CssRoot(CssAssetId),
    CssChild,
}

// TODO(port): Zig defines `Content.Untagged` via `@typeInfo` to strip the tag for the
// packed layout below. In Rust we keep `Content` as a tagged enum and the `Packed`
// representation stores it directly; revisit if size assertions fire in Phase B.

pub struct ClientFile {
    pub content: Content,
    pub source_map: PackedMap::Shared,
    /// This should always be None if `source_map` is `Some`, since HTML files do not have
    /// source maps.
    pub html_route_bundle_index: Option<RouteBundle::Index>,
    /// If the file has an error, the failure can be looked up in the `.failures` map.
    pub failed: bool,
    /// For JS files, this is a component root; the server contains a matching file.
    pub is_hmr_root: bool,
    /// This is a file is an entry point to the framework. Changing this will always cause
    /// a full page reload.
    pub is_special_framework_file: bool,
}

impl Default for ClientFile {
    fn default() -> Self {
        Self {
            content: Content::Unknown,
            source_map: PackedMap::Shared::None,
            html_route_bundle_index: None,
            failed: false,
            is_hmr_root: false,
            is_special_framework_file: false,
        }
    }
}

/// Packed version of `ClientFile`. Don't access fields directly; call `unpack`.
// TODO(port): The Zig version is a hand-packed struct overlaying `Content.Untagged` with
// a `source_map`/`html_route_bundle_index` union to fit in `4 * u64`. In Phase A we
// store the unpacked `ClientFile` directly and rely on Phase B to re-pack if the size
// assertion (`@sizeOf == @sizeOf(u64) * 4`) is load-bearing.
pub struct ClientFilePacked {
    unsafe_packed_data: ClientFile,
}

impl ClientFilePacked {
    pub fn unpack(self) -> ClientFile {
        // TODO(port): see struct comment — currently identity.
        self.unsafe_packed_data
    }

    // Zig has a `comptime` block here asserting size/align in non-debug builds.
    // const _: () = assert!(core::mem::size_of::<ClientFilePacked>() == core::mem::size_of::<u64>() * 4);
}

impl ClientFile {
    pub type Packed = ClientFilePacked;

    pub fn pack(&self) -> ClientFilePacked {
        // HTML files should not have source maps
        debug_assert!(
            self.html_route_bundle_index.is_none()
                || !matches!(self.source_map, PackedMap::Shared::Some(_))
        );
        // TODO(port): see `ClientFilePacked` comment — currently identity. The Zig
        // implementation switches over `std.meta.activeTag(self.content)` and
        // `self.source_map` to build the overlaid untagged unions.
        ClientFilePacked {
            unsafe_packed_data: ClientFile {
                content: self.content.clone(),
                source_map: self.source_map.clone(),
                html_route_bundle_index: self.html_route_bundle_index,
                failed: self.failed,
                is_hmr_root: self.is_hmr_root,
                is_special_framework_file: self.is_special_framework_file,
            },
        }
    }

    pub fn kind(&self) -> FileKind {
        match self.content {
            Content::Unknown => FileKind::Unknown,
            Content::Js(_) => FileKind::Js,
            Content::Asset(_) => FileKind::Asset,
            Content::CssRoot(_) | Content::CssChild => FileKind::Css,
        }
    }

    fn js_code(&self) -> Option<&[u8]> {
        match &self.content {
            Content::Js(code) | Content::Asset(code) => Some(code),
            _ => None,
        }
    }

    #[inline]
    fn stops_dependency_trace(self) -> bool {
        false
    }

    pub fn file_kind(&self) -> FileKind {
        self.kind()
    }
}

// PORT NOTE: Zig uses `fn IncrementalGraph(comptime side: bake.Side) type` and switches
// on `side` to select field types (e.g. `current_chunk_parts` is `Vec<FileIndex>` for
// client and `Vec<Owned<[u8]>>` for server). Rust const generics cannot select types
// at compile time via `match`, so we model `side` as a marker type implementing a
// `GraphSide` trait with associated types. `SIDE` constant on the trait recovers the
// runtime tag for logging / branching.
pub trait GraphSide: Sized + 'static {
    const SIDE: Side;
    type File: FileLike;
    type FilePacked;
    /// Element type of `current_chunk_parts`.
    type ChunkPart;
    /// `Vec<CssAssetId>` on client, `()` on server.
    type CurrentCssFiles: Default;
    /// `Vec<CurrentChunkSourceMapData>` on server, `()` on client.
    type CurrentChunkSourceMaps: Default;

    /// Field name on `DevServer` for `@fieldParentPtr`.
    const OWNER_FIELD: &'static str;
}

pub trait FileLike {
    type Packed;
    fn pack(&self) -> Self::Packed;
    fn file_kind(&self) -> FileKind;
}

impl FileLike for ServerFile {
    type Packed = ServerFile;
    fn pack(&self) -> Self::Packed {
        *self
    }
    fn file_kind(&self) -> FileKind {
        self.kind
    }
}
impl FileLike for ClientFile {
    type Packed = ClientFilePacked;
    fn pack(&self) -> Self::Packed {
        ClientFile::pack(self)
    }
    fn file_kind(&self) -> FileKind {
        self.kind()
    }
}

pub struct Client;
pub struct Server;

impl GraphSide for Client {
    const SIDE: Side = Side::Client;
    type File = ClientFile;
    type FilePacked = ClientFilePacked;
    type ChunkPart = FileIndex;
    type CurrentCssFiles = Vec<CssAssetId>;
    type CurrentChunkSourceMaps = ();
    const OWNER_FIELD: &'static str = "client_graph";
}
impl GraphSide for Server {
    const SIDE: Side = Side::Server;
    type File = ServerFile;
    type FilePacked = ServerFile;
    // This memory is allocated by the dev server allocator
    type ChunkPart = Box<[u8]>; // TODO(port): was `bun.ptr.OwnedIn([]const u8, DevAllocator)`
    type CurrentCssFiles = ();
    type CurrentChunkSourceMaps = Vec<CurrentChunkSourceMapData>;
    const OWNER_FIELD: &'static str = "server_graph";
}

/// The paradigm of Bake's incremental state is to store a separate list of files
/// than the Graph in bundle_v2. When watch events happen, the bundler is run on
/// the changed files, excluding non-stale files via `isFileStale`.
///
/// Upon bundle completion, both `client_graph` and `server_graph` have their
/// `receiveChunk` methods called with all new chunks, counting the total length
/// needed. A call to `takeJSBundle` joins all of the chunks, resulting in the
/// code to send to client or evaluate on the server.
///
/// Then, `processChunkDependencies` is called on each chunk to update the
/// list of imports. When a change in imports is detected, the dependencies
/// are updated accordingly.
///
/// Since all routes share the two graphs, bundling a new route that shared
/// a module from a previously bundled route will perform the same exclusion
/// behavior that rebuilds use. This also ensures that two routes on the server
/// do not emit duplicate dependencies. By tracing `imports` on each file in
/// the module graph recursively, the full bundle for any given route can
/// be re-materialized (required when pressing Cmd+R after any client update)
///
/// Since source mappings are all relative to their previous mapping, each
/// chunk's mappings can be stored in the graph, and very trivially built into
/// JSON source map files (`takeSourceMap`), even after hot updates. The
/// lifetime for these sourcemaps is a bit tricky and depend on the lifetime of
/// of WebSocket connections; see comments in `Assets` for more details.
pub struct IncrementalGraph<S: GraphSide> {
    // Unless otherwise mentioned, all data structures use DevServer's allocator.
    // All arrays are indexed by FileIndex, except for the two edge-related arrays.

    /// Keys are absolute paths for the "file" namespace, or the
    /// pretty-formatted path value that appear in imports. Absolute paths
    /// are stored so the watcher can quickly query and invalidate them.
    /// Key slices are owned by `dev.allocator()`
    pub bundled_files: ArrayHashMap<Box<[u8]>, S::FilePacked>,
    /// Track bools for files which are "stale", meaning they should be
    /// re-bundled before being used. Resizing this is usually deferred
    /// until after a bundle, since resizing the bit-set requires an
    /// exact size, instead of the log approach that dynamic arrays use.
    pub stale_files: DynamicBitSet,

    // TODO: rename `dependencies` to something that clearly indicates direction.
    // such as "parent" or "consumer"

    /// Start of a file's 'dependencies' linked list. These are the other
    /// files that have imports to this file. Walk this list to discover
    /// what files are to be reloaded when something changes.
    pub first_dep: Vec<OptionalEdgeIndex>,
    /// Start of a file's 'imports' linked lists. These are the files that
    /// this file imports.
    pub first_import: Vec<OptionalEdgeIndex>,
    /// `File` objects act as nodes in a directional many-to-many graph,
    /// where edges represent the imports between modules. An 'dependency'
    /// is a file that must to be notified when it `imported` changes. This
    /// is implemented using an array of `Edge` objects that act as linked
    /// list nodes; each file stores the first imports and dependency.
    pub edges: Vec<Edge>,
    /// HMR Dependencies are added and removed very frequently, but indexes
    /// must remain stable. This free list allows re-use of freed indexes,
    /// so garbage collection can run less often.
    pub edges_free_list: Vec<EdgeIndex>,

    /// Byte length of every file queued for concatenation
    pub current_chunk_len: usize,
    /// All part contents
    pub current_chunk_parts: Vec<S::ChunkPart>,

    /// Asset IDs, which can be printed as hex in '/_bun/asset/{hash}.css'
    pub current_css_files: S::CurrentCssFiles,

    /// Source maps for server chunks and the file indices to track which
    /// file each chunk comes from
    pub current_chunk_source_maps: S::CurrentChunkSourceMaps,
}

pub struct CurrentChunkSourceMapData {
    pub file_index: FileIndex,
    pub source_map: PackedMap::Shared,
}

// If this data structure is not clear, see `DirectoryWatchStore.Dep`
// for a simpler example. It is more complicated here because this
// structure is two-way.
#[derive(Clone, Copy)]
pub struct Edge {
    /// The file with the import statement
    pub dependency: FileIndex,
    /// The file the import statement references.
    pub imported: FileIndex,

    /// Next edge in the "imports" linked list for the `dependency` file.
    /// Used to iterate through all files that `dependency` imports.
    pub next_import: OptionalEdgeIndex,

    /// Next edge in the "dependencies" linked list for the `imported` file.
    /// Used to iterate through all files that import `imported`.
    pub next_dependency: OptionalEdgeIndex,

    /// Previous edge in the "dependencies" linked list for the `imported` file.
    /// Enables bidirectional traversal and efficient removal from the middle of the list.
    pub prev_dependency: OptionalEdgeIndex,
}

/// An index into `bundled_files`, `stale_files`, `first_dep`, `first_import`
/// Top bits cannot be relied on due to `SerializedFailure.Owner.Packed`
// PORT NOTE: Zig `bun.GenericIndex(u30, File)` — newtype over u30; the type-tag `File`
// is dropped (Rust newtypes are already distinct).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct FileIndex(u32);
impl FileIndex {
    pub const fn init(v: u32) -> Self {
        debug_assert!(v < (1 << 30));
        Self(v)
    }
    pub const fn get(self) -> u32 {
        self.0
    }
}

pub const REACT_REFRESH_INDEX: FileIndex = FileIndex(0); // only meaningful when side == .client

/// An index into `edges`
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct EdgeIndex(u32);
impl EdgeIndex {
    pub const fn init(v: u32) -> Self {
        Self(v)
    }
    pub const fn get(self) -> u32 {
        self.0
    }
    pub const fn to_optional(self) -> OptionalEdgeIndex {
        OptionalEdgeIndex(Some(self))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct OptionalEdgeIndex(Option<EdgeIndex>);
impl OptionalEdgeIndex {
    pub const NONE: Self = Self(None);
    pub fn unwrap(self) -> Option<EdgeIndex> {
        self.0
    }
    pub fn unwrap_get(self) -> Option<u32> {
        self.0.map(|e| e.get())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FreeCssMode {
    UnrefCss,
    IgnoreCss,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ProcessMode {
    Normal,
    Css,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EdgeAttachmentMode {
    JsOrHtml,
    /// When set, the graph tracing state bits are used to prevent
    /// infinite recursion. This is only done for CSS, since it:
    /// - Recursively processes its imports
    /// - Does not use its tracing bits for anything else
    Css,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EdgeAttachmentResult {
    Continue,
    Stop,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TraceDependencyGoal {
    StopAtBoundary,
    NoStop,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum InsertFailureMode {
    AbsPath,
    Index,
}

pub struct ReceiveChunkSourceMap {
    pub chunk: SourceMap::Chunk,
    pub escaped_source: Option<Box<[u8]>>, // was `Owned(?[]u8)`
}

pub enum ReceiveChunkContent {
    Js {
        code: JsCode,
        source_map: Option<ReceiveChunkSourceMap>,
    },
    Css(CssAssetId),
}

pub struct MemoryCost {
    pub graph: usize,
    pub code: usize,
    pub source_maps: usize,
}

#[repr(C)]
pub struct TempLookup {
    pub edge_index: EdgeIndex,
    pub seen: bool,
}
pub type TempLookupHashTable = AutoArrayHashMap<FileIndex, TempLookup>;

pub struct InsertEmptyResult {
    pub index: FileIndex,
    pub key: *const [u8], // borrow of the interned key in `bundled_files`
}

impl<S: GraphSide> Default for IncrementalGraph<S> {
    fn default() -> Self {
        Self {
            bundled_files: ArrayHashMap::default(),
            stale_files: DynamicBitSet::default(),
            first_dep: Vec::new(),
            first_import: Vec::new(),
            edges: Vec::new(),
            edges_free_list: Vec::new(),
            current_chunk_len: 0,
            current_chunk_parts: Vec::new(),
            current_css_files: Default::default(),
            current_chunk_source_maps: Default::default(),
        }
    }
}

impl<S: GraphSide> IncrementalGraph<S> {
    pub const EMPTY: fn() -> Self = Self::default;

    pub fn get_file_index(&self, path: &[u8]) -> Option<FileIndex> {
        self.bundled_files
            .get_index(path)
            .map(|i| FileIndex::init(u32::try_from(i).unwrap()))
    }

    pub fn ensure_stale_bit_capacity(
        &mut self,
        are_new_files_stale: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        let target = self.bundled_files.count().max(self.stale_files.bit_length());
        // allocate 8 in 8 usize chunks
        let align = 8 * core::mem::size_of::<usize>() * 8;
        let aligned = (target + align - 1) & !(align - 1);
        self.stale_files.resize(aligned, are_new_files_stale)
    }

    fn new_edge(&mut self, edge: Edge) -> Result<EdgeIndex, bun_alloc::AllocError> {
        if let Some(index) = self.edges_free_list.pop() {
            self.edges[index.get() as usize] = edge;
            return Ok(index);
        }

        let index = EdgeIndex::init(u32::try_from(self.edges.len()).unwrap());
        self.edges.push(edge);
        Ok(index)
    }

    /// Does nothing besides release the `Edge` for reallocation by `new_edge`
    /// Caller must detach the dependency from the linked list it is in.
    fn free_edge(&mut self, edge_index: EdgeIndex) {
        bun_output::scoped_log!(
            IncrementalGraph,
            "IncrementalGraph(0x{:x}, {}).freeEdge({})",
            self as *const _ as usize,
            <&'static str>::from(S::SIDE),
            edge_index.get()
        );
        // `defer g.checkEdgeRemoval(edge_index)` — run after the body below.
        if cfg!(debug_assertions) {
            // SAFETY: marking the slot as garbage in debug builds; matches Zig's `= undefined`.
            // We can't write `MaybeUninit::uninit()` into a `Vec<Edge>`, so leave the value.
            // TODO(port): consider a sentinel Edge value for debug poisoning.
        }

        if (edge_index.get() as usize) == self.edges.len() - 1 {
            self.edges.truncate(self.edges.len() - 1);
        } else {
            // Leak an edge object; Ok since it may get cleaned up by
            // the next incremental graph garbage-collection cycle.
            let _ = (|| -> Result<(), ()> {
                self.edges_free_list.push(edge_index);
                Ok(())
            })();
        }

        self.check_edge_removal(edge_index);
    }

    /// It is very easy to call `g.freeEdge(idx)` but still keep references
    /// to the idx around, basically causing use-after-free with more steps
    /// and no asan to check it since we are dealing with indices and not
    /// pointers to memory.
    ///
    /// So we'll check it manually by making sure there are no references to
    /// `edge_index` in the graph.
    fn check_edge_removal(&self, edge_index: EdgeIndex) {
        // Enable this on any builds with asan enabled so we can catch stuff
        // in CI too
        // TODO(port): `bun.asan.enabled or bun.Environment.ci_assert`
        const ENABLED: bool = cfg!(debug_assertions);
        if !ENABLED {
            return;
        }

        for maybe_first_dep in &self.first_dep {
            if let Some(first_dep) = maybe_first_dep.unwrap() {
                debug_assert_ne!(first_dep.get(), edge_index.get());
            }
        }

        for maybe_first_import in &self.first_import {
            if let Some(first_import) = maybe_first_import.unwrap() {
                debug_assert_ne!(first_import.get(), edge_index.get());
            }
        }

        for edge in &self.edges {
            let in_free_list = 'in_free_list: {
                for free_edge_index in &self.edges_free_list {
                    if free_edge_index.get() == edge_index.get() {
                        break 'in_free_list true;
                    }
                }
                false
            };

            if in_free_list {
                continue;
            }

            debug_assert_ne!(edge.prev_dependency.unwrap_get(), Some(edge_index.get()));
            debug_assert_ne!(edge.next_import.unwrap_get(), Some(edge_index.get()));
            debug_assert_ne!(edge.next_dependency.unwrap_get(), Some(edge_index.get()));
        }
    }

    pub fn owner(&mut self) -> &mut DevServer::DevServer {
        // SAFETY: self is the `client_graph` / `server_graph` field of DevServer.
        // TODO(port): `offset_of!` cannot take a runtime field-name string; in Phase B
        // add per-side `const OFFSET: usize` on `GraphSide` computed via `offset_of!`.
        unsafe {
            let offset = match S::SIDE {
                Side::Client => offset_of!(DevServer::DevServer, client_graph),
                Side::Server => offset_of!(DevServer::DevServer, server_graph),
            };
            &mut *(self as *mut Self as *mut u8)
                .sub(offset)
                .cast::<DevServer::DevServer>()
        }
    }

    fn dev_allocator(&self) -> DevAllocator {
        // SAFETY: const-cast of self to call `owner()`; owner() does not mutate through `self`.
        let dev_server: &DevServer::DevServer = unsafe {
            (*(self as *const Self as *mut Self)).owner()
        };
        dev_server.dev_allocator()
    }

    /// When we delete an edge, we need to delete it by connecting the
    /// previous dependency (importer) edge to the next depedenency
    /// (importer) edge.
    ///
    /// DO NOT ONLY CALL THIS FUNCTION TO TRY TO DELETE AN EDGE, YOU MUST DELETE
    /// THE IMPORTS TOO!
    fn disconnect_edge_from_dependency_list(&mut self, edge_index: EdgeIndex) {
        // PORT NOTE: reshaped for borrowck — we copy `edge` out (it's `Copy`) instead of
        // holding `&mut self.edges[..]` across other `self.edges[..]` accesses.
        let edge = self.edges[edge_index.get() as usize];
        let imported = edge.imported.get() as usize;
        bun_output::scoped_log!(
            disconnectEdgeFromDependencyList,
            "detach edge={} | id={} {} -> id={} {} (first_dep={})",
            edge_index.get(),
            edge.dependency.get(),
            bun_fmt::quote(&self.bundled_files.keys()[edge.dependency.get() as usize]),
            imported,
            bun_fmt::quote(&self.bundled_files.keys()[edge.imported.get() as usize]),
            match self.first_dep[imported].unwrap() {
                Some(first_dep) => first_dep.get(),
                None => 42069000,
            }
        );

        // Delete this edge by connecting the previous dependency to the
        // next dependency and vice versa
        if let Some(prev) = edge.prev_dependency.unwrap() {
            self.edges[prev.get() as usize].next_dependency = edge.next_dependency;

            if let Some(next) = edge.next_dependency.unwrap() {
                self.edges[next.get() as usize].prev_dependency = edge.prev_dependency;
            }
        } else {
            // If no prev dependency, this better be the first one!
            debug_assert_eq!(
                self.first_dep[edge.imported.get() as usize].unwrap(),
                Some(edge_index)
            );

            // The edge has no prev dependency, but it *might* have a next dependency!
            if let Some(next) = edge.next_dependency.unwrap() {
                self.edges[next.get() as usize].prev_dependency = OptionalEdgeIndex::NONE;
                self.first_dep[edge.imported.get() as usize] = next.to_optional();
            } else {
                self.first_dep[edge.imported.get() as usize] = OptionalEdgeIndex::NONE;
            }
        }
    }

    fn disconnect_and_delete_file(&mut self, file_index: FileIndex) {
        debug_assert!(self.first_dep[file_index.get() as usize] == OptionalEdgeIndex::NONE); // must have no dependencies

        // Disconnect all imports
        {
            let mut it: Option<EdgeIndex> = self.first_import[file_index.get() as usize].unwrap();
            self.first_import[file_index.get() as usize] = OptionalEdgeIndex::NONE;
            while let Some(edge_index) = it {
                let dep = self.edges[edge_index.get() as usize];
                it = dep.next_import.unwrap();
                debug_assert!(dep.dependency == file_index);

                self.disconnect_edge_from_dependency_list(edge_index);
                self.free_edge(edge_index);

                // TODO: a flag to this function which is queues all
                // direct importers to rebuild themselves, which will
                // display the bundling errors.
            }
        }

        // PORT NOTE: reshaped for borrowck — take key out before calling owner().
        let key: Box<[u8]> = core::mem::replace(
            &mut self.bundled_files.keys_mut()[file_index.get() as usize],
            Box::default(), // cannot be `undefined` as it may be read by hashmap logic
        );

        // DirectoryWatchStore.Dep.source_file_path borrows this key; remove
        // any such dependencies before freeing it so they do not dangle.
        self.owner()
            .directory_watchers
            .remove_dependencies_for_file(&key);

        drop(key);

        debug_assert_eq!(self.first_dep[file_index.get() as usize], OptionalEdgeIndex::NONE);
        debug_assert_eq!(self.first_import[file_index.get() as usize], OptionalEdgeIndex::NONE);

        // TODO: it is infeasible to swapRemove a file since
        // FrameworkRouter, SerializedFailure, and more structures contains
        // file indices to the server graph.  Instead, `file_index` should
        // go in a free-list for use by new files.
    }

    pub fn on_file_deleted(&mut self, abs_path: &[u8], bv2: &mut BundleV2) {
        let Some(index) = self.get_file_index(abs_path) else {
            return;
        };

        // Disconnect all imports
        let mut it: Option<EdgeIndex> = self.first_import[index.get() as usize].unwrap();
        self.first_import[index.get() as usize] = OptionalEdgeIndex::NONE;
        while let Some(edge_index) = it {
            let dep = self.edges[edge_index.get() as usize];
            it = dep.next_import.unwrap();
            debug_assert!(dep.dependency == index);

            self.disconnect_edge_from_dependency_list(edge_index);
            self.free_edge(edge_index);
        }

        // Rebuild all dependencies
        let mut it = self.first_dep[index.get() as usize].unwrap();
        while let Some(edge_index) = it {
            let dep = self.edges[edge_index.get() as usize];
            it = dep.next_dependency.unwrap();
            debug_assert!(dep.imported == index);

            let key = &self.bundled_files.keys()[dep.dependency.get() as usize];
            bv2.enqueue_file_from_dev_server_incremental_graph_invalidation(
                key,
                match S::SIDE {
                    Side::Client => bun_bundler::Target::Browser,
                    Side::Server => bun_bundler::Target::Bun,
                },
            )
            .unwrap_or_else(|e| bun_core::handle_oom(e));
        }

        // Bust the resolution caches of the dir containing this file,
        // so that it cannot be resolved.
        let dirname = bun_paths::dirname(abs_path).unwrap_or(abs_path);
        let _ = bv2.transpiler.resolver.bust_dir_cache(dirname);

        // Additionally, clear the cached entry of the file from the path to
        // source index map.
        for map in bv2.graph.build_graphs.values_mut() {
            let _ = map.remove(abs_path);
        }
    }
}

// ───────────────────────────── Client-only ─────────────────────────────

impl IncrementalGraph<Client> {
    fn free_file_content(&mut self, key: &[u8], file: &mut ClientFile, css: FreeCssMode) {
        if let Some(ptr) = file.source_map.take() {
            drop(ptr);
        }
        let content = core::mem::replace(&mut file.content, Content::Unknown);
        match content {
            Content::Js(_code) | Content::Asset(_code) => {
                // freed by Box drop
            }
            Content::CssRoot(_) | Content::CssChild => {
                if css == FreeCssMode::UnrefCss {
                    self.owner().assets.unref_by_path(key);
                }
            }
            Content::Unknown => {}
        }
    }

    /// Prefer calling .values() and indexing manually if accessing more than one
    pub fn get_file_by_index(&self, index: FileIndex) -> ClientFile {
        // TODO(port): `ClientFilePacked::unpack` consumes self; values() returns a slice.
        // Phase B should make `unpack` take `&self` or make `ClientFilePacked: Clone`.
        self.bundled_files.values()[index.get() as usize].unpack()
    }

    pub fn html_route_bundle_index(&self, index: FileIndex) -> RouteBundle::Index {
        self.get_file_by_index(index).html_route_bundle_index.unwrap()
    }

    /// Does NOT count size_of::<Self>()
    pub fn memory_cost_detailed(&mut self) -> MemoryCost {
        let mut graph: usize = 0;
        let mut code: usize = 0;
        let mut source_maps: usize = 0;
        graph += DevServer::memory_cost_array_hash_map(&self.bundled_files);
        graph += self.stale_files.bytes().len();
        graph += DevServer::memory_cost_array_list(&self.first_dep);
        graph += DevServer::memory_cost_array_list(&self.first_import);
        graph += DevServer::memory_cost_array_list(&self.edges);
        graph += DevServer::memory_cost_array_list(&self.edges_free_list);
        graph += DevServer::memory_cost_array_list(&self.current_chunk_parts);
        graph += DevServer::memory_cost_array_list(&self.current_css_files);
        for packed_file in self.bundled_files.values() {
            let file = packed_file.unpack();
            match &file.content {
                Content::Js(code_slice) | Content::Asset(code_slice) => code += code_slice.len(),
                _ => {}
            }
            source_maps += file.source_map.memory_cost();
        }
        MemoryCost { graph, code, source_maps }
    }
}

impl IncrementalGraph<Server> {
    /// Prefer calling .values() and indexing manually if accessing more than one
    pub fn get_file_by_index(&self, index: FileIndex) -> ServerFile {
        self.bundled_files.values()[index.get() as usize].unpack()
    }

    /// Does NOT count size_of::<Self>()
    pub fn memory_cost_detailed(&mut self) -> MemoryCost {
        let mut graph: usize = 0;
        let code: usize = 0;
        let mut source_maps: usize = 0;
        graph += DevServer::memory_cost_array_hash_map(&self.bundled_files);
        graph += self.stale_files.bytes().len();
        graph += DevServer::memory_cost_array_list(&self.first_dep);
        graph += DevServer::memory_cost_array_list(&self.first_import);
        graph += DevServer::memory_cost_array_list(&self.edges);
        graph += DevServer::memory_cost_array_list(&self.edges_free_list);
        graph += DevServer::memory_cost_array_list(&self.current_chunk_parts);
        graph += DevServer::memory_cost_array_list(&self.current_chunk_source_maps);
        for item in &self.current_chunk_source_maps {
            source_maps += item.source_map.memory_cost();
        }
        MemoryCost { graph, code, source_maps }
    }
}

// ───────────────────────────── receiveChunk ─────────────────────────────
// PORT NOTE: `receiveChunk` is heavily side-specific (different value types, different
// `current_chunk_parts` element types). Split into per-side impls to avoid type-level
// `match S::SIDE` gymnastics. Logic mirrors the Zig `switch (side)` arms 1:1.

impl IncrementalGraph<Client> {
    /// Tracks a bundled code chunk for cross-bundle chunks,
    /// ensuring it has an entry in `bundled_files`.
    ///
    /// For client, takes ownership of the code slice (must be default allocated)
    pub fn receive_chunk(
        &mut self,
        ctx: &mut HotUpdateContext,
        index: ast::Index,
        mut content: ReceiveChunkContent,
        is_ssr_graph: bool,
    ) -> Result<(), bun_core::Error> {
        let _ = is_ssr_graph;
        let dev = self.owner();
        dev.graph_safety_lock.assert_locked();

        let path = &ctx.sources[index.get() as usize].path;
        let key = path.key_for_incremental_graph();

        bun_output::scoped_log!(
            IncrementalGraphReceiveChunk,
            "receiveChunk({}, {})",
            <&'static str>::from(Side::Client),
            bstr::BStr::new(key)
        );

        if cfg!(debug_assertions) {
            if let ReceiveChunkContent::Js { code, .. } = &content {
                if strings::is_all_whitespace(code) {
                    // Should at least contain the function wrapper
                    Output::panic(format_args!(
                        "Empty chunk is impossible: {} client",
                        bstr::BStr::new(key)
                    ));
                }
            }
        }

        // Dump to filesystem if enabled
        if bun_core::FeatureFlags::BAKE_DEBUGGING_FEATURES {
            if let ReceiveChunkContent::Js { code, .. } = &content {
                if let Some(dump_dir) = &dev.dump_dir {
                    DevServer::dump_bundle_for_chunk(dev, dump_dir, Side::Client, key, code, true, is_ssr_graph);
                }
            }
        }

        let gop = self.bundled_files.get_or_put(key)?;
        let file_index = FileIndex::init(u32::try_from(gop.index).unwrap());

        if !gop.found_existing {
            *gop.key_ptr = Box::<[u8]>::from(key);
            self.first_dep.push(OptionalEdgeIndex::NONE);
            self.first_import.push(OptionalEdgeIndex::NONE);
        }

        if self.stale_files.bit_length() > gop.index {
            self.stale_files.unset(gop.index);
        }

        *ctx.get_cached_index(Side::Client, index) = Some(file_index).into();

        let mut html_route_bundle_index: Option<RouteBundle::Index> = None;
        let mut is_special_framework_file = false;

        if gop.found_existing {
            let mut existing = gop.value_ptr.unpack();

            // Free the original content + old source map
            // PORT NOTE: reshaped for borrowck — `gop` borrows `self.bundled_files` mutably;
            // `free_file_content` needs `&mut self`. We re-fetch via index after.
            // TODO(port): hoisted free_file_content body inline to avoid double &mut self
            if let Some(ptr) = existing.source_map.take() {
                drop(ptr);
            }
            match core::mem::replace(&mut existing.content, Content::Unknown) {
                Content::Js(_) | Content::Asset(_) => {}
                Content::CssRoot(_) | Content::CssChild => { /* .ignore_css */ }
                Content::Unknown => {}
            }

            // Free a failure if it exists
            if existing.failed {
                let dev = self.owner();
                let kv = dev
                    .bundling_failures
                    .fetch_swap_remove_adapted(
                        SerializedFailure::Owner::Client(file_index),
                        SerializedFailure::ArrayHashAdapter {},
                    )
                    .unwrap_or_else(|| {
                        Output::panic(format_args!("Missing SerializedFailure in IncrementalGraph"))
                    });
                dev.incremental_result.failures_removed.push(kv.key);
            }

            // Persist some data
            html_route_bundle_index = existing.html_route_bundle_index;
            is_special_framework_file = existing.is_special_framework_file;
        }

        // PORT NOTE: reshaped for borrowck — Zig reads `js.code` again after assigning
        // it into `new_file.content` (slice aliasing). Capture the derived scalars
        // before `code` is moved into `Content::Js`/`Content::Asset`.
        let (code_line_count, code_len): (u32, usize) = match &content {
            ReceiveChunkContent::Css(_) => (0, 0),
            ReceiveChunkContent::Js { code, .. } => (
                u32::try_from(strings::count_char(code, b'\n')).unwrap(),
                code.len(),
            ),
        };

        let new_file = ClientFile {
            content: match &content {
                // non-root CSS files never get registered in this function
                ReceiveChunkContent::Css(css) => Content::CssRoot(*css),
                ReceiveChunkContent::Js { code, .. } => {
                    if ctx.loaders[index.get() as usize].is_javascript_like() {
                        Content::Js(core::mem::take(code))
                    } else {
                        Content::Asset(core::mem::take(code))
                    }
                }
            },
            source_map: match &mut content {
                ReceiveChunkContent::Css(_) => PackedMap::Shared::None,
                ReceiveChunkContent::Js { code, source_map } => 'blk: {
                    // Insert new source map or patch existing empty source map.
                    if let Some(source_map) = source_map {
                        debug_assert!(html_route_bundle_index.is_none()); // suspect behind #17956
                        if source_map.chunk.buffer.len() > 0 {
                            break 'blk PackedMap::Shared::Some(PackedMap::new_non_empty(
                                &mut source_map.chunk,
                                source_map.escaped_source.take().unwrap(),
                            ));
                        }
                        // chunk.buffer / escaped_source dropped at end of scope
                    }

                    // Must precompute this. Otherwise, source maps won't have
                    // the info needed to concatenate VLQ mappings.
                    let _ = code;
                    PackedMap::Shared::LineCount(LineCount::init(code_line_count))
                },
            },
            html_route_bundle_index,
            is_hmr_root: ctx.server_to_client_bitset.is_set(index.get() as usize),
            is_special_framework_file,
            failed: false,
        };

        // PORT NOTE: re-fetch value_ptr by index since `gop` may have been invalidated
        // by intervening `&mut self` borrows.
        self.bundled_files.values_mut()[file_index.get() as usize] = new_file.pack();

        if let ReceiveChunkContent::Js { .. } = &content {
            // Track JavaScript chunks for concatenation
            self.current_chunk_parts.push(file_index);
            self.current_chunk_len += code_len;
        }

        Ok(())
    }
}

impl IncrementalGraph<Server> {
    /// For server, the code is temporarily kept in the
    /// `current_chunk_parts` array, where it must live until
    /// takeJSBundle is called. Then it can be freed.
    pub fn receive_chunk(
        &mut self,
        ctx: &mut HotUpdateContext,
        index: ast::Index,
        mut content: ReceiveChunkContent,
        is_ssr_graph: bool,
    ) -> Result<(), bun_core::Error> {
        let dev = self.owner();
        dev.graph_safety_lock.assert_locked();

        let path = &ctx.sources[index.get() as usize].path;
        let key = path.key_for_incremental_graph();

        bun_output::scoped_log!(
            IncrementalGraphReceiveChunk,
            "receiveChunk({}, {})",
            <&'static str>::from(Side::Server),
            bstr::BStr::new(key)
        );

        if cfg!(debug_assertions) {
            if let ReceiveChunkContent::Js { code, .. } = &content {
                if strings::is_all_whitespace(code) {
                    Output::panic(format_args!(
                        "Empty chunk is impossible: {} {}",
                        bstr::BStr::new(key),
                        if is_ssr_graph { "ssr" } else { "server" }
                    ));
                }
            }
        }

        if bun_core::FeatureFlags::BAKE_DEBUGGING_FEATURES {
            if let ReceiveChunkContent::Js { code, .. } = &content {
                if let Some(dump_dir) = &dev.dump_dir {
                    DevServer::dump_bundle_for_chunk(dev, dump_dir, Side::Server, key, code, true, is_ssr_graph);
                }
            }
        }

        let gop = self.bundled_files.get_or_put(key)?;
        let file_index = FileIndex::init(u32::try_from(gop.index).unwrap());

        if !gop.found_existing {
            *gop.key_ptr = Box::<[u8]>::from(key);
            self.first_dep.push(OptionalEdgeIndex::NONE);
            self.first_import.push(OptionalEdgeIndex::NONE);
        }

        if self.stale_files.bit_length() > gop.index {
            self.stale_files.unset(gop.index);
        }

        *ctx.get_cached_index(Side::Server, index) = Some(file_index).into();

        if !gop.found_existing {
            let client_component_boundary = ctx.server_to_client_bitset.is_set(index.get() as usize);

            *gop.value_ptr = ServerFile {
                is_rsc: !is_ssr_graph,
                is_ssr: is_ssr_graph,
                is_route: false,
                is_client_component_boundary: client_component_boundary,
                failed: false,
                kind: match content {
                    ReceiveChunkContent::Js { .. } => FileKind::Js,
                    ReceiveChunkContent::Css(_) => FileKind::Css,
                },
            };

            if client_component_boundary {
                self.owner()
                    .incremental_result
                    .client_components_added
                    .push(file_index);
            }
        } else {
            gop.value_ptr.kind = match content {
                ReceiveChunkContent::Js { .. } => FileKind::Js,
                ReceiveChunkContent::Css(_) => FileKind::Css,
            };

            if is_ssr_graph {
                gop.value_ptr.is_ssr = true;
            } else {
                gop.value_ptr.is_rsc = true;
            }

            if ctx.server_to_client_bitset.is_set(index.get() as usize) {
                gop.value_ptr.is_client_component_boundary = true;
                self.owner()
                    .incremental_result
                    .client_components_added
                    .push(file_index);
            } else if gop.value_ptr.is_client_component_boundary {
                let key_owned = gop.key_ptr.clone();
                let client_graph = &mut self.owner().client_graph;
                let client_index = client_graph
                    .get_file_index(&key_owned)
                    .unwrap_or_else(|| Output::panic(format_args!("Client graph's SCB was already deleted")));
                client_graph.disconnect_and_delete_file(client_index);
                // re-fetch value_ptr
                self.bundled_files.values_mut()[file_index.get() as usize]
                    .is_client_component_boundary = false;

                self.owner()
                    .incremental_result
                    .client_components_removed
                    .push(file_index);
            }

            let value = &mut self.bundled_files.values_mut()[file_index.get() as usize];
            if value.failed {
                value.failed = false;
                let dev = self.owner();
                let kv = dev
                    .bundling_failures
                    .fetch_swap_remove_adapted(
                        SerializedFailure::Owner::Server(file_index),
                        SerializedFailure::ArrayHashAdapter {},
                    )
                    .unwrap_or_else(|| {
                        Output::panic(format_args!("Missing failure in IncrementalGraph"))
                    });
                dev.incremental_result.failures_removed.push(kv.key);
            }
        }

        if let ReceiveChunkContent::Js { code, source_map } = &mut content {
            let code_len = code.len();
            self.current_chunk_parts.push(core::mem::take(code));
            self.current_chunk_len += code_len;

            // TODO: we probably want to store SSR chunks but not
            //       server chunks, but not 100% sure
            const SHOULD_IMMEDIATELY_FREE_SOURCEMAP: bool = false;
            if SHOULD_IMMEDIATELY_FREE_SOURCEMAP {
                // @compileError("Not implemented the codepath to free the sourcemap")
                unreachable!("Not implemented the codepath to free the sourcemap");
            } else {
                'append_empty: {
                    if let Some(source_map) = source_map {
                        // defer source_map.chunk.deinit() / escaped_source.deinit() — handled by Drop
                        if source_map.chunk.buffer.len() > 0 {
                            let Some(escaped_source) = source_map.escaped_source.take() else {
                                break 'append_empty;
                            };
                            let packed_map = PackedMap::Shared::Some(PackedMap::new_non_empty(
                                &mut source_map.chunk,
                                escaped_source,
                            ));
                            self.current_chunk_source_maps.push(CurrentChunkSourceMapData {
                                source_map: packed_map,
                                file_index,
                            });
                            return Ok(());
                        }
                    }
                }

                // Must precompute this. Otherwise, source maps won't have
                // the info needed to concatenate VLQ mappings.
                // PORT NOTE: `code` was moved above; use `code_len` doesn't help here as
                // we need the bytes. In Zig `content.js.code` is a slice so the read is fine.
                // TODO(port): capture the newline count before pushing `code` into
                // `current_chunk_parts`, or read it back from the just-pushed slice.
                let last = self.current_chunk_parts.last().unwrap();
                let count: u32 = u32::try_from(strings::count_char(last, b'\n')).unwrap();
                self.current_chunk_source_maps.push(CurrentChunkSourceMapData {
                    file_index,
                    source_map: PackedMap::Shared::LineCount(LineCount::init(count)),
                });
            }
        }

        Ok(())
    }
}

// ─────────────────────── processChunkDependencies & friends ───────────────────────

impl<S: GraphSide> IncrementalGraph<S> {
    /// Second pass of IncrementalGraph indexing
    /// - Updates dependency information for each file
    /// - Resolves what the HMR roots are
    pub fn process_chunk_dependencies(
        &mut self,
        ctx: &mut HotUpdateContext,
        mode: ProcessMode, // PERF(port): was comptime monomorphization — profile in Phase B
        bundle_graph_index: ast::Index,
        temp_alloc: &bun_alloc::Arena, // bumpalo arena
    ) -> Result<(), bun_alloc::AllocError> {
        let file_index: FileIndex = ctx
            .get_cached_index(S::SIDE, bundle_graph_index)
            .unwrap()
            .unwrap_or_else(|| panic!("unresolved index")); // do not process for failed chunks
        bun_output::scoped_log!(
            processChunkDependencies,
            "index id={} {}:",
            file_index.get(),
            bun_fmt::quote(&self.bundled_files.keys()[file_index.get() as usize])
        );

        // Build a map from the existing import list. Later, entries that
        // were not marked as `.seen = true` will be freed.
        let mut quick_lookup: TempLookupHashTable = TempLookupHashTable::default();
        {
            let mut it: Option<EdgeIndex> = self.first_import[file_index.get() as usize].unwrap();
            while let Some(edge_index) = it {
                let dep = self.edges[edge_index.get() as usize];
                it = dep.next_import.unwrap();
                debug_assert!(dep.dependency == file_index);
                quick_lookup.put_no_clobber(
                    dep.imported,
                    TempLookup { seen: false, edge_index },
                )?;
            }
        }

        // `processChunkImportRecords` appends items into `quick_lookup`,
        // but those entries always have .seen = true. Snapshot the length
        // of original entries so that the new ones can be ignored when
        // removing edges.
        let quick_lookup_values_to_care_len = quick_lookup.count();

        // A new import linked list is constructed. A side effect of this
        // approach is that the order of the imports is reversed on every
        // save. However, the ordering here doesn't matter.
        let mut new_imports: OptionalEdgeIndex = OptionalEdgeIndex::NONE;

        // (CSS chunks are not present on the server side)
        if mode == ProcessMode::Normal && S::SIDE == Side::Server {
            if ctx.server_seen_bit_set.is_set(file_index.get() as usize) {
                // defer g.first_import.items[file_index.get()] = new_imports;
                self.first_import[file_index.get() as usize] = new_imports;
                return Ok(());
            }

            // TODO(port): `g.getFileByIndex(file_index)` is side-specific (different
            // return types). The body here only checks `is_rsc and is_ssr` which only
            // exist on ServerFile. Phase B: move this block into a Server-only impl.
            // The Zig body is currently a no-op (the SSR processing is commented out
            // with a TODO), so we replicate that no-op.
            // let file = self.get_file_by_index(file_index);
            // if file.is_rsc && file.is_ssr {
            //     // The non-ssr file is always first.
            //     // TODO:
            //     // let ssr_index = ctx.scbs.get_ssr_index(bundle_graph_index.get())
            //     //     .expect("Unexpected missing server-component-boundary entry");
            //     // self.process_chunk_import_records(ctx, &mut quick_lookup, &mut new_imports, file_index, ast::Index::init(ssr_index))?;
            // }
        }

        match mode {
            ProcessMode::Normal => self.process_chunk_import_records(
                ctx,
                temp_alloc,
                &mut quick_lookup,
                &mut new_imports,
                file_index,
                bundle_graph_index,
            )?,
            ProcessMode::Css => self.process_css_chunk_import_records(
                ctx,
                temp_alloc,
                &mut quick_lookup,
                &mut new_imports,
                file_index,
                bundle_graph_index,
            )?,
        }

        // We need to add this here to not trip up
        // `checkEdgeRemoval(edge_idx)` (which checks that there no
        // references to `edge_idx`.
        //
        // I don't think `g.first_import.items[file_index]` is ever read
        // from again in this function, so this is safe.
        self.first_import[file_index.get() as usize] = OptionalEdgeIndex::NONE;

        // '.seen = false' means an import was removed and should be freed
        for val in &quick_lookup.values()[0..quick_lookup_values_to_care_len] {
            if !val.seen {
                self.owner().incremental_result.had_adjusted_edges = true;

                // Unlink from dependency list. At this point the edge is
                // already detached from the import list.
                self.disconnect_edge_from_dependency_list(val.edge_index);

                // With no references to this edge, it can be freed
                self.free_edge(val.edge_index);
            }
        }

        // defer g.first_import.items[file_index.get()] = new_imports;
        self.first_import[file_index.get() as usize] = new_imports;

        // Follow this file to the route / HTML route / HMR root to mark as stale.
        // (Both branches in Zig call the same function with the same args.)
        self.trace_dependencies(file_index, ctx.gts, TraceDependencyGoal::StopAtBoundary, file_index)?;

        Ok(())
    }

    fn process_css_chunk_import_records(
        &mut self,
        ctx: &mut HotUpdateContext,
        temp_alloc: &bun_alloc::Arena,
        quick_lookup: &mut TempLookupHashTable,
        new_imports: &mut OptionalEdgeIndex,
        file_index: FileIndex,
        bundler_index: ast::Index,
    ) -> Result<(), bun_alloc::AllocError> {
        debug_assert!(bundler_index.is_valid());
        debug_assert!(ctx.loaders[bundler_index.get() as usize].is_css());

        // PERF(port): was stack-fallback (sfb @sizeOf(ast::Index) * 64)
        let _ = temp_alloc;

        // This queue avoids stack overflow.
        // Infinite loop is prevented by the tracing bits in `processEdgeAttachment`.
        let mut queue: Vec<ast::Index> = Vec::new();

        for import_record in ctx.import_records[bundler_index.get() as usize].slice() {
            let result = self.process_edge_attachment(
                ctx, temp_alloc, quick_lookup, new_imports, file_index, import_record,
                EdgeAttachmentMode::Css,
            )?;
            if result == EdgeAttachmentResult::Continue && import_record.source_index.is_valid() {
                queue.push(import_record.source_index);
            }
        }

        while let Some(index) = queue.pop() {
            for import_record in ctx.import_records[index.get() as usize].slice() {
                let result = self.process_edge_attachment(
                    ctx, temp_alloc, quick_lookup, new_imports, file_index, import_record,
                    EdgeAttachmentMode::Css,
                )?;
                if result == EdgeAttachmentResult::Continue && import_record.source_index.is_valid() {
                    queue.push(import_record.source_index);
                }
            }
        }

        Ok(())
    }

    fn process_edge_attachment(
        &mut self,
        ctx: &mut HotUpdateContext,
        temp_alloc: &bun_alloc::Arena,
        quick_lookup: &mut TempLookupHashTable,
        new_imports: &mut OptionalEdgeIndex,
        file_index: FileIndex,
        import_record: &ImportRecord,
        mode: EdgeAttachmentMode, // PERF(port): was comptime monomorphization — profile in Phase B
    ) -> Result<EdgeAttachmentResult, bun_alloc::AllocError> {
        // When an import record is duplicated, it gets marked unused.
        // This happens in `ConvertESMExportsForHmr.deduplicatedImport`
        // There is still a case where deduplication must happen.
        if import_record.flags.is_unused {
            return Ok(EdgeAttachmentResult::Stop);
        }
        if import_record.source_index.is_runtime() {
            return Ok(EdgeAttachmentResult::Stop);
        }

        let key = import_record.path.key_for_incremental_graph();
        bun_output::scoped_log!(
            processEdgeAttachment,
            "processEdgeAttachment({}, {:?})",
            bstr::BStr::new(key),
            import_record.source_index
        );

        // Attempt to locate the FileIndex from bundle_v2's Source.Index
        let (imported_file_index, kind): (FileIndex, Option<FileKind>) = 'brk: {
            if import_record.source_index.is_valid() {
                let kind: Option<FileKind> = if mode == EdgeAttachmentMode::Css {
                    Some(match ctx.loaders[import_record.source_index.get() as usize] {
                        l if l.is_css() => FileKind::Css,
                        _ => FileKind::Asset,
                    })
                } else {
                    None
                };
                if let Some(i) = ctx.get_cached_index(S::SIDE, import_record.source_index).unwrap() {
                    break 'brk (i, kind);
                } else if mode == EdgeAttachmentMode::Css {
                    let index = self.insert_empty(key, kind.unwrap())?.index;
                    // TODO: make this more clear that:
                    // temp_alloc == bv2.graph.allocator
                    ctx.gts.resize(S::SIDE, temp_alloc, index.get() as usize + 1)?;
                    break 'brk (index, kind);
                }
            }

            match mode {
                // All invalid source indices are external URLs that cannot be watched.
                EdgeAttachmentMode::Css => return Ok(EdgeAttachmentResult::Stop),
                // Check IncrementalGraph to find an file from a prior build.
                EdgeAttachmentMode::JsOrHtml => {
                    let Some(idx) = self.bundled_files.get_index(key) else {
                        // Not tracked in IncrementalGraph. This can be hit for
                        // certain external files.
                        return Ok(EdgeAttachmentResult::Continue);
                    };
                    (FileIndex::init(u32::try_from(idx).unwrap()), None)
                }
            }
        };

        if cfg!(debug_assertions) {
            debug_assert!((imported_file_index.get() as usize) < self.bundled_files.count());
        }

        // For CSS files visiting other CSS files, prevent infinite
        // recursion.  CSS files visiting assets cannot cause recursion
        // since assets cannot import other files.
        if mode == EdgeAttachmentMode::Css && kind == Some(FileKind::Css) {
            if ctx.gts.bits(S::SIDE).is_set(imported_file_index.get() as usize) {
                return Ok(EdgeAttachmentResult::Stop);
            }
            ctx.gts.bits(S::SIDE).set(imported_file_index.get() as usize);
        }

        let gop = quick_lookup.get_or_put(imported_file_index)?;
        if gop.found_existing {
            // If the edge has already been seen, it will be skipped
            // to ensure duplicate edges never exist.
            if gop.value_ptr.seen {
                return Ok(EdgeAttachmentResult::Continue);
            }
            let lookup = gop.value_ptr;
            lookup.seen = true;
            let dep = &mut self.edges[lookup.edge_index.get() as usize];
            dep.next_import = *new_imports;
            *new_imports = lookup.edge_index.to_optional();
        } else {
            // A new edge is needed to represent the dependency and import.
            let first_dep_val = self.first_dep[imported_file_index.get() as usize];
            let edge = self.new_edge(Edge {
                next_import: *new_imports,
                next_dependency: first_dep_val,
                prev_dependency: OptionalEdgeIndex::NONE,
                imported: imported_file_index,
                dependency: file_index,
            })?;
            if let Some(dep) = first_dep_val.unwrap() {
                self.edges[dep.get() as usize].prev_dependency = edge.to_optional();
            }
            *new_imports = edge.to_optional();
            self.first_dep[imported_file_index.get() as usize] = edge.to_optional();

            self.owner().incremental_result.had_adjusted_edges = true;

            // To prevent duplicates, add into the quick lookup map
            // the file index so that it does exist.
            *gop.value_ptr = TempLookup { edge_index: edge, seen: true };

            bun_output::scoped_log!(
                processEdgeAttachment,
                "attach edge={} | id={} {} -> id={} {}",
                edge.get(),
                file_index.get(),
                bun_fmt::quote(&self.bundled_files.keys()[file_index.get() as usize]),
                imported_file_index.get(),
                bun_fmt::quote(&self.bundled_files.keys()[imported_file_index.get() as usize])
            );
        }

        Ok(EdgeAttachmentResult::Continue)
    }

    fn process_chunk_import_records(
        &mut self,
        ctx: &mut HotUpdateContext,
        _temp_alloc: &bun_alloc::Arena,
        quick_lookup: &mut TempLookupHashTable,
        new_imports: &mut OptionalEdgeIndex,
        file_index: FileIndex,
        index: ast::Index,
    ) -> Result<(), bun_alloc::AllocError> {
        debug_assert!(index.is_valid());
        // don't call this function for CSS sources
        debug_assert!(!ctx.loaders[index.get() as usize].is_css());

        for import_record in ctx.import_records[index.get() as usize].slice() {
            // When an import record is duplicated, it gets marked unused.
            // This happens in `ConvertESMExportsForHmr.deduplicatedImport`
            // There is still a case where deduplication must happen.
            if import_record.flags.is_unused {
                continue;
            }

            if !import_record.source_index.is_runtime() {
                'try_index_record: {
                    // TODO: move this block into a function
                    let key = import_record.path.key_for_incremental_graph();
                    let imported_file_index: FileIndex = 'brk: {
                        if import_record.source_index.is_valid() {
                            if let Some(i) =
                                ctx.get_cached_index(S::SIDE, import_record.source_index).unwrap()
                            {
                                break 'brk i;
                            }
                        }
                        let Some(idx) = self.bundled_files.get_index(key) else {
                            break 'try_index_record;
                        };
                        FileIndex::init(u32::try_from(idx).unwrap())
                    };

                    if cfg!(debug_assertions) {
                        debug_assert!(
                            (imported_file_index.get() as usize) < self.bundled_files.count()
                        );
                    }

                    let gop = quick_lookup.get_or_put(imported_file_index)?;
                    if gop.found_existing {
                        // If the edge has already been seen, it will be skipped
                        // to ensure duplicate edges never exist.
                        if gop.value_ptr.seen {
                            continue;
                        }
                        let lookup = gop.value_ptr;
                        lookup.seen = true;
                        let dep = &mut self.edges[lookup.edge_index.get() as usize];
                        dep.next_import = *new_imports;
                        *new_imports = lookup.edge_index.to_optional();
                    } else {
                        // A new edge is needed to represent the dependency and import.
                        let first_dep_val = self.first_dep[imported_file_index.get() as usize];
                        let edge = self.new_edge(Edge {
                            next_import: *new_imports,
                            next_dependency: first_dep_val,
                            prev_dependency: OptionalEdgeIndex::NONE,
                            imported: imported_file_index,
                            dependency: file_index,
                        })?;
                        if let Some(dep) = first_dep_val.unwrap() {
                            self.edges[dep.get() as usize].prev_dependency = edge.to_optional();
                        }
                        *new_imports = edge.to_optional();
                        self.first_dep[imported_file_index.get() as usize] = edge.to_optional();

                        self.owner().incremental_result.had_adjusted_edges = true;

                        // To prevent duplicates, add into the quick lookup map
                        // the file index so that it does exist.
                        *gop.value_ptr = TempLookup { edge_index: edge, seen: true };

                        bun_output::scoped_log!(
                            processChunkDependencies,
                            "attach edge={} | id={} {} -> id={} {}",
                            edge.get(),
                            file_index.get(),
                            bun_fmt::quote(&self.bundled_files.keys()[file_index.get() as usize]),
                            imported_file_index.get(),
                            bun_fmt::quote(
                                &self.bundled_files.keys()[imported_file_index.get() as usize]
                            )
                        );
                    }
                }
            }
        }
        Ok(())
    }

    // TODO(port): `trace_dependencies` and `trace_imports` switch on `side` to access
    // side-specific File fields and to call across to the *other* side's graph. They
    // are kept generic here for diff parity but Phase B must split into per-side impls
    // (or add `where`-bounds) since `S::File` does not expose `is_route` etc. uniformly.
    pub fn trace_dependencies(
        &mut self,
        file_index: FileIndex,
        gts: &mut GraphTraceState,
        goal: TraceDependencyGoal,
        from_file_index: FileIndex,
    ) -> Result<(), bun_alloc::AllocError> {
        self.owner().graph_safety_lock.assert_locked();

        if cfg!(feature = "debug_logs") {
            DevServer::ig_log(format_args!(
                "traceDependencies(.{}, {}{})",
                <&'static str>::from(S::SIDE),
                bun_fmt::quote(&self.bundled_files.keys()[file_index.get() as usize]),
                if gts.bits(S::SIDE).is_set(file_index.get() as usize) {
                    " [already visited]"
                } else {
                    ""
                }
            ));
        }

        if gts.bits(S::SIDE).is_set(file_index.get() as usize) {
            return Ok(());
        }
        gts.bits(S::SIDE).set(file_index.get() as usize);

        // TODO(port): side-specific body — see Zig `switch (side)`. Stubbed dispatch:
        match S::SIDE {
            Side::Server => {
                // SAFETY: S == Server here.
                let g: &mut IncrementalGraph<Server> =
                    unsafe { &mut *(self as *mut Self as *mut IncrementalGraph<Server>) };
                let file = g.get_file_by_index(file_index);
                let dev = g.owner();
                if file.is_route {
                    let route_index = dev.route_lookup.get(&file_index).copied().unwrap_or_else(|| {
                        Output::panic(format_args!(
                            "Route not in lookup index: {} {}",
                            file_index.get(),
                            bun_fmt::quote(&g.bundled_files.keys()[file_index.get() as usize])
                        ))
                    });
                    DevServer::ig_log(format_args!("\\<- Route"));
                    dev.incremental_result.framework_routes_affected.push(route_index);
                }
                if file.is_client_component_boundary {
                    dev.incremental_result.client_components_affected.push(file_index);
                }
                // Certain files do not propagate updates to dependencies.
                if goal == TraceDependencyGoal::StopAtBoundary && file.stops_dependency_trace() {
                    DevServer::ig_log(format_args!("\\<- this file stops propagation"));
                    return Ok(());
                }
            }
            Side::Client => {
                // SAFETY: S == Client here.
                let g: &mut IncrementalGraph<Client> =
                    unsafe { &mut *(self as *mut Self as *mut IncrementalGraph<Client>) };
                let file = g.get_file_by_index(file_index);
                let dev = g.owner();
                if file.is_hmr_root {
                    let key = g.bundled_files.keys()[file_index.get() as usize].clone();
                    let index = dev.server_graph.get_file_index(&key).unwrap_or_else(|| {
                        Output::panic(format_args!(
                            "Server Incremental Graph is missing component for {}",
                            bun_fmt::quote(&key)
                        ))
                    });
                    dev.server_graph.trace_dependencies(index, gts, goal, index)?;
                } else if let Some(route_bundle_index) = file.html_route_bundle_index {
                    // If the HTML file itself was modified, or an asset was
                    // modified, this must be a hard reload. Otherwise just
                    // invalidate the script tag.
                    let list = if from_file_index == file_index
                        || matches!(g.get_file_by_index(from_file_index).content, Content::Asset(_))
                    {
                        &mut dev.incremental_result.html_routes_hard_affected
                    } else {
                        &mut dev.incremental_result.html_routes_soft_affected
                    };

                    list.push(route_bundle_index);

                    if goal == TraceDependencyGoal::StopAtBoundary {
                        return Ok(());
                    }
                }
                // PORT NOTE: reshaped — Zig places the `stops_dependency_trace()` check
                // after the `switch (side)` for both arms. ClientFile's impl is const
                // false, so the check is folded into the Server arm only.
            }
        }

        // Recurse
        let mut it: Option<EdgeIndex> = self.first_dep[file_index.get() as usize].unwrap();
        while let Some(dep_index) = it {
            let edge = self.edges[dep_index.get() as usize];
            it = edge.next_dependency.unwrap();
            self.trace_dependencies(edge.dependency, gts, goal, file_index)?;
        }
        Ok(())
    }

    pub fn trace_imports(
        &mut self,
        file_index: FileIndex,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal, // PERF(port): was comptime monomorphization — profile in Phase B
    ) -> Result<(), bun_alloc::AllocError> {
        self.owner().graph_safety_lock.assert_locked();

        if cfg!(feature = "debug_logs") {
            DevServer::ig_log(format_args!(
                "traceImports(.{}, .{}, {}{})",
                <&'static str>::from(S::SIDE),
                <&'static str>::from(goal),
                bun_fmt::quote(&self.bundled_files.keys()[file_index.get() as usize]),
                if gts.bits(S::SIDE).is_set(file_index.get() as usize) {
                    " [already visited]"
                } else {
                    ""
                }
            ));
        }

        if gts.bits(S::SIDE).is_set(file_index.get() as usize) {
            return Ok(());
        }
        gts.bits(S::SIDE).set(file_index.get() as usize);

        match S::SIDE {
            Side::Server => {
                // SAFETY: S == Server here.
                let g: &mut IncrementalGraph<Server> =
                    unsafe { &mut *(self as *mut Self as *mut IncrementalGraph<Server>) };
                let file = g.get_file_by_index(file_index);
                if file.is_client_component_boundary || file.kind == FileKind::Css {
                    let dev = g.owner();
                    let key = g.bundled_files.keys()[file_index.get() as usize].clone();
                    let index = dev.client_graph.get_file_index(&key).unwrap_or_else(|| {
                        Output::panic(format_args!(
                            "Client Incremental Graph is missing component for {}",
                            bun_fmt::quote(&key)
                        ))
                    });
                    dev.client_graph.trace_imports(index, gts, goal)?;

                    if cfg!(debug_assertions) && file.kind == FileKind::Css {
                        // Server CSS files never have imports. They are
                        // purely a reference to the client graph.
                        debug_assert!(
                            g.first_import[file_index.get() as usize] == OptionalEdgeIndex::NONE
                        );
                    }
                }
                if goal == TraceImportGoal::FindErrors && file.failed {
                    let fail = g
                        .owner()
                        .bundling_failures
                        .get_key_adapted(
                            SerializedFailure::Owner::Server(file_index),
                            SerializedFailure::ArrayHashAdapter {},
                        )
                        .expect("Failed to get bundling failure");
                    g.owner().incremental_result.failures_added.push(fail);
                }
            }
            Side::Client => {
                // SAFETY: S == Client here.
                let g: &mut IncrementalGraph<Client> =
                    unsafe { &mut *(self as *mut Self as *mut IncrementalGraph<Client>) };
                let file = g.get_file_by_index(file_index);
                match &file.content {
                    Content::CssChild => {
                        debug_assert!(false, "only CSS roots should be found by tracing");
                    }
                    Content::CssRoot(id) => {
                        if goal == TraceImportGoal::FindCss {
                            g.current_css_files.push(*id);
                        }
                        // See the comment on `Content::CssRoot` on how CSS roots
                        // have a slightly different meaning for their assets.
                        // Regardless, CSS can't import JS, so this trace is done.
                        return Ok(());
                    }
                    _ => {}
                }

                if goal == TraceImportGoal::FindClientModules {
                    g.current_chunk_parts.push(file_index);
                    // TODO: will `file.js_code` ever return None here?
                    g.current_chunk_len += file.js_code().map(|c| c.len()).unwrap_or(0);
                }

                if goal == TraceImportGoal::FindErrors && file.failed {
                    let fail = g
                        .owner()
                        .bundling_failures
                        .get_key_adapted(
                            SerializedFailure::Owner::Client(file_index),
                            SerializedFailure::ArrayHashAdapter {},
                        )
                        .expect("Failed to get bundling failure");
                    g.owner().incremental_result.failures_added.push(fail);
                    return Ok(());
                }
            }
        }

        // Recurse
        let mut it: Option<EdgeIndex> = self.first_import[file_index.get() as usize].unwrap();
        while let Some(dep_index) = it {
            let edge = self.edges[dep_index.get() as usize];
            it = edge.next_import.unwrap();
            self.trace_imports(edge.imported, gts, goal)?;
        }
        Ok(())
    }

    /// Never takes ownership of `abs_path`
    /// Marks a chunk but without any content. Used to track dependencies to files that don't exist.
    pub fn insert_stale(&mut self, abs_path: &[u8], is_ssr_graph: bool) -> Result<FileIndex, bun_alloc::AllocError> {
        self.insert_stale_extra(abs_path, is_ssr_graph, false)
    }

    // TODO: `is_route` is unused in client graph
    pub fn insert_stale_extra(
        &mut self,
        abs_path: &[u8],
        is_ssr_graph: bool,
        is_route: bool,
    ) -> Result<FileIndex, bun_alloc::AllocError> {
        self.owner().graph_safety_lock.assert_locked();

        DevServer::debug_log(format_args!("Insert stale: {}", bstr::BStr::new(abs_path)));
        let gop = self.bundled_files.get_or_put(abs_path)?;
        let file_index = FileIndex::init(u32::try_from(gop.index).unwrap());

        if gop.found_existing {
            if S::SIDE == Side::Server && is_route {
                // SAFETY: S == Server, FilePacked == ServerFile
                unsafe {
                    (&mut *(gop.value_ptr as *mut S::FilePacked as *mut ServerFile)).is_route = true;
                }
            }
        } else {
            *gop.key_ptr = Box::<[u8]>::from(abs_path);
            self.first_dep.push(OptionalEdgeIndex::NONE);
            self.first_import.push(OptionalEdgeIndex::NONE);
        }

        if self.stale_files.bit_length() > gop.index {
            self.stale_files.set(gop.index);
        }

        match S::SIDE {
            Side::Client => {
                // SAFETY: S == Client.
                let g: &mut IncrementalGraph<Client> =
                    unsafe { &mut *(self as *mut Self as *mut IncrementalGraph<Client>) };
                let value_ptr = &mut g.bundled_files.values_mut()[file_index.get() as usize];
                let new_file: ClientFile = if gop.found_existing {
                    let mut existing = core::mem::replace(value_ptr, ClientFile::default().pack()).unpack();
                    // sets .content to .unknown
                    let key = g.bundled_files.keys()[file_index.get() as usize].clone();
                    g.free_file_content(&key, &mut existing, FreeCssMode::UnrefCss);
                    existing
                } else {
                    ClientFile { content: Content::Unknown, ..Default::default() }
                };
                g.bundled_files.values_mut()[file_index.get() as usize] = new_file.pack();
            }
            Side::Server => {
                // SAFETY: S == Server.
                let value_ptr = unsafe {
                    &mut *(gop.value_ptr as *mut S::FilePacked as *mut ServerFile)
                };
                if !gop.found_existing {
                    *value_ptr = ServerFile {
                        is_rsc: !is_ssr_graph,
                        is_ssr: is_ssr_graph,
                        is_route,
                        is_client_component_boundary: false,
                        failed: false,
                        kind: FileKind::Unknown,
                    };
                } else if is_ssr_graph {
                    value_ptr.is_ssr = true;
                } else {
                    value_ptr.is_rsc = true;
                }
            }
        }

        Ok(file_index)
    }

    /// Returns the key that was inserted.
    pub fn insert_empty(
        &mut self,
        abs_path: &[u8],
        kind: FileKind,
    ) -> Result<InsertEmptyResult, bun_alloc::AllocError> {
        self.owner().graph_safety_lock.assert_locked();
        let gop = self.bundled_files.get_or_put(abs_path)?;
        if !gop.found_existing {
            *gop.key_ptr = Box::<[u8]>::from(abs_path);
            // TODO(port): side-specific value initialization; we can't write `S::FilePacked`
            // generically without a constructor trait. Phase B: add `GraphSide::empty_file(kind)`.
            match S::SIDE {
                // SAFETY: S == Client here; S::FilePacked is layout-compatible with ClientFilePacked.
                Side::Client => unsafe {
                    *(gop.value_ptr as *mut S::FilePacked as *mut ClientFilePacked) =
                        ClientFile {
                            content: match kind {
                                FileKind::Unknown => Content::Unknown,
                                FileKind::Js => Content::Js(Box::default()),
                                FileKind::Asset => Content::Asset(Box::default()),
                                FileKind::Css => Content::CssChild,
                            },
                            ..Default::default()
                        }
                        .pack();
                },
                // SAFETY: S == Server here; S::FilePacked is layout-compatible with ServerFile.
                Side::Server => unsafe {
                    *(gop.value_ptr as *mut S::FilePacked as *mut ServerFile) = ServerFile {
                        is_rsc: false,
                        is_ssr: false,
                        is_route: false,
                        is_client_component_boundary: false,
                        failed: false,
                        kind,
                    };
                },
            }
            self.first_dep.push(OptionalEdgeIndex::NONE);
            self.first_import.push(OptionalEdgeIndex::NONE);
            self.ensure_stale_bit_capacity(true)?;
        }
        Ok(InsertEmptyResult {
            index: FileIndex::init(u32::try_from(gop.index).unwrap()),
            key: &**gop.key_ptr as *const [u8],
        })
    }
}

impl IncrementalGraph<Server> {
    /// Server CSS files are just used to be targets for graph traversal.
    /// Its content lives only on the client.
    pub fn insert_css_file_on_server(
        &mut self,
        ctx: &mut HotUpdateContext,
        index: ast::Index,
        abs_path: &[u8],
    ) -> Result<(), bun_alloc::AllocError> {
        self.owner().graph_safety_lock.assert_locked();

        DevServer::debug_log(format_args!("Insert stale: {}", bstr::BStr::new(abs_path)));
        let gop = self.bundled_files.get_or_put(abs_path)?;
        let file_index = FileIndex::init(u32::try_from(gop.index).unwrap());

        if !gop.found_existing {
            *gop.key_ptr = Box::<[u8]>::from(abs_path);
            self.first_dep.push(OptionalEdgeIndex::NONE);
            self.first_import.push(OptionalEdgeIndex::NONE);
        }

        // .client => @compileError("not implemented: use receiveChunk")
        *gop.value_ptr = ServerFile {
            is_rsc: false,
            is_ssr: false,
            is_route: false,
            is_client_component_boundary: false,
            failed: false,
            kind: FileKind::Css,
        };

        *ctx.get_cached_index(Side::Server, index) = Some(file_index).into();
        Ok(())
    }
}

// ───────────────────────────── insertFailure ─────────────────────────────

pub enum InsertFailureKey<'a> {
    AbsPath(&'a [u8]),
    Index(FileIndex),
}

impl<S: GraphSide> IncrementalGraph<S> {
    pub fn insert_failure(
        &mut self,
        key: InsertFailureKey<'_>,
        log: &Log,
        is_ssr_graph: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        self.owner().graph_safety_lock.assert_locked();

        // found_existing is destructured separately so that it is
        // comptime-known true when mode == .index
        // PORT NOTE: in Rust both arms produce a runtime `found_existing`; the
        // `comptime assert(mode == .abs_path)` becomes a debug_assert.
        let (gop_index, found_existing, file_index) = match key {
            InsertFailureKey::AbsPath(abs_path) => {
                let gop = self.bundled_files.get_or_put(abs_path)?;
                if !gop.found_existing {
                    *gop.key_ptr = Box::<[u8]>::from(abs_path);
                    self.first_dep.push(OptionalEdgeIndex::NONE);
                    self.first_import.push(OptionalEdgeIndex::NONE);
                }
                (
                    gop.index,
                    gop.found_existing,
                    FileIndex::init(u32::try_from(gop.index).unwrap()),
                )
            }
            // When given an index, no fetch is needed.
            InsertFailureKey::Index(idx) => (idx.get() as usize, true, idx),
        };

        self.ensure_stale_bit_capacity(true)?;
        self.stale_files.set(gop_index);

        match S::SIDE {
            // SAFETY: S == Client here; layout-compatible cast of Self.
            Side::Client => unsafe {
                let g: &mut IncrementalGraph<Client> =
                    &mut *(self as *mut Self as *mut IncrementalGraph<Client>);
                let mut new_file: ClientFile = if found_existing {
                    let value_ptr = &mut g.bundled_files.values_mut()[gop_index];
                    let mut existing =
                        core::mem::replace(value_ptr, ClientFile::default().pack()).unpack();
                    let key_owned = g.bundled_files.keys()[gop_index].clone();
                    // sets .content to .unknown
                    g.free_file_content(&key_owned, &mut existing, FreeCssMode::UnrefCss);
                    existing
                } else {
                    ClientFile { content: Content::Unknown, ..Default::default() }
                };
                new_file.failed = true;
                g.bundled_files.values_mut()[gop_index] = new_file.pack();
            },
            // SAFETY: S == Server here; S::FilePacked is layout-compatible with ServerFile.
            Side::Server => unsafe {
                let value_ptr =
                    &mut *((&mut self.bundled_files.values_mut()[gop_index]) as *mut S::FilePacked
                        as *mut ServerFile);
                if !found_existing {
                    *value_ptr = ServerFile {
                        is_rsc: !is_ssr_graph,
                        is_ssr: is_ssr_graph,
                        is_route: false,
                        is_client_component_boundary: false,
                        failed: true,
                        kind: FileKind::Unknown,
                    };
                } else {
                    if is_ssr_graph {
                        value_ptr.is_ssr = true;
                    } else {
                        value_ptr.is_rsc = true;
                    }
                    value_ptr.failed = true;
                }
            },
        }

        let dev = self.owner();

        let fail_owner: SerializedFailure::Owner = match S::SIDE {
            Side::Server => SerializedFailure::Owner::Server(file_index),
            Side::Client => SerializedFailure::Owner::Client(file_index),
        };
        // TODO: DevServer should get a stdio manager which can process
        // the error list as it changes while also supporting a REPL
        let _ = log.print(Output::error_writer());
        let failure = {
            let relative_path_buf = path_buffer_pool().get();
            // this string is just going to be memcpy'd into the log buffer
            let owner_display_name =
                dev.relative_path(&mut *relative_path_buf, &self.bundled_files.keys()[gop_index]);
            SerializedFailure::init_from_log(dev, fail_owner, owner_display_name, &log.msgs)?
        };
        let fail_gop = dev.bundling_failures.get_or_put(failure.clone())?;
        dev.incremental_result.failures_added.push(failure.clone());
        if fail_gop.found_existing {
            dev.incremental_result
                .failures_removed
                .push(core::mem::replace(fail_gop.key_ptr, failure));
        }
        Ok(())
    }
}

// ───────────────────────────── invalidate / reset ─────────────────────────────

impl IncrementalGraph<Client> {
    /// Given a set of paths, mark the relevant files as stale and append
    /// them into `entry_points`. This is called whenever a file is changed,
    /// and a new bundle has to be run.
    pub fn invalidate(
        &mut self,
        paths: &[&[u8]],
        entry_points: &mut EntryPointList,
    ) -> Result<(), bun_core::Error> {
        self.owner().graph_safety_lock.assert_locked();
        for path in paths {
            let Some(index) = self.bundled_files.get_index(path) else {
                // Cannot enqueue because it's impossible to know what
                // targets to bundle for. Instead, a failing bundle must
                // retrieve the list of files and add them as stale.
                continue;
            };
            // Store the graph-owned key, not the incoming `path`. `path`
            // may be a slice into `HotReloadEvent.extra_files`, which is
            // reset (and may be reallocated by the watcher thread) before
            // `entry_points` is consumed by startAsyncBundle/TestingBatch.
            // PORT NOTE: reshaped for borrowck — re-index keys/values per use.
            self.stale_files.set(index);
            let data = self.bundled_files.values()[index].unpack();
            match &data.content {
                Content::CssRoot(_) | Content::CssChild => {
                    if matches!(data.content, Content::CssRoot(_)) {
                        let owned_path = &self.bundled_files.keys()[index];
                        entry_points.append_css(owned_path)?;
                    }

                    let mut it = self.first_dep[index].unwrap();
                    while let Some(edge_index) = it {
                        let entry = self.edges[edge_index.get() as usize];
                        let dep = entry.dependency;
                        self.stale_files.set(dep.get() as usize);

                        let dep_file = self.bundled_files.values()[dep.get() as usize].unpack();
                        if matches!(dep_file.content, Content::CssRoot(_)) {
                            entry_points
                                .append_css(&self.bundled_files.keys()[dep.get() as usize])?;
                        }

                        it = entry.next_dependency.unwrap();
                    }
                }
                Content::Asset(_) => {
                    let mut it = self.first_dep[index].unwrap();
                    while let Some(edge_index) = it {
                        let entry = self.edges[edge_index.get() as usize];
                        let dep = entry.dependency;
                        self.stale_files.set(dep.get() as usize);

                        let dep_file = self.bundled_files.values()[dep.get() as usize].unpack();
                        // Assets violate the "do not reprocess
                        // unchanged files" rule by reprocessing ALL
                        // dependencies, instead of just the CSS roots.
                        //
                        // This is currently required to force HTML
                        // bundles to become up to date with the new
                        // asset URL. Additionally, it is currently seen
                        // as a bit nicer in HMR to do this for all JS
                        // files, though that could be reconsidered.
                        if matches!(dep_file.content, Content::CssRoot(_)) {
                            entry_points
                                .append_css(&self.bundled_files.keys()[dep.get() as usize])?;
                        } else {
                            entry_points.append_js(
                                &self.bundled_files.keys()[dep.get() as usize],
                                bake::Graph::Client,
                            )?;
                        }

                        it = entry.next_dependency.unwrap();
                    }

                    entry_points
                        .append_js(&self.bundled_files.keys()[index], bake::Graph::Client)?;
                }
                // When re-bundling SCBs, only bundle the server. Otherwise
                // the bundler gets confused and bundles both sides without
                // knowledge of the boundary between them.
                Content::Js(_) | Content::Unknown => {
                    if !data.is_hmr_root {
                        entry_points
                            .append_js(&self.bundled_files.keys()[index], bake::Graph::Client)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn reset(&mut self) {
        self.owner().graph_safety_lock.assert_locked();
        self.current_chunk_len = 0;
        self.current_css_files.clear();
        self.current_chunk_parts.clear();
    }
}

impl IncrementalGraph<Server> {
    pub fn invalidate(
        &mut self,
        paths: &[&[u8]],
        entry_points: &mut EntryPointList,
    ) -> Result<(), bun_core::Error> {
        self.owner().graph_safety_lock.assert_locked();
        for path in paths {
            let Some(index) = self.bundled_files.get_index(path) else {
                continue;
            };
            self.stale_files.set(index);
            let data = self.bundled_files.values()[index].unpack();
            let owned_path = &self.bundled_files.keys()[index];
            if data.is_rsc {
                entry_points.append_js(owned_path, bake::Graph::Server)?;
            }
            if data.is_ssr && !data.is_client_component_boundary {
                entry_points.append_js(owned_path, bake::Graph::Ssr)?;
            }
        }
        Ok(())
    }

    pub fn reset(&mut self) {
        self.owner().graph_safety_lock.assert_locked();
        self.current_chunk_len = 0;
        self.current_chunk_parts.clear(); // Box<[u8]> Drop frees each part
        self.current_chunk_source_maps.clear();
    }
}

// ───────────────────────────── takeJSBundle ─────────────────────────────

pub struct TakeJSBundleOptionsClient {
    pub kind: ChunkKind,
    pub script_id: SourceMapStore::Key,
    // TODO(port): lifetime — callers pass non-static path slices; Phase A forbids
    // struct lifetimes so `&'static [u8]` stands in for the borrowed `[]const u8`.
    pub initial_response_entry_point: &'static [u8],
    pub react_refresh_entry_point: &'static [u8],
    pub console_log: bool,
}
impl Default for TakeJSBundleOptionsClient {
    fn default() -> Self {
        Self {
            kind: ChunkKind::InitialResponse,
            script_id: SourceMapStore::Key::default(),
            initial_response_entry_point: b"",
            react_refresh_entry_point: b"",
            console_log: false,
        }
    }
}

pub struct TakeJSBundleOptionsServer {
    pub kind: ChunkKind,
    pub script_id: SourceMapStore::Key,
}

pub struct SourceMapGeneration {
    pub json: Box<[u8]>,
    pub mappings: bun_str::StringPointer,
    pub file_paths: Box<[Box<[u8]>]>,
}

impl IncrementalGraph<Client> {
    pub fn take_js_bundle(
        &mut self,
        options: &TakeJSBundleOptionsClient,
    ) -> Result<Box<[u8]>, bun_core::Error> {
        let mut chunk: Vec<u8> = Vec::new();
        self.take_js_bundle_to_list(&mut chunk, options)?;
        debug_assert!(chunk.len() == chunk.capacity());
        Ok(chunk.into_boxed_slice())
    }

    pub fn take_js_bundle_to_list(
        &mut self,
        list: &mut Vec<u8>,
        options: &TakeJSBundleOptionsClient,
    ) -> Result<(), bun_core::Error> {
        use std::io::Write as _;
        let kind = options.kind;
        self.owner().graph_safety_lock.assert_locked();
        // initial bundle needs at least the entry point
        // hot updates shouldn't be emitted if there are no chunks
        debug_assert!(self.current_chunk_len > 0);

        let runtime: HmrRuntime = match kind {
            ChunkKind::InitialResponse => bake::get_hmr_runtime(Side::Client),
            ChunkKind::HmrChunk => HmrRuntime::init(b"self[Symbol.for(\"bun:hmr\")]({\n"),
        };

        // A small amount of metadata is present at the end of the chunk
        // to inform the HMR runtime some crucial entry-point info. The
        // exact upper bound of this can be calculated, but is not to
        // avoid worrying about windows paths.
        // PERF(port): was stack-fallback (65536)
        let mut end_list: Vec<u8> = Vec::with_capacity(65536);
        let end: &[u8] = {
            let w = &mut end_list;
            match kind {
                ChunkKind::InitialResponse => {
                    w.extend_from_slice(b"}, {\n  main: ");
                    let initial_response_entry_point = options.initial_response_entry_point;
                    if !initial_response_entry_point.is_empty() {
                        let mut relative_path_buf = path_buffer_pool().get();
                        bun_js_parser::printer::write_json_string(
                            self.owner().relative_path(&mut *relative_path_buf, initial_response_entry_point),
                            w,
                            bun_js_parser::printer::Encoding::Utf8,
                        )?;
                    } else {
                        w.extend_from_slice(b"null");
                    }
                    w.extend_from_slice(
                        const_format::concatcp!(
                            ",\n  bun: \"",
                            bun_core::Global::PACKAGE_JSON_VERSION_WITH_CANARY,
                            "\""
                        )
                        .as_bytes(),
                    );
                    w.extend_from_slice(b",\n  generation: \"");
                    let generation: u32 = u32::try_from(options.script_id.get() >> 32).unwrap();
                    write!(w, "{:x}", bun_fmt::HexBytes(&generation.to_ne_bytes()))?;
                    w.extend_from_slice(b"\",\n  version: \"");
                    w.extend_from_slice(&self.owner().configuration_hash_key);

                    if options.console_log {
                        w.extend_from_slice(b"\",\n  console: true");
                    } else {
                        w.extend_from_slice(b"\",\n  console: false");
                    }

                    if !options.react_refresh_entry_point.is_empty() {
                        w.extend_from_slice(b",\n  refresh: ");
                        let mut relative_path_buf = path_buffer_pool().get();
                        bun_js_parser::printer::write_json_string(
                            self.owner().relative_path(&mut *relative_path_buf, options.react_refresh_entry_point),
                            w,
                            bun_js_parser::printer::Encoding::Utf8,
                        )?;
                    }
                    w.extend_from_slice(b"\n})");
                }
                ChunkKind::HmrChunk => {
                    w.extend_from_slice(b"}, \"");
                    // TODO(port): std.fmt.bytesToHex(asBytes(&script_id), .lower)
                    w.extend_from_slice(
                        bun_fmt::bytes_to_hex_lower(&options.script_id.get().to_ne_bytes()).as_bytes(),
                    );
                    w.extend_from_slice(b"\")");
                }
            }
            w.extend_from_slice(
                const_format::concatcp!("\n//# sourceMappingURL=", DevServer::CLIENT_PREFIX, "/")
                    .as_bytes(),
            );
            w.extend_from_slice(
                bun_fmt::bytes_to_hex_lower(&options.script_id.get().to_ne_bytes()).as_bytes(),
            );
            w.extend_from_slice(b".js.map\n");
            &end_list[..]
        };

        let start = list.len();
        if start == 0 {
            list.reserve_exact(self.current_chunk_len + runtime.code.len() + end.len());
        } else {
            list.reserve(self.current_chunk_len + runtime.code.len() + end.len());
        }

        list.extend_from_slice(runtime.code); // PERF(port): was assume_capacity
        for entry in &self.current_chunk_parts {
            // entry is an index into files
            // will return None if the chunk is a non-js (like css)
            let file = self.bundled_files.values()[entry.get() as usize].unpack();
            let Some(code) = file.js_code() else { continue };
            list.extend_from_slice(code); // PERF(port): was assume_capacity
        }
        list.extend_from_slice(end); // PERF(port): was assume_capacity

        if bun_core::FeatureFlags::BAKE_DEBUGGING_FEATURES {
            if let Some(dump_dir) = &self.owner().dump_dir {
                let rel_path_escaped: &[u8] = match kind {
                    ChunkKind::InitialResponse => b"latest_chunk.js",
                    ChunkKind::HmrChunk => b"latest_hmr.js",
                };
                if let Err(err) =
                    DevServer::dump_bundle(dump_dir, Side::Client, rel_path_escaped, &list[start..], false)
                {
                    // TODO(port): bun.handleErrorReturnTrace
                    Output::warn(format_args!("Could not dump bundle: {}", err.name()));
                }
            }
        }
        Ok(())
    }

    /// Uses `arena` as a temporary allocator, fills in all fields of `out` except ref_count
    pub fn take_source_map(
        &mut self,
        _arena: &bun_alloc::Arena,
        out: &mut SourceMapStore::Entry,
    ) -> Result<(), bun_alloc::AllocError> {
        let paths = self.bundled_files.keys();
        let files = self.bundled_files.values();

        let _buf = path_buffer_pool().get();

        let mut file_paths: Vec<*const [u8]> =
            Vec::with_capacity(self.current_chunk_parts.len());
        let mut contained_maps: MultiArrayList<PackedMap::Shared> = MultiArrayList::default();
        contained_maps.ensure_total_capacity(self.current_chunk_parts.len())?;

        let mut overlapping_memory_cost: usize = 0;

        for file_index in &self.current_chunk_parts {
            file_paths.push(&*paths[file_index.get() as usize] as *const [u8]); // PERF(port): was assume_capacity
            let source_map = files[file_index.get() as usize].unpack().source_map.clone();
            if let Some(map) = source_map.get() {
                overlapping_memory_cost += map.memory_cost();
            }
            contained_maps.push(source_map); // PERF(port): was assume_capacity
        }

        overlapping_memory_cost +=
            contained_maps.memory_cost() + DevServer::memory_cost_slice(&file_paths);

        let ref_count = out.ref_count;
        *out = SourceMapStore::Entry {
            dev_allocator: self.dev_allocator(),
            ref_count,
            paths: file_paths.into_boxed_slice(),
            files: contained_maps,
            overlapping_memory_cost: u32::try_from(overlapping_memory_cost).unwrap(),
        };
        Ok(())
    }
}

impl IncrementalGraph<Server> {
    pub fn take_js_bundle(
        &mut self,
        options: &TakeJSBundleOptionsServer,
    ) -> Result<Box<[u8]>, bun_core::Error> {
        let mut chunk: Vec<u8> = Vec::new();
        self.take_js_bundle_to_list(&mut chunk, options)?;
        debug_assert!(chunk.len() == chunk.capacity());
        Ok(chunk.into_boxed_slice())
    }

    pub fn take_js_bundle_to_list(
        &mut self,
        list: &mut Vec<u8>,
        options: &TakeJSBundleOptionsServer,
    ) -> Result<(), bun_core::Error> {
        let kind = options.kind;
        self.owner().graph_safety_lock.assert_locked();
        debug_assert!(self.current_chunk_len > 0);

        let runtime: HmrRuntime = match kind {
            ChunkKind::InitialResponse => bake::get_hmr_runtime(Side::Server),
            ChunkKind::HmrChunk => HmrRuntime::init(b"({"),
        };

        // PERF(port): was stack-fallback (65536)
        let mut end_list: Vec<u8> = Vec::with_capacity(65536);
        let end: &[u8] = {
            let w = &mut end_list;
            match kind {
                ChunkKind::InitialResponse => {
                    // if (comptime side == .server) @panic("unreachable");
                    unreachable!();
                }
                ChunkKind::HmrChunk => {
                    w.extend_from_slice(b"})");
                }
            }
            // (no sourceMappingURL footer on server side)
            #[allow(unreachable_code)]
            &end_list[..]
        };

        let start = list.len();
        if start == 0 {
            list.reserve_exact(self.current_chunk_len + runtime.code.len() + end.len());
        } else {
            list.reserve(self.current_chunk_len + runtime.code.len() + end.len());
        }

        list.extend_from_slice(runtime.code); // PERF(port): was assume_capacity
        for entry in &self.current_chunk_parts {
            // entry is the '[]const u8' itself
            list.extend_from_slice(entry); // PERF(port): was assume_capacity
        }
        list.extend_from_slice(end); // PERF(port): was assume_capacity

        if bun_core::FeatureFlags::BAKE_DEBUGGING_FEATURES {
            if let Some(dump_dir) = &self.owner().dump_dir {
                let rel_path_escaped: &[u8] = match kind {
                    ChunkKind::InitialResponse => b"latest_chunk.js",
                    ChunkKind::HmrChunk => b"latest_hmr.js",
                };
                if let Err(err) =
                    DevServer::dump_bundle(dump_dir, Side::Server, rel_path_escaped, &list[start..], false)
                {
                    Output::warn(format_args!("Could not dump bundle: {}", err.name()));
                }
            }
        }
        Ok(())
    }

    pub fn take_source_map(
        &mut self,
        _arena: &bun_alloc::Arena,
        out: &mut SourceMapStore::Entry,
    ) -> Result<(), bun_alloc::AllocError> {
        let paths = self.bundled_files.keys();

        let mut file_paths: Vec<*const [u8]> =
            Vec::with_capacity(self.current_chunk_parts.len());
        let mut contained_maps: MultiArrayList<PackedMap::Shared> = MultiArrayList::default();
        contained_maps.ensure_total_capacity(self.current_chunk_parts.len())?;

        let mut overlapping_memory_cost: u32 = 0;

        // For server, we use the tracked file indices to get the correct paths
        for item in &self.current_chunk_source_maps {
            file_paths.push(&*paths[item.file_index.get() as usize] as *const [u8]); // PERF(port): was assume_capacity
            contained_maps.push(item.source_map.clone()); // PERF(port): was assume_capacity
            overlapping_memory_cost += u32::try_from(item.source_map.memory_cost()).unwrap();
        }

        overlapping_memory_cost += u32::try_from(
            contained_maps.memory_cost() + DevServer::memory_cost_slice(&file_paths),
        )
        .unwrap();

        *out = SourceMapStore::Entry {
            dev_allocator: self.dev_allocator(),
            ref_count: out.ref_count,
            paths: file_paths.into_boxed_slice(),
            files: contained_maps,
            overlapping_memory_cost,
        };
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/IncrementalGraph.zig (2079 lines)
//   confidence: low
//   todos:      19
//   notes:      comptime side enum -> GraphSide trait + per-side impls; ClientFile.Packed punted to identity wrapper; several `match S::SIDE` arms use unsafe transmute to per-side Self — Phase B should split into proper specialized impls; @fieldParentPtr owner() needs per-side offset_of consts.
// ──────────────────────────────────────────────────────────────────────────
