// ══════════════════════════════════════════════════════════════════════════
// B-2 un-gated header — real `BundleV2` struct definition.
// resolver↔bundler cycle broken in O; `bun_resolver` is now a direct dep, so
// `Transpiler` (which embeds `Resolver`) is referenceable here. Method bodies
// remain in the gated `__phase_a_draft` module below until `LinkerContext`,
// `ParseTask`, `ThreadPool`, and the JSBundler/api TYPE_ONLY split land.
// ══════════════════════════════════════════════════════════════════════════

use core::ptr::NonNull;

use bun_collections::{ArrayHashMap, BabyList, StringHashMap};
use bun_core::ThreadLock;
use bun_logger as Logger;

// `bake_types` / `dispatch` are canonically defined in `__phase_a_draft` below
// (the full versions); re-exported here so the crate-root `lib.rs` modules and
// the outer `BundleV2` struct see exactly the same types as the impl bodies.
pub use __phase_a_draft::bake_types;
pub use __phase_a_draft::dispatch;
pub use __phase_a_draft::api;
pub use __phase_a_draft::{
    JSMeta, ImportData, ExportData, ImportTracker, DevServerOutput,
    EntryPoint, EntryPointKind, EntryPointList, generic_path_with_pretty_initialized,
};
pub use crate::ungate_support::RefImportData;
use self::bake_types as bake;

use crate::barrel_imports::{self, RequestedExports};
use crate::cache::ExternalFreeFunction;
use crate::options::{self, Target};
use crate::parse_task::{self, ResultValue as ParseResultValue};
use crate::transpiler::Transpiler;
use crate::ungate_support::{EventLoop, InputFileListExtMut, UseDirective};
pub use crate::DeferredBatchTask::DeferredBatchTask;
use crate::Graph::{Graph, InputFileListExt, SideEffects};
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
use crate::{Index, IndexInt, LinkerContext};

// ── re-exports for the B-1 inline `pub mod bundle_v2 { … }` shim surface ──
pub use crate::options::Loader;
pub use crate::ParseTask;
/// Stub: see gated `BundleThread` module (`BundleThread.zig` — owns the worker
/// pool + completion queue for `BundleV2`).
pub struct BundleThread(());

/// `jsc::api::JSBundler::Plugin` — re-exported from the canonical def below.
pub use api::JSBundler::Plugin as JSBundlerPlugin;

/// `BundleV2.JSBundleCompletionTask` — re-exported from the canonical def below.
pub use __phase_a_draft::JSBundleCompletionTask;

/// `jsc::api::JSBundler::FileMap` — re-exported from the canonical def below.
pub use api::JSBundler::FileMap;

#[derive(Clone, Copy)]
pub struct PendingImport {
    pub to_source_index: Index,
    pub import_record_index: u32,
}

pub struct BundleV2<'a> {
    // PORT NOTE: Zig stored `*Transpiler` (and aliased the same pointer into
    // `ssr_transpiler` when SSR graph isn't separate). `ssr_transpiler` stays
    // `*mut` so the alias is legal; `transpiler` is `&'a mut` for ergonomic
    // field access throughout the bundler bodies.
    pub transpiler: &'a mut Transpiler<'a>,
    /// When Server Components is enabled, this is used for the client bundles
    /// and `transpiler` is used for the server bundles.
    pub client_transpiler: Option<NonNull<Transpiler<'a>>>,
    /// See `bake.Framework.ServerComponents.separate_ssr_graph`.
    pub ssr_transpiler: *mut Transpiler<'a>,
    /// When Bun Bake is used, the resolved framework is passed here.
    pub framework: Option<bake::Framework>,
    pub graph: Graph,
    // Real `LinkerContext<'a>` (un-gated B-2). Borrows the same arena lifetime
    // as `transpiler` (Zig stored both as raw pointers into the bundler heap).
    pub linker: LinkerContext<'a>,
    // CYCLEBREAK GENUINE: `jsc::hot_reloader::NewHotReloader<BundleV2, …>` is a
    // T6 generic instantiated over a T5 type. SAFETY: erased — never deref'd here.
    pub bun_watcher: Option<NonNull<()>>,
    pub plugins: Option<NonNull<JSBundlerPlugin>>,
    pub completion: Option<*mut JSBundleCompletionTask>,
    /// CYCLEBREAK GENUINE: erased `bake::DevServer`. Populated from
    /// `transpiler.options.dev_server` + the runtime-registered vtable at
    /// construction. All ~15 DevServer call sites go through this.
    pub dev_server: Option<dispatch::DevServerHandle>,
    /// In-memory files that can be used as entrypoints or imported.
    /// This is a pointer to the FileMap in the completion config.
    pub file_map: Option<&'a FileMap>,
    pub source_code_length: usize,

    /// There is a race condition where an onResolve plugin may schedule a task
    /// on the bundle thread before its parsing task completes.
    pub resolve_tasks_waiting_for_import_source_index: ArrayHashMap<IndexInt, BabyList<PendingImport>>,

    /// Allocations not tracked by a threadlocal heap.
    pub free_list: Vec<Box<[u8]>>,

    /// See the comment in `Chunk.OutputPiece`.
    pub unique_key: u64,
    pub dynamic_import_entry_points: ArrayHashMap<IndexInt, ()>,
    pub has_on_parse_plugins: bool,

    pub finalizers: Vec<ExternalFreeFunction>,

    pub drain_defer_task: DeferredBatchTask,

    /// Set true by DevServer. Currently every usage of the transpiler (Bun.build
    /// and `bun build` CLI) runs at the top of an event loop. When this is true,
    /// a callback is executed after all work is complete (`finishFromBakeDevServer`).
    pub asynchronous: bool,
    pub thread_lock: ThreadLock,

    /// If false we can skip TLA validation and propagation.
    pub has_any_top_level_await_modules: bool,

    /// Barrel optimization: tracks which exports have been requested from each
    /// module encountered during barrel BFS. Keys are source indices. Values
    /// track requested export names for deduplication and cycle detection.
    /// Persists across calls to `scheduleBarrelDeferredImports` so cross-file
    /// deduplication is free.
    pub requested_exports: ArrayHashMap<u32, RequestedExports>,
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gated impl: lifecycle entry points (`init` skeleton, scan-counter
// machinery, `on_parse_task_complete`, `deinit_without_freeing_arena`). Method
// bodies are real where lower-tier surfaces exist; sub-regions that touch
// still-gated modules (`ThreadPool`, full `dispatch::DevServerVTable`,
// `ServerComponentParseTask`, `Watcher`) are ``-gated inline so
// the call shape is preserved verbatim and un-gates by deletion once those
// land. See `__phase_a_draft` below for the full reference bodies.
// ──────────────────────────────────────────────────────────────────────────

bun_core::declare_scope!(Bundle, visible);
bun_core::declare_scope!(scan_counter, visible);

/// `bundle_v2.zig` `ResolveQueue = std.StringArrayHashMap(*ParseTask)`.
/// Values are raw `*mut ParseTask` (arena-owned by `graph.heap`); the map only
/// dedups by path during a single `on_parse_task_complete` pass.
pub type ResolveQueue = StringHashMap<*mut ParseTask>;

/// `bundle_v2.zig:BakeOptions`.
pub struct BakeOptions<'a> {
    pub framework: bake::Framework,
    pub client_transpiler: NonNull<Transpiler<'a>>,
    pub ssr_transpiler: NonNull<Transpiler<'a>>,
    pub plugins: Option<NonNull<JSBundlerPlugin>>,
}

/// Argument struct for `patch_import_record_source_indices` — pulled out so the
/// borrow of `import_records` (a column of `graph.ast`) doesn't overlap the
/// `&mut self` the body needs for `path_to_source_index_map`.
pub struct PatchImportRecordsCtx<'s> {
    pub source_index: Index,
    pub source_path: &'s [u8],
    pub loader: Loader,
    pub target: options::Target,
    pub redirect_import_record_index: Option<u32>,
    pub force_save: bool,
}

impl<'a> BundleV2<'a> {
    // ── raw-ptr accessors ─────────────────────────────────────────────────
    // PORT NOTE: `transpiler`/`ssr_transpiler` are `*mut` because Zig stored
    // aliased `*Transpiler` (same pointer in both slots when no SSR graph).
    // Callers go through these accessors so the unsafe deref is centralized.
    #[inline]
    pub fn transpiler(&self) -> &Transpiler<'a> {
        &*self.transpiler
    }
    #[inline]
    pub fn transpiler_mut(&mut self) -> &mut Transpiler<'a> {
        &mut *self.transpiler
    }

    #[inline]
    pub fn r#loop(&mut self) -> &mut EventLoop {
        &mut self.linker.r#loop
    }

    #[inline]
    pub fn dev_server_handle(&self) -> Option<&dispatch::DevServerHandle> {
        self.dev_server.as_ref()
    }

    #[inline]
    pub fn path_to_source_index_map(&mut self, target: options::Target) -> &mut PathToSourceIndexMap {
        self.graph.path_to_source_index_map(target)
    }

    pub fn transpiler_for_target(&mut self, target: options::Target) -> &mut Transpiler<'a> {
        // SAFETY: all three pointers are live for `'a` (set in `init`); the
        // `client_transpiler` arm is only reached when bake populated it.
        // bundle_v2.zig:247-263 — outside of server-components / dev-server,
        // the only case that doesn't return the main transpiler is a
        // browser-target request from a server-side build, which lazily
        // spins up a client transpiler.
        if !self.transpiler.options.server_components && self.linker.dev_server.is_none() {
            if target == Target::Browser && self.transpiler.options.target.is_server_side() {
                if let Some(mut p) = self.client_transpiler {
                    // SAFETY: client_transpiler is live for `'a` (set in `init`).
                    return unsafe { p.as_mut() };
                }
                // bundle_v2.zig:250-252 — `client_transpiler orelse initializeClientTranspiler() catch panic`.
                // PORT NOTE: `initialize_client_transpiler` lives in the
                // gated draft below; until that un-gates, this path panics.
                panic!("Failed to initialize client transpiler: not yet wired");
            }
            return &mut *self.transpiler;
        }
        // SAFETY: all three pointers are live for `'a` (set in `init`); the
        // `client_transpiler` arm is only reached when bake populated it.
        unsafe {
            match target {
                Target::Browser => self.client_transpiler.unwrap().as_mut(),
                Target::BakeServerComponentsSsr => &mut *self.ssr_transpiler,
                _ => &mut *self.transpiler,
            }
        }
    }

    // PORT NOTE: draft `on_parse_task_complete` / `deinit_without_freeing_arena`
    // removed — canonical bodies live in the later impl blocks below.
}
// ══════════════════════════════════════════════════════════════════════════
// Phase-A draft body — gated until lower-tier crate surfaces solidify.
// (`bun_fs`/`bun_str`/`bun_node_fallbacks` crate aliases, full `dispatch`
// vtable slot set, `api::JSBundler` TYPE_ONLY split, `LinkerContext`,
// `ParseTask`, `ThreadPool`, OUT_DIR codegen for HmrRuntime embeds.)
// ══════════════════════════════════════════════════════════════════════════

pub mod __phase_a_draft {
// This is Bun's JavaScript/TypeScript bundler
//
// A lot of the implementation is based on the Go implementation of esbuild. Thank you Evan Wallace.
//
// # Memory management
//
// Zig is not a managed language, so we have to be careful about memory management.
// Manually freeing memory is error-prone and tedious, but garbage collection
// is slow and reference counting incurs a performance penalty.
//
// Bun's bundler relies on mimalloc's threadlocal heaps as arena allocators.
//
// When a new thread is spawned for a bundling job, it is given a threadlocal
// heap and all allocations are done on that heap. When the job is done, the
// threadlocal heap is destroyed and all memory is freed.
//
// There are a few careful gotchas to keep in mind:
//
// - A threadlocal heap cannot allocate memory on a different thread than the one that
//   created it. You will get a segfault if you try to do that.
//
// - Since the heaps are destroyed at the end of bundling, any globally shared
//   references to data must NOT be allocated on a threadlocal heap.
//
//   For example, package.json and tsconfig.json read from the filesystem must be
//   use the global allocator (bun.default_allocator) because bun's directory
//   entry cache and module resolution cache are globally shared across all
//   threads.
//
//   Additionally, `LinkerContext`'s allocator is also threadlocal.
//
// - Globally allocated data must be in a cache & reused, or we will create an infinite
//   memory leak over time. To do that, we have a DirnameStore, FilenameStore, and the other
//   data structures related to `BSSMap`. This still leaks memory, but not very
//   much since it only allocates the first time around.
//
// In development, it is strongly recommended to use either a debug build of
// mimalloc or Valgrind to help catch memory issues
// To use a debug build of mimalloc:
//
//     make mimalloc-debug
//

use core::ffi::c_void;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_core::{self as bun, Environment, FeatureFlags, Output, Error};
use crate::transpiler::Transpiler;
use crate::ungate_support::bun_str::strings;
use bun_alloc::{Arena as ThreadLocalArena, AllocError};
use bun_collections::{BabyList, MultiArrayList, ArrayHashMap, StringHashMap, StringArrayHashMap, DynamicBitSet, DynamicBitSetUnmanaged};
use bun_logger as Logger;
use bun_js_parser::{self as js_ast, Ref, Symbol, Stmt, Expr, E, S, G, B, Binding, Scope, Part, Dependency};
use crate::Index;
use crate::ungate_support::JSAst;
use bun_js_parser::ServerComponentBoundary;
use bun_js_parser::ast::server_component_boundary;
use bun_options_types::{ImportRecord, ImportKind};
use crate::ungate_support::bun_fs as Fs;
use crate::ungate_support::{bun_fs, bun_css, import_record};
use bun_resolver::DataURL;
use crate::ungate_support::bun_node_fallbacks as NodeFallbackModules;
use bun_resolver::{self as _resolver, Resolver, is_package_path};
use bun_threading::ThreadPool as ThreadPoolLib;
use crate::options_impl::{TargetExt, LoaderExt};
use crate::Graph::{InputFileListExt, InputFileSliceExt as _};
use bun_js_parser::ast::bundled_ast::{BundledAstListExt as _, BundledAstSliceExt as _};
use bun_js_parser::ast::server_component_boundary::{
    ServerComponentBoundaryListExt as _, ServerComponentBoundarySliceExt as _,
};
// TODO(b0): bake_types arrives from move-in (TYPE_ONLY Side/Graph/BuiltInModule/Framework → bundler)
use self::bake_types as bake;

/// CYCLEBREAK(b0) TYPE_ONLY: pure value types from bake that bundler needs without
/// depending on the full DevServer. Move-in pass keeps these as the canonical defs;
/// bun_bake (post tier-6 collapse: bun_runtime::bake) re-exports from here.
pub mod bake_types {
    /// Mirrors src/bake/lib.zig `Side`.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Side { Client = 0, Server = 1 }
    /// Mirrors src/bake/lib.zig `Graph`.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Graph { Client = 0, Server = 1, Ssr = 2 }
    /// Zig `@tagName(graph)` — used for the per-file `// path (target)` comment
    /// in postProcessJSChunk and friends.
    impl From<Graph> for &'static str {
        fn from(g: Graph) -> Self {
            match g {
                Graph::Client => "client",
                Graph::Server => "server",
                Graph::Ssr => "ssr",
            }
        }
    }
    impl Side {
        pub fn graph(self) -> Graph {
            match self { Side::Client => Graph::Client, Side::Server => Graph::Server }
        }
    }
    /// Mirrors src/bake/DevServer.zig `FileKind` (the type of `CacheEntry.kind`).
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum CacheKind { Unknown = 0, Js = 1, Asset = 2, Css = 3 }
    #[derive(Copy, Clone)]
    pub struct CacheEntry { pub kind: CacheKind }
    /// Mirrors src/bake/DevServer.zig `ASSET_PREFIX` (= INTERNAL_PREFIX ++ "/asset" = "/_bun/asset").
    pub const ASSET_PREFIX: &str = "/_bun/asset";

    /// Mirrors src/bake/bake.zig:355 `BuiltInModule = union(enum)`. TYPE_ONLY moved
    /// down to bundler (T5); bake (in runtime, T6) constructs values of this type.
    pub enum BuiltInModule {
        Import(Box<[u8]>),
        Code(Box<[u8]>),
    }

    /// Mirrors src/bake/DevServer.zig `EntryPointList.Flags` (`packed struct(u8)`).
    #[repr(transparent)]
    #[derive(Copy, Clone, Default, Eq, PartialEq)]
    pub struct EntryPointFlags(pub u8);
    impl EntryPointFlags {
        pub const CLIENT: u8 = 1 << 0;
        pub const SERVER: u8 = 1 << 1;
        pub const SSR: u8 = 1 << 2;
        /// When set, `.CLIENT` is also set.
        pub const CSS: u8 = 1 << 3;
        #[inline] pub fn client(self) -> bool { self.0 & Self::CLIENT != 0 }
        #[inline] pub fn server(self) -> bool { self.0 & Self::SERVER != 0 }
        #[inline] pub fn ssr(self) -> bool { self.0 & Self::SSR != 0 }
        #[inline] pub fn css(self) -> bool { self.0 & Self::CSS != 0 }
    }

    /// Mirrors src/bake/DevServer.zig `EntryPointList`. TYPE_ONLY moved down; bundler
    /// reads `.set` (count/keys/values) in `enqueue_entry_points_dev_server`.
    #[derive(Default)]
    pub struct EntryPointList {
        pub set: bun_collections::StringArrayHashMap<EntryPointFlags>,
    }
    impl EntryPointList {
        pub fn empty() -> Self { Self { set: bun_collections::StringArrayHashMap::new() } }
    }

    /// Mirrors src/bake/bake.zig `Framework`. Only the field bundler reads
    /// (ParseTask.rs:958 `f.built_in_modules.get(...)`); remaining fields stay opaque
    /// until tier-6 collapse lands the full struct in bun_runtime.
    pub struct Framework {
        pub built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
        /// Mirrors `Framework.server_components`. TYPE_ONLY: only the two
        /// flags the bundler reads.
        pub server_components: Option<ServerComponents>,
        /// Mirrors `Framework.is_built_in_react` — read by
        /// `linker_context::generateChunksInParallel` to gate `BakeExtra`.
        pub is_built_in_react: bool,
        /// Read by `entry_points.rs` (FallbackEntryPoint/ClientEntryPoint::generate).
        /// In Zig this lives on the legacy package_json `Framework`; the duck-typed
        /// `comptime TranspilerType` callers reach it through `options.framework.?`.
        pub client_css_in_js: crate::options::ClientCssInJs,
        // TODO(b0-genuine): remaining Framework fields (react_fast_refresh,
        // file_system_router_types, ...) — bundler does not read them; bake constructs.
        _opaque_tail: (),
    }
    /// Mirrors src/bake/bake.zig `Framework.ServerComponents` — TYPE_ONLY subset.
    #[derive(Default, Clone)]
    pub struct ServerComponents {
        pub separate_ssr_graph: bool,
        pub server_runtime_import: Box<[u8]>,
        pub server_register_client_reference: Box<[u8]>,
    }

    /// Mirrors src/bake/bake.zig:840 `HmrRuntime`. TYPE_ONLY moved down so the
    /// linker can splice the runtime preamble without depending on bun_bake.
    #[derive(Clone, Copy)]
    pub struct HmrRuntime {
        pub code: &'static [u8],
        /// Precomputed `\n` count — sourcemap generation skips this many lines.
        pub line_count: u32,
    }
    impl HmrRuntime {
        pub const fn init(code: &'static [u8]) -> Self {
            // const-fn line counter (mirrors `std.mem.count(u8, code, "\n")`).
            let mut n: u32 = 0;
            let mut i = 0usize;
            while i < code.len() {
                if code[i] == b'\n' { n += 1; }
                i += 1;
            }
            Self { code, line_count: n }
        }
    }
    /// Alias used at the crate root (`crate::HmrRuntimeSide`); identical to `Side`.
    pub type HmrRuntimeSide = Side;

    /// Mirrors src/bake/bake.zig:855 `getHmrRuntime`. MOVE_DOWN bake→bundler.
    /// Embed bytes are produced by codegen (`bake.client.js` / `bake.server.js`);
    /// in dev builds those came from `runtimeEmbedFile` (lazy disk read), which is
    /// a tier-6 hook — the static fallback here uses `include_bytes!` so the
    /// linker has a real preamble even before runtime registers a loader.
    #[inline]
    pub fn get_hmr_runtime(side: Side) -> HmrRuntime {
        // PORT NOTE: `OUT_DIR` codegen for `bake.client.js` / `bake.server.js`
        // is not wired in the Rust build yet. Embed empty preambles; the runtime
        // (T6) registers a loader at init that supersedes this.
        match side {
            Side::Client => HmrRuntime::init(b"// bake.client.js (placeholder)\n"),
            Side::Server => HmrRuntime::init(b"// bake.server.js (placeholder)\n"),
        }
    }

    /// Mirrors src/bake/bake.zig:936 `server_virtual_source` / :942 `client_virtual_source`.
    /// `Logger::Source` is not `const`-constructible (owns a `fs::Path`), so these
    /// are lazy statics. PERF(port): was `pub const` — verify in Phase B.
    pub static SERVER_VIRTUAL_SOURCE: std::sync::LazyLock<bun_logger::Source> =
        std::sync::LazyLock::new(|| {
            let mut s = bun_logger::Source::default();
            // Port of `Fs.Path.initForKitBuiltIn("bun", "bake/server")` (fs.zig:1992) —
            // inlined because `bun_logger::fs::Path` is the local TYPE_ONLY stub and
            // does not yet expose that constructor.
            s.path = bun_logger::fs::Path {
                pretty: b"bun:bake/server",
                text: b"_bun/bake/server",
                namespace: b"bun",
                name: bun_logger::fs::PathName::init(b"bake/server"),
                is_disabled: false,
                is_symlink: true,
            };
            s.index = bun_logger::Index(crate::Index::BAKE_SERVER_DATA.get());
            s
        });
    pub static CLIENT_VIRTUAL_SOURCE: std::sync::LazyLock<bun_logger::Source> =
        std::sync::LazyLock::new(|| {
            let mut s = bun_logger::Source::default();
            s.path = bun_logger::fs::Path {
                pretty: b"bun:bake/client",
                text: b"_bun/bake/client",
                namespace: b"bun",
                name: bun_logger::fs::PathName::init(b"bake/client"),
                is_disabled: false,
                is_symlink: true,
            };
            s.index = bun_logger::Index(crate::Index::BAKE_CLIENT_DATA.get());
            s
        });
    /// Alias kept for callers that referenced the DevServer constant name directly.
    pub const DEV_SERVER_ASSET_PREFIX: &str = ASSET_PREFIX;

    /// TYPE_ONLY mirror of src/bake/production.zig:844 `EntryPointMap`. The bundler
    /// only reads `.root` and iterates `.files` (key → InputFile, value →
    /// OutputFile.Index); router-integration methods stay in bun_runtime::bake.
    pub mod production {
        use super::Side;

        /// `OpaqueFileId` is the index into `files`.
        #[repr(transparent)]
        #[derive(Copy, Clone, Eq, PartialEq, Hash)]
        pub struct OpaqueFileId(pub u32);
        impl OpaqueFileId {
            #[inline] pub const fn init(i: u32) -> Self { Self(i) }
            #[inline] pub const fn get(self) -> u32 { self.0 }
        }

        /// Mirrors `EntryPointMap.InputFile` (raw ptr+len so `Side` packs in the
        /// trailing word — keeps the 16-byte key layout the Zig hasher relies on).
        #[derive(Copy, Clone)]
        pub struct InputFile {
            abs_path_ptr: *const u8,
            abs_path_len: u32,
            pub side: Side,
        }
        // SAFETY: abs_path_ptr borrows arena-owned bytes that outlive the map; the
        // map itself is single-producer (bake build thread) per Zig contract.
        unsafe impl Send for InputFile {}
        unsafe impl Sync for InputFile {}
        impl InputFile {
            #[inline]
            pub fn init(abs_path: &[u8], side: Side) -> Self {
                Self { abs_path_ptr: abs_path.as_ptr(), abs_path_len: abs_path.len() as u32, side }
            }
            #[inline]
            pub fn abs_path(&self) -> &[u8] {
                // SAFETY: ptr/len were derived from a slice in `init`; the backing
                // allocation is owned by `EntryPointMap` (duped on insert).
                unsafe { core::slice::from_raw_parts(self.abs_path_ptr, self.abs_path_len as usize) }
            }
        }
        impl core::hash::Hash for InputFile {
            fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
                state.write(self.abs_path());
                state.write_u8(self.side as u8);
            }
        }
        impl PartialEq for InputFile {
            fn eq(&self, other: &Self) -> bool {
                self.side == other.side && self.abs_path() == other.abs_path()
            }
        }
        impl Eq for InputFile {}

        /// Value side is `OutputFile.Index` (u32) — left uninitialized until the
        /// bundle is indexed, so the bundler treats it as opaque.
        pub type OutputFileIndex = u32;

        #[derive(Default)]
        pub struct EntryPointMap {
            pub root: Box<[u8]>,
            /// `OpaqueFileId` is the insertion index into this map.
            pub files: bun_collections::ArrayHashMap<InputFile, OutputFileIndex>,
        }
        impl EntryPointMap {
            /// Mirrors `getOrPutEntryPoint`. Dupes `abs_path` on first insert.
            pub fn get_or_put_entry_point(
                &mut self,
                abs_path: &[u8],
                side: Side,
            ) -> Result<OpaqueFileId, bun_core::Error> {
                let k = InputFile::init(abs_path, side);
                let gop = self.files.get_or_put(k)?;
                if !gop.found_existing {
                    let owned: Box<[u8]> = abs_path.to_vec().into_boxed_slice();
                    // SAFETY: leak the box so the raw ptr in `InputFile` stays valid
                    // for the map's lifetime (mirrors Zig `allocator.dupe` ownership).
                    let leaked: &'static [u8] = Box::leak(owned);
                    *gop.key_ptr = InputFile::init(leaked, side);
                }
                Ok(OpaqueFileId::init(gop.index as u32))
            }
        }
    }
}
// TODO(b0): jsc::api arrives from move-in (TYPE_ONLY → bundler)
use self::api as jsc_api;

/// CYCLEBREAK(b0) TYPE_ONLY: data-only halves of `jsc::api::JSBundler` and
/// `jsc::api::BuildArtifact` that the bundler reads/constructs without touching
/// JSC. The JS-thread halves (dispatch onto the JS event loop, `toJS`, plugin
/// FFI bodies) stay in tier-6 (`bun_runtime::api`) and re-export these.
pub mod api {
    /// Mirrors src/runtime/api/JSBundler.zig:1799 `BuildArtifact.OutputKind`.
    pub mod build_artifact {
        #[repr(u8)]
        #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
        pub enum OutputKind {
            #[default]
            Chunk = 0,
            Asset,
            EntryPoint,
            Sourcemap,
            Bytecode,
            ModuleInfo,
            MetafileJson,
            MetafileMarkdown,
        }
        impl OutputKind {
            #[inline]
            pub fn is_file_in_standalone_mode(self) -> bool {
                !matches!(
                    self,
                    OutputKind::Sourcemap
                        | OutputKind::Bytecode
                        | OutputKind::ModuleInfo
                        | OutputKind::MetafileJson
                        | OutputKind::MetafileMarkdown
                )
            }
            /// String form used by `BuildArtifact.getOutputKind` (`@tagName`).
            pub fn as_str(self) -> &'static str {
                match self {
                    OutputKind::Chunk => "chunk",
                    OutputKind::Asset => "asset",
                    OutputKind::EntryPoint => "entry-point",
                    OutputKind::Sourcemap => "sourcemap",
                    OutputKind::Bytecode => "bytecode",
                    OutputKind::ModuleInfo => "module_info",
                    OutputKind::MetafileJson => "metafile-json",
                    OutputKind::MetafileMarkdown => "metafile-markdown",
                }
            }
        }
    }

    /// Mirrors src/runtime/api/JSBundler.zig:3 `JSBundler` — TYPE_ONLY subset.
    /// Exposed as a module (not a struct) so callers can write
    /// `api::JSBundler::Load` / `api::JSBundler::Resolve::MiniImportRecord`.
    #[allow(non_snake_case)]
    pub mod JSBundler {
        use bun_options_types::ImportKind;
        use crate::options::{Loader, Target};
        use crate::options_impl::TargetExt;
        use crate::parse_task::ParseTask;
        use super::super::BundleV2;

        /// `Plugin = opaque {}` — backed by C++ `BunPlugin`. The bundler only
        /// calls `has_any_matches` / `match_on_load` / `match_on_resolve`,
        /// which are `extern "C"` entry points; the body lives in T6.
        #[repr(C)]
        pub struct Plugin {
            _opaque: [u8; 0],
        }
        unsafe extern "C" {
            #[link_name = "JSBundlerPlugin__anyMatchesCrossingBoundaries"]
            fn JSBundlerPlugin__anyMatches(this: *const Plugin, path: *const crate::ungate_support::bun_fs::Path, is_on_load: bool) -> bool;
        }
        impl Plugin {
            #[inline]
            pub fn has_any_matches(&self, path: &crate::ungate_support::bun_fs::Path, is_on_load: bool) -> bool {
                // SAFETY: `self` is a live opaque C++ BunPlugin; FFI signature matches.
                unsafe { JSBundlerPlugin__anyMatches(self, path, is_on_load) }
            }
        }

        /// Mirrors `JSBundler.FileMap` — virtual in-memory files for the build.
        /// The Zig value type is `jsc.Node.BlobOrStringOrBuffer` (T6); bundler
        /// only ever reads `.slice()`, so the moved-down map stores raw bytes
        /// and T6 owns the JSC handle that keeps those bytes alive.
        #[derive(Default)]
        pub struct FileMap {
            pub map: bun_collections::StringHashMap<Box<[u8]>>,
        }
        impl FileMap {
            pub fn get(&self, specifier: &[u8]) -> Option<&[u8]> {
                if self.map.is_empty() { return None; }
                #[cfg(not(windows))]
                { self.map.get(specifier).map(|b| b.as_ref()) }
                #[cfg(windows)]
                {
                    let mut buf = bun_paths::path_buffer_pool::get();
                    let normalized = bun_paths::resolve_path::path_to_posix_buf(specifier, &mut **buf);
                    let r = self.map.get(normalized).map(|b| b.as_ref());
                    drop(buf);
                    r
                }
            }
            #[inline]
            pub fn contains(&self, specifier: &[u8]) -> bool { self.get(specifier).is_some() }
            /// Minimal `resolve` — bundler only needs the owned key back so it
            /// can build a `Resolver::Result` around it.
            pub fn resolve(&self, _source_file: &[u8], specifier: &[u8]) -> Option<bun_resolver::Result> {
                if self.map.is_empty() { return None; }
                let (key, _) = self.map.get_key_value(specifier)?;
                // SAFETY: Zig `getKey` returns the map-owned key slice; the Rust
                // `bun_resolver::Result` stores `Path<'static>` as the porting
                // convention for Zig `[]const u8` fields. The borrow is valid for
                // the lifetime of `self.map` — callers must not outlive the
                // `FileMap`. PERF(port): revisit once `Result` is lifetime-generic.
                let key: &'static [u8] =
                    unsafe { core::mem::transmute::<&[u8], &'static [u8]>(key.as_ref()) };
                Some(bun_resolver::Result {
                    path_pair: bun_resolver::PathPair {
                        primary: crate::ungate_support::bun_fs::Path::init_with_namespace(key, b"file"),
                        ..Default::default()
                    },
                    ..Default::default()
                })
            }
        }

        /// Mirrors `JSBundler.Resolve.MiniImportRecord` (zig:1242).
        #[derive(Clone, Default)]
        pub struct MiniImportRecord {
            pub kind: ImportKind,
            pub source_file: Box<[u8]>,
            pub namespace: Box<[u8]>,
            pub specifier: Box<[u8]>,
            pub importer_source_index: u32,
            pub import_record_index: u32,
            pub range: bun_logger::Range,
            pub original_target: Target,
        }

        /// Mirrors `JSBundler.Resolve.Value.success` payload.
        #[derive(Clone, Default)]
        pub struct ResolveSuccess {
            pub path: Box<[u8]>,
            pub namespace: Box<[u8]>,
            pub external: bool,
        }
        /// Mirrors `JSBundler.Resolve.Value` (`union(enum)`).
        #[derive(Default)]
        pub enum ResolveValue {
            Err(bun_logger::Msg),
            Success(ResolveSuccess),
            NoMatch,
            #[default]
            Pending,
            Consumed,
        }
        impl ResolveValue {
            #[inline]
            pub fn consume(&mut self) -> ResolveValue {
                core::mem::replace(self, ResolveValue::Consumed)
            }
        }

        /// Mirrors `JSBundler.Resolve` (zig:1234). `js_task`/`task` slots are
        /// erased — T6 (`bun_runtime`) writes its concrete `jsc::AnyTask` /
        /// `AnyEventLoop::Task` via `dispatch()` and never reads them here.
        pub struct Resolve {
            pub bv2: *mut BundleV2<'static>,
            pub import_record: MiniImportRecord,
            pub value: ResolveValue,
            // SAFETY: erased `jsc::AnyTask` / `jsc::AnyEventLoop::Task` storage.
            // Layout reserved so T6 can `cast` and fill in-place.
            pub js_task: [usize; 2],
            pub task: [usize; 4],
        }
        impl Default for Resolve {
            fn default() -> Self {
                Self {
                    bv2: core::ptr::null_mut(),
                    import_record: MiniImportRecord::default(),
                    value: ResolveValue::Pending,
                    js_task: [0; 2],
                    task: [0; 4],
                }
            }
        }
        impl Resolve {
            pub fn init(bv2: &mut BundleV2<'_>, record: MiniImportRecord) -> Self {
                Self {
                    // SAFETY: lifetime erased — Resolve is owned by the dispatch
                    // chain and never outlives `bv2` (mirrors Zig raw `*BundleV2`).
                    bv2: bv2 as *mut BundleV2<'_> as *mut BundleV2<'static>,
                    import_record: record,
                    value: ResolveValue::Pending,
                    js_task: [0; 2],
                    task: [0; 4],
                }
            }
            /// Hops to the JS thread via the registered event-loop hook. The
            /// actual `runOnJSThread` body (which calls into the C++ plugin)
            /// is owned by T6; here we hand the boxed `Resolve` to it.
            pub fn dispatch(&mut self) {
                let hook = super::super::dispatch::PLUGIN_RESOLVE_HOOK
                    .load(core::sync::atomic::Ordering::Acquire);
                if !hook.is_null() {
                    // SAFETY: hook was registered by runtime with matching sig.
                    unsafe { (*hook)(self) };
                }
            }
        }

        /// Mirrors `JSBundler.Load.Value.success` payload.
        #[derive(Clone, Default)]
        pub struct LoadSuccess {
            pub source_code: Box<[u8]>,
            pub loader: Loader,
        }
        /// Mirrors `JSBundler.Load.Value` (`union(enum)`).
        #[derive(Default)]
        pub enum LoadValue {
            Err(bun_logger::Msg),
            Success(LoadSuccess),
            #[default]
            Pending,
            NoMatch,
            Consumed,
        }
        impl LoadValue {
            #[inline]
            pub fn consume(&mut self) -> LoadValue {
                core::mem::replace(self, LoadValue::Consumed)
            }
        }

        /// Mirrors `JSBundler.Load` (zig:1369).
        pub struct Load {
            pub bv2: *mut BundleV2<'static>,
            pub source_index: bun_js_parser::Index,
            pub default_loader: Loader,
            pub path: Box<[u8]>,
            pub namespace: Box<[u8]>,
            pub value: LoadValue,
            pub parse_task: *mut ParseTask,
            /// Faster path: skip the extra threadpool dispatch when the file is not found.
            pub was_file: bool,
            /// Defer may only be called once.
            pub called_defer: bool,
            // SAFETY: erased `jsc::AnyTask` / `jsc::AnyEventLoop::Task` storage.
            pub js_task: [usize; 2],
            pub task: [usize; 4],
        }
        impl Load {
            pub fn init(bv2: &mut BundleV2<'_>, parse: &mut ParseTask) -> Self {
                let default_loader = parse
                    .path
                    .loader(&bv2.transpiler.options.loaders)
                    .unwrap_or(Loader::Js);
                Self {
                    bv2: bv2 as *mut BundleV2<'_> as *mut BundleV2<'static>,
                    parse_task: parse,
                    source_index: parse.source_index,
                    default_loader,
                    value: LoadValue::Pending,
                    path: parse.path.text.to_vec().into_boxed_slice(),
                    namespace: parse.path.namespace.to_vec().into_boxed_slice(),
                    was_file: false,
                    called_defer: false,
                    js_task: [0; 2],
                    task: [0; 4],
                }
            }
            #[inline]
            pub fn bake_graph(&self) -> crate::bake_types::Graph {
                // SAFETY: parse_task is live for the duration of the load.
                unsafe { (*self.parse_task).known_target.bake_graph() }
            }
            pub fn dispatch(&mut self) {
                let hook = super::super::dispatch::PLUGIN_LOAD_HOOK
                    .load(core::sync::atomic::Ordering::Acquire);
                if !hook.is_null() {
                    // SAFETY: hook was registered by runtime with matching sig.
                    unsafe { (*hook)(self) };
                }
            }
        }
    }
}

/// CYCLEBREAK(b0) TYPE_ONLY: `SavedFile` is a unit struct in Zig
/// (src/bundler_jsc/output_file_jsc.zig:4) — its only member is `toJS`, which
/// is JSC-bound and stays in T6. The bundler stores it as an `OutputFile` value
/// tag, so a unit struct here is sufficient.
pub mod saved_file {
    #[derive(Default, Clone, Copy)]
    pub struct SavedFile;
}

// ── crate-root re-exports for forward-refs left by move-out ───────────────
pub use crate::cache::RuntimeTranspilerCache;
pub use self::bake_types::{get_hmr_runtime, HmrRuntimeSide};
/// `crate::bundle_v2::JSBundlerPlugin` — see BundleThread.rs.
pub type JSBundlerPlugin = self::api::JSBundler::Plugin;
pub type FileMap = self::api::JSBundler::FileMap;

use bun_sourcemap as SourceMap;
use bun_paths as resolve_path;

use crate::options::{self, Loader, Target};
use crate::Graph::Graph;
use crate::LinkerContext;
use crate::linker_graph::LinkerGraph;
use crate::parse_task::{self, ParseTask};
use crate::thread_pool::ThreadPool;
use crate::DeferredBatchTask::DeferredBatchTask;
use crate::ServerComponentParseTask::ServerComponentParseTask;
use crate::AstBuilder::AstBuilder;
use crate::chunk::{self, Chunk, ChunkImport};
use crate::cache::Entry as CacheEntry;
use crate::PathToSourceIndexMap::PathToSourceIndexMap;
use crate::barrel_imports;
use crate::ungate_support::entry_point;

pub use crate::BundleThread::BundleThread;

bun_core::declare_scope!(part_dep_tree, visible);
bun_core::declare_scope!(Bundle, visible);
bun_core::declare_scope!(scan_counter, visible);
bun_core::declare_scope!(ReachableFiles, visible);
bun_core::declare_scope!(TreeShake, hidden);
bun_core::declare_scope!(PartRanges, hidden);
bun_core::declare_scope!(ContentHasher, hidden);
// Zig: `bun.Output.scoped(.watcher, .visible)` — lowercase to avoid colliding
// with the `Watcher` type alias (hot-reloader handle) in this module.
bun_core::declare_scope!(watcher, visible);

pub type MangledProps = ArrayHashMap<Ref, Box<[u8]>>;

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK §Dispatch — vtables/hooks for T6 GENUINE deps (jsc/bake/runtime).
// Low tier (bundler) names no high-tier types. High tier (runtime) provides
// static instances and registers hooks at init. See PORTING.md §Dispatch.
// ══════════════════════════════════════════════════════════════════════════
pub mod dispatch {
    use core::sync::atomic::AtomicPtr;
    use core::ptr::null_mut;

    /// Erased handle to bake::DevServer. PERF(port): was direct struct access.
    #[derive(Copy, Clone)]
    pub struct DevServerHandle {
        pub owner: *mut (),
        pub vtable: &'static DevServerVTable,
    }
    // SAFETY: `owner` is an erased `*mut bake::DevServer` — the Zig side passes it
    // across the worker pool freely (DevServer is the single-instance coordinator
    // and its methods take `*DevServer`). The vtable is `&'static`. Marking the
    // handle `Send + Sync` matches the Zig threading model; callee fns are
    // responsible for any internal synchronization.
    unsafe impl Send for DevServerHandle {}
    unsafe impl Sync for DevServerHandle {}
    pub struct DevServerVTable {
        pub barrel_needed_exports:
            unsafe fn(*mut ()) -> *mut bun_collections::StringHashMap<bun_collections::StringHashMap<()>>,
        pub log_for_resolution_failures:
            unsafe fn(*mut (), &[u8], super::bake_types::Graph) -> *mut bun_logger::Log,
        /// `dev.finalizeBundle(bv2, result)` — DevServer.zig:2239.
        pub finalize_bundle:
            unsafe fn(*mut (), *mut super::BundleV2, *const super::DevServerOutput<'_>) -> Result<(), bun_core::Error>,
        // ── slots below cover every remaining direct DevServer access in bundler ──
        /// `dev.handleParseTaskFailure(err, graph, abs_path, log, bv2)` — DevServer.zig:3063.
        pub handle_parse_task_failure:
            unsafe fn(*mut (), err: bun_core::Error, graph: super::bake_types::Graph, abs_path: &[u8], log: *const bun_logger::Log, bv2: *mut super::BundleV2) -> Result<(), bun_core::Error>,
        /// `dev.putOrOverwriteAsset(path, contents, hash)` — DevServer.zig:4398.
        /// `path` is `&fs::Path` erased; `contents` is the raw bytes (runtime impl
        /// wraps into `AnyBlob`). Ownership of contents transfers to the callee.
        pub put_or_overwrite_asset:
            unsafe fn(*mut (), path: *const (), contents: &[u8], content_hash: u64) -> Result<(), bun_core::Error>,
        /// `dev.track_resolution_failure(...)`
        pub track_resolution_failure:
            unsafe fn(*mut (), import_source: &[u8], specifier: &[u8], renderer: super::bake_types::Graph, loader: bun_options_types::Loader) -> Result<(), bun_core::Error>,
        /// `dev.is_file_cached(abs_path, side)` — None if not cached.
        pub is_file_cached:
            unsafe fn(*mut (), abs_path: &[u8], side: super::bake_types::Graph) -> Option<super::bake_types::CacheEntry>,
        /// `dev.assets.get_hash(abs_path)`
        pub asset_hash: unsafe fn(*mut (), abs_path: &[u8]) -> Option<u64>,
        /// `dev.current_bundle.?.start_data` accessor for finish_from_bake_dev_server.
        pub current_bundle_start_data: unsafe fn(*mut ()) -> *const (),
        /// `dev.barrel_files_with_deferrals.get_or_put(path)` + key dupe.
        pub register_barrel_with_deferrals: unsafe fn(*mut (), path: &[u8]) -> Result<(), bun_core::Error>,
        /// `dev.barrel_needed_exports.get_or_put(path).get_or_put(alias)` — wraps the
        /// full body of `barrel_imports.zig:persistBarrelExport` so the bundler crate
        /// doesn't name DevServer.
        pub register_barrel_export: unsafe fn(*mut (), barrel_path: &[u8], alias: &[u8]),
    }
    impl DevServerHandle {
        #[inline]
        pub fn handle_parse_task_failure(
            &self,
            err: bun_core::Error,
            graph: super::bake_types::Graph,
            abs_path: &[u8],
            log: *const bun_logger::Log,
            bv2: *mut super::BundleV2,
        ) -> Result<(), bun_core::Error> {
            // SAFETY: owner is a live *mut DevServer per handle invariant.
            unsafe { (self.vtable.handle_parse_task_failure)(self.owner, err, graph, abs_path, log, bv2) }
        }
        #[inline]
        pub fn finalize_bundle(
            &self,
            bv2: &mut super::BundleV2,
            result: &super::DevServerOutput<'_>,
        ) -> Result<(), bun_core::Error> {
            // SAFETY: owner is a live *mut DevServer; bv2/result are valid for the call.
            unsafe { (self.vtable.finalize_bundle)(self.owner, bv2, result) }
        }
        #[inline]
        pub fn put_or_overwrite_asset<P>(
            &self,
            path: &P,
            contents: &[u8],
            content_hash: u64,
        ) -> Result<(), bun_core::Error> {
            // SAFETY: erases &P to *const () for the vtable boundary; runtime impl
            // casts back to &fs::Path. Ownership of `contents` transfers per Zig contract.
            unsafe {
                (self.vtable.put_or_overwrite_asset)(
                    self.owner,
                    path as *const P as *const (),
                    contents,
                    content_hash,
                )
            }
        }
        #[inline] pub fn track_resolution_failure(&self, src: &[u8], spec: &[u8], r: super::bake_types::Graph, l: bun_options_types::Loader) -> Result<(), bun_core::Error> {
            unsafe { (self.vtable.track_resolution_failure)(self.owner, src, spec, r, l) }
        }
        #[inline] pub fn is_file_cached(&self, path: &[u8], side: super::bake_types::Graph) -> Option<super::bake_types::CacheEntry> {
            unsafe { (self.vtable.is_file_cached)(self.owner, path, side) }
        }
        #[inline] pub fn asset_hash(&self, path: &[u8]) -> Option<u64> {
            unsafe { (self.vtable.asset_hash)(self.owner, path) }
        }
    }

    /// Erased handle to the JS-thread event loop (jsc::EventLoop). Cold path
    /// (per plugin callback). PERF(port): was inline switch.
    pub struct JsEventLoopHandle {
        pub owner: *mut (),
        pub vtable: &'static JsEventLoopVTable,
    }
    pub struct JsEventLoopVTable {
        pub enqueue_task_concurrent: unsafe fn(*mut (), *mut bun_event_loop::ConcurrentTask::ConcurrentTask),
    }
    impl JsEventLoopHandle {
        #[inline]
        pub fn enqueue_task_concurrent(&self, task: *mut bun_event_loop::ConcurrentTask::ConcurrentTask) {
            unsafe { (self.vtable.enqueue_task_concurrent)(self.owner, task) }
        }
    }

    /// Bytecode generation hook (jsc::CachedBytecode + jsc::initialize +
    /// VirtualMachine::set_is_bundler_thread_for_bytecode_cache). Registered
    /// by runtime at init; null = bytecode disabled.
    pub static BYTECODE_HOOK: AtomicPtr<BytecodeVTable> = AtomicPtr::new(null_mut());
    pub struct BytecodeVTable {
        pub set_bundler_thread: unsafe fn(bool),
        pub initialize_jsc: unsafe fn(bool),
        /// Returns (bytes, source_provider_url_dupe) on success.
        pub generate: unsafe fn(
            format: crate::options_impl::Format,
            source: &[u8],
            source_url: &[u8],
        ) -> Option<(Box<[u8]>, Box<[u8]>)>,
    }

    /// Debug hook: bundler state dump for crash handler.
    pub static DUMP_BUNDLER: AtomicPtr<()> = AtomicPtr::new(null_mut());

    /// One-shot hooks for `JSBundler::{Resolve,Load}::dispatch` — runtime writes
    /// the JS-thread trampoline (`runOnJSThread`) at init. See PORTING.md
    /// §Dispatch "Debug/crash hooks" pattern (AtomicPtr fn-ptr registration).
    pub static PLUGIN_RESOLVE_HOOK: AtomicPtr<unsafe fn(*mut super::api::JSBundler::Resolve)> =
        AtomicPtr::new(null_mut());
    pub static PLUGIN_LOAD_HOOK: AtomicPtr<unsafe fn(*mut super::api::JSBundler::Load)> =
        AtomicPtr::new(null_mut());

    /// CYCLEBREAK GENUINE: `bun.jsc.hot_reloader.NewHotReloader<BundleV2, …>` is
    /// a T6 generic instantiated over a T5 type. The bundler stores it as an
    /// erased `NonNull<()>`; this hook lets `on_load_complete` register watched
    /// files without naming the concrete reloader type.
    pub struct WatcherVTable {
        /// `watcher.add_file(fd, path, hash, loader, dir_fd, package_json, copy)`
        /// (Watcher.zig:addFile).
        pub add_file: unsafe fn(
            watcher: *mut (),
            fd: bun_sys::Fd,
            file_path: &[u8],
            hash: u32,
            loader: bun_options_types::Loader,
            dir_fd: bun_sys::Fd,
            package_json: Option<*const ()>,
            copy_file_path: bool,
        ) -> Result<(), bun_core::Error>,
    }
    pub static WATCHER_HOOK: AtomicPtr<WatcherVTable> = AtomicPtr::new(null_mut());
}

// CYCLEBREAK GENUINE: jsc::hot_reloader::NewHotReloader<BundleV2, EventLoop, true>
// is a T6 generic type instantiated over a T5 type. bundler stores it opaquely;
// runtime constructs/drives it. SAFETY: erased — never dereferenced in bundler.
pub type Watcher = *mut (); // TODO(b0-genuine): hot_reloader — opaque until runtime owns lifecycle

/// `bun.jsc.AnyEventLoop` — erased handle. Re-export the linker's alias
/// (`Option<NonNull<()>>`). The Js/Mini discriminant lives in T6.
pub use crate::ungate_support::EventLoop;

/// Mirrors `AnyEventLoop.tick` — drives the loop until `is_done` returns true.
/// T5 cannot name the concrete loop, so this spins on the bundle-thread
/// `is_done` predicate. The JS loop runs microtasks between checks (T6).
fn event_loop_tick<Ctx>(_loop: &mut EventLoop, ctx: *mut Ctx, is_done: fn(&mut Ctx) -> bool) {
    // SAFETY: ctx is a live `&mut BundleV2` for the duration of the tick.
    while !is_done(unsafe { &mut *ctx }) {
        std::thread::yield_now();
    }
}

/// `JSBundleCompletionTask` (JSBundler.zig) — TYPE_ONLY backref for
/// `BundleV2.completion`. The bundler reads only `.jsc_event_loop`.
pub struct JSBundleCompletionTask {
    pub jsc_event_loop: dispatch::JsEventLoopHandle,
}

type IndexInt = u32; // Index.Int

/// This assigns a concise, predictable, and unique `.pretty` attribute to a Path.
/// DevServer relies on pretty paths for identifying modules, so they must be unique.
pub fn generic_path_with_pretty_initialized<'a>(
    path: Fs::Path<'a>,
    target: options::Target,
    top_level_dir: &[u8],
    bump: &'a bun_alloc::Arena,
) -> Result<Fs::Path<'a>, Error> {
    // TODO(port): narrow error set
    let mut buf = bun_paths::path_buffer_pool::get();

    let is_node = path.namespace == b"node";
    if is_node
        && (path.text.starts_with(NodeFallbackModules::IMPORT_PATH)
            || !bun_paths::is_absolute(&path.text))
    {
        return Ok(path);
    }

    // "file" namespace should use the relative file path for its display name.
    // the "node" namespace is also put through this code path so that the
    // "node:" prefix is not emitted.
    if path.is_file() || is_node {
        let mut buf2 = bun_paths::path_buffer_pool::get();
        // TODO(port): in Zig buf2 aliases buf when target != ssr.
        let rel = bun_paths::resolve_path::relative_platform_buf::<bun_paths::resolve_path::platform::Loose, false>(
            &mut **buf2, top_level_dir, &path.text,
        );
        let mut path_clone = path;
        // stack-allocated temporary is not leaked because dupeAlloc on the path will
        // move .pretty into the heap. that function also fixes some slash issues.
        if target == Target::BakeServerComponentsSsr {
            // the SSR graph needs different pretty names or else HMR mode will
            // confuse the two modules.
            let buf_slice = &mut buf.0[..];
            let mut cursor = &mut buf_slice[..];
            let buf_len = cursor.len();
            let _ = write!(cursor, "ssr:{}", bstr::BStr::new(rel));
            let written = buf_len - cursor.len();
            path_clone.pretty = &buf.0[..written];
        } else {
            path_clone.pretty = rel;
        }
        Ok(path_clone.dupe_alloc_fix_pretty()?)
    } else {
        // in non-file namespaces, standard filesystem rules do not apply.
        let mut path_clone = path;
        let buf_slice = &mut buf.0[..];
        let mut cursor = &mut buf_slice[..];
        let buf_len = cursor.len();
        let _ = write!(
            cursor,
            "{}{}:{}",
            if target == Target::BakeServerComponentsSsr { "ssr:" } else { "" },
            // make sure that a namespace including a colon wont collide with anything
            EscapedNamespace(&path_clone.namespace),
            bstr::BStr::new(&path_clone.text),
        );
        let written = buf_len - cursor.len();
        path_clone.pretty = &buf.0[..written];
        Ok(path_clone.dupe_alloc_fix_pretty()?)
    }
}

/// PORT NOTE: `bun_logger::fs::Path`, `bun_resolver::fs::Path<'a>`, and
/// `bun_paths::fs::Path<'a>` are field-identical mirrors of `fs.zig:Path` that
/// haven't been unified yet (TYPE_ONLY split). These shims bit-cast between
/// them at the few construction sites in this file.
/// SAFETY: all three share the *exact* same field set (`pretty`/`text`/
/// `namespace`/`name{dir,base,ext,filename}`/`is_disabled`/`is_symlink`);
/// callers feed slices interned in `FilenameStore`/`DirnameStore`
/// (process-static), so the `'static` bound on `bun_logger::fs::Path` holds.
#[inline]
pub(crate) fn fs_path_to_logger(p: Fs::Path<'_>) -> Logger::fs::Path {
    // SAFETY: see fn doc — identical layout, slices are interned `'static`.
    unsafe { core::mem::transmute::<Fs::Path<'_>, Logger::fs::Path>(p) }
}
#[inline]
#[allow(dead_code)]
pub(crate) fn logger_path_to_paths(p: &Logger::fs::Path) -> bun_paths::fs::Path<'static> {
    // SAFETY: see `fs_path_to_logger` — identical layout.
    unsafe { core::mem::transmute::<Logger::fs::Path, bun_paths::fs::Path<'static>>(p.clone()) }
}

struct EscapedNamespace<'a>(&'a [u8]);
impl core::fmt::Display for EscapedNamespace<'_> {
    fn fmt(&self, w: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let mut rest = self.0;
        while let Some(i) = strings::index_of_char(rest, b':') {
            write!(w, "{}", bstr::BStr::new(&rest[..i as usize]))?;
            w.write_str("::")?;
            rest = &rest[i as usize + 1..];
        }
        write!(w, "{}", bstr::BStr::new(rest))
    }
}

// Unified with the canonical definitions at the parent module level (this
// avoids two distinct nominal `BundleV2`/`PendingImport`/`BakeOptions` types
// that previously caused widespread "expected `BundleV2`, found `BundleV2`"
// errors in cross-module call sites).
pub use super::{BundleV2, PendingImport, BakeOptions};

impl<'a> BundleV2<'a> {
    /// Returns the jsc.EventLoop where plugin callbacks can be queued up on
    pub fn js_loop_for_plugins(&mut self) -> &dispatch::JsEventLoopHandle {
        // CYCLEBREAK GENUINE: jsc::EventLoop → vtable handle. PERF(port): was inline switch.
        debug_assert!(self.plugins.is_some());
        if let Some(completion) = self.completion {
            // From Bun.build
            // SAFETY: completion is a valid backref while bundle is running
            return unsafe { &(*completion).jsc_event_loop };
        }
        // From bake where the loop running the bundle is also the loop running
        // the plugins. PORT NOTE: `linker.r#loop` is an erased `Option<NonNull<()>>`
        // — the Js/Mini discriminant lives in T6. Without a completion task the
        // CLI path has no JS event loop.
        panic!("No JavaScript event loop for transpiler plugins to run on")
    }

    fn ensure_client_transpiler(&mut self) {
        if self.client_transpiler.is_none() {
            let _ = self.initialize_client_transpiler().unwrap_or_else(|e: Error| {
                panic!("Failed to initialize client transpiler: {}", e.name());
            });
        }
    }

    #[cold]
    fn initialize_client_transpiler(&mut self) -> Result<&mut Transpiler<'a>, Error> {
        // PORT NOTE: `Transpiler<'a>` is not `Clone` (owns resolver/log) and the
        // arena's lifetime can't be threaded as `'a` here without restructuring
        // `BundleV2`. Allocate via Box::leak (lifetime tied to `graph.heap` in
        // practice; freed in `deinit_without_freeing_arena`). The body mirrors
        // bundle_v2.zig:310-360.
        todo!("blocked_on: Transpiler::shallow_clone_for_client");
        #[allow(unreachable_code)]
        let this_transpiler: &mut Transpiler<'a> = unsafe { &mut *(&mut *self.transpiler as *mut _) };
        #[allow(unreachable_code)]
        let client_transpiler: &'a mut Transpiler<'a> = unreachable!();

        client_transpiler.options.target = Target::Browser;
        client_transpiler.options.main_fields = Target::Browser
            .default_main_fields()
            .iter()
            .map(|s| s.as_bytes().to_vec().into_boxed_slice())
            .collect();
        client_transpiler.options.conditions = options::ESMConditions::init(
            Target::Browser.default_conditions(),
            false,
            &[],
        )?;

        // We need to make sure it has [hash] in the names so we don't get conflicts.
        if this_transpiler.options.compile {
            client_transpiler.options.asset_naming = options::PathTemplate::ASSET.data.to_vec().into_boxed_slice();
            client_transpiler.options.chunk_naming = options::PathTemplate::CHUNK.data.to_vec().into_boxed_slice();
            client_transpiler.options.entry_naming = b"./[name]-[hash].[ext]".to_vec().into_boxed_slice();

            // Use "/" so that asset URLs in HTML are absolute (e.g. "/chunk-abc.js"
            // instead of "./chunk-abc.js"). Relative paths break when the HTML is
            // served from a nested route like "/foo/".
            client_transpiler.options.public_path = b"/".to_vec().into_boxed_slice();
        }

        client_transpiler.set_log(this_transpiler.log);
        client_transpiler.configure_defines()?;
        // TODO(port): resolver.opts/env_loader/caches assignment — lifetime threading.
        self.client_transpiler = Some(NonNull::from(&mut *client_transpiler));
        Ok(client_transpiler)
    }

    /// By calling this function, it implies that the returned log *will* be
    /// written to. For DevServer, this allocates a per-file log for the sources
    /// it is called on. Function must be called on the bundle thread.
    pub fn log_for_resolution_failures(&mut self, abs_path: &[u8], bake_graph: bake::Graph) -> &mut Logger::Log {
        if let Some(dev) = self.dev_server_handle() {
            // CYCLEBREAK GENUINE: DevServer → vtable. PERF(port): was inline switch.
            // SAFETY: owner is a live *mut DevServer per handle invariant.
            return unsafe { &mut *(dev.vtable.log_for_resolution_failures)(dev.owner, abs_path, bake_graph) };
        }
        // SAFETY: `transpiler.log` is set from a live `*mut Log` in `init` and
        // outlives `BundleV2`.
        unsafe { &mut *self.transpiler.log }
    }
}

pub struct ReachableFileVisitor<'a> {
    pub reachable: Vec<Index>,
    pub visited: DynamicBitSet,
    pub all_import_records: &'a mut [import_record::List],
    pub all_loaders: &'a [Loader],
    pub all_urls_for_css: &'a [&'a [u8]],
    pub redirects: &'a [u32],
    // PORT NOTE: Zig copied the map by value (cheap shallow copy). The Rust
    // `PathToSourceIndexMap` is `!Clone` and the field is unread in `visit`, so
    // store a raw backref to satisfy the struct shape without forcing `Clone`.
    pub redirect_map: *const PathToSourceIndexMap,
    pub dynamic_import_entry_points: &'a mut ArrayHashMap<IndexInt, ()>,
    /// Files which are Server Component Boundaries
    pub scb_bitset: Option<DynamicBitSetUnmanaged>,
    pub scb_list: server_component_boundary::Slice<'a>,

    /// Files which are imported by JS and inlined in CSS
    pub additional_files_imported_by_js_and_inlined_in_css: &'a mut DynamicBitSetUnmanaged,
    /// Files which are imported by CSS and inlined in CSS
    pub additional_files_imported_by_css_and_inlined: &'a mut DynamicBitSetUnmanaged,
}

impl<'a> ReachableFileVisitor<'a> {
    const MAX_REDIRECTS: usize = 64;

    // Find all files reachable from all entry points. This order should be
    // deterministic given that the entry point order is deterministic, since the
    // returned order is the postorder of the graph traversal and import record
    // order within a given file is deterministic.
    pub fn visit<const CHECK_DYNAMIC_IMPORTS: bool>(&mut self, source_index: Index, was_dynamic_import: bool) {
        if source_index.is_invalid() {
            return;
        }

        if self.visited.is_set(source_index.get() as usize) {
            if CHECK_DYNAMIC_IMPORTS {
                if was_dynamic_import {
                    self.dynamic_import_entry_points.put(source_index.get(), ()).expect("unreachable");
                }
            }
            return;
        }
        self.visited.set(source_index.get() as usize);

        if let Some(scb_bitset) = &self.scb_bitset {
            if scb_bitset.is_set(source_index.get() as usize) {
                let scb_index = self.scb_list.get_index(source_index.get()).expect("unreachable");
                self.visit::<CHECK_DYNAMIC_IMPORTS>(Index::init(self.scb_list.list.reference_source_index()[scb_index]), false);
                self.visit::<CHECK_DYNAMIC_IMPORTS>(Index::init(self.scb_list.list.ssr_source_index()[scb_index]), false);
            }
        }

        let is_js = self.all_loaders[source_index.get() as usize].is_javascript_like();
        let is_css = self.all_loaders[source_index.get() as usize].is_css();

        let import_record_list_id = source_index;
        // when there are no import records, v index will be invalid
        if (import_record_list_id.get() as usize) < self.all_import_records.len() {
            // PORT NOTE: reshaped for borrowck — split borrow of all_import_records
            let import_records_len = self.all_import_records[import_record_list_id.get() as usize].len as usize;
            for ir_idx in 0..import_records_len {
                let import_record = &mut self.all_import_records[import_record_list_id.get() as usize].slice_mut()[ir_idx];
                let mut other_source = import_record.source_index;
                if other_source.is_valid() {
                    let mut redirect_count: usize = 0;
                    while let Some(redirect_id) = get_redirect_id(self.redirects[other_source.get() as usize]) {
                        // PORT NOTE: reshaped for borrowck — copy out the redirect target's
                        // (source_index, path) before re-borrowing `all_import_records` mutably.
                        let (other_src_idx, other_path) = {
                            let other_import_records = self.all_import_records[other_source.get() as usize].slice();
                            let other_import_record = &other_import_records[redirect_id as usize];
                            (other_import_record.source_index, other_import_record.path.clone())
                        };
                        let import_record = &mut self.all_import_records[import_record_list_id.get() as usize].slice_mut()[ir_idx];
                        import_record.source_index = other_src_idx;
                        import_record.path = other_path;
                        other_source = other_src_idx;
                        if redirect_count == Self::MAX_REDIRECTS {
                            import_record.path.is_disabled = true;
                            import_record.source_index = Index::INVALID;
                            break;
                        }

                        // Handle redirects to a builtin or external module
                        // https://github.com/oven-sh/bun/issues/3764
                        if !other_source.is_valid() {
                            break;
                        }
                        redirect_count += 1;
                    }

                    let import_record = &self.all_import_records[import_record_list_id.get() as usize].slice()[ir_idx];
                    // Mark if the file is imported by JS and its URL is inlined for CSS
                    let is_inlined = import_record.source_index.is_valid()
                        && !self.all_urls_for_css[import_record.source_index.get() as usize].is_empty();
                    if is_js && is_inlined {
                        self.additional_files_imported_by_js_and_inlined_in_css.set(import_record.source_index.get() as usize);
                    } else if is_css && is_inlined {
                        self.additional_files_imported_by_css_and_inlined.set(import_record.source_index.get() as usize);
                    }

                    let next_source = import_record.source_index;
                    let kind_is_dynamic = import_record.kind == ImportKind::Dynamic;
                    self.visit::<CHECK_DYNAMIC_IMPORTS>(next_source, CHECK_DYNAMIC_IMPORTS && kind_is_dynamic);
                }
            }

            // Redirects replace the source file with another file
            if let Some(redirect_id) = get_redirect_id(self.redirects[source_index.get() as usize]) {
                let redirect_source_index = self.all_import_records[source_index.get() as usize].slice()[redirect_id as usize].source_index.get();
                self.visit::<CHECK_DYNAMIC_IMPORTS>(Index::source(redirect_source_index), was_dynamic_import);
                return;
            }
        }

        // Each file must come after its dependencies
        self.reachable.push(source_index);
        if CHECK_DYNAMIC_IMPORTS {
            if was_dynamic_import {
                self.dynamic_import_entry_points.put(source_index.get(), ()).expect("unreachable");
            }
        }
    }
}

impl<'a> BundleV2<'a> {
    pub fn find_reachable_files(&mut self) -> Result<Box<[Index]>, Error> {
        let trace = crate::ungate_support::perf::trace("Bundler.findReachableFiles");
        drop(trace); // TODO(port): scope guard for trace.end()

        // Create a quick index for server-component boundaries.
        // We need to mark the generated files as reachable, or else many files will appear missing.
        // PERF(port): was stack-fallback
        let mut scb_bitset = if self.graph.server_component_boundaries.list.len() > 0 {
            Some(self.graph.server_component_boundaries.slice().bit_set(self.graph.input_files.len())?)
        } else {
            None
        };

        let mut additional_files_imported_by_js_and_inlined_in_css = DynamicBitSetUnmanaged::init_empty(self.graph.input_files.len())?;
        let mut additional_files_imported_by_css_and_inlined = DynamicBitSetUnmanaged::init_empty(self.graph.input_files.len())?;

        self.dynamic_import_entry_points = ArrayHashMap::new();

        // PORT NOTE: reshaped for borrowck — hoist the values that would
        // otherwise re-borrow `self`/`self.graph` while the visitor holds
        // disjoint column refs (Zig pulled multiple `items(.field)` columns at
        // once with no aliasing model).
        let redirect_map: *const PathToSourceIndexMap =
            self.path_to_source_index_map(self.transpiler.options.target) as *const _;
        let scb_list = if scb_bitset.is_some() {
            self.graph.server_component_boundaries.slice()
        } else {
            // SAFETY: will never be read since `scb_bitset` is `None`
            unsafe { core::mem::zeroed() }
        };

        // PORT NOTE: reshaped for borrowck — SoA columns are physically
        // disjoint slabs but rustc cannot see that through `&mut
        // MultiArrayList`. Route the one mutable column through the raw
        // pointer (`Slice::items_raw`); the rest stay as shared borrows.
        let ast_slice = self.graph.ast.slice();
        let ast_len = ast_slice.len();
        // SAFETY: column type matches `BundledAst::import_records`; the slab
        // does not resize for the duration of this function and no other
        // `&mut` to this column exists.
        let all_import_records: &mut [import_record::List] = unsafe {
            core::slice::from_raw_parts_mut(
                ast_slice.items_raw::<import_record::List>(
                    js_ast::ast::bundled_ast::BundledAstField::import_records,
                ),
                ast_len,
            )
        };
        let all_urls_for_css = self.graph.ast.items_url_for_css();

        let mut visitor = ReachableFileVisitor {
            reachable: Vec::with_capacity(self.graph.entry_points.len() + 1),
            visited: DynamicBitSet::init_empty(self.graph.input_files.len())?,
            redirects: self.graph.ast.items_redirect_import_record_index(),
            all_import_records,
            all_loaders: self.graph.input_files.items_loader(),
            all_urls_for_css,
            redirect_map,
            dynamic_import_entry_points: &mut self.dynamic_import_entry_points,
            scb_bitset,
            scb_list,
            additional_files_imported_by_js_and_inlined_in_css: &mut additional_files_imported_by_js_and_inlined_in_css,
            additional_files_imported_by_css_and_inlined: &mut additional_files_imported_by_css_and_inlined,
        };

        // If we don't include the runtime, __toESM or __toCommonJS will not get
        // imported and weird things will happen
        visitor.visit::<false>(Index::RUNTIME, false);

        if self.transpiler.options.code_splitting {
            for entry_point in self.graph.entry_points.iter().copied() {
                visitor.visit::<true>(entry_point.into(), false);
            }
        } else {
            for entry_point in self.graph.entry_points.iter().copied() {
                visitor.visit::<false>(entry_point.into(), false);
            }
        }

        if cfg!(debug_assertions) && ReachableFiles.is_visible() {
            bun_core::scoped_log!(ReachableFiles, "Reachable count: {} / {}", visitor.reachable.len(), self.graph.input_files.len());
            let sources = self.graph.input_files.items_source();
            let targets = self.graph.ast.items_target();
            for idx in visitor.reachable.iter() {
                let source = &sources[idx.get() as usize];
                bun_core::scoped_log!(
                    ReachableFiles,
                    "reachable file: #{} {} ({}) target=.{}",
                    source.index.0,
                    bun_core::fmt::quote(&source.path.pretty),
                    bstr::BStr::new(&source.path.text),
                    <&'static str>::from(targets[idx.get() as usize]),
                );
            }
        }

        // PORT NOTE: reshaped for borrowck — release the visitor's `&mut`
        // borrows on the two bitsets and `input_files` columns before the
        // cleanup loop reads them.
        let ReachableFileVisitor { reachable, .. } = visitor;

        // PORT NOTE: reshaped for borrowck — three disjoint mutable SoA
        // columns; route through `Slice::items_raw`.
        let input_files_slice = self.graph.input_files.slice();
        let input_files_len = input_files_slice.len();
        // SAFETY: SoA columns are disjoint; the slab does not resize for the
        // duration of this loop and no other `&mut` to these columns exists.
        let additional_files: &mut [BabyList<crate::AdditionalFile>] = unsafe {
            core::slice::from_raw_parts_mut(
                input_files_slice
                    .items_raw::<BabyList<crate::AdditionalFile>>(crate::Graph::InputFileField::additional_files),
                input_files_len,
            )
        };
        let unique_keys: &mut [Box<[u8]>] = unsafe {
            core::slice::from_raw_parts_mut(
                input_files_slice
                    .items_raw::<Box<[u8]>>(crate::Graph::InputFileField::unique_key_for_additional_file),
                input_files_len,
            )
        };
        let content_hashes: &mut [u64] = unsafe {
            core::slice::from_raw_parts_mut(
                input_files_slice.items_raw::<u64>(crate::Graph::InputFileField::content_hash_for_additional_file),
                input_files_len,
            )
        };
        for (index, url_for_css) in all_urls_for_css.iter().enumerate() {
            if !url_for_css.is_empty() {
                // We like to inline additional files in CSS if they fit a size threshold
                // If we do inline a file in CSS, and it is not imported by JS, then we don't need to copy the additional file into the output directory
                if additional_files_imported_by_css_and_inlined.is_set(index)
                    && !additional_files_imported_by_js_and_inlined_in_css.is_set(index)
                {
                    additional_files[index].clear_retaining_capacity();
                    unique_keys[index] = b"".as_slice().into();
                    content_hashes[index] = 0;
                }
            }
        }

        Ok(reachable.into_boxed_slice())
    }

    fn is_done(&mut self) -> bool {
        self.thread_lock.assert_locked();

        if self.graph.pending_items == 0 {
            // PORT NOTE: reshaped for borrowck — Zig passed `&self.graph` and
            // `self` to the same call. Take a raw ptr so the two `&mut` don't
            // overlap from rustc's view.
            // SAFETY: `drain_deferred_tasks` only touches `self.graph.deferred_*`
            // fields and the `BundleV2` callback surface; no aliasing UB.
            let this: *mut Self = self;
            if unsafe { (*this).graph.drain_deferred_tasks(&mut *this) } {
                return false;
            }
            return true;
        }

        false
    }

    pub fn wait_for_parse(&mut self) {
        let self_ptr: *mut Self = self;
        event_loop_tick(self.r#loop(), self_ptr, Self::is_done);
        bun_core::scoped_log!(Bundle, "Parsed {} files, producing {} ASTs", self.graph.input_files.len(), self.graph.ast.len());
    }

    pub fn scan_for_secondary_paths(&mut self) {
        if !self.graph.has_any_secondary_paths {
            // Assert the boolean is accurate.
            #[cfg(debug_assertions)]
            for secondary_path in self.graph.input_files.items_secondary_path() {
                if !secondary_path.is_empty() {
                    panic!("secondary_path is not empty");
                }
            }
            // No dual package hazard. Do nothing.
            return;
        }

        // Now that all files have been scanned, look for packages that are imported
        // both with "import" and "require". Rewrite any imports that reference the
        // "module" package.json field to the "main" package.json field instead.
        //
        // This attempts to automatically avoid the "dual package hazard" where a
        // package has both a CommonJS module version and an ECMAScript module
        // version and exports a non-object in CommonJS (often a function). If we
        // pick the "module" field and the package is imported with "require" then
        // code expecting a function will crash.
        //
        // PORT NOTE: reshaped for borrowck — Zig pulled the mutable
        // `import_records` column alongside shared columns. Route the one
        // mutable column through `Slice::items_raw` and read the per-target
        // map through the disjoint `build_graphs` field instead of the
        // `&mut self` accessor.
        let ast_slice = self.graph.ast.slice();
        let ast_len = ast_slice.len();
        // SAFETY: column type matches `BundledAst::import_records`; the slab
        // does not resize for the duration of this loop and no other `&mut`
        // to this column exists.
        let ast_import_records: &mut [import_record::List] = unsafe {
            core::slice::from_raw_parts_mut(
                ast_slice.items_raw::<import_record::List>(
                    js_ast::ast::bundled_ast::BundledAstField::import_records,
                ),
                ast_len,
            )
        };
        let targets = self.graph.ast.items_target();
        let max_valid_source_index = Index::init(self.graph.input_files.len());
        let secondary_paths = self.graph.input_files.items_secondary_path();
        let sources = self.graph.input_files.items_source();

        debug_assert_eq!(ast_import_records.len(), targets.len());
        for (ast_import_record_list, target) in ast_import_records.iter_mut().zip(targets.iter()) {
            let import_records = ast_import_record_list.slice_mut();
            let path_to_source_index_map = &self.graph.build_graphs[*target];
            for import_record in import_records.iter_mut() {
                let source_index = import_record.source_index.get();
                if source_index >= max_valid_source_index.get() {
                    continue;
                }
                let secondary_path: &[u8] = &secondary_paths[source_index as usize];
                if !secondary_path.is_empty() {
                    let Some(secondary_source_index) = path_to_source_index_map.get(secondary_path) else { continue };
                    import_record.source_index = Index::init(secondary_source_index);
                    // Keep path in sync for determinism, diagnostics, and dev tooling.
                    import_record.path = logger_path_to_paths(&sources[secondary_source_index as usize].path);
                }
            }
        }
    }

    /// This runs on the Bundle Thread.
    pub fn run_resolver(
        &mut self,
        import_record: jsc_api::JSBundler::MiniImportRecord,
        target: options::Target,
    ) {
        let transpiler = self.transpiler_for_target(target);
        let source_dir = Fs::PathName::init(&import_record.source_file).dir_with_trailing_slash();

        // Check the FileMap first for in-memory files
        if let Some(file_map) = self.file_map {
            if let Some(_file_map_result) = file_map.resolve(&import_record.source_file, &import_record.specifier) {
                let mut file_map_result = _file_map_result;
                let mut path_primary = file_map_result.path_pair.primary.clone();
                let entry = self.path_to_source_index_map(target).get_or_put(&path_primary.text).expect("oom");
                if !entry.found_existing {
                    let loader: Loader = 'brk: {
                        let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                        if let Some(out_loader) = record.loader {
                            break 'brk out_loader;
                        }
                        break 'brk Fs::Path::init(path_primary.text.clone()).loader(&transpiler.options.loaders).unwrap_or(Loader::File);
                    };
                    // For virtual files, use the path text as-is (no relative path computation needed).
                    path_primary.pretty = self.allocator().alloc_slice_copy(&path_primary.text);
                    let mut tmp_source = Logger::Source {
                        path: fs_path_to_logger(path_primary),
                        contents: std::borrow::Cow::Borrowed(&b""[..]),
                        ..Default::default()
                    };
                    let idx = self.enqueue_parse_task(
                        &file_map_result,
                        &mut tmp_source,
                        loader,
                        import_record.original_target,
                    ).expect("oom");
                    *entry.value_ptr = idx;
                    let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                    record.source_index = Index::init(idx);
                } else {
                    let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                    record.source_index = Index::init(*entry.value_ptr);
                }
                return;
            }
        }

        let mut had_busted_dir_cache = false;
        let resolve_result: _resolver::Result = loop {
            match transpiler.resolver.resolve(source_dir, &import_record.specifier, import_record.kind) {
                Ok(r) => break r,
                Err(err) => {
                    // Only perform directory busting when hot-reloading is enabled
                    if err == bun_core::err!("ModuleNotFound") {
                        if let Some(dev) = self.dev_server {
                            if !had_busted_dir_cache {
                                // Only re-query if we previously had something cached.
                                if transpiler.resolver.bust_dir_cache_from_specifier(&import_record.source_file, &import_record.specifier) {
                                    had_busted_dir_cache = true;
                                    continue;
                                }
                            }

                            // Tell Bake's Dev Server to wait for the file to be imported.
                            dev.track_resolution_failure(
                                &import_record.source_file,
                                &import_record.specifier,
                                target.bake_graph(),
                                self.graph.input_files.items_loader()[import_record.importer_source_index as usize],
                            ).expect("oom");

                            // Turn this into an invalid AST, so that incremental mode skips it when printing.
                            self.graph.ast.items_parts_mut()[import_record.importer_source_index as usize].len = 0;
                        }
                    }

                    let mut handles_import_errors = false;
                    let mut source: Option<&Logger::Source> = None;
                    let log = self.log_for_resolution_failures(&import_record.source_file, target.bake_graph());

                    let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                    source = Some(&self.graph.input_files.items_source()[import_record.importer_source_index as usize]);
                    handles_import_errors = record.flags.contains(bun_options_types::import_record::Flags::HANDLES_IMPORT_ERRORS);

                    // Disable failing packages from being printed.
                    // This may cause broken code to write.
                    // However, doing this means we tell them all the resolve errors
                    // Rather than just the first one.
                    record.path.is_disabled = true;

                    if err == bun_core::err!("ModuleNotFound") {
                        let add_error = Logger::Log::add_resolve_error_with_text_dupe;
                        let path_to_use = &import_record.specifier;

                        if !handles_import_errors && !self.transpiler.options.ignore_module_resolution_errors {
                            if is_package_path(&import_record.specifier) {
                                if target == Target::Browser && options::ExternalModules::is_node_builtin(path_to_use) {
                                    add_error(
                                        log, source, import_record.range,
                                        format_args!("Browser build cannot {} Node.js module: \"{}\". To use Node.js builtins, set target to 'node' or 'bun'",
                                            bstr::BStr::new(import_record.kind.error_label()), bstr::BStr::new(path_to_use)),
                                        path_to_use,
                                        import_record.kind.into(),
                                    ).expect("unreachable");
                                } else {
                                    add_error(
                                        log, source, import_record.range,
                                        format_args!("Could not resolve: \"{}\". Maybe you need to \"bun install\"?", bstr::BStr::new(path_to_use)),
                                        path_to_use,
                                        import_record.kind.into(),
                                    ).expect("unreachable");
                                }
                            } else {
                                add_error(
                                    log, source, import_record.range,
                                    format_args!("Could not resolve: \"{}\"", bstr::BStr::new(path_to_use)),
                                    path_to_use,
                                    import_record.kind.into(),
                                ).expect("unreachable");
                            }
                        }
                    }
                    // assume other errors are already in the log
                    return;
                }
            }
        };
        let mut resolve_result = resolve_result;

        let mut out_source_index: Option<Index> = None;

        // PORT NOTE(borrowck): Zig held a `*Fs.Path` into `resolve_result` while
        // also reading other fields and re-borrowing `self`. Rust borrowck rejects
        // that, so we clone the active path out and operate on an owned value.
        let mut path: Fs::Path<'static> = match resolve_result.path() {
            Some(p) => p.clone(),
            None => {
                let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
                // Disable failing packages from being printed.
                // This may cause broken code to write.
                // However, doing this means we tell them all the resolve errors
                // Rather than just the first one.
                record.path.is_disabled = true;
                return;
            }
        };

        if resolve_result.flags.is_external() {
            return;
        }

        if path.pretty.as_ptr() == path.text.as_ptr() {
            // TODO: outbase
            let rel = bun_paths::resolve_path::relative_platform::<bun_paths::resolve_path::platform::Loose, false>(
                // SAFETY: `transpiler.fs` is a live `*mut FileSystem` for the bundle pass.
                unsafe { (*transpiler.fs).top_level_dir }, &path.text);
            // SAFETY: arena outlives the bundle pass; raw-pointer detour erases the
            // `&self` lifetime so the resulting `&'static [u8]` doesn't pin `self`.
            path.pretty = unsafe { &*(self.allocator().alloc_slice_copy(rel) as *const [u8]) };
        }
        path.assert_pretty_is_valid();
        path.assert_file_path_is_absolute();

        // PORT NOTE(borrowck): split Zig's `getOrPut` into get-then-put so the map
        // borrow doesn't span `enqueue_parse_task` (which needs `&mut self`).
        if let Some(existing) = self.path_to_source_index_map(target).get(&path.text) {
            out_source_index = Some(Index::init(existing));
        } else {
            path = self.path_with_pretty_initialized(path, target).expect("oom");
            let loader: Loader = 'brk: {
                let record: &ImportRecord = &self.graph.ast.items_import_records()[import_record.importer_source_index as usize].slice()[import_record.import_record_index as usize];
                if let Some(out_loader) = record.loader {
                    break 'brk out_loader;
                }
                break 'brk path.loader(&transpiler.options.loaders).unwrap_or(Loader::File);
                // HTML is only allowed at the entry point.
            };
            let mut tmp_source = Logger::Source {
                path: fs_path_to_logger(path.dupe_alloc().expect("oom")),
                contents: std::borrow::Cow::Borrowed(&b""[..]),
                ..Default::default()
            };
            let idx = self.enqueue_parse_task(
                &resolve_result,
                &mut tmp_source,
                loader,
                import_record.original_target,
            ).expect("oom");
            self.path_to_source_index_map(target).put(&path.text, idx).expect("oom");
            out_source_index = Some(Index::init(idx));

            if let Some(secondary) = &resolve_result.path_pair.secondary {
                if !secondary.is_disabled
                    && !strings::eql_long(&secondary.text, &path.text, true)
                {
                    let secondary_path_to_copy = secondary.dupe_alloc().expect("oom");
                    self.graph.input_files.items_secondary_path_mut()[idx as usize] = secondary_path_to_copy.text.into();
                    // Ensure the determinism pass runs.
                    self.graph.has_any_secondary_paths = true;
                }
            }

            // For non-javascript files, make all of these files share indices.
            // For example, it is silly to bundle index.css depended on by client+server twice.
            // It makes sense to separate these for JS because the target affects DCE
            if self.transpiler.options.server_components && !loader.is_javascript_like() {
                // PORT NOTE: reshaped for borrowck — cannot hold two `&mut` into
                // `self.graph` simultaneously, so re-derive the map per insert.
                let key_text: Box<[u8]> = path.text.to_vec().into_boxed_slice();
                let main_target = self.transpiler.options.target;
                let separate_ssr = self.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph;
                let (ta, tb) = match target {
                    Target::Browser => (main_target, Target::BakeServerComponentsSsr),
                    Target::BakeServerComponentsSsr => (main_target, Target::Browser),
                    _ => (Target::Browser, Target::BakeServerComponentsSsr),
                };
                self.path_to_source_index_map(ta).put(&key_text, idx).expect("oom");
                if separate_ssr {
                    self.path_to_source_index_map(tb).put(&key_text, idx).expect("oom");
                }
            }
        }

        if let Some(source_index) = out_source_index {
            let record: &mut ImportRecord = &mut self.graph.ast.items_import_records_mut()[import_record.importer_source_index as usize].slice_mut()[import_record.import_record_index as usize];
            record.source_index = source_index;
        }
    }

    pub fn enqueue_file_from_dev_server_incremental_graph_invalidation(
        &mut self,
        path_slice: &[u8],
        target: options::Target,
    ) -> Result<(), Error> {
        // TODO: plugins with non-file namespaces
        // PORT NOTE(borrowck): split Zig's `getOrPut` into get-then-put so the map
        // borrow doesn't span the resolver / `&mut self` calls below.
        if self.path_to_source_index_map(target).get(path_slice).is_some() {
            return Ok(());
        }
        let result = match self.transpiler_for_target(target).resolve_entry_point(path_slice) {
            Ok(r) => r,
            Err(_) => return Ok(()),
        };
        let mut path = result.path_pair.primary.clone();
        self.increment_scan_counter();
        let source_index = Index::source(self.graph.input_files.len() as u32);
        let loader = path.loader(&self.transpiler.options.loaders).unwrap_or(Loader::File);

        path = self.path_with_pretty_initialized(path, target)?;
        path.assert_pretty_is_valid();
        self.path_to_source_index_map(target).put(path_slice, source_index.get()).expect("oom");
        self.graph.ast.append(JSAst::empty());

        self.graph.input_files.append(crate::Graph::InputFile {
            source: Logger::Source {
                path: fs_path_to_logger(path),
                contents: std::borrow::Cow::Borrowed(&b""[..]),
                index: bun_logger::Index(source_index.get()),
                ..Default::default()
            },
            loader,
            side_effects: result.primary_side_effects_data,
            ..Default::default()
        })?;
        let task = Box::leak(Box::new(ParseTask::init(&result, source_index.into(), self)));
        task.loader = Some(loader);
        task.task.node.next = core::ptr::null_mut();
        task.tree_shaking = self.linker.options.tree_shaking;
        task.known_target = target;
        {
            let t = self.transpiler_for_target(target);
            task.jsx.development = match t.options.force_node_env {
                options::ForceNodeEnv::Development => true,
                options::ForceNodeEnv::Production => false,
                options::ForceNodeEnv::Unspecified => t.options.jsx.development,
            };
        }

        // Handle onLoad plugins as entry points
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<crate::AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(crate::AdditionalFile::SourceIndex(task.source_index.get())).expect("oom");
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            unsafe { self.graph.pool.as_mut() }.schedule(task);
        }
        Ok(())
    }

    pub fn enqueue_entry_item(
        &mut self,
        resolve: &mut _resolver::Result,
        is_entry_point: bool,
        target: options::Target,
    ) -> Result<Option<IndexInt>, Error> {
        let result = &mut *resolve;
        // PORT NOTE(borrowck): clone the active path out so we don't hold a `&mut`
        // into `result` across the `&mut self` calls below.
        let mut path: Fs::Path<'static> = match result.path() {
            Some(p) => p.clone(),
            None => return Ok(None),
        };

        path.assert_file_path_is_absolute();
        // PORT NOTE(borrowck): split Zig's `getOrPut` into get-then-put.
        if self.path_to_source_index_map(target).get(&path.text).is_some() {
            return Ok(None);
        }
        self.increment_scan_counter();
        let source_index = Index::source(self.graph.input_files.len() as u32);

        let loader = path.loader(&self.transpiler.options.loaders).unwrap_or(Loader::File);

        // SAFETY: `path_with_pretty_initialized` allocates into `self.graph.heap`, which
        // outlives the bundle pass; erase the arena lifetime back to the resolver's
        // `Path<'static>` alias so `path` doesn't keep `self` borrowed.
        path = unsafe {
            core::mem::transmute::<Fs::Path<'_>, Fs::Path<'static>>(
                self.path_with_pretty_initialized(path, target)?,
            )
        };
        path.assert_pretty_is_valid();
        self.path_to_source_index_map(target).put(&path.text, source_index.get()).expect("oom");
        self.graph.ast.append(JSAst::empty());

        let side_effects = result.primary_side_effects_data;
        self.graph.input_files.append(crate::Graph::InputFile {
            source: Logger::Source {
                path: fs_path_to_logger(path.dupe_alloc().expect("oom")),
                contents: std::borrow::Cow::Borrowed(&b""[..]),
                index: bun_logger::Index(source_index.get()),
                ..Default::default()
            },
            loader,
            side_effects,
            ..Default::default()
        })?;
        let task = Box::leak(Box::new(ParseTask::init(result, source_index.into(), self)));
        task.loader = Some(loader);
        task.task.node.next = core::ptr::null_mut();
        task.tree_shaking = self.linker.options.tree_shaking;
        task.is_entry_point = is_entry_point;
        task.known_target = target;
        {
            let bundler = self.transpiler_for_target(target);
            task.jsx.development = match bundler.options.force_node_env {
                options::ForceNodeEnv::Development => true,
                options::ForceNodeEnv::Production => false,
                options::ForceNodeEnv::Unspecified => bundler.options.jsx.development,
            };
        }

        // Handle onLoad plugins as entry points
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<crate::AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(crate::AdditionalFile::SourceIndex(task.source_index.get())).expect("oom");
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            unsafe { self.graph.pool.as_mut() }.schedule(task);
        }

        self.graph.entry_points.push(js_ast::Index::init(source_index.get()));

        Ok(Some(source_index.get()))
    }

    /// `heap` is not freed when `deinit`ing the BundleV2
    pub fn init(
        transpiler: &'a mut Transpiler<'a>,
        bake_options: Option<BakeOptions<'a>>,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
        cli_watch_flag: bool,
        thread_pool: Option<&mut ThreadPoolLib>,
        heap: ThreadLocalArena,
    ) -> Result<Box<BundleV2<'a>>, Error> {
        // TODO(port): arena-allocate self via bump.alloc — Box::new is wrong allocator (Zig: allocator.create(@This()) on arena)
        unsafe { (*transpiler.env).load_tracy() };

        transpiler.options.mark_builtins_as_external = transpiler.options.target.is_bun() || transpiler.options.target == Target::Node;
        transpiler.resolver.opts.mark_builtins_as_external = transpiler.options.target.is_bun() || transpiler.options.target == Target::Node;

        // SAFETY: aliased *mut for `ssr_transpiler` (Zig stored both as raw ptrs).
        let ssr_alias: *mut Transpiler<'a> = transpiler as *mut _;
        let mut this = Box::new(BundleV2 {
            transpiler,
            client_transpiler: None,
            ssr_transpiler: ssr_alias,
            framework: None,
            #[allow(unreachable_code)]
            graph: Graph {
                pool: NonNull::dangling(), // set below
                heap,
                kit_referenced_server_data: false,
                kit_referenced_client_data: false,
                ..todo!("blocked_on: Graph::default")
            },
            #[allow(unreachable_code)]
            linker: LinkerContext {
                r#loop: event_loop,
                #[allow(unreachable_code)]
                graph: LinkerGraph {
                    ..todo!("blocked_on: LinkerGraph::default")
                },
                ..todo!("blocked_on: LinkerContext::default")
            },
            bun_watcher: None,
            plugins: None,
            completion: None,
            dev_server: None,
            file_map: None,
            source_code_length: 0,
            thread_lock: bun_core::ThreadLock::init_locked(),
            resolve_tasks_waiting_for_import_source_index: ArrayHashMap::new(),
            free_list: Vec::new(),
            unique_key: 0,
            dynamic_import_entry_points: ArrayHashMap::new(),
            has_on_parse_plugins: false,
            finalizers: Vec::new(),
            drain_defer_task: DeferredBatchTask::default(),
            asynchronous: false,
            has_any_top_level_await_modules: false,
            requested_exports: ArrayHashMap::new(),
        });
        if let Some(bo) = bake_options {
            this.client_transpiler = Some(bo.client_transpiler);
            this.ssr_transpiler = bo.ssr_transpiler.as_ptr();
            let separate_ssr = bo.framework.server_components.as_ref()
                .map(|sc| sc.separate_ssr_graph).unwrap_or(false);
            this.framework = Some(bo.framework);
            this.linker.framework = this.framework.as_ref().map(|f| f as *const _);
            this.plugins = bo.plugins;
            if this.transpiler.options.server_components {
                debug_assert!(unsafe { this.client_transpiler.unwrap().as_ref() }.options.server_components);
                if separate_ssr {
                    debug_assert!(unsafe { (*this.ssr_transpiler).options.server_components });
                }
            }
        }
        // TODO(port): allocator field assignments — Transpiler/Resolver/Linker
        // store `&Arena` in Rust; lifetime threading deferred.
        unsafe { (*this.transpiler.log).clone_line_text = true };

        // We don't expose an option to disable this. Bake forbids tree-shaking
        // since every export must is always exist in case a future module
        // starts depending on it.
        if this.transpiler.options.output_format == options::Format::InternalBakeDev {
            this.transpiler.options.tree_shaking = false;
            // TODO(port): resolver.opts.tree_shaking — field absent on FORWARD_DECL BundleOptions subset
        } else {
            this.transpiler.options.tree_shaking = true;
            // TODO(port): resolver.opts.tree_shaking — field absent on FORWARD_DECL BundleOptions subset
        }

        this.linker.resolver = &mut this.transpiler.resolver;
        this.linker.graph.code_splitting = this.transpiler.options.code_splitting;

        this.linker.options.minify_syntax = this.transpiler.options.minify_syntax;
        this.linker.options.minify_identifiers = this.transpiler.options.minify_identifiers;
        this.linker.options.minify_whitespace = this.transpiler.options.minify_whitespace;
        this.linker.options.emit_dce_annotations = this.transpiler.options.emit_dce_annotations;
        this.linker.options.ignore_dce_annotations = this.transpiler.options.ignore_dce_annotations;
        // SAFETY: `transpiler.options.{banner,footer,public_path,metafile_*}` are
        // owned by the `'a`-lifetime `Transpiler` which outlives `this.linker`;
        // `LinkerOptions` stores `&'static [u8]` as a Phase-A lifetime erasure.
        let leak = |s: &[u8]| -> &'static [u8] { unsafe { core::mem::transmute(s) } };
        this.linker.options.banner = leak(&this.transpiler.options.banner);
        this.linker.options.footer = leak(&this.transpiler.options.footer);
        this.linker.options.css_chunking = this.transpiler.options.css_chunking;
        this.linker.options.compile_to_standalone_html = this.transpiler.options.compile_to_standalone_html;
        this.linker.options.source_maps = this.transpiler.options.source_map;
        this.linker.options.tree_shaking = this.transpiler.options.tree_shaking;
        this.linker.options.public_path = leak(&this.transpiler.options.public_path);
        this.linker.options.target = this.transpiler.options.target;
        this.linker.options.output_format = this.transpiler.options.output_format;
        this.linker.options.generate_bytecode_cache = this.transpiler.options.bytecode;
        this.linker.options.compile = this.transpiler.options.compile;
        this.linker.options.metafile = this.transpiler.options.metafile;
        this.linker.options.metafile_json_path = leak(&this.transpiler.options.metafile_json_path);
        this.linker.options.metafile_markdown_path = leak(&this.transpiler.options.metafile_markdown_path);

        this.linker.dev_server = this.dev_server;

        // TODO(port): allocator.create — Box-allocate the ThreadPool until the
        // arena gains a `create<T>()` helper.
        let pool = Box::leak(Box::new(ThreadPool::default()));
        if cli_watch_flag {
            // CYCLEBREAK GENUINE: hot_reloader is T6; runtime registers a
            // watcher hook and writes `bun_watcher` directly.
        }
        // errdefer pool.destroy();
        // TODO(port): errdefer this.graph.heap.deinit() — Drop handles arena teardown

        *pool = ThreadPool::init(&mut *this, thread_pool)?;
        this.graph.pool = NonNull::from(pool);
        pool.start();
        Ok(this)
    }

    pub fn allocator(&self) -> &bun_alloc::Arena {
        &self.graph.heap
    }

    pub fn increment_scan_counter(&mut self) {
        self.thread_lock.assert_locked();
        self.graph.pending_items += 1;
        bun_core::scoped_log!(scan_counter, ".pending_items + 1 = {}", self.graph.pending_items);
    }

    pub fn decrement_scan_counter(&mut self) {
        self.thread_lock.assert_locked();
        self.graph.pending_items -= 1;
        bun_core::scoped_log!(scan_counter, ".pending_items - 1 = {}", self.graph.pending_items);
        self.on_after_decrement_scan_counter();
    }

    pub fn on_after_decrement_scan_counter(&mut self) {
        if self.asynchronous && self.is_done() {
            let dev = self.dev_server
                .unwrap_or_else(|| panic!("No dev server attached in asynchronous bundle job"));
            self.finish_from_bake_dev_server(&dev).expect("oom");
        }
    }

    // PORT NOTE: split because data type varies by variant — cannot express `switch(variant)`-typed param with const-generic enum on stable
    // TODO(port): comptime variant enum param + dependent data type — split into three monomorphic fns
    pub fn enqueue_entry_points_normal<P: AsRef<[u8]>>(&mut self, data: &[P]) -> Result<(), Error> {
        self.enqueue_entry_points_common()?;
        // (variant != .dev_server)
        self.reserve_source_indexes_for_bake()?;

        // Setup entry points
        let num_entry_points = data.len();
        self.graph.entry_points.reserve(num_entry_points);
        self.graph.input_files.ensure_unused_capacity(num_entry_points)?;

        for entry_point in data {
            let entry_point: &[u8] = entry_point.as_ref();
            if self.enqueue_entry_point_on_resolve_plugin_if_needed(entry_point, self.transpiler.options.target) {
                continue;
            }

            // Check FileMap first for in-memory entry points
            if let Some(file_map) = self.file_map {
                if let Some(file_map_result) = file_map.resolve(b"", entry_point) {
                    let _ = self.enqueue_entry_item(&mut {file_map_result}, true, self.transpiler.options.target)?;
                    continue;
                }
            }

            // no plugins were matched
            let mut resolved = match self.transpiler.resolve_entry_point(entry_point) {
                Ok(r) => r,
                Err(_) => continue,
            };

            let target = 'brk: {
                let main_target = self.transpiler.options.target;
                if main_target.is_server_side() {
                    if let Some(path) = resolved.path_const() {
                        if let Some(loader) = path.loader(&self.transpiler.options.loaders) {
                            if loader == Loader::Html {
                                self.ensure_client_transpiler();
                                break 'brk Target::Browser;
                            }
                        }
                    }
                }
                break 'brk main_target;
            };
            let _ = self.enqueue_entry_item(&mut resolved, true, target)?;
        }
        Ok(())
    }

    pub fn enqueue_entry_points_dev_server(
        &mut self,
        files: bake_types::EntryPointList,
        css_data: &mut ArrayHashMap<Index, CssEntryPointMeta>,
    ) -> Result<(), Error> {
        self.enqueue_entry_points_common()?;
        debug_assert!(self.dev_server.is_some());

        let num_entry_points = files.set.count();
        self.graph.entry_points.reserve(num_entry_points);
        self.graph.input_files.ensure_unused_capacity(num_entry_points)?;

        debug_assert_eq!(files.set.keys().len(), files.set.values().len());
        for (abs_path, flags) in files.set.keys().iter().zip(files.set.values().iter()) {
            // Ensure we have the proper conditions set for client-side entrypoints.
            // SAFETY: Zig stores `transpiler` as a raw `*Transpiler` across the loop body;
            // mirror with `*mut` so it doesn't keep `self` borrowed through the plugin
            // dispatch / dev_server calls below.
            let transpiler: *mut Transpiler<'a> = if flags.client() && !flags.server() && !flags.ssr() {
                self.transpiler_for_target(Target::Browser) as *mut _
            } else {
                &mut *self.transpiler as *mut _
            };
            let server_target = self.transpiler.options.target;

            struct TargetCheck { should_dispatch: bool, target: options::Target }
            let targets_to_check = [
                TargetCheck { should_dispatch: flags.client(), target: Target::Browser },
                TargetCheck { should_dispatch: flags.server(), target: server_target },
                TargetCheck { should_dispatch: flags.ssr(), target: Target::BakeServerComponentsSsr },
            ];

            let mut any_plugin_matched = false;
            for target_info in &targets_to_check {
                if target_info.should_dispatch {
                    if self.enqueue_entry_point_on_resolve_plugin_if_needed(abs_path, target_info.target) {
                        any_plugin_matched = true;
                    }
                }
            }

            if any_plugin_matched {
                continue;
            }

            // Fall back to normal resolution if no plugins matched
            // SAFETY: `transpiler` points at one of self's transpilers, live for `'a`.
            let mut resolved = match unsafe { &mut *transpiler }.resolve_entry_point(abs_path) {
                Ok(r) => r,
                Err(err) => {
                    let dev = self.dev_server.expect("unreachable");
                    dev.handle_parse_task_failure(
                        err,
                        if flags.client() { bake::Graph::Client } else { bake::Graph::Server },
                        abs_path,
                        unsafe { (*transpiler).log } as *const _,
                        self as *mut _,
                    ).expect("oom");
                    unsafe { (*(*transpiler).log).reset() };
                    continue;
                }
            };

            if flags.client() {
                'brk: {
                    let Some(source_index) = self.enqueue_entry_item(&mut resolved, true, Target::Browser)? else { break 'brk };
                    if flags.css() {
                        css_data.put_no_clobber(Index::init(source_index), CssEntryPointMeta { imported_on_server: false })?;
                    }
                }
            }
            if flags.server() { let _ = self.enqueue_entry_item(&mut resolved, true, self.transpiler.options.target)?; }
            if flags.ssr() { let _ = self.enqueue_entry_item(&mut resolved, true, Target::BakeServerComponentsSsr)?; }
        }
        Ok(())
    }

    pub fn enqueue_entry_points_bake_production(
        &mut self,
        data: bake_types::production::EntryPointMap,
    ) -> Result<(), Error> {
        self.enqueue_entry_points_common()?;
        self.reserve_source_indexes_for_bake()?;

        let num_entry_points = data.files.count();
        self.graph.entry_points.reserve(num_entry_points);
        self.graph.input_files.ensure_unused_capacity(num_entry_points)?;

        for key in data.files.keys() {
            let abs_path = key.abs_path();
            let target = match key.side {
                bake::Side::Client => Target::Browser,
                bake::Side::Server => self.transpiler.options.target,
            };

            if self.enqueue_entry_point_on_resolve_plugin_if_needed(abs_path, target) {
                continue;
            }

            // no plugins matched
            let mut resolved = match self.transpiler.resolve_entry_point(abs_path) {
                Ok(r) => r,
                Err(_) => continue,
            };

            // TODO: wrap client files so the exports arent preserved.
            let Some(_) = self.enqueue_entry_item(&mut resolved, true, target)? else { continue };
        }
        Ok(())
    }

    /// Common prelude shared by all enqueue_entry_points_* variants: add the runtime task.
    fn enqueue_entry_points_common(&mut self) -> Result<(), Error> {
        // Add the runtime
        let rt = ParseTask::get_runtime_source(self.transpiler.options.target);
        self.graph.input_files.append(crate::Graph::InputFile {
            source: rt.source,
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        })?;

        // try this.graph.entry_points.append(allocator, Index.runtime);
        self.graph.ast.append(JSAst::empty());
        self.path_to_source_index_map(self.transpiler.options.target).put(&b"bun:wrap"[..], Index::RUNTIME.get()).expect("oom");
        // SAFETY: arena (`self.graph.heap`) outlives the bundle pass; coerce the
        // `&mut ParseTask` to `*mut` immediately so the `&self` borrow from
        // `allocator()` ends before we take `&mut self` below.
        let runtime_parse_task: *mut ParseTask = self.allocator().alloc(rt.parse_task);
        unsafe {
            // BACKREF — lifetime erased per ParseTask::ctx convention.
            (*runtime_parse_task).ctx = self as *mut _ as *mut BundleV2<'static>;
            (*runtime_parse_task).tree_shaking = true;
            (*runtime_parse_task).loader = Some(Loader::Js);
        }
        self.increment_scan_counter();
        unsafe { self.graph.pool.as_mut() }.schedule(runtime_parse_task);
        Ok(())
    }

    fn clone_ast(&mut self) -> Result<(), Error> {
        let _trace = crate::ungate_support::perf::trace("Bundler.cloneAST");
        // TODO(port): bun.safety.alloc.assertEq
        self.linker.graph.ast = self.graph.ast.clone()?;

        for module_scope in self.linker.graph.ast.items_module_scope_mut() {
            // SAFETY: `children` are arena-allocated `NonNull<Scope>`s; we re-point
            // their `parent` BACKREF at the cloned module scope. The raw-pointer
            // dance mirrors Zig's `child.parent = module_scope`.
            let parent_ptr = NonNull::from(&mut *module_scope);
            for child in module_scope.children.slice_mut() {
                unsafe { child.as_mut() }.parent = Some(parent_ptr);
            }

            if FeatureFlags::HELP_CATCH_MEMORY_ISSUES {
                /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */
            }

            module_scope.generated = module_scope.generated.clone()?;
        }

        // Some parts of the AST are owned by worker allocators at this point.
        // Transfer ownership to the graph heap.
        self.linker.graph.take_ast_ownership();
        Ok(())
    }

    /// This generates the two asts for 'bun:bake/client' and 'bun:bake/server'. Both are generated
    /// at the same time in one pass over the SCB list.
    pub fn process_server_component_manifest_files(&mut self) -> Result<(), AllocError> {
        // If a server components is not configured, do nothing
        let Some(fw) = &self.framework else { return Ok(()) };
        let Some(sc) = &fw.server_components else { return Ok(()) };

        if !self.graph.kit_referenced_server_data && !self.graph.kit_referenced_client_data {
            return Ok(());
        }

        let alloc = self.allocator();

        let mut server = AstBuilder::init(self.allocator(), &bake::SERVER_VIRTUAL_SOURCE, self.transpiler.options.hot_module_reloading)?;
        let mut client = AstBuilder::init(self.allocator(), &bake::CLIENT_VIRTUAL_SOURCE, self.transpiler.options.hot_module_reloading)?;

        let mut server_manifest_props: Vec<G::Property> = Vec::new();
        let mut client_manifest_props: Vec<G::Property> = Vec::new();

        let scbs = self.graph.server_component_boundaries.list.slice();
        let named_exports_array = self.graph.ast.items_named_exports();

        let id_string = server.new_expr(E::EString { data: b"id", ..Default::default() });
        let name_string = server.new_expr(E::EString { data: b"name", ..Default::default() });
        let chunks_string = server.new_expr(E::EString { data: b"chunks", ..Default::default() });
        let specifier_string = server.new_expr(E::EString { data: b"specifier", ..Default::default() });
        let empty_array = server.new_expr(E::Array::default());

        for ((r#use, source_id), ssr_index) in scbs.use_directive().iter()
            .zip(scbs.source_index().iter())
            .zip(scbs.ssr_source_index().iter())
        {
            if *r#use == js_ast::UseDirective::Client {
                // TODO(@paperclover/bake): this file is being generated far too
                // early. we don't know which exports are dead and which exports
                // are live. Tree-shaking figures that out. However,
                // tree-shaking happens after import binding, which would
                // require this ast.
                //
                // The plan: change this to generate a stub ast which only has
                // `export const serverManifest = undefined;`, and then
                // re-generate this file later with the properly decided
                // manifest. However, I will probably reconsider how this
                // manifest is being generated when I write the whole
                // "production build" part of Bake.

                let keys = named_exports_array[*source_id as usize].keys();
                // PORT NOTE: `G::Property: !Clone` — build via iterator instead of `vec![v; n]`.
                let mut client_manifest_items: Box<[G::Property]> =
                    (0..keys.len()).map(|_| G::Property::default()).collect();

                if !sc.separate_ssr_graph {
                    bun_core::todo_panic!("separate_ssr_graph=false");
                }

                // SAFETY: arena slice — `alloc` (== `self.graph.heap`) outlives the
                // produced AST. Phase-A erases the `'bump` lifetime to `'static`.
                let astr = |s: &[u8]| -> &'static [u8] {
                    unsafe { core::mem::transmute::<&[u8], &'static [u8]>(s) }
                };

                let client_path = server.new_expr(E::EString {
                    data: astr(alloc.alloc_slice_copy(format!("{:x}S{:08}", self.unique_key, source_id).as_bytes())),
                    ..Default::default()
                });
                let ssr_path = server.new_expr(E::EString {
                    data: astr(alloc.alloc_slice_copy(format!("{:x}S{:08}", self.unique_key, ssr_index).as_bytes())),
                    ..Default::default()
                });

                debug_assert_eq!(keys.len(), client_manifest_items.len());
                for (export_name_string, client_item) in keys.iter().zip(client_manifest_items.iter_mut()) {
                    let server_key_string = astr(alloc.alloc_slice_copy(format!(
                        "{:x}S{:08}#{}",
                        self.unique_key, source_id, bstr::BStr::new(export_name_string)
                    ).as_bytes()));
                    let export_name = server.new_expr(E::EString { data: export_name_string, ..Default::default() });

                    // write dependencies on the underlying module, not the proxy
                    server_manifest_props.push(G::Property {
                        key: Some(server.new_expr(E::EString { data: server_key_string, ..Default::default() })),
                        value: Some(server.new_expr(E::Object {
                            properties: js_ast::ast::g::PropertyList::from_owned_slice(Box::new([
                                G::Property { key: Some(id_string), value: Some(client_path), ..Default::default() },
                                G::Property { key: Some(name_string), value: Some(export_name), ..Default::default() },
                                G::Property { key: Some(chunks_string), value: Some(empty_array), ..Default::default() },
                            ])),
                            ..Default::default()
                        })),
                        ..Default::default()
                    });
                    *client_item = G::Property {
                        key: Some(export_name),
                        value: Some(server.new_expr(E::Object {
                            properties: js_ast::ast::g::PropertyList::from_owned_slice(Box::new([
                                G::Property { key: Some(name_string), value: Some(export_name), ..Default::default() },
                                G::Property { key: Some(specifier_string), value: Some(ssr_path), ..Default::default() },
                            ])),
                            ..Default::default()
                        })),
                        ..Default::default()
                    };
                }

                client_manifest_props.push(G::Property {
                    key: Some(client_path),
                    value: Some(server.new_expr(E::Object {
                        properties: js_ast::ast::g::PropertyList::from_owned_slice(client_manifest_items),
                        ..Default::default()
                    })),
                    ..Default::default()
                });
            } else {
                bun_core::todo_panic!("\"use server\"");
            }
        }

        server.append_stmt(S::Local {
            kind: js_ast::ast::s::Kind::KConst,
            decls: js_ast::ast::g::DeclList::from_owned_slice(Box::new([G::Decl {
                binding: Binding::alloc(alloc, js_ast::ast::b::Identifier {
                    r#ref: server.new_symbol(js_ast::ast::symbol::Kind::Other, b"serverManifest")?,
                }, Logger::Loc::EMPTY),
                value: Some(server.new_expr(E::Object {
                    properties: js_ast::ast::g::PropertyList::move_from_list(server_manifest_props),
                    ..Default::default()
                })),
            }])),
            is_export: true,
            ..Default::default()
        })?;
        server.append_stmt(S::Local {
            kind: js_ast::ast::s::Kind::KConst,
            decls: js_ast::ast::g::DeclList::from_owned_slice(Box::new([G::Decl {
                binding: Binding::alloc(alloc, js_ast::ast::b::Identifier {
                    r#ref: server.new_symbol(js_ast::ast::symbol::Kind::Other, b"ssrManifest")?,
                }, Logger::Loc::EMPTY),
                value: Some(server.new_expr(E::Object {
                    properties: js_ast::ast::g::PropertyList::move_from_list(client_manifest_props),
                    ..Default::default()
                })),
            }])),
            is_export: true,
            ..Default::default()
        })?;

        self.graph.ast.set(Index::BAKE_SERVER_DATA.get() as usize, server.to_bundled_ast(Target::Bun)?);
        self.graph.ast.set(Index::BAKE_CLIENT_DATA.get() as usize, client.to_bundled_ast(Target::Browser)?);
        Ok(())
    }

    pub fn enqueue_parse_task(
        &mut self,
        resolve_result: &_resolver::Result,
        source: &mut Logger::Source,
        loader: Loader,
        known_target: options::Target,
    ) -> Result<IndexInt, AllocError> {
        let source_index = Index::init(u32::try_from(self.graph.ast.len()).unwrap());
        self.graph.ast.append(JSAst::empty());

        self.graph.input_files.append(crate::Graph::InputFile {
            source: core::mem::take(source),
            loader,
            side_effects: loader.side_effects(),
            ..Default::default()
        })?;
        // PORT NOTE: `ParseTask::init` takes `bun_js_parser::Index`; both Index newtypes
        // are `repr(transparent)` u32 so reconstruct via `.get()`.
        let task = Box::leak(Box::new(ParseTask::init(resolve_result, js_ast::Index::init(source_index.get()), self)));
        task.loader = Some(loader);
        task.jsx = self.transpiler_for_target(known_target).options.jsx.clone();
        task.task.node.next = core::ptr::null_mut();
        task.io_task.node.next = core::ptr::null_mut();
        task.tree_shaking = self.linker.options.tree_shaking;
        task.known_target = known_target;

        self.increment_scan_counter();

        // Handle onLoad plugins
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<crate::AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(crate::AdditionalFile::SourceIndex(task.source_index.get())).expect("oom");
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            unsafe { self.graph.pool.as_mut() }.schedule(task);
        }

        Ok(source_index.get())
    }

    pub fn enqueue_parse_task2(
        &mut self,
        source: &mut Logger::Source,
        loader: Loader,
        known_target: options::Target,
    ) -> Result<IndexInt, AllocError> {
        let source_index = Index::init(u32::try_from(self.graph.ast.len()).unwrap());
        self.graph.ast.append(JSAst::empty());

        self.graph.input_files.append(crate::Graph::InputFile {
            source: core::mem::take(source),
            loader,
            side_effects: loader.side_effects(),
            ..Default::default()
        })?;
        let task = self.allocator().alloc(ParseTask {
            ctx: self,
            // PORT NOTE: Zig had a single `fs.Path`; Rust split it into
            // `bun_logger::fs::Path` (on `Source`) and `bun_resolver::fs::Path`
            // (on `ParseTask`). Reconstruct from the `text` slice — `pretty`/
            // `namespace` are unset on a generated source anyway.
            path: Fs::Path::init(source.path.text),
            // SAFETY: `source.contents` borrows the bundler arena (`'a`); leak
            // the borrowed-arm slice to `'static` to fit `ContentsOrFd::Contents`.
            contents_or_fd: parse_task::ContentsOrFd::Contents(unsafe {
                core::mem::transmute::<&[u8], &'static [u8]>(source.contents())
            }),
            side_effects: _resolver::SideEffects::HasSideEffects,
            jsx: if known_target == Target::BakeServerComponentsSsr
                && !self.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph
            {
                self.transpiler.options.jsx.clone()
            } else {
                self.transpiler_for_target(known_target).options.jsx.clone()
            },
            source_index: js_ast::Index::init(source_index.get()),
            module_type: options::ModuleType::Unknown,
            emit_decorator_metadata: false, // TODO
            package_version: b"",
            loader: Some(loader),
            tree_shaking: self.linker.options.tree_shaking,
            known_target,
            ..Default::default()
        });
        task.task.node.next = core::ptr::null_mut();
        task.io_task.node.next = core::ptr::null_mut();

        self.increment_scan_counter();

        // Handle onLoad plugins
        if !self.enqueue_on_load_plugin_if_needed(task) {
            if loader.should_copy_for_bundling() {
                let additional_files: &mut BabyList<crate::AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                additional_files.append(crate::AdditionalFile::SourceIndex(task.source_index.get())).expect("oom");
                self.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                self.graph.estimated_file_loader_count += 1;
            }

            unsafe { self.graph.pool.as_mut() }.schedule(task);
        }
        Ok(source_index.get())
    }

    /// Enqueue a ServerComponentParseTask.
    /// `source_without_index` is copied and assigned a new source index. That index is returned.
    pub fn enqueue_server_component_generated_file(
        &mut self,
        data: crate::ServerComponentParseTask::Data,
        source_without_index: Logger::Source,
    ) -> Result<IndexInt, AllocError> {
        let mut new_source = source_without_index;
        let source_index = self.graph.input_files.len();
        new_source.index = bun_logger::Index(source_index as u32);
        // PORT NOTE: `Logger::Source: !Clone` — manually dup the (all-Clone) fields.
        let task_source = Logger::Source {
            path: new_source.path.clone(),
            contents: new_source.contents.clone(),
            contents_is_recycled: new_source.contents_is_recycled,
            identifier_name: new_source.identifier_name.clone(),
            index: new_source.index,
        };
        self.graph.input_files.append(crate::Graph::InputFile {
            source: new_source,
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::HasSideEffects,
            ..Default::default()
        })?;
        self.graph.ast.append(JSAst::empty());

        #[allow(unreachable_code)]
        let task = Box::leak(Box::new(ServerComponentParseTask {
            data,
            // SAFETY: lifetime-erase `'a` → `'static` for the BACKREF (matches Zig `*BundleV2`).
            ctx: (self as *mut Self).cast::<BundleV2<'static>>(),
            source: task_source,
            ..todo!("blocked_on: ServerComponentParseTask task field init (private callback)")
        }));

        self.increment_scan_counter();

        // SAFETY: `pool` and its `worker_pool` are live for the bundle lifetime.
        unsafe { (*(*self.graph.pool.as_ptr()).worker_pool).schedule(bun_threading::thread_pool::Batch::from(core::ptr::addr_of_mut!(task.task))) };

        Ok(u32::try_from(source_index).unwrap())
    }
}

pub struct DependenciesScanner {
    pub ctx: *mut (),
    pub entry_points: Box<[Box<[u8]>]>,
    pub on_fetch: fn(ctx: *mut (), result: &mut DependenciesScannerResult) -> Result<(), Error>,
}

pub struct DependenciesScannerResult<'r, 'a> {
    pub dependencies: bun_collections::StringSet,
    pub reachable_files: &'r [Index],
    pub bundle_v2: &'r mut BundleV2<'a>,
}

impl<'a> BundleV2<'a> {
    pub fn get_all_dependencies(&mut self, reachable_files: &[Index], fetcher: &DependenciesScanner) -> Result<(), Error> {
        // Find all external dependencies from reachable files
        let mut external_deps = bun_collections::StringSet::new();

        let import_records = self.graph.ast.items_import_records();

        for source_index in reachable_files {
            let records: &[ImportRecord] = import_records[source_index.get() as usize].slice();
            for record in records {
                if !record.source_index.is_valid() && record.tag == bun_options_types::import_record::Tag::None {
                    let path = &record.path.text;
                    // External dependency
                    if !path.is_empty()
                        // Check for either node or bun builtins
                        // We don't use the list from .bun because that includes third-party packages in some cases.
                        && !bun_resolve_builtins::HardcodedModule::Alias::has(path, Target::Node, Default::default())
                        && !path.starts_with(b"bun:")
                        && path != b"bun"
                    {
                        if strings::is_npm_package_name_ignore_length(path) {
                            external_deps.insert(path)?;
                        }
                    }
                }
            }
        }
        let mut result = DependenciesScannerResult {
            dependencies: external_deps,
            bundle_v2: self,
            reachable_files,
        };
        (fetcher.on_fetch)(fetcher.ctx, &mut result)
    }

    pub fn generate_from_cli(
        transpiler: &'a mut Transpiler<'a>,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
        enable_reloading: bool,
        reachable_files_count: &mut usize,
        minify_duration: &mut u64,
        source_code_size: &mut u64,
        fetcher: Option<&DependenciesScanner>,
    ) -> Result<BuildResult, Error> {
        let mut this = BundleV2::init(
            transpiler,
            None,
            alloc,
            event_loop,
            enable_reloading,
            None,
            ThreadLocalArena::new(),
        )?;
        this.unique_key = generate_unique_key();

        if unsafe { (*this.transpiler.log).has_errors() } {
            return Err(bun_core::err!("BuildFailed"));
        }

        // SAFETY: `transpiler.options.entry_points` is borrowed only for the duration
        // of `enqueue_entry_points_normal`, which never frees/reallocates it; raw-ptr
        // sidestep for the `&mut self` overlap (Zig stored both as raw `*Transpiler`).
        let entry_points: *const [Box<[u8]>] = &*this.transpiler.options.entry_points;
        this.enqueue_entry_points_normal(unsafe { &*entry_points })?;

        if unsafe { (*this.transpiler.log).has_errors() } {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.wait_for_parse();

        *minify_duration = (((bun_core::time::nano_timestamp() as i64) - (bun_core::start_time() as i64)) / (bun_core::time::NS_PER_MS as i64)) as u64;
        *source_code_size = this.source_code_length as u64;

        if unsafe { (*this.transpiler.log).has_errors() } {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.scan_for_secondary_paths();

        this.process_server_component_manifest_files()?;

        let mut reachable_files = this.find_reachable_files()?;
        *reachable_files_count = reachable_files.len().saturating_sub(1); // - 1 for the runtime

        this.process_files_to_copy(&reachable_files)?;

        this.add_server_component_boundaries_as_extra_entry_points()?;

        this.clone_ast()?;

        // SAFETY: `Graph::entry_points` is `Vec<js_ast::Index>` and
        // `LinkerContext::link` takes `&[js_ast::Index]`; the raw-ptr dance
        // sidesteps the `&mut self.linker` / `&mut *this` / `&this.graph`
        // borrow overlap (Zig stored all as raw ptrs).
        let mut chunks = unsafe {
            let bundle_ptr: *mut BundleV2 = &mut *this;
            let ep_len = (*bundle_ptr).graph.entry_points.len();
            // `Graph::entry_points` is `Vec<bun_js_parser::Index>`; `link()` takes
            // `&[crate::Index]` (= bun_options_types). Both are `#[repr(transparent)]`
            // `u32` newtypes (see ast/base.rs:52 / BundleEnums.rs:659), so a ptr cast
            // is layout-identical.
            let ep = (*bundle_ptr).graph.entry_points.as_ptr().cast::<Index>();
            let scbs = core::mem::take(&mut (*bundle_ptr).graph.server_component_boundaries);
            this.linker.link(
                &mut *bundle_ptr,
                core::slice::from_raw_parts(ep, ep_len),
                scbs,
                &mut reachable_files,
            )?
        };

        // Do this at the very end, after processing all the imports/exports so that we can follow exports as needed.
        if let Some(fetch) = fetcher {
            this.get_all_dependencies(&reachable_files, fetch)?;
            return Ok(BuildResult {
                output_files: Vec::new(),
                metafile: None,
                metafile_markdown: None,
            });
        }

        let output_files = crate::linker_context_mod::generate_chunks_in_parallel::<false>(&mut this.linker, &mut chunks)?;

        // Generate metafile if requested (CLI writes files in build_command.zig)
        let metafile: Option<Box<[u8]>> = if this.linker.options.metafile {
            match crate::linker_context::metafile_builder::generate(&mut this.linker, &mut chunks) {
                Ok(m) => Some(m),
                Err(err) => {
                    Output::warn(format_args!("Failed to generate metafile: {}", err));
                    None
                }
            }
        } else {
            None
        };

        // Markdown is generated later in build_command.zig for CLI
        Ok(BuildResult {
            output_files,
            metafile,
            metafile_markdown: None,
        })
    }

    /// Build only the parse graph for the given entry points and return the
    /// BundleV2 instance. No linking or code generation is performed; this is
    /// used by `bun test --changed` to walk import records and compute which
    /// test entry points transitively depend on a given set of source files.
    ///
    /// The returned BundleV2, its ThreadLocalArena, and its worker pool are
    /// intentionally left alive for the remainder of the process. Tearing
    /// the pool down via `deinitWithoutFreeingArena()` blocks on worker
    /// shutdown and contends with the runtime VM's own parse threads; the
    /// sole caller exec()s (watch mode) or exits shortly after, so the leak
    /// is bounded. Dupe anything you need out of the graph before returning
    /// to the caller.
    pub fn scan_module_graph_from_cli(
        transpiler: &'a mut Transpiler<'a>,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
        entry_points: &[&[u8]],
    ) -> Result<Box<BundleV2<'a>>, Error> {
        let mut this = BundleV2::init(
            transpiler,
            None,
            alloc,
            event_loop,
            false,
            None,
            ThreadLocalArena::new(),
        )?;
        this.unique_key = generate_unique_key();

        if unsafe { (*this.transpiler.log).has_errors() } {
            return Err(bun_core::err!("BuildFailed"));
        }

        // enqueueEntryPoints schedules the runtime task before any fallible
        // allocation. If a later allocation fails we must still drain the
        // pool so workers aren't left holding pointers into the caller's
        // stack-allocated Transpiler.
        if let Err(err) = this.enqueue_entry_points_normal(entry_points) {
            this.wait_for_parse();
            return Err(err);
        }

        // Even if entry point resolution produced errors we still wait for
        // all enqueued parse tasks to finish so the graph is consistent.
        this.wait_for_parse();

        Ok(this)
    }

    pub fn generate_from_bake_production_cli(
        entry_points: bake_types::production::EntryPointMap,
        server_transpiler: &'a mut Transpiler<'a>,
        bake_options: BakeOptions<'a>,
        alloc: &bun_alloc::Arena,
        event_loop: EventLoop,
    ) -> Result<Vec<options::OutputFile>, Error> {
        let mut this = BundleV2::init(
            server_transpiler,
            Some(bake_options),
            alloc,
            event_loop,
            false,
            None,
            ThreadLocalArena::new(),
        )?;
        this.unique_key = generate_unique_key();

        if unsafe { (*this.transpiler.log).has_errors() } {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.enqueue_entry_points_bake_production(entry_points)?;

        if unsafe { (*this.transpiler.log).has_errors() } {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.wait_for_parse();

        if unsafe { (*this.transpiler.log).has_errors() } {
            return Err(bun_core::err!("BuildFailed"));
        }

        this.scan_for_secondary_paths();

        this.process_server_component_manifest_files()?;

        let mut reachable_files = this.find_reachable_files()?;

        this.process_files_to_copy(&reachable_files)?;

        this.add_server_component_boundaries_as_extra_entry_points()?;

        this.clone_ast()?;

        // SAFETY: see `generate_from_cli` — raw-ptr borrow sidestep for
        // `&mut self.linker` / `&mut *this` / `&this.graph.entry_points`.
        let mut chunks = unsafe {
            let bundle_ptr: *mut BundleV2 = &mut *this;
            let ep_len = (*bundle_ptr).graph.entry_points.len();
            // Both Index newtypes are `#[repr(transparent)]` u32 — see `generate_from_cli`.
            let ep = (*bundle_ptr).graph.entry_points.as_ptr().cast::<Index>();
            let scbs = core::mem::take(&mut (*bundle_ptr).graph.server_component_boundaries);
            this.linker.link(
                &mut *bundle_ptr,
                core::slice::from_raw_parts(ep, ep_len),
                scbs,
                &mut reachable_files,
            )?
        };

        if chunks.is_empty() {
            return Ok(Vec::new());
        }

        let mut chunks = chunks;
        crate::linker_context_mod::generate_chunks_in_parallel::<false>(&mut this.linker, &mut chunks)
    }

    pub fn add_server_component_boundaries_as_extra_entry_points(&mut self) -> Result<(), Error> {
        // Prepare server component boundaries. Each boundary turns into two
        // entry points, a client entrypoint and a server entrypoint.
        //
        // TODO: This should be able to group components by the user specified
        // entry points. This way, using two component files in a route does not
        // create two separate chunks. (note: bake passes each route as an entrypoint)
        {
            let scbs = self.graph.server_component_boundaries.slice();
            self.graph.entry_points.reserve(scbs.list.len() * 2);
            debug_assert_eq!(scbs.list.source_index().len(), scbs.list.ssr_source_index().len());
            for (original_index, ssr_index) in scbs.list.source_index().iter().zip(scbs.list.ssr_source_index().iter()) {
                for idx in [*original_index, *ssr_index] {
                    self.graph.entry_points.push(bun_js_parser::Index::init(idx)); // PERF(port): was assume_capacity
                }
            }
        }
        Ok(())
    }

    pub fn process_files_to_copy(&mut self, reachable_files: &[Index]) -> Result<(), Error> {
        if self.graph.estimated_file_loader_count > 0 {
            // PORT NOTE: Zig per-file `allocator` column dropped — Box owns its alloc.
            // SAFETY: MultiArrayList columns are disjoint backing storage; raw-ptr
            // sidestep so we can hold several read-only column slices, one mutable
            // column slice (`additional_files`), and call `transpiler_for_target`
            // (which needs `&mut self`) inside the loop. Zig accessed all of these
            // as raw `.items(.field)` slices with no borrow-checking.
            let self_ptr: *mut Self = self;
            let unique_key_for_additional_files = unsafe { (*self_ptr).graph.input_files.items_unique_key_for_additional_file() };
            let content_hashes_for_additional_files = unsafe { (*self_ptr).graph.input_files.items_content_hash_for_additional_file() };
            let sources = unsafe { (*self_ptr).graph.input_files.items_source() };
            let targets = unsafe { (*self_ptr).graph.ast.items_target() };
            let mut additional_output_files: Vec<options::OutputFile> = Vec::new();

            let additional_files = unsafe { (*self_ptr).graph.input_files.items_additional_files_mut() };
            let loaders = unsafe { (*self_ptr).graph.input_files.items_loader() };

            for reachable_source in reachable_files {
                let index = reachable_source.get() as usize;
                let key: &[u8] = &unique_key_for_additional_files[index];
                if !key.is_empty() {
                    let mut template: options::PathTemplate = if self.graph.html_imports.server_source_indices.len != 0
                        && self.transpiler.options.asset_naming.is_empty()
                    {
                        options::PathTemplate::ASSET_WITH_TARGET.into()
                    } else {
                        options::PathTemplate::ASSET.into()
                    };

                    let target = targets[index];
                    // SAFETY: see `self_ptr` note above — `transpiler_for_target` needs
                    // `&mut self` only to pick between two stored `*mut Transpiler`s; it
                    // never touches `graph.input_files`.
                    let asset_naming = unsafe { &(*self_ptr).transpiler_for_target(target).options.asset_naming };
                    if !asset_naming.is_empty() {
                        template.data = asset_naming.clone();
                    }

                    let source = &sources[index];

                    let output_path: Box<[u8]> = {
                        // TODO: outbase
                        let pathname = Fs::PathName::init(bun_paths::resolve_path::relative_platform::<bun_paths::resolve_path::platform::Loose, false>(
                            &self.transpiler.options.root_dir,
                            &source.path.text,
                        ));

                        template.placeholder.name = pathname.base.to_vec().into_boxed_slice();
                        template.placeholder.dir = pathname.dir.to_vec().into_boxed_slice();
                        let mut ext: &[u8] = pathname.ext;
                        if !ext.is_empty() && ext[0] == b'.' {
                            ext = &ext[1..];
                        }
                        template.placeholder.ext = ext.to_vec().into_boxed_slice();

                        if template.needs(options::PlaceholderField::Hash) {
                            template.placeholder.hash = Some(content_hashes_for_additional_files[index]);
                        }

                        if template.needs(options::PlaceholderField::Target) {
                            template.placeholder.target = <&'static str>::from(target).as_bytes().to_vec().into_boxed_slice();
                        }
                        let mut v = Vec::new();
                        template.print(&mut v).expect("oom");
                        v.into_boxed_slice()
                    };

                    let loader = loaders[index];

                    additional_output_files.push(options::OutputFile::init(crate::output_file::Options {
                        source_index: crate::output_file::IndexOptional::some(crate::output_file::Index(index as u32)),
                        data: crate::output_file::OptionsData::Buffer {
                            data: source.contents.to_vec().into_boxed_slice(),
                        },
                        size: Some(source.contents.len()),
                        output_path,
                        input_path: source.path.text.to_vec().into_boxed_slice(),
                        input_loader: Loader::File,
                        output_kind: crate::options::OutputKind::Asset,
                        loader,
                        hash: Some(content_hashes_for_additional_files[index]),
                        side: Some(crate::options::Side::Client),
                        entry_point_index: None,
                        is_executable: false,
                        ..Default::default()
                    }));
                    additional_files[index].append(crate::AdditionalFile::OutputFile((additional_output_files.len() - 1) as u32)).expect("oom");
                }
            }

            self.graph.additional_output_files = additional_output_files;
        }
        Ok(())
    }

    pub fn on_load_async(&mut self, load: &mut jsc_api::JSBundler::Load) {
        // CYCLEBREAK GENUINE: `linker.r#loop` is an erased `Option<NonNull<()>>`;
        // the Js/Mini discriminant is owned by T6. With a JS completion task we
        // can route through its event loop; otherwise (CLI/Mini) call inline.
        if let Some(completion) = self.completion {
            // SAFETY: completion is a valid backref while bundle is running.
            unsafe { &(*completion).jsc_event_loop }.enqueue_task_concurrent(
                bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(load as *mut _, on_load_from_js_loop_raw),
            );
        } else {
            Self::on_load(load, self);
        }
    }

    pub fn on_resolve_async(&mut self, resolve: &mut jsc_api::JSBundler::Resolve) {
        // CYCLEBREAK GENUINE: see `on_load_async`.
        if let Some(completion) = self.completion {
            // SAFETY: completion is a valid backref while bundle is running.
            unsafe { &(*completion).jsc_event_loop }.enqueue_task_concurrent(
                bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(resolve as *mut _, on_resolve_from_js_loop_raw),
            );
        } else {
            Self::on_resolve(resolve, self);
        }
    }
}

pub fn on_load_from_js_loop(load: &mut jsc_api::JSBundler::Load) {
    // SAFETY: `bv2` is a live backref set in `Load::init`.
    let bv2 = unsafe { &mut *load.bv2 };
    BundleV2::on_load(load, bv2);
}

fn on_load_from_js_loop_raw(load: *mut jsc_api::JSBundler::Load) -> Result<(), *mut ()> {
    // SAFETY: `load` is a valid pointer set up by `from_callback`.
    on_load_from_js_loop(unsafe { &mut *load });
    Ok(())
}

impl<'a> BundleV2<'a> {
    pub fn on_load(load: &mut jsc_api::JSBundler::Load, this: &mut BundleV2) {
        bun_core::scoped_log!(Bundle, "onLoad: ({}, {:?})", load.source_index.get(), core::mem::discriminant(&load.value));
        // PORT NOTE: `helpCatchMemoryIssues` was a mimalloc TLH probe; bumpalo has no equivalent.
        let _ = FeatureFlags::HELP_CATCH_MEMORY_ISSUES;
        let log = this.transpiler.log;

        // TODO: watcher

        match load.value.consume() {
            jsc_api::JSBundler::LoadValue::NoMatch => {
                let source = &this.graph.input_files.items_source()[load.source_index.get() as usize];
                // If it's a file namespace, we should run it through the parser like normal.
                // The file could be on disk.
                if source.path.is_file() {
                    unsafe { this.graph.pool.as_mut() }.schedule(unsafe { &mut *load.parse_task });
                    return;
                }

                // When it's not a file, this is a build error and we should report it.
                // we have no way of loading non-files.
                let _ = unsafe { &mut *log }.add_error_fmt(Some(source), Logger::Loc::EMPTY, format_args!(
                    "Module not found {} in namespace {}",
                    bun_core::fmt::quote(&source.path.pretty),
                    bun_core::fmt::quote(&source.path.namespace),
                ));

                // An error occurred, prevent spinning the event loop forever
                this.decrement_scan_counter();
            }
            jsc_api::JSBundler::LoadValue::Success(code) => {
                let code = code; // LoadSuccess { source_code, loader }
                // When a plugin returns a file loader, we always need to populate additional_files
                let should_copy_for_bundling = code.loader.should_copy_for_bundling();
                if should_copy_for_bundling {
                    let source_index = load.source_index;
                    let additional_files: &mut BabyList<crate::AdditionalFile> = &mut this.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                    let _ = additional_files.append(crate::AdditionalFile::SourceIndex(source_index.get()));
                    this.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                    this.graph.estimated_file_loader_count += 1;
                }
                this.graph.input_files.items_loader_mut()[load.source_index.get() as usize] = code.loader;
                // PERF(port): Zig aliased the same `source_code` slice three ways; Rust
                // boxes are single-owner, so leak once to a `'static` slice and reuse.
                let source_code: &'static [u8] = Box::leak(code.source_code);
                this.graph.input_files.items_source_mut()[load.source_index.get() as usize].contents = std::borrow::Cow::Borrowed(source_code);
                this.graph.input_files.items_flags_mut()[load.source_index.get() as usize].insert(crate::Graph::InputFileFlags::IS_PLUGIN_FILE);
                // SAFETY: `parse_task` was set in `Load::init` and is live for the load.
                let parse_task = unsafe { &mut *load.parse_task };
                parse_task.loader = Some(code.loader);
                if !should_copy_for_bundling {
                    this.free_list.push(Box::<[u8]>::from(source_code));
                }
                parse_task.contents_or_fd = parse_task::ContentsOrFd::Contents(source_code);
                unsafe { this.graph.pool.as_mut() }.schedule(parse_task);

                if let Some(watcher) = this.bun_watcher {
                    'add_watchers: {
                        if !this.should_add_watcher_plugin(&load.namespace, &load.path) {
                            break 'add_watchers;
                        }

                        // TODO: support explicit watchFiles array. this is not done
                        // right now because DevServer requires a table to map
                        // watched files and dirs to their respective dependants.
                        // PORT NOTE: `Watcher.REQUIRES_FILE_DESCRIPTORS` is `true`
                        // only on macOS (kqueue needs an open fd per file).
                        let fd = if cfg!(target_os = "macos") {
                            let mut buf = bun_paths::path_buffer_pool::get();
                            // PORT NOTE: Zig used `std.posix.toPosixPath` (copy + NUL-
                            // terminate); on macOS paths are already posix-separated so
                            // `z()` alone suffices. `Watcher.WATCH_OPEN_FLAGS` = `O_EVTONLY`.
                            match bun_sys::open(bun_paths::resolve_path::z(load.path.as_ref(), &mut *buf), 0x8000 /* O_EVTONLY */, 0) {
                                bun_sys::Result::Ok(fd) => fd,
                                bun_sys::Result::Err(_) => break 'add_watchers,
                            }
                        } else {
                            bun_sys::Fd::INVALID
                        };

                        // CYCLEBREAK GENUINE: `bun_watcher` is an erased
                        // `Option<NonNull<()>>`; the `add_file` call goes through
                        // the runtime-registered watcher hook.
                        let hook = dispatch::WATCHER_HOOK.load(core::sync::atomic::Ordering::Acquire);
                        if !hook.is_null() {
                            // SAFETY: `hook` is a leaked `&'static WatcherVTable`
                            // registered at runtime init; `watcher` is valid while
                            // the bundle is running.
                            let _ = unsafe {
                                ((*hook).add_file)(
                                    watcher.as_ptr(),
                                    fd,
                                    &load.path,
                                    bun_wyhash::hash(load.path.as_ref()) as u32,
                                    code.loader,
                                    bun_sys::Fd::INVALID,
                                    None,
                                    true,
                                )
                            };
                        }
                    }
                }
            }
            jsc_api::JSBundler::LoadValue::Err(msg) => {
                if let Some(dev) = this.dev_server {
                    let source = &this.graph.input_files.items_source()[load.source_index.get() as usize];
                    // A stack-allocated Log object containing the singular message
                    let kind = msg.kind;
                    let temp_log = Logger::Log {
                        clone_line_text: false,
                        errors: (kind == Logger::Kind::Err) as u32,
                        warnings: (kind == Logger::Kind::Warn) as u32,
                        msgs: vec![msg],
                        ..Default::default()
                    };
                    dev.handle_parse_task_failure(
                        bun_core::err!("Plugin"),
                        load.bake_graph(),
                        source.path.key_for_incremental_graph(),
                        &temp_log,
                        this,
                    ).expect("oom");
                } else {
                    let kind = msg.kind;
                    // SAFETY: `log` is `*mut Log` backref valid for the bundle.
                    let log = unsafe { &mut *log };
                    log.msgs.push(msg);
                    log.errors += (kind == Logger::Kind::Err) as u32;
                    log.warnings += (kind == Logger::Kind::Warn) as u32;
                }

                // An error occurred, prevent spinning the event loop forever
                this.decrement_scan_counter();
            }
            jsc_api::JSBundler::LoadValue::Pending | jsc_api::JSBundler::LoadValue::Consumed => unreachable!(),
        }
        // load is dropped here (defer load.deinit())
    }
}

pub fn on_resolve_from_js_loop(resolve: &mut jsc_api::JSBundler::Resolve) {
    // SAFETY: `bv2` is a live backref set in `Resolve::init`.
    let bv2 = unsafe { &mut *resolve.bv2 };
    BundleV2::on_resolve(resolve, bv2);
}

fn on_resolve_from_js_loop_raw(resolve: *mut jsc_api::JSBundler::Resolve) -> Result<(), *mut ()> {
    // SAFETY: `resolve` is a valid pointer set up by `from_callback`.
    on_resolve_from_js_loop(unsafe { &mut *resolve });
    Ok(())
}

impl<'a> BundleV2<'a> {
    pub fn on_resolve(resolve: &mut jsc_api::JSBundler::Resolve, this: &mut BundleV2) {
        // SAFETY: `this` outlives `_dec_guard` (dropped at fn exit). Capturing
        // `this` by reference would hold a unique borrow for the whole body and
        // block every subsequent use; raw-ptr capture mirrors Zig's
        // `defer this.decrementScanCounter()` without borrowck contention.
        let this_ptr: *mut BundleV2 = this;
        let _dec_guard = scopeguard::guard((), move |_| unsafe { (*this_ptr).decrement_scan_counter() });
        bun_core::scoped_log!(Bundle, "onResolve: ({}:{}, {:?})",
            bstr::BStr::new(&resolve.import_record.namespace),
            bstr::BStr::new(&resolve.import_record.specifier),
            core::mem::discriminant(&resolve.value));

        // PORT NOTE: `helpCatchMemoryIssues` was a mimalloc TLH probe; bumpalo has no equivalent.
        let _ = FeatureFlags::HELP_CATCH_MEMORY_ISSUES;

        match resolve.value.consume() {
            jsc_api::JSBundler::ResolveValue::NoMatch => {
                // If it's a file namespace, we should run it through the resolver like normal.
                //
                // The file could be on disk.
                if resolve.import_record.namespace.as_ref() == b"file" {
                    if resolve.import_record.kind == ImportKind::EntryPointBuild {
                        let target = resolve.import_record.original_target;
                        let Ok(resolved) = this.transpiler_for_target(target).resolve_entry_point(&resolve.import_record.specifier) else {
                            return;
                        };
                        let mut resolved = resolved;
                        let Ok(source_index) = this.enqueue_entry_item(&mut resolved, true, target) else {
                            return;
                        };

                        // Store the original entry point name for virtual entries that fall back to file resolution
                        if let Some(idx) = source_index {
                            let _ = this.graph.entry_point_original_names.put(idx, &resolve.import_record.specifier);
                        }
                        return;
                    }

                    this.run_resolver(resolve.import_record.clone(), resolve.import_record.original_target);
                    return;
                }

                let log = this.log_for_resolution_failures(&resolve.import_record.source_file, resolve.import_record.original_target.bake_graph());

                // When it's not a file, this is an error and we should report it.
                //
                // We have no way of loading non-files.
                if resolve.import_record.kind == ImportKind::EntryPointBuild {
                    let _ = log.add_error_fmt(None, Logger::Loc::EMPTY, format_args!(
                        "Module not found {} in namespace {}",
                        bun_core::fmt::quote(&resolve.import_record.specifier),
                        bun_core::fmt::quote(&resolve.import_record.namespace),
                    ));
                } else {
                    let source = &this.graph.input_files.items_source()[resolve.import_record.importer_source_index as usize];
                    let _ = log.add_range_error_fmt(
                        Some(source),
                        resolve.import_record.range,
                        format_args!(
                            "Module not found {} in namespace {}",
                            bun_core::fmt::quote(&resolve.import_record.specifier),
                            bun_core::fmt::quote(&resolve.import_record.namespace),
                        ),
                    );
                }
            }
            jsc_api::JSBundler::ResolveValue::Success(result) => {
                let mut out_source_index: Option<Index> = None;
                if !result.external {
                    let mut path = Fs::Path::init(&result.path);
                    if result.namespace.is_empty() || result.namespace.as_ref() == b"file" {
                        path.namespace = b"file";
                    } else {
                        path.namespace = &result.namespace;
                    }

                    let existing = this.path_to_source_index_map(resolve.import_record.original_target)
                        .get_or_put(path.text).expect("oom");
                    if !existing.found_existing {
                        let _ = this.free_list.extend_from_slice(&[result.namespace.clone(), result.path.clone()]);
                        path = this.path_with_pretty_initialized(path, resolve.import_record.original_target).expect("oom");
                        // PORT NOTE: `GetOrPutResult` has no `key_ptr` — `get_or_put` already
                        // duped the key into the map (see PathToSourceIndexMap.rs).

                        // We need to parse this
                        let source_index = Index::init(u32::try_from(this.graph.ast.len()).unwrap());
                        *existing.value_ptr = source_index.get();
                        out_source_index = Some(source_index);
                        this.graph.ast.append(JSAst::empty());
                        let loader = path.loader(&this.transpiler.options.loaders).unwrap_or(Loader::File);

                        this.graph.input_files.append(crate::Graph::InputFile {
                            source: Logger::Source {
                                path: todo!("blocked_on: bun_resolver::Path::dupe_alloc"),
                                contents: std::borrow::Cow::Borrowed(&b""[..]),
                                index: bun_logger::Index(source_index.get()),
                                ..Default::default()
                            },
                            loader,
                            side_effects: _resolver::SideEffects::HasSideEffects,
                            ..Default::default()
                        }).expect("unreachable");
                        let task = Box::new(ParseTask {
                            ctx: this,
                            path,
                            // unknown at this point:
                            contents_or_fd: parse_task::ContentsOrFd::Fd {
                                dir: bun_sys::Fd::INVALID,
                                file: bun_sys::Fd::INVALID,
                            },
                            side_effects: _resolver::SideEffects::HasSideEffects,
                            jsx: this.transpiler_for_target(resolve.import_record.original_target).options.jsx.clone(),
                            source_index: bun_js_parser::Index::init(source_index.get()),
                            module_type: options::ModuleType::Unknown,
                            loader: Some(loader),
                            tree_shaking: this.linker.options.tree_shaking,
                            known_target: resolve.import_record.original_target,
                            ..Default::default()
                        });
                        let task = Box::leak(task); // TODO(port): owned by pool; freed via destroy()
                        task.task.node.next = core::ptr::null_mut();
                        task.io_task.node.next = core::ptr::null_mut();
                        this.increment_scan_counter();

                        if !this.enqueue_on_load_plugin_if_needed(task) {
                            if loader.should_copy_for_bundling() {
                                let additional_files: &mut BabyList<crate::AdditionalFile> = &mut this.graph.input_files.items_additional_files_mut()[source_index.get() as usize];
                                additional_files.append(crate::AdditionalFile::SourceIndex(task.source_index.get())).expect("oom");
                                this.graph.input_files.items_side_effects_mut()[source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                                this.graph.estimated_file_loader_count += 1;
                            }

                            unsafe { this.graph.pool.as_mut() }.schedule(task);
                        }
                    } else {
                        out_source_index = Some(Index::init(*existing.value_ptr));
                        // PORT NOTE: Zig freed result.{namespace,path} here; Rust drops below.
                        drop(result.namespace);
                        drop(result.path);
                    }
                } else {
                    drop(result.namespace);
                    drop(result.path);
                }

                if let Some(source_index) = out_source_index {
                    if resolve.import_record.kind == ImportKind::EntryPointBuild {
                        this.graph.entry_points.push(bun_js_parser::Index::init(source_index.get()));

                        // Store the original entry point name for virtual entries
                        // This preserves the original name for output file naming
                        let _ = this.graph.entry_point_original_names.put(source_index.get(), &resolve.import_record.specifier);
                    } else {
                        let source_import_records = &mut this.graph.ast.items_import_records_mut()[resolve.import_record.importer_source_index as usize];
                        if source_import_records.len <= resolve.import_record.import_record_index {
                            let entry = this.resolve_tasks_waiting_for_import_source_index.get_or_put(
                                resolve.import_record.importer_source_index,
                            ).expect("oom");
                            if !entry.found_existing {
                                *entry.value_ptr = BabyList::default();
                            }
                            let _ = entry.value_ptr.append(PendingImport {
                                to_source_index: source_index,
                                import_record_index: resolve.import_record.import_record_index,
                            });
                        } else {
                            let import_record: &mut ImportRecord = &mut source_import_records.slice_mut()[resolve.import_record.import_record_index as usize];
                            import_record.source_index = source_index;
                        }
                    }
                }
            }
            jsc_api::JSBundler::ResolveValue::Err(err) => {
                let log = this.log_for_resolution_failures(&resolve.import_record.source_file, resolve.import_record.original_target.bake_graph());
                let kind = err.kind;
                log.msgs.push(err.clone().expect("oom"));
                log.errors += (kind == Logger::Kind::Err) as u32;
                log.warnings += (kind == Logger::Kind::Warn) as u32;
            }
            jsc_api::JSBundler::ResolveValue::Pending | jsc_api::JSBundler::ResolveValue::Consumed => unreachable!(),
        }
        // resolve is dropped here (defer resolve.deinit())
    }

    pub fn deinit_without_freeing_arena(&mut self) {
        {
            // We do this first to make it harder for any dangling pointers to data to be used in there.
            let on_parse_finalizers = core::mem::take(&mut self.finalizers);
            for finalizer in &on_parse_finalizers {
                finalizer.call();
            }
            drop(on_parse_finalizers);
        }

        // TODO(port): defer block — graph.ast/input_files/entry_points/entry_point_original_names deinit
        // In Rust these are dropped automatically; arena-backed slices are bulk-freed.

        // bundle_v2.zig:1426-1437 — worker-assignment teardown.
        let pool = unsafe { self.graph.pool.as_mut() };
        {
            let mut assignments = pool.workers_assignments.lock();
            if assignments.count() > 0 {
                for worker in assignments.values() {
                    // SAFETY: worker ptrs are live until `deinit_soon`.
                    unsafe { (**worker).deinit_soon() };
                }
                assignments.clear_retaining_capacity();
                // SAFETY: worker_pool is live for the bundle lifetime.
                unsafe { (*pool.worker_pool).wake_for_idle_events() };
            }
        }
        pool.deinit();

        for free in self.free_list.drain(..) {
            drop(free);
        }
    }

    pub fn run_from_js_in_new_thread(
        &mut self,
        entry_points: &[&[u8]],
    ) -> Result<BuildResult, Error> {
        self.unique_key = generate_unique_key();

        if unsafe { (*self.transpiler.log).errors } > 0 {
            return Err(bun_core::err!("BuildFailed"));
        }

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        self.enqueue_entry_points_normal(entry_points)?;

        // We must wait for all the parse tasks to complete, even if there are errors.
        self.wait_for_parse();

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        if unsafe { (*self.transpiler.log).errors } > 0 {
            return Err(bun_core::err!("BuildFailed"));
        }

        self.scan_for_secondary_paths();

        self.process_server_component_manifest_files()?;

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        self.clone_ast()?;

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        let reachable_files = self.find_reachable_files()?;

        self.process_files_to_copy(&reachable_files)?;

        self.add_server_component_boundaries_as_extra_entry_points()?;

        // SAFETY: see `generate_from_cli` — repr(transparent) Index slice cast +
        // raw-ptr borrow sidestep for `&mut self.linker` / `&mut *self`.
        let mut chunks = unsafe {
            let bundle_ptr: *mut BundleV2 = self;
            let ep_len = (*bundle_ptr).graph.entry_points.len();
            let ep = (*bundle_ptr).graph.entry_points.as_ptr();
            let scbs = core::mem::take(&mut (*bundle_ptr).graph.server_component_boundaries);
            let mut reachable_files = reachable_files;
            self.linker.link(
                &mut *bundle_ptr,
                core::slice::from_raw_parts(ep, ep_len),
                scbs,
                &mut reachable_files,
            )?
        };

        if unsafe { (*self.transpiler.log).errors } > 0 {
            return Err(bun_core::err!("BuildFailed"));
        }

        let mut output_files = crate::linker_context_mod::generate_chunks_in_parallel::<false>(&mut self.linker, &mut chunks)?;

        // Generate metafile if requested
        let metafile: Option<Box<[u8]>> = if self.linker.options.metafile {
            match crate::linker_context::metafile_builder::generate(&mut self.linker, &mut chunks) {
                Ok(m) => Some(m),
                Err(err) => {
                    Output::warn(format_args!("Failed to generate metafile: {}", err.name()));
                    None
                }
            }
        } else {
            None
        };

        // Generate markdown if metafile was generated and path specified
        let metafile_markdown: Option<Box<[u8]>> = if !self.linker.options.metafile_markdown_path.is_empty() && metafile.is_some() {
            match crate::linker_context::metafile_builder::generate_markdown(metafile.as_ref().unwrap()) {
                Ok(m) => Some(m),
                Err(err) => {
                    Output::warn(format_args!("Failed to generate metafile markdown: {}", err));
                    None
                }
            }
        } else {
            None
        };

        // Write metafile outputs to disk and add them as OutputFiles.
        // Metafile paths are relative to outdir, like all other output files.
        // SAFETY: `resolver` is a `*mut Resolver` backref valid for the bundle.
        let outdir = unsafe { &(*self.linker.resolver).opts.output_dir };
        if !self.linker.options.metafile_json_path.is_empty() {
            if let Some(mf) = &metafile {
                write_metafile_output(&mut output_files, outdir, &self.linker.options.metafile_json_path, mf, crate::options::OutputKind::MetafileJson)?;
            }
        }
        if !self.linker.options.metafile_markdown_path.is_empty() {
            if let Some(md) = &metafile_markdown {
                write_metafile_output(&mut output_files, outdir, &self.linker.options.metafile_markdown_path, md, crate::options::OutputKind::MetafileMarkdown)?;
            }
        }

        Ok(BuildResult {
            output_files,
            metafile,
            metafile_markdown,
        })
    }
}

/// Writes a metafile (JSON or markdown) to disk and appends it to the output_files list.
/// Metafile paths are relative to outdir, like all other output files.
fn write_metafile_output(
    output_files: &mut Vec<options::OutputFile>,
    outdir: &[u8],
    file_path: &[u8],
    content: &[u8],
    output_kind: crate::options::OutputKind,
) -> Result<(), Error> {
    if !outdir.is_empty() {
        // Open the output directory and write the metafile relative to it.
        // PORT NOTE: Zig used `bun.FD.cwd().makeOpenPath()` +
        // `NodeFS.writeFileWithPathBuffer`. Route through `bun_sys::File`.
        let mut buf = bun_paths::path_buffer_pool::get();
        let joined = bun_paths::resolve_path::join_string_buf::<bun_paths::resolve_path::platform::Auto>(
            &mut buf.0[..], &[outdir, file_path],
        );
        // Create parent directories if needed (relative to outdir).
        let parent = bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Loose>(joined);
        if !parent.is_empty() {
            let _ = bun_sys::mkdir_recursive(parent);
        }
        let mut zbuf = bun_paths::path_buffer_pool::get();
        let joined_z = bun_paths::resolve_path::z(joined, &mut zbuf);
        match bun_sys::File::write_file(bun_core::Fd::cwd(), joined_z, content) {
            Ok(()) => {}
            Err(err) => {
                Output::warn(format_args!(
                    "Failed to write metafile to '{}': {}",
                    bstr::BStr::new(file_path), err
                ));
            }
        }
    }

    // Add as OutputFile so it appears in result.outputs
    let is_json = output_kind == crate::options::OutputKind::MetafileJson;
    output_files.push(options::OutputFile::init(crate::output_file::Options {
        loader: if is_json { Loader::Json } else { Loader::File },
        input_loader: if is_json { Loader::Json } else { Loader::File },
        input_path: Box::<[u8]>::from(if is_json { b"metafile.json".as_slice() } else { b"metafile.md".as_slice() }),
        output_path: Box::<[u8]>::from(file_path),
        data: crate::output_file::OptionsData::Saved(content.len()),
        output_kind,
        is_executable: false,
        side: None,
        entry_point_index: None,
        ..Default::default()
    }));
    Ok(())
}

impl<'a> BundleV2<'a> {
    fn should_add_watcher_plugin(&self, namespace: &[u8], path: &[u8]) -> bool {
        namespace == b"file"
            && bun_paths::is_absolute(path)
            && self.should_add_watcher(path)
    }

    fn should_add_watcher(&self, path: &[u8]) -> bool {
        if self.dev_server.is_some() {
            strings::index_of(path, b"/node_modules/").is_none()
                && (if cfg!(windows) { strings::index_of(path, b"\\node_modules\\").is_none() } else { true })
        } else {
            true // `bun build --watch` has always watched node_modules
        }
    }

    /// Dev Server uses this instead to run a subset of the transpiler, and to run it asynchronously.
    pub fn start_from_bake_dev_server(&mut self, bake_entry_points: bake_types::EntryPointList) -> Result<DevServerInput, Error> {
        self.unique_key = generate_unique_key();

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        let mut ctx = DevServerInput {
            css_entry_points: ArrayHashMap::new(),
        };
        self.enqueue_entry_points_dev_server(bake_entry_points, &mut ctx.css_entry_points)?;

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        Ok(ctx)
    }

    // TODO(b0-genuine): body has deep DevServer field access (current_bundle.start_data,
    // css_entry_points, etc.). After tier-6 collapse this fn should be HOISTED into
    // bun_runtime::bake (which can name DevServer concretely) and call back into BundleV2
    // helpers. Until then the entry-point fields are reached through the vtable.
    pub fn finish_from_bake_dev_server(&mut self, dev_server: &dispatch::DevServerHandle) -> Result<(), AllocError> {
        // SAFETY: DevServer guarantees current_bundle is Some during finish (DevServer.zig:2237).
        let start = unsafe { &mut *(dev_server.vtable.current_bundle_start_data)(dev_server.owner).cast::<DevServerInput>() };

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        self.clone_ast().map_err(|_| AllocError)?;

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        self.dynamic_import_entry_points = ArrayHashMap::new();
        let mut html_files: ArrayHashMap<Index, ()> = ArrayHashMap::new();

        // Separate non-failing files into two lists: JS and CSS
        let js_reachable_files: &[Index] = 'reachable_files: {
            let mut css_total_files: Vec<Index> = Vec::with_capacity(self.graph.css_file_count);
            start.css_entry_points.reserve(self.graph.css_file_count);
            let mut js_files: Vec<Index> = Vec::with_capacity(self.graph.ast.len() - self.graph.css_file_count - 1);

            let asts = self.graph.ast.slice();
            let css_asts = asts.css();

            let input_files = self.graph.input_files.slice();
            let loaders = input_files.loader();
            let sources = input_files.source();
            // TODO(port): multi-zip iteration over MultiArrayList slices [1..]
            for index in 1..self.graph.ast.len() {
                let part_list = &asts.parts()[index];
                let import_records = &asts.import_records()[index];
                let maybe_css = &css_asts[index];
                let target = asts.target()[index];
                // Dev Server proceeds even with failed files.
                // These files are filtered out via the lack of any parts.
                //
                // Actual empty files will contain a part exporting an empty object.
                if part_list.len != 0 {
                    if maybe_css.is_some() {
                        // CSS has restrictions on what files can be imported.
                        // This means the file can become an error after
                        // resolution, which is not usually the case.
                        css_total_files.push(Index::init(u32::try_from(index).unwrap())); // PERF(port): was assume_capacity
                        let mut log = Logger::Log::init();
                        if self.linker.scan_css_imports(
                            u32::try_from(index).unwrap(),
                            import_records.slice(),
                            // PORT NOTE: `scan_css_imports` takes the column as a raw
                            // `*mut` slice (the scanImportsAndExports caller holds raw
                            // SoA pointers); it only reads via `is_none()`.
                            css_asts as *const [Option<*mut core::ffi::c_void>] as *mut [Option<*mut core::ffi::c_void>],
                            sources,
                            loaders,
                        ) == crate::linker_context_mod::ScanCssImportsResult::Errors {
                            // TODO: it could be possible for a plugin to change
                            // the type of loader from whatever it was into a
                            // css-compatible loader.
                            dev_server.handle_parse_task_failure(
                                bun_core::err!("InvalidCssImport"),
                                bake::Graph::Client,
                                &sources[index].path.text,
                                &log,
                                self,
                            ).map_err(|_| AllocError)?;
                            // Since there is an error, do not treat it as a
                            // valid CSS chunk.
                            let _ = start.css_entry_points.swap_remove(&Index::init(u32::try_from(index).unwrap()));
                        }
                    } else {
                        // HTML files are special cased because they correspond
                        // to routes in DevServer. They have a JS chunk too,
                        // derived off of the import record list.
                        if loaders[index] == Loader::Html {
                            html_files.put(Index::init(u32::try_from(index).unwrap()), ())?;
                        } else {
                            js_files.push(Index::init(u32::try_from(index).unwrap())); // PERF(port): was assume_capacity

                            // Mark every part live.
                            for p in part_list.slice_mut() {
                                p.is_live = true;
                            }
                        }

                        // Discover all CSS roots.
                        for record in import_records.slice_mut() {
                            if !record.source_index.is_valid() { continue; }
                            if loaders[record.source_index.get() as usize] != Loader::Css { continue; }
                            if asts.parts()[record.source_index.get() as usize].len == 0 {
                                record.source_index = Index::INVALID;
                                continue;
                            }

                            let gop = start.css_entry_points.get_or_put(record.source_index).expect("oom");
                            if target != Target::Browser {
                                *gop.value_ptr = CssEntryPointMeta { imported_on_server: true };
                            } else if !gop.found_existing {
                                *gop.value_ptr = CssEntryPointMeta { imported_on_server: false };
                            }
                        }
                    }
                } else {
                    // Treat empty CSS files for removal.
                    let _ = start.css_entry_points.swap_remove(&Index::init(u32::try_from(index).unwrap()));
                }
            }

            // Find CSS entry points. Originally, this was computed up front, but
            // failed files do not remember their loader, and plugins can
            // asynchronously decide a file is CSS.
            let css = asts.css();
            for entry_point in &self.graph.entry_points {
                if css[entry_point.get() as usize].is_some() {
                    start.css_entry_points.put(
                        Index::init(entry_point.get()),
                        CssEntryPointMeta { imported_on_server: false },
                    )?;
                }
            }

            // TODO(port): leak js_files into arena — Zig returned .items
            break 'reachable_files self.allocator().alloc_slice_copy(&js_files);
        };

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        // HMR skips most of the linker! All linking errors are converted into
        // runtime errors to avoid a more complicated dependency graph. For
        // example, if you remove an exported symbol, we only rebuild the
        // changed file, then detect the missing export at runtime.
        //
        // Additionally, notice that we run this code generation even if we have
        // files that failed. This allows having a large build graph (importing
        // a new npm dependency), where one file that fails doesnt prevent the
        // passing files to get cached in the incremental graph.

        // The linker still has to be initialized as code generation expects
        // much of its state to be valid memory, even if empty.
        // SAFETY: see `generate_from_cli` — repr(transparent) Index slice cast +
        // raw-ptr borrow sidestep for `&mut self.linker` / `&mut *self`.
        unsafe {
            let bundle_ptr: *mut BundleV2 = self;
            let ep_len = (*bundle_ptr).graph.entry_points.len();
            // Both Index newtypes are `#[repr(transparent)]` u32 — see `generate_from_cli`.
            let ep = (*bundle_ptr).graph.entry_points.as_ptr().cast::<Index>();
            let scbs = core::mem::take(&mut (*bundle_ptr).graph.server_component_boundaries);
            self.linker.load(
                &mut *bundle_ptr,
                core::slice::from_raw_parts(ep, ep_len),
                scbs,
                js_reachable_files,
            ).map_err(|_| AllocError)?;
        }

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        // Compute line offset tables and quoted contents, used in source maps.
        // Quoted contents will be default-allocated
        if cfg!(debug_assertions) {
            for idx in js_reachable_files {
                debug_assert!(self.graph.ast.items_parts()[idx.get() as usize].len != 0); // will create a memory leak
            }
        }
        // SAFETY: Index is repr(transparent) over u32
        self.linker.compute_data_for_source_map(unsafe { core::mem::transmute::<&[Index], &[IndexInt]>(js_reachable_files) });
        // TODO(port): errdefer { bun.outOfMemory() } — caller cannot recover

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        // Generate chunks
        let js_part_ranges = self.allocator().alloc_slice_fill_default::<crate::ungate_support::PartRange>(js_reachable_files.len());
        let parts = self.graph.ast.items_parts();
        debug_assert_eq!(js_reachable_files.len(), js_part_ranges.len());
        for (source_index, part_range) in js_reachable_files.iter().zip(js_part_ranges.iter_mut()) {
            *part_range = crate::ungate_support::PartRange {
                source_index: *source_index,
                part_index_begin: 0,
                part_index_end: parts[source_index.get() as usize].len,
            };
        }

        // PORT NOTE: `Chunk: !Default` (BabyList fields). Allocate via Vec then
        // leak into the arena.
        let mut chunks: Vec<Chunk> = Vec::with_capacity(
            1 + start.css_entry_points.count() + html_files.count(),
        );

        // First is a chunk to contain all JavaScript modules.
        chunks.push(Chunk {
            entry_point: chunk::EntryPoint::new(0, 0, true, false),
            content: chunk::Content::Javascript({
                let mut js = chunk::JavaScriptChunk::default();
                // TODO(@paperclover): remove this ptrCast when Source Index is fixed
                // SAFETY: Index is repr(transparent) over u32
                js.files_in_chunk_order = unsafe { core::mem::transmute::<&[Index], &[u32]>(js_reachable_files) }
                    .to_vec().into_boxed_slice();
                js.parts_in_chunk_in_order = js_part_ranges.to_vec().into_boxed_slice();
                js
            }),
            output_source_map: SourceMap::SourceMapPieces::init(),
            ..Chunk::default()
        });

        // Then all the distinct CSS bundles (these are JS->CSS, not CSS->CSS)
        for entry_point in start.css_entry_points.keys() {
            #[cfg(feature = "css")]
            let order = crate::linker_context::find_imported_files_in_css_order::find_imported_files_in_css_order(&mut self.linker, self.allocator(), &[*entry_point]);
            #[cfg(not(feature = "css"))]
            let order: BabyList<chunk::CssImportOrder> = BabyList::default();
            chunks.push(Chunk {
                entry_point: chunk::EntryPoint::new(entry_point.get(), entry_point.get(), false, false),
                content: chunk::Content::Css(chunk::CssChunk {
                    imports_in_chunk_in_order: order,
                    asts: (0..order.len as usize)
                        .map(|_| bun_css::BundlerStyleSheet::empty())
                        .collect::<Vec<_>>()
                        .into_boxed_slice(),
                }),
                output_source_map: SourceMap::SourceMapPieces::init(),
                ..Chunk::default()
            });
        }

        // Then all HTML files
        for source_index in html_files.keys() {
            chunks.push(Chunk {
                entry_point: chunk::EntryPoint::new(source_index.get(), source_index.get(), false, true),
                content: chunk::Content::Html,
                output_source_map: SourceMap::SourceMapPieces::init(),
                ..Chunk::default()
            });
        }
        let chunks: &mut [Chunk] = Box::leak(chunks.into_boxed_slice());

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        crate::linker_context_mod::generate_chunks_in_parallel::<true>(&mut self.linker, chunks)
            .map_err(|_| AllocError)?;
        // TODO(port): errdefer { bun.outOfMemory() } — caller cannot recover

        /* arena: help_catch_memory_issues — no-op (mimalloc TLH check) */

        dev_server.finalize_bundle(self, &DevServerOutput {
            chunks,
            css_file_list: core::mem::take(&mut start.css_entry_points),
            html_files,
        }).map_err(|_| AllocError)
    }

    pub fn enqueue_on_resolve_plugin_if_needed(
        &mut self,
        source_index: IndexInt,
        import_record: &ImportRecord,
        source_file: &[u8],
        import_record_index: u32,
        original_target: options::Target,
    ) -> bool {
        if let Some(mut plugins_ptr) = self.plugins {
            let plugins = unsafe { plugins_ptr.as_mut() };
            // PORT NOTE: `ImportRecord.path` is `bun_paths::fs::Path`; `has_any_matches`
            // takes the structurally-identical `bun_resolver::fs::Path`. Rebuild the
            // resolver-crate variant from the same backing slices (Zig has a single
            // `Fs.Path` type — the FFI side only reads `.text` / `.namespace`).
            let match_path = Fs::Path::init_with_namespace(import_record.path.text, import_record.path.namespace);
            if plugins.has_any_matches(&match_path, false) {
                // This is where onResolve plugins are enqueued
                let resolve = Box::new(jsc_api::JSBundler::Resolve::default());
                bun_core::scoped_log!(Bundle, "enqueue onResolve: {}:{}",
                    bstr::BStr::new(&import_record.path.namespace),
                    bstr::BStr::new(&import_record.path.text));
                self.increment_scan_counter();

                let resolve = Box::leak(resolve); // TODO(port): owned by dispatch chain
                *resolve = jsc_api::JSBundler::Resolve::init(self, jsc_api::JSBundler::MiniImportRecord {
                    kind: import_record.kind,
                    source_file: source_file.into(),
                    namespace: import_record.path.namespace.into(),
                    specifier: import_record.path.text.to_vec().into_boxed_slice(),
                    importer_source_index: source_index,
                    import_record_index,
                    range: import_record.range,
                    original_target,
                });

                resolve.dispatch();
                return true;
            }
        }

        false
    }

    pub fn enqueue_entry_point_on_resolve_plugin_if_needed(
        &mut self,
        entry_point: &[u8],
        target: options::Target,
    ) -> bool {
        if let Some(mut plugins_ptr) = self.plugins {
            let plugins = unsafe { plugins_ptr.as_mut() };
            let mut temp_path = Fs::Path::init(entry_point.into());
            temp_path.namespace = b"file";
            if plugins.has_any_matches(&temp_path, false) {
                bun_core::scoped_log!(Bundle, "Entry point '{}' plugin match", bstr::BStr::new(entry_point));

                let resolve = Box::leak(Box::new(jsc_api::JSBundler::Resolve::default()));
                self.increment_scan_counter();

                *resolve = jsc_api::JSBundler::Resolve::init(self, jsc_api::JSBundler::MiniImportRecord {
                    kind: ImportKind::EntryPointBuild,
                    source_file: Box::default(), // No importer for entry points
                    namespace: (&b"file"[..]).into(),
                    specifier: entry_point.into(),
                    importer_source_index: u32::MAX, // Sentinel value for entry points
                    import_record_index: 0,
                    range: Logger::Range::NONE,
                    original_target: target,
                });

                resolve.dispatch();
                return true;
            }
        }
        false
    }

    pub fn enqueue_on_load_plugin_if_needed(&mut self, parse: &mut ParseTask) -> bool {
        let had_matches = self.enqueue_on_load_plugin_if_needed_impl(parse);
        if had_matches {
            return true;
        }

        if parse.path.namespace == b"dataurl" {
            let Ok(maybe_data_url) = DataURL::parse(&parse.path.text) else { return false };
            let Some(data_url) = maybe_data_url else { return false };
            let Ok(maybe_decoded) = data_url.decode_data() else { return false };
            self.free_list.push(maybe_decoded.clone().into_boxed_slice());
            // TODO(port): lifetime — leaked for &'static [u8]; tracked in free_list above.
            parse.contents_or_fd = parse_task::ContentsOrFd::Contents(Box::leak(maybe_decoded.into_boxed_slice()));
            parse.loader = Some(match data_url.decode_mime_type().category {
                bun_http_types::MimeType::Category::Javascript => Loader::Js,
                bun_http_types::MimeType::Category::Css => Loader::Css,
                bun_http_types::MimeType::Category::Json => Loader::Json,
                _ => parse.loader.unwrap_or(Loader::File),
            });
        }

        false
    }

    pub fn enqueue_on_load_plugin_if_needed_impl(&mut self, parse: &mut ParseTask) -> bool {
        if let Some(mut plugins_ptr) = self.plugins {
            let plugins = unsafe { plugins_ptr.as_mut() };
            if plugins.has_any_matches(&parse.path, true) {
                // This is where onLoad plugins are enqueued
                bun_core::scoped_log!(Bundle, "enqueue onLoad: {}:{}",
                    bstr::BStr::new(&parse.path.namespace),
                    bstr::BStr::new(&parse.path.text));
                let load = Box::leak(Box::new(jsc_api::JSBundler::Load::init(self, parse)));
                load.dispatch();
                return true;
            }
        }

        false
    }

    fn path_with_pretty_initialized(&self, path: Fs::Path<'static>, target: options::Target) -> Result<Fs::Path<'static>, Error> {
        // SAFETY: arena outlives the bundle pass; erase the `&self` lifetime so the
        // returned `Path<'static>` doesn't keep `self` borrowed (borrowck).
        let bump: &'static bun_alloc::Arena = unsafe { &*(self.allocator() as *const bun_alloc::Arena) };
        generic_path_with_pretty_initialized(path, target, unsafe { &(*self.transpiler.fs).top_level_dir }, bump)
    }

    fn reserve_source_indexes_for_bake(&mut self) -> Result<(), Error> {
        let Some(fw) = &self.framework else { return Ok(()) };
        if fw.server_components.is_none() {
            return Ok(());
        }

        // Call this after
        debug_assert!(self.graph.input_files.len() == 1);
        debug_assert!(self.graph.ast.len() == 1);

        self.graph.ast.ensure_unused_capacity(2)?;
        self.graph.input_files.ensure_unused_capacity(2)?;

        // PORT NOTE: Zig copied `bake.server_virtual_source` by value. The Rust
        // statics are `LazyLock<Source>` and `Source` is not `Clone`, so rebuild
        // an owned `Source` from the static's clonable fields (`path`, `index`).
        let server_source = bun_logger::Source {
            path: bake::SERVER_VIRTUAL_SOURCE.path.clone(),
            index: bake::SERVER_VIRTUAL_SOURCE.index,
            ..Default::default()
        };
        let client_source = bun_logger::Source {
            path: bake::CLIENT_VIRTUAL_SOURCE.path.clone(),
            index: bake::CLIENT_VIRTUAL_SOURCE.index,
            ..Default::default()
        };

        self.graph.input_files.append(crate::Graph::InputFile {
            source: server_source,
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        }); // PERF(port): was assume_capacity
        self.graph.input_files.append(crate::Graph::InputFile {
            source: client_source,
            loader: Loader::Js,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        }); // PERF(port): was assume_capacity

        debug_assert!(self.graph.input_files.items_source()[Index::BAKE_SERVER_DATA.get() as usize].index.0 == Index::BAKE_SERVER_DATA.get());
        debug_assert!(self.graph.input_files.items_source()[Index::BAKE_CLIENT_DATA.get() as usize].index.0 == Index::BAKE_CLIENT_DATA.get());

        self.graph.ast.append(JSAst::empty()); // PERF(port): was assume_capacity
        self.graph.ast.append(JSAst::empty()); // PERF(port): was assume_capacity
        Ok(())
    }

    // See barrel_imports.rs for barrel optimization implementation.
    // PORT NOTE: Zig `pub usingnamespace`-style method aliases. `pub use` is not
    // permitted in `impl` blocks; the underlying fns live in `barrel_imports` and
    // take `&mut BundleV2` directly — callers reach them as free functions.
    // (was: pub use barrel_imports::{apply_barrel_optimization, schedule_barrel_deferred_imports})

    /// Returns true when barrel optimization is enabled. Barrel optimization
    /// can apply to any package with sideEffects: false or listed in
    /// optimize_imports, so it is always enabled during bundling.
    fn is_barrel_optimization_enabled(&self) -> bool {
        true
    }

    // TODO: remove ResolveQueue
    //
    // Moving this to the Bundle thread was a significant perf improvement on Linux for first builds
    //
    // The problem is that module resolution has many mutexes.
    // The downside is cached resolutions are faster to do in threads since they only lock very briefly.
    fn run_resolution_for_parse_task(parse_result: &mut parse_task::Result, this: &mut BundleV2) -> ResolveQueue {
        let result = match &mut parse_result.value {
            parse_task::ResultValue::Success(r) => r,
            _ => unreachable!(),
        };
        // Capture these before resolveImportRecords, since on error we overwrite
        // parse_result.value (invalidating the `result` pointer).
        let source_index = result.source.index;
        let target = result.ast.target;
        let mut resolve_result = this.resolve_import_records(ResolveImportRecordCtx {
            import_records: &mut result.ast.import_records,
            source: &result.source,
            loader: result.loader,
            target,
        });

        if let Some(err) = resolve_result.last_error {
            bun_core::scoped_log!(Bundle, "failed with error: {}", err.name());
            resolve_result.resolve_queue.clear();

            // Preserve the parsed import_records on the graph so any plugin
            // onResolve tasks already dispatched for *other* records in this
            // same file can still dereference
            // `graph.ast.items(.import_records)[importer_source_index]` when
            // they complete. Without this, the graph entry stays at
            // JSAst.empty and the deferred plugin callback index-out-of-
            // bounds crashes in BundleV2.onResolve / runResolver. The linker
            // never runs because `transpiler.log.errors > 0` aborts the
            // build before link time, so saving the AST is safe.
            this.graph.ast.items_import_records_mut()[source_index.0 as usize] = core::mem::take(&mut result.ast.import_records);

            parse_result.value = parse_task::ResultValue::Err(parse_task::ResultError {
                err,
                step: crate::parse_task::Step::Resolve,
                log: Logger::Log::init(),
                source_index: js_ast::Index { value: source_index.0 },
                target,
            });
        }

        resolve_result.resolve_queue
    }
}

pub struct ResolveImportRecordCtx<'a> {
    pub import_records: &'a mut import_record::List,
    pub source: &'a Logger::Source,
    pub loader: Loader,
    pub target: options::Target,
}

pub struct ResolveImportRecordResult {
    pub resolve_queue: ResolveQueue,
    pub last_error: Option<Error>,
}

// CYCLEBREAK TYPE_ONLY: `bun_paths::fs::Path` / `bun_resolver::fs::Path` /
// `bun_logger::fs::Path` are field-identical mirrors of the same Zig `Fs.Path`.
// Re-construct field-by-field rather than transmute non-`repr(C)` structs.
// SAFETY: Phase-A lifetime erasure — backing slices are arena/BSSStringList-owned
// and outlive the bundle pass (TODO(port): unify Path types to remove this).
#[inline]
pub(crate) fn fs_path_from_ir(p: &bun_paths::fs::Path<'static>) -> Fs::Path<'static> {
    Fs::Path {
        pretty: p.pretty,
        text: p.text,
        namespace: p.namespace,
        name: Fs::PathName {
            base: p.name.base,
            dir: p.name.dir,
            ext: p.name.ext,
            filename: p.name.filename,
        },
        is_disabled: p.is_disabled,
        is_symlink: p.is_symlink,
    }
}

#[inline]
pub(crate) fn ir_path_from_fs(p: &Fs::Path<'_>) -> bun_paths::fs::Path<'static> {
    let s = |b: &[u8]| -> &'static [u8] { unsafe { core::mem::transmute(b) } };
    bun_paths::fs::Path {
        pretty: s(p.pretty),
        text: s(p.text),
        namespace: s(p.namespace),
        name: bun_paths::fs::PathName {
            base: s(p.name.base),
            dir: s(p.name.dir),
            ext: s(p.name.ext),
            filename: s(p.name.filename),
        },
        is_disabled: p.is_disabled,
        is_symlink: p.is_symlink,
    }
}

#[inline]
pub(crate) fn ir_path_from_logger(p: &bun_logger::fs::Path) -> bun_paths::fs::Path<'static> {
    bun_paths::fs::Path {
        pretty: p.pretty,
        text: p.text,
        namespace: p.namespace,
        name: bun_paths::fs::PathName {
            base: p.name.base,
            dir: p.name.dir,
            ext: p.name.ext,
            filename: p.name.filename,
        },
        is_disabled: p.is_disabled,
        is_symlink: p.is_symlink,
    }
}

#[inline]
pub(crate) fn logger_path_from_fs(p: &Fs::Path<'_>) -> bun_logger::fs::Path {
    let s = |b: &[u8]| -> &'static [u8] { unsafe { core::mem::transmute(b) } };
    bun_logger::fs::Path {
        pretty: s(p.pretty),
        text: s(p.text),
        namespace: s(p.namespace),
        name: bun_logger::fs::PathName {
            base: s(p.name.base),
            dir: s(p.name.dir),
            ext: s(p.name.ext),
            filename: s(p.name.filename),
        },
        is_disabled: p.is_disabled,
        is_symlink: p.is_symlink,
    }
}

impl<'a> BundleV2<'a> {
    /// Resolve all unresolved import records for a module. Skips records that
    /// are already resolved (valid source_index), unused, or internal.
    /// Returns a resolve queue of new modules to schedule, plus any fatal error.
    /// Used by both initial parse resolution and barrel un-deferral.
    pub fn resolve_import_records(&mut self, ctx: ResolveImportRecordCtx) -> ResolveImportRecordResult {
        let source = ctx.source;
        let loader = ctx.loader;
        let source_dir = source.path.source_dir();
        let mut estimated_resolve_queue_count: usize = 0;
        for import_record in ctx.import_records.slice_mut() {
            if import_record.flags.contains(bun_options_types::import_record::Flags::IS_INTERNAL) {
                import_record.tag = bun_options_types::import_record::Tag::Runtime;
                import_record.source_index = Index::RUNTIME;
            }

            // For non-dev-server builds, barrel-deferred records need their
            // source_index cleared so they don't get linked. For dev server,
            // skip this — is_unused is also set by ConvertESMExportsForHmr
            // deduplication, and clearing those source_indices breaks module
            // identity (e.g., __esModule on ESM namespace objects).
            if import_record.flags.contains(bun_options_types::import_record::Flags::IS_UNUSED) && self.dev_server.is_none() {
                import_record.source_index = Index::INVALID;
            }

            estimated_resolve_queue_count += (!(import_record.flags.contains(bun_options_types::import_record::Flags::IS_INTERNAL) || import_record.flags.contains(bun_options_types::import_record::Flags::IS_UNUSED) || import_record.source_index.is_valid())) as usize;
        }
        let mut resolve_queue = ResolveQueue::default();
        resolve_queue.reserve(estimated_resolve_queue_count);

        let mut last_error: Option<Error> = None;

        'outer: for (i, import_record) in ctx.import_records.slice_mut().iter_mut().enumerate() {
            // Preserve original import specifier before resolution modifies path
            if import_record.original_path.is_empty() {
                import_record.original_path = import_record.path.text;
            }

            if
            // Don't resolve TypeScript types
            import_record.flags.contains(bun_options_types::import_record::Flags::IS_UNUSED)
                // Don't resolve the runtime
                || import_record.flags.contains(bun_options_types::import_record::Flags::IS_INTERNAL)
                // Don't resolve pre-resolved imports
                || import_record.source_index.is_valid()
            {
                continue;
            }

            if let Some(fw) = &self.framework {
                if fw.server_components.is_some() {
                    // PERF(port): was comptime bool dispatch — profile in Phase B
                    let is_server = ctx.target.is_server_side();
                    let src = if is_server { &bake::SERVER_VIRTUAL_SOURCE } else { &bake::CLIENT_VIRTUAL_SOURCE };
                    if import_record.path.text == src.path.pretty {
                        if self.dev_server.is_some() {
                            import_record.flags.insert(bun_options_types::import_record::Flags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                            import_record.source_index = Index::INVALID;
                        } else {
                            if is_server {
                                self.graph.kit_referenced_server_data = true;
                            } else {
                                self.graph.kit_referenced_client_data = true;
                            }
                            import_record.path.namespace = b"bun";
                            import_record.source_index = Index::source(src.index.0);
                        }
                        continue;
                    }
                }
            }

            if import_record.path.text == b"bun:wrap" {
                import_record.path.namespace = b"bun";
                import_record.tag = bun_options_types::import_record::Tag::Runtime;
                import_record.path.text = b"wrap";
                import_record.source_index = Index::RUNTIME;
                continue;
            }

            if ctx.target.is_bun() {
                if let Some(replacement) = bun_resolve_builtins::HardcodedModule::Alias::get(
                    &import_record.path.text,
                    Target::Bun,
                    bun_resolve_builtins::HardcodedModule::Cfg { rewrite_jest_for_tests: self.transpiler.options.rewrite_jest_for_tests },
                ) {
                    // When bundling node builtins, remove the "node:" prefix.
                    // This supports special use cases where the bundle is put
                    // into a non-node module resolver that doesn't support
                    // node's prefix. https://github.com/oven-sh/bun/issues/18545
                    import_record.path.text = if replacement.node_builtin && !replacement.node_only_prefix {
                        &replacement.path.as_bytes()[5..]
                    } else {
                        replacement.path.as_bytes()
                    };
                    import_record.tag = replacement.tag;
                    import_record.source_index = Index::INVALID;
                    import_record.flags.insert(bun_options_types::import_record::Flags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                    continue;
                }

                if import_record.path.text.starts_with(b"bun:") {
                    let new_text: &'static [u8] = &import_record.path.text[b"bun:".len()..];
                    import_record.path = bun_paths::fs::Path::init(new_text);
                    import_record.path.namespace = b"bun";
                    import_record.source_index = Index::INVALID;
                    import_record.flags.insert(bun_options_types::import_record::Flags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);

                    // don't link bun
                    continue;
                }
            }

            // By default, we treat .sqlite files as external.
            if import_record.loader == Some(Loader::Sqlite) {
                import_record.flags.insert(bun_options_types::import_record::Flags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                continue;
            }

            if import_record.loader == Some(Loader::SqliteEmbedded) {
                import_record.flags.insert(bun_options_types::import_record::Flags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
            }

            if self.enqueue_on_resolve_plugin_if_needed(source.index.0, import_record, &source.path.text, i as u32, ctx.target) {
                continue;
            }

            let (transpiler, bake_graph, target): (&mut Transpiler, bake::Graph, options::Target) =
                if import_record.tag == bun_options_types::import_record::Tag::BakeResolveToSsrGraph {
                    if self.framework.is_none() {
                        self.log_for_resolution_failures(&source.path.text, bake::Graph::Ssr).add_error_fmt(
                            Some(source),
                            import_record.range.loc,
                            format_args!("The 'bunBakeGraph' import attribute cannot be used outside of a Bun Bake bundle"),
                        ).expect("unexpected log error");
                        continue;
                    }

                    let is_supported = self.framework.as_ref().unwrap().server_components.is_some()
                        && self.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph;
                    if !is_supported {
                        self.log_for_resolution_failures(&source.path.text, bake::Graph::Ssr).add_error_fmt(
                            Some(source),
                            import_record.range.loc,
                            format_args!("Framework does not have a separate SSR graph to put this import into"),
                        ).expect("unexpected log error");
                        continue;
                    }

                    (unsafe { &mut *self.ssr_transpiler }, bake::Graph::Ssr, Target::BakeServerComponentsSsr)
                } else {
                    (self.transpiler_for_target(ctx.target), ctx.target.bake_graph(), ctx.target)
                };

            // Check the FileMap first for in-memory files
            if let Some(file_map) = self.file_map {
                if let Some(_file_map_result) = file_map.resolve(&source.path.text, &import_record.path.text) {
                    let mut file_map_result = _file_map_result;
                    let mut path_primary = file_map_result.path_pair.primary.clone();
                    let import_record_loader = import_record.loader.unwrap_or_else(|| {
                        Fs::Path::init(path_primary.text.clone()).loader(&transpiler.options.loaders).unwrap_or(Loader::File)
                    });
                    import_record.loader = Some(import_record_loader);

                    if let Some(id) = self.path_to_source_index_map(target).get(&path_primary.text) {
                        import_record.source_index = Index::init(id);
                        continue;
                    }

                    let resolve_entry = resolve_queue.get_or_put(&path_primary.text).expect("oom");
                    if resolve_entry.found_existing {
                        import_record.path = ir_path_from_fs(&unsafe { &**resolve_entry.value_ptr }.path);
                        continue;
                    }

                    // For virtual files, use the path text as-is (no relative path computation needed).
                    path_primary.pretty = self.allocator().alloc_slice_copy(&path_primary.text);
                    import_record.path = ir_path_from_fs(&path_primary);
                    let _ = path_primary.text; // key already interned by get_or_put
                    bun_core::scoped_log!(Bundle, "created ParseTask from FileMap: {}", bstr::BStr::new(&path_primary.text));
                    let resolve_task = Box::leak(Box::new(ParseTask::default()));
                    file_map_result.path_pair.primary = path_primary;
                    *resolve_task = ParseTask::init(&file_map_result, js_ast::Index::INVALID, self);
                    resolve_task.known_target = target;
                    // Use transpiler JSX options, applying force_node_env like the disk path does
                    resolve_task.jsx = transpiler.options.jsx.clone();
                    resolve_task.jsx.development = match transpiler.options.force_node_env {
                        options::ForceNodeEnv::Development => true,
                        options::ForceNodeEnv::Production => false,
                        options::ForceNodeEnv::Unspecified => transpiler.options.jsx.development,
                    };
                    resolve_task.loader = Some(import_record_loader);
                    resolve_task.tree_shaking = transpiler.options.tree_shaking;
                    resolve_task.side_effects = _resolver::SideEffects::HasSideEffects;
                    *resolve_entry.value_ptr = resolve_task;
                    continue;
                }
            }

            let mut had_busted_dir_cache = false;
            let resolve_result: _resolver::Result = 'inner: loop {
                match transpiler.resolver.resolve_with_framework(
                    source_dir,
                    &import_record.path.text,
                    import_record.kind,
                ) {
                    Ok(r) => break r,
                    Err(err) => {
                        let log = self.log_for_resolution_failures(&source.path.text, bake_graph);

                        // Only perform directory busting when hot-reloading is enabled
                        if err == bun_core::err!("ModuleNotFound") {
                            if self.bun_watcher.is_some() {
                                if !had_busted_dir_cache {
                                    bun_core::scoped_log!(watcher, "busting dir cache {} -> {}",
                                        bstr::BStr::new(&source.path.text), bstr::BStr::new(&import_record.path.text));
                                    // Only re-query if we previously had something cached.
                                    if transpiler.resolver.bust_dir_cache_from_specifier(
                                        &source.path.text,
                                        &import_record.path.text,
                                    ) {
                                        had_busted_dir_cache = true;
                                        continue 'inner;
                                    }
                                }
                                if let Some(dev) = self.dev_server {
                                    // Tell DevServer about the resolution failure.
                                    dev.track_resolution_failure(
                                        &source.path.text,
                                        &import_record.path.text,
                                        ctx.target.bake_graph(), // use the source file target not the altered one
                                        loader,
                                    ).expect("oom");
                                }
                            }
                        }

                        // Disable failing packages from being printed.
                        // This may cause broken code to write.
                        // However, doing this means we tell them all the resolve errors
                        // Rather than just the first one.
                        import_record.path.is_disabled = true;

                        if err == bun_core::err!("ModuleNotFound") {
                            let add_error = Logger::Log::add_resolve_error_with_text_dupe;

                            if !import_record.flags.contains(bun_options_types::import_record::Flags::HANDLES_IMPORT_ERRORS) && !self.transpiler.options.ignore_module_resolution_errors {
                                last_error = Some(err);
                                if is_package_path(&import_record.path.text) {
                                    if ctx.target == Target::Browser && options::ExternalModules::is_node_builtin(&import_record.path.text) {
                                        add_error(
                                            log, Some(source), import_record.range,
                                            format_args!("Browser build cannot {} Node.js builtin: \"{}\"{}",
                                                bstr::BStr::new(import_record.kind.error_label()),
                                                bstr::BStr::new(&import_record.path.text),
                                                if self.dev_server.is_none() {
                                                    ". To use Node.js builtins, set target to 'node' or 'bun'"
                                                } else { "" },
                                            ),
                                            &import_record.path.text,
                                            import_record.kind.into(),
                                        ).expect("oom");
                                    } else if !ctx.target.is_bun() && import_record.path.text == b"bun" {
                                        add_error(
                                            log, Some(source), import_record.range,
                                            format_args!("Browser build cannot {} Bun builtin: \"{}\"{}",
                                                bstr::BStr::new(import_record.kind.error_label()),
                                                bstr::BStr::new(&import_record.path.text),
                                                if self.dev_server.is_none() {
                                                    ". When bundling for Bun, set target to 'bun'"
                                                } else { "" },
                                            ),
                                            &import_record.path.text,
                                            import_record.kind.into(),
                                        ).expect("oom");
                                    } else if !ctx.target.is_bun() && import_record.path.text.starts_with(b"bun:") {
                                        add_error(
                                            log, Some(source), import_record.range,
                                            format_args!("Browser build cannot {} Bun builtin: \"{}\"{}",
                                                bstr::BStr::new(import_record.kind.error_label()),
                                                bstr::BStr::new(&import_record.path.text),
                                                if self.dev_server.is_none() {
                                                    ". When bundling for Bun, set target to 'bun'"
                                                } else { "" },
                                            ),
                                            &import_record.path.text,
                                            import_record.kind.into(),
                                        ).expect("oom");
                                    } else {
                                        add_error(
                                            log, Some(source), import_record.range,
                                            format_args!("Could not resolve: \"{}\". Maybe you need to \"bun install\"?",
                                                bstr::BStr::new(&import_record.path.text)),
                                            &import_record.path.text,
                                            import_record.kind.into(),
                                        ).expect("oom");
                                    }
                                } else {
                                    let buf = bun_paths::path_buffer_pool::get();
                                    let specifier_to_use = if loader == Loader::Html
                                        && import_record.path.text.starts_with(&Fs::FileSystem::instance().top_level_dir)
                                    {
                                        let specifier_to_use = &import_record.path.text[Fs::FileSystem::instance().top_level_dir.len()..];
                                        #[cfg(windows)]
                                        {
                                            bun_paths::path_to_posix_buf::<u8>(specifier_to_use, &mut *buf)
                                        }
                                        #[cfg(not(windows))]
                                        {
                                            specifier_to_use
                                        }
                                    } else {
                                        &import_record.path.text
                                    };
                                    add_error(
                                        log, Some(source), import_record.range,
                                        format_args!("Could not resolve: \"{}\"", bstr::BStr::new(specifier_to_use)),
                                        specifier_to_use,
                                        import_record.kind.into(),
                                    ).expect("oom");
                                }
                            }
                        } else {
                            // assume other errors are already in the log
                            last_error = Some(err);
                        }
                        continue 'outer;
                    }
                }
            };
            let mut resolve_result = resolve_result;
            // if there were errors, lets go ahead and collect them all
            if last_error.is_some() {
                continue;
            }

            let path: &mut Fs::Path = match resolve_result.path() {
                Some(p) => p,
                None => {
                    import_record.path.is_disabled = true;
                    import_record.source_index = Index::INVALID;
                    continue;
                }
            };

            if resolve_result.flags.is_external() {
                if resolve_result.flags.is_external_and_rewrite_import_path()
                    && !strings::eql_long(&resolve_result.path_pair.primary.text, &import_record.path.text, true)
                {
                    import_record.path = ir_path_from_fs(&resolve_result.path_pair.primary);
                }
                import_record.flags.set(
                    bun_options_types::import_record::Flags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS,
                    resolve_result.primary_side_effects_data != _resolver::SideEffects::HasSideEffects,
                );
                continue;
            }

            if let Some(dev_server) = self.dev_server_handle() {
                'brk: {
                    if path.loader(&self.transpiler.options.loaders) == Some(Loader::Html)
                        && (import_record.loader.is_none() || import_record.loader.unwrap() == Loader::Html)
                    {
                        // This use case is currently not supported. This error
                        // blocks an assertion failure because the DevServer
                        // reserves the HTML file's spot in IncrementalGraph for the
                        // route definition.
                        let log = self.log_for_resolution_failures(&source.path.text, bake_graph);
                        log.add_range_error_fmt(
                            Some(source),
                            import_record.range,
                            format_args!("Browser builds cannot import HTML files."),
                        ).expect("oom");
                        continue 'outer;
                    }

                    if loader == Loader::Css {
                        // Do not use cached files for CSS.
                        break 'brk;
                    }

                    import_record.source_index = Index::INVALID;

                    if let Some(entry) = dev_server.is_file_cached(&path.text, bake_graph) {
                        let rel = bun_paths::resolve_path::relative_platform::<bun_paths::resolve_path::platform::Loose, false>(unsafe { &(*self.transpiler.fs).top_level_dir }, &path.text);
                        if loader == Loader::Html && entry.kind == bake_types::CacheKind::Asset {
                            // Overload `path.text` to point to the final URL
                            // This information cannot be queried while printing because a lock wouldn't get held.
                            let hash = dev_server.asset_hash(&path.text).expect("cached asset not found");
                            import_record.path.text = path.text;
                            import_record.path.namespace = b"file";
                            import_record.path.pretty = self.allocator().alloc_str(&format!(
                                "{}/{:016x}{}",
                                bake_types::ASSET_PREFIX,
                                hash,
                                bstr::BStr::new(bun_paths::extension(&path.text)),
                            )).as_bytes();
                            import_record.path.is_disabled = false;
                        } else {
                            import_record.path.text = path.text;
                            import_record.path.pretty = rel.into();
                            import_record.path = ir_path_from_fs(&self.path_with_pretty_initialized(path.clone(), target).expect("oom"));
                            if loader == Loader::Html || entry.kind == bake_types::CacheKind::Css {
                                import_record.path.is_disabled = true;
                            }
                        }
                        continue 'outer;
                    }
                }
            }

            let import_record_loader = 'brk: {
                let resolved_loader = import_record.loader.unwrap_or_else(|| path.loader(&transpiler.options.loaders).unwrap_or(Loader::File));
                // When an HTML file references a URL asset (e.g. <link rel="manifest" href="./manifest.json" />),
                // the file must be copied to the output directory as-is. If the resolved loader would
                // parse/transform the file (e.g. .json, .toml) rather than copy it, force the .file loader
                // so that `shouldCopyForBundling()` returns true and the asset is emitted.
                // Only do this for HTML sources — CSS url() imports should retain their original behavior.
                if loader == Loader::Html && import_record.kind == ImportKind::Url
                    && !resolved_loader.should_copy_for_bundling()
                    && !resolved_loader.is_javascript_like()
                    && !resolved_loader.is_css()
                    && resolved_loader != Loader::Html
                {
                    break 'brk Loader::File;
                }
                break 'brk resolved_loader;
            };
            import_record.loader = Some(import_record_loader);

            let is_html_entrypoint = import_record_loader == Loader::Html
                && target.is_server_side()
                && self.dev_server.is_none();

            if let Some(id) = self.path_to_source_index_map(target).get(&path.text) {
                if self.dev_server.is_some() && loader != Loader::Html {
                    import_record.path = ir_path_from_logger(&self.graph.input_files.items_source()[id as usize].path);
                } else {
                    import_record.source_index = Index::init(id);
                }
                continue;
            }

            if is_html_entrypoint {
                import_record.kind = ImportKind::HtmlManifest;
            }

            let resolve_entry = resolve_queue.get_or_put(&path.text).expect("oom");
            if resolve_entry.found_existing {
                import_record.path = ir_path_from_fs(&unsafe { &**resolve_entry.value_ptr }.path);
                continue;
            }

            *path = self.path_with_pretty_initialized(core::mem::take(path), target).expect("oom");

            import_record.path = ir_path_from_fs(path);
            // key already interned by get_or_put — no key_ptr on StringHashMapGetOrPut
            bun_core::scoped_log!(Bundle, "created ParseTask: {}", bstr::BStr::new(&path.text));
            let resolve_task = Box::leak(Box::new(ParseTask::init(&resolve_result, js_ast::Index::INVALID, self)));

            resolve_task.known_target = if import_record.kind == ImportKind::HtmlManifest {
                Target::Browser
            } else {
                target
            };

            resolve_task.jsx = resolve_result.jsx.clone().into();
            resolve_task.jsx.development = match transpiler.options.force_node_env {
                options::ForceNodeEnv::Development => true,
                options::ForceNodeEnv::Production => false,
                options::ForceNodeEnv::Unspecified => transpiler.options.jsx.development,
            };

            resolve_task.loader = Some(import_record_loader);
            resolve_task.tree_shaking = transpiler.options.tree_shaking;
            *resolve_entry.value_ptr = resolve_task;
            if let Some(secondary) = &resolve_result.path_pair.secondary {
                if !secondary.is_disabled
                    && !core::ptr::eq(secondary, path)
                    && !strings::eql_long(&secondary.text, &path.text, true)
                {
                    resolve_task.secondary_path_for_commonjs_interop = Some(secondary.clone());
                }
            }

            if is_html_entrypoint {
                self.generate_server_html_module(path, target, import_record, &path.text).expect("unreachable");
            }
        }

        ResolveImportRecordResult { resolve_queue, last_error }
    }

    /// Process a resolve queue: create input file slots and schedule parse tasks.
    /// Returns the number of newly scheduled tasks (for pending_items accounting).
    pub fn process_resolve_queue(&mut self, resolve_queue: ResolveQueue, target: options::Target, importer_source_index: IndexInt) -> i32 {
        let mut diff: i32 = 0;
        // PORT NOTE: reshaped for borrowck — Zig freely aliased `graph` and the
        // path map across the loop body. Here we (a) capture a raw self ptr for
        // ParseTask.ctx, (b) hoist dev_server check, and (c) scope the map
        // borrow to the get_or_put so later `self.graph.*` writes don't overlap.
        let self_ptr: *mut BundleV2<'static> = self as *mut Self as *mut BundleV2<'static>;
        let dev_server_is_none = self.dev_server.is_none();
        for (key, value) in resolve_queue.iter() {
            let value: *mut ParseTask = *value;
            // SAFETY: ParseTask was Box::leak'd in resolve_import_records
            let value = unsafe { &mut *value };
            let loader = value.loader.unwrap_or_else(|| value.path.loader(&self.transpiler.options.loaders).unwrap_or(Loader::File));
            let is_html_entrypoint = loader == Loader::Html && target.is_server_side() && dev_server_is_none;
            // Select map and perform get_or_put, capturing the slot as a raw ptr
            // so the &mut on self.graph is released before we touch other fields.
            let (found_existing, value_ptr): (bool, *mut IndexInt) = {
                let map: &mut PathToSourceIndexMap = if is_html_entrypoint {
                    self.graph.path_to_source_index_map(Target::Browser)
                } else {
                    self.graph.path_to_source_index_map(target)
                };
                let existing = map.get_or_put(&key).expect("oom");
                (existing.found_existing, existing.value_ptr as *mut IndexInt)
            };

            if !found_existing {
                let new_task: &mut ParseTask = value;
                let mut new_input_file = crate::Graph::InputFile {
                    source: Logger::Source::init_empty_file(&new_task.path.text),
                    side_effects: new_task.side_effects,
                    secondary_path: if let Some(secondary_path) = &new_task.secondary_path_for_commonjs_interop {
                        secondary_path.text.into()
                    } else {
                        Box::default()
                    },
                    ..Default::default()
                };

                self.graph.has_any_secondary_paths = self.graph.has_any_secondary_paths || !new_input_file.secondary_path.is_empty();

                new_input_file.source.index = bun_logger::Index(self.graph.input_files.len() as u32);
                new_input_file.source.path = logger_path_from_fs(&new_task.path);
                new_input_file.loader = loader;
                let new_source_index: u32 = new_input_file.source.index.0;
                new_task.source_index = js_ast::Index { value: new_source_index };
                new_task.ctx = self_ptr;
                // SAFETY: value_ptr points into PathToSourceIndexMap storage; no
                // intervening insert into that map has occurred since get_or_put.
                unsafe { *value_ptr = new_task.source_index.get(); }

                diff += 1;

                self.graph.input_files.append(new_input_file).expect("unreachable");
                self.graph.ast.append(JSAst::empty());

                if is_html_entrypoint {
                    self.ensure_client_transpiler();
                    self.graph.entry_points.push(js_ast::Index { value: new_source_index });
                }

                if self.enqueue_on_load_plugin_if_needed(new_task) {
                    continue;
                }

                if loader.should_copy_for_bundling() {
                    let additional_files: &mut BabyList<crate::AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[importer_source_index as usize];
                    additional_files.append(crate::AdditionalFile::SourceIndex(new_task.source_index.get())).expect("oom");
                    self.graph.input_files.items_side_effects_mut()[new_task.source_index.get() as usize] = _resolver::SideEffects::NoSideEffectsPureData;
                    self.graph.estimated_file_loader_count += 1;
                }

                unsafe { self.graph.pool.as_mut() }.schedule(new_task);
            } else {
                if loader.should_copy_for_bundling() {
                    // SAFETY: value_ptr is valid (see above).
                    let existing_idx = unsafe { *value_ptr };
                    let additional_files: &mut BabyList<crate::AdditionalFile> = &mut self.graph.input_files.items_additional_files_mut()[importer_source_index as usize];
                    additional_files.append(crate::AdditionalFile::SourceIndex(existing_idx)).expect("oom");
                    self.graph.estimated_file_loader_count += 1;
                }

                // SAFETY: ParseTask was Box::leak'd; reconstitute and drop
                drop(unsafe { Box::from_raw(value) });
            }
        }
        diff
    }
}

#[derive(Clone, Copy)]
pub struct PatchImportRecordsCtx<'a> {
    pub source_index: Index,
    pub source_path: &'a [u8],
    pub loader: Loader,
    pub target: options::Target,
    pub redirect_import_record_index: u32,
    /// When true, always save source indices regardless of dev_server/loader.
    /// Used for barrel un-deferral where records must always be connected.
    pub force_save: bool,
}

impl Default for PatchImportRecordsCtx<'_> {
    fn default() -> Self {
        Self {
            source_index: Index::INVALID,
            source_path: b"",
            loader: Loader::File,
            target: Target::Browser,
            redirect_import_record_index: u32::MAX,
            force_save: false,
        }
    }
}

impl<'a> BundleV2<'a> {
    /// Patch source_index on import records from pathToSourceIndexMap and
    /// resolve_tasks_waiting_for_import_source_index. Called after
    /// processResolveQueue has registered new modules.
    pub fn patch_import_record_source_indices(&mut self, import_records: &mut import_record::List, ctx: PatchImportRecordsCtx) {
        // PORT NOTE: Zig aliased `const graph = &this.graph;`. Borrowck rejects
        // holding that across the `&mut self.graph.build_graphs[...]` borrow
        // below, so address the disjoint `self.graph.*` fields directly instead.
        let input_file_loaders = self.graph.input_files.items_loader();
        let save_import_record_source_index = ctx.force_save
            || self.dev_server.is_none()
            || ctx.loader == Loader::Html
            || ctx.loader.is_css();

        if let Some(idx) = self.resolve_tasks_waiting_for_import_source_index.get_index(&ctx.source_index.get()) {
            let (_, value) = self.resolve_tasks_waiting_for_import_source_index.swap_remove_at(idx);
            for to_assign in value.slice() {
                if save_import_record_source_index
                    || input_file_loaders[to_assign.to_source_index.get() as usize].is_css()
                {
                    import_records.slice_mut()[to_assign.import_record_index as usize].source_index = to_assign.to_source_index;
                }
            }
            drop(value);
        }

        // Inlined `self.path_to_source_index_map(ctx.target)` (== `&mut self.graph.build_graphs[target]`)
        // so borrowck sees it as disjoint from `self.graph.input_files` above.
        let path_to_source_index_map = &mut self.graph.build_graphs[ctx.target];
        for (i, record) in import_records.slice_mut().iter_mut().enumerate() {
            if let Some(source_index) = path_to_source_index_map.get_path(&record.path) {
                if save_import_record_source_index || input_file_loaders[source_index as usize].is_css() {
                    record.source_index.value = source_index;
                }

                if let Some(compare) = get_redirect_id(ctx.redirect_import_record_index) {
                    if compare == i as u32 {
                        path_to_source_index_map.put(ctx.source_path.into(), source_index);
                    }
                }
            }
        }
    }

    fn generate_server_html_module(&mut self, path: &Fs::Path, target: options::Target, import_record: &mut ImportRecord, path_text: &[u8]) -> Result<(), Error> {
        // 1. Create the ast right here
        // 2. Create a separate "virutal" module that becomes the manifest later on.
        // 3. Add it to the graph
        // PORT NOTE: Zig aliased `graph = &this.graph;` — re-borrow `self.graph`
        // at each use so the `self.*` method calls below don't conflict.
        let empty_html_file_source = Logger::Source {
            path: logger_path_from_fs(path),
            index: bun_logger::Index(self.graph.input_files.len() as u32),
            contents: std::borrow::Cow::Borrowed(&b""[..]),
            ..Default::default()
        };
        let mut js_parser_options = bun_js_parser::ast::ParserOptions::init(self.transpiler_for_target(target).options.jsx.clone().into(), Loader::Html);
        js_parser_options.bundle = true;

        // SAFETY: `alloc_str` returns a `&mut str` into the bundler arena, which
        // outlives this AST. `E::EString.data` is `&'static [u8]` per the Phase-A
        // arena-erasure convention (see `js_parser/ast/E.rs:Str`).
        let unique_key: &'static [u8] = unsafe {
            core::mem::transmute::<&[u8], &'static [u8]>(
                self.allocator()
                    .alloc_str(&format!(
                        "{:x}H{:08}",
                        self.unique_key,
                        self.graph.html_imports.server_source_indices.len,
                    ))
                    .as_bytes(),
            )
        };

        // Extract raw pointers so the `&mut self` borrow from
        // `transpiler_for_target` doesn't overlap `self.allocator()` below.
        // SAFETY: `define`/`log` live for `'a` (owned by the Transpiler /
        // BACKREF set in `BundleV2::init`).
        let (define_ptr, log_ptr): (*mut bun_js_parser::Define, *mut bun_logger::Log) = {
            let transpiler = self.transpiler_for_target(target);
            (&mut *transpiler.options.define as *mut _, transpiler.log)
        };

        let ast_for_html_entrypoint = JSAst::init(bun_js_parser::new_lazy_export_ast(
            self.allocator(),
            unsafe { &mut *define_ptr },
            js_parser_options,
            unsafe { &mut *log_ptr },
            Expr::init(E::EString { data: unique_key, ..Default::default() }, Logger::Loc::EMPTY),
            &empty_html_file_source,
            // We replace this runtime API call's ref later via .link on the Symbol.
            b"__jsonParse",
        )?.unwrap());

        let fake_input_file = crate::Graph::InputFile {
            source: empty_html_file_source,
            side_effects: _resolver::SideEffects::NoSideEffectsPureData,
            ..Default::default()
        };

        let fake_source_index = fake_input_file.source.index;
        self.graph.input_files.append(fake_input_file)?;
        self.graph.ast.append(ast_for_html_entrypoint);

        import_record.source_index = Index::init(fake_source_index.0);
        self.path_to_source_index_map(target).put(path_text.into(), fake_source_index.0);
        self.graph.html_imports.server_source_indices.append(fake_source_index.0);
        self.ensure_client_transpiler();
        Ok(())
    }
}

pub type ResolveQueue = StringHashMap<*mut ParseTask>;

impl<'a> BundleV2<'a> {
    pub fn on_notify_defer(&mut self) {
        self.thread_lock.assert_locked();
        self.graph.deferred_pending += 1;
        self.decrement_scan_counter();
    }

    pub fn on_notify_defer_mini(_: &mut jsc_api::JSBundler::Load, this: &mut BundleV2) {
        this.on_notify_defer();
    }

    pub fn on_parse_task_complete(parse_result: &mut parse_task::Result, this: &mut BundleV2) {
        let _trace = crate::ungate_support::perf::trace("Bundler.onParseTaskComplete");
        // PORT NOTE: Zig aliased `const graph = &this.graph;`. Borrowck rejects
        // holding that across the `this.*` method calls below (each takes
        // `&mut BundleV2`), so re-borrow `this.graph` at each use site instead.
        if parse_result.external.function.is_some() {
            let source = match &parse_result.value {
                parse_task::ResultValue::Empty { source_index } => source_index.get(),
                parse_task::ResultValue::Err(data) => data.source_index.get(),
                parse_task::ResultValue::Success(val) => val.source.index.0,
            };
            let loader: Loader = this.graph.input_files.items_loader()[source as usize];
            // PORT NOTE: `InputFile.allocator` column dropped in the Rust port;
            // stash the finalizer regardless so plugin-owned bytes are freed.
            let _ = loader;
            this.finalizers.push(core::mem::take(&mut parse_result.external));
        }

        // defer bun.default_allocator.destroy(parse_result) — caller owns Box and drops at end
        // TODO(port): parse_result is heap-allocated by worker; reconstruct Box::from_raw at scope exit

        let mut diff: i32 = -1;
        // PORT NOTE: Zig used `defer { graph.pending_items += diff; … }` —
        // hoisted to tail position (see end of fn) so the closure doesn't
        // double-borrow `graph`/`this`.

        let mut resolve_queue = ResolveQueue::default();
        let mut process_log = true;

        if matches!(parse_result.value, parse_task::ResultValue::Success(_)) {
            // TODO(b2-blocked): `barrel_imports::apply_barrel_optimization` —
            // body is gated (reads `Graph::ast` SoA columns not yet exposed).
            resolve_queue = Self::run_resolution_for_parse_task(parse_result, this);
            if matches!(parse_result.value, parse_task::ResultValue::Err(_)) {
                process_log = false;
            }
        }

        // To minimize contention, watchers are appended on the bundle thread.
        // CYCLEBREAK GENUINE: `bun_watcher` is an opaque `Option<NonNull<()>>`;
        // `add_file` lives in T6 (`bun_runtime::hot_reloader`). The dispatch
        // hook for it lands with the WatcherVTable; until then we drop the fd
        // bookkeeping (the fd is closed by the worker on Result drop).
        let _ = this.bun_watcher;

        match &mut parse_result.value {
            parse_task::ResultValue::Empty { source_index: empty_source_index } => {
                let empty_idx = (*empty_source_index).get() as usize;
                this.graph.input_files.items_side_effects_mut()[empty_idx] = _resolver::SideEffects::NoSideEffectsEmptyAst;
                if cfg!(debug_assertions) {
                    bun_core::scoped_log!(Bundle, "onParse({}, {}) = empty",
                        empty_idx,
                        bstr::BStr::new(&this.graph.input_files.items_source()[empty_idx].path.text));
                }
            }
            parse_task::ResultValue::Success(result) => {
                // SAFETY: `transpiler.log` is a live BACKREF set in BundleV2::init.
                result.log.clone_to_with_recycled(unsafe { &mut *this.transpiler.log }, true).expect("unreachable");

                this.has_any_top_level_await_modules = this.has_any_top_level_await_modules || !result.ast.top_level_await_keyword.is_empty();

                // Warning: `input_files` and `ast` arrays may resize in this function call
                // It is not safe to cache slices from them.
                let result_source_index = result.source.index.0 as usize;
                core::mem::swap(
                    &mut this.graph.input_files.items_source_mut()[result_source_index],
                    &mut result.source,
                );
                // PORT NOTE: Zig kept `source` as a stable pointer into the SoA.
                // Borrowck forbids holding `&input_files.source[i]` while writing
                // other `input_files` columns through the MultiArrayList accessor
                // methods (each takes `&mut input_files`), so copy out the
                // `'static` path text now and re-borrow `source` per-use below.
                let source_path_text: &'static [u8] =
                    this.graph.input_files.items_source()[result_source_index].path.text;
                this.source_code_length += if result_source_index != 0 {
                    this.graph.input_files.items_source()[result_source_index].contents.len()
                } else {
                    0
                };

                this.graph.input_files.items_unique_key_for_additional_file_mut()[result_source_index] = result.unique_key_for_additional_file.into();
                this.graph.input_files.items_content_hash_for_additional_file_mut()[result_source_index] = result.content_hash_for_additional_file;
                if !result.unique_key_for_additional_file.is_empty() && result.loader.should_copy_for_bundling() {
                    if let Some(dev) = this.dev_server {
                        let source = &this.graph.input_files.items_source()[result_source_index];
                        dev.put_or_overwrite_asset(
                            &source.path,
                            // SAFETY: when shouldCopyForBundling is true, the
                            // contents are allocated by bun.default_allocator
                            &source.contents,
                            result.content_hash_for_additional_file,
                        ).expect("oom");
                    }
                }

                // Record which loader we used for this file
                this.graph.input_files.items_loader_mut()[result_source_index] = result.loader;

                bun_core::scoped_log!(Bundle, "onParse({}, {}) = {} imports, {} exports",
                    result_source_index,
                    bstr::BStr::new(source_path_text),
                    result.ast.import_records.len as usize,
                    result.ast.named_exports.count());

                if result.ast.css.is_some() {
                    this.graph.css_file_count += 1;
                }

                diff += this.process_resolve_queue(core::mem::take(&mut resolve_queue), result.ast.target, result_source_index as IndexInt);

                let mut import_records = core::mem::take(&mut result.ast.import_records);
                let source_path_owned: Box<[u8]> = source_path_text.into();
                this.patch_import_record_source_indices(&mut import_records, PatchImportRecordsCtx {
                    source_index: Index::init(result_source_index as IndexInt),
                    source_path: &source_path_owned,
                    loader: result.loader,
                    target: result.ast.target,
                    redirect_import_record_index: result.ast.redirect_import_record_index,
                    force_save: false,
                });

                // Set is_export_star_target for barrel optimization.
                // In dev server mode, source_index is not saved on JS import
                // records, so fall back to resolving via the path map.
                // PORT NOTE: split-borrow `Graph` fields directly so the
                // `&build_graphs[target]` lookup doesn't lock out
                // `input_files.items_flags_mut()` (disjoint columns).
                let result_ast_target = result.ast.target;
                for star_record_idx in result.ast.export_star_import_records.iter() {
                    if (*star_record_idx as usize) < import_records.len as usize {
                        let star_ir = &import_records.slice()[*star_record_idx as usize];
                        let resolved_index = if star_ir.source_index.is_valid() {
                            star_ir.source_index.get()
                        } else if let Some(idx) = this.graph.build_graphs[result_ast_target].get_path(&star_ir.path) {
                            idx
                        } else {
                            continue;
                        };
                        this.graph.input_files.items_flags_mut()[resolved_index as usize] |=
                            crate::Graph::InputFileFlags::IS_EXPORT_STAR_TARGET;
                    }
                }
                result.ast.import_records = import_records;

                this.graph.ast.set(result_source_index, core::mem::replace(&mut result.ast, JSAst::empty()));

                // Barrel optimization: eagerly record import requests and
                // un-defer barrel records that are now needed.
                // TODO(b2-blocked): `schedule_barrel_deferred_imports` is gated.

                // For files with use directives, index and prepare the other side.
                if result.use_directive != crate::UseDirective::None
                    && if this.framework.as_ref().unwrap().server_components.as_ref().unwrap().separate_ssr_graph {
                        (result.use_directive == crate::UseDirective::Client) == (result_ast_target == Target::Browser)
                    } else {
                        (result.use_directive == crate::UseDirective::Client) != (result_ast_target == Target::Browser)
                    }
                {
                    if result.use_directive == crate::UseDirective::Server {
                        bun_core::todo_panic!("\"use server\"");
                    }

                    // blocked_on: `Logger::Source.path` is `bun_logger::fs::Path` but
                    // `path_with_pretty_initialized` takes/returns `Fs::Path`
                    // (`bun_resolver::Path<'_>`) — types not yet unified. Additionally
                    // `result.ast` / `result.source` were consumed above (moved into
                    // `graph.ast` / swapped into `graph.input_files`), so the Zig data
                    // flow that builds `ReferenceProxy { other_source, named_exports }`
                    // from `result` needs re-threading from `graph` once unified.
                    let _ = (result_ast_target, &source_path_owned, result_source_index);
                    todo!("blocked_on: Logger::fs::Path vs Fs::Path unification + ServerComponentParseTask::ReferenceProxy data flow");
                }
            }
            parse_task::ResultValue::Err(err) => {
                if cfg!(feature = "debug_logs") {
                    bun_core::scoped_log!(Bundle, "onParse() = err");
                }

                if process_log {
                    if let Some(dev_server) = this.dev_server {
                        // Copy out the `'static` path slice so the `input_files`
                        // borrow ends before we coerce `this` to `*mut _`.
                        let abs_path: &'static [u8] =
                            this.graph.input_files.items_source()[err.source_index.get() as usize].path.text;
                        dev_server.handle_parse_task_failure(
                            err.err,
                            err.target.bake_graph(),
                            abs_path,
                            &err.log as *const _,
                            this as *mut _,
                        ).expect("oom");
                    } else if !err.log.msgs.is_empty() {
                        // SAFETY: `transpiler.log` is a live BACKREF set in BundleV2::init.
                        err.log.clone_to_with_recycled(unsafe { &mut *this.transpiler.log }, true).expect("unreachable");
                    } else {
                        // PORT NOTE: Zig used `@tagName(err.step)`.
                        let step_name = match err.step {
                            crate::parse_task::Step::Pending => "pending",
                            crate::parse_task::Step::ReadFile => "read_file",
                            crate::parse_task::Step::Parse => "parse",
                            crate::parse_task::Step::Resolve => "resolve",
                        };
                        // SAFETY: `transpiler.log` is a live BACKREF set in BundleV2::init.
                        unsafe { &mut *this.transpiler.log }.add_error_fmt(
                            None,
                            Logger::Loc::EMPTY,
                            format_args!("{} while {}", bstr::BStr::new(err.err.name()), step_name),
                        ).expect("unreachable");
                    }
                }

                if cfg!(debug_assertions) && this.dev_server.is_some() {
                    debug_assert!(this.graph.ast.items_parts()[err.source_index.get() as usize].len == 0);
                }
            }
        }

        // `defer { graph.pending_items += diff; if diff < 0 on_after_decrement }`
        bun_core::scoped_log!(scan_counter, "in parse task .pending_items += {} = {}\n",
            diff, i32::try_from(this.graph.pending_items).unwrap() + diff);
        this.graph.pending_items = u32::try_from(i32::try_from(this.graph.pending_items).unwrap() + diff).unwrap();
        if diff < 0 {
            this.on_after_decrement_scan_counter();
        }
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn get_loaders(&mut self) -> &mut options::LoaderHashTable {
        &mut self.transpiler.options.loaders
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        self.transpiler.resolver.bust_dir_cache(path)
    }
}

// `UseDirective`/`ServerComponentBoundary` already imported at module head.

type RefVoidMap = ArrayHashMap<Ref, ()>; // TODO(port): Ref.ArrayHashCtx
pub use crate::ungate_support::{ResolvedExports, TopLevelSymbolToParts};

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum WrapKind {
    #[default]
    None,
    Cjs,
    Esm,
}

#[derive(Default)]
pub struct ImportData {
    // This is an array of intermediate statements that re-exported this symbol
    // in a chain before getting to the final symbol. This can be done either with
    // "export * from" or "export {} from". If this is done with "export * from"
    // then this may not be the result of a single chain but may instead form
    // a diamond shape if this same symbol was re-exported multiple times from
    // different files.
    pub re_exports: BabyList<Dependency>,

    pub data: ImportTracker,
}

#[derive(Default)]
pub struct ExportData {
    // Export star resolution happens first before import resolution. That means
    // it cannot yet determine if duplicate names from export star resolution are
    // ambiguous (point to different symbols) or not (point to the same symbol).
    // This issue can happen in the following scenario:
    //
    //   // entry.js
    //   export * from './a'
    //   export * from './b'
    //
    //   // a.js
    //   export * from './c'
    //
    //   // b.js
    //   export {x} from './c'
    //
    //   // c.js
    //   export let x = 1, y = 2
    //
    // In this case "entry.js" should have two exports "x" and "y", neither of
    // which are ambiguous. To handle this case, ambiguity resolution must be
    // deferred until import resolution time. That is done using this array.
    pub potentially_ambiguous_export_star_refs: BabyList<ImportData>,

    // This is the file that the named export above came from. This will be
    // different from the file that contains this object if this is a re-export.
    pub data: ImportTracker,
}

#[derive(Default)]
pub struct JSMeta {
    /// This is only for TypeScript files. If an import symbol is in this map, it
    /// means the import couldn't be found and doesn't actually exist. This is not
    /// an error in TypeScript because the import is probably just a type.
    ///
    /// Normally we remove all unused imports for TypeScript files during parsing,
    /// which automatically removes type-only imports. But there are certain re-
    /// export situations where it's impossible to tell if an import is a type or
    /// not:
    ///
    ///   import {typeOrNotTypeWhoKnows} from 'path';
    ///   export {typeOrNotTypeWhoKnows};
    ///
    /// Really people should be using the TypeScript "isolatedModules" flag with
    /// bundlers like this one that compile TypeScript files independently without
    /// type checking. That causes the TypeScript type checker to emit the error
    /// "Re-exporting a type when the '--isolatedModules' flag is provided requires
    /// using 'export type'." But we try to be robust to such code anyway.
    pub probably_typescript_type: RefVoidMap,

    /// Imports are matched with exports in a separate pass from when the matched
    /// exports are actually bound to the imports. Here "binding" means adding non-
    /// local dependencies on the parts in the exporting file that declare the
    /// exported symbol to all parts in the importing file that use the imported
    /// symbol.
    ///
    /// This must be a separate pass because of the "probably TypeScript type"
    /// check above. We can't generate the part for the export namespace until
    /// we've matched imports with exports because the generated code must omit
    /// type-only imports in the export namespace code. And we can't bind exports
    /// to imports until the part for the export namespace is generated since that
    /// part needs to participate in the binding.
    ///
    /// This array holds the deferred imports to bind so the pass can be split
    /// into two separate passes.
    pub imports_to_bind: crate::RefImportData,

    /// This includes both named exports and re-exports.
    ///
    /// Named exports come from explicit export statements in the original file,
    /// and are copied from the "NamedExports" field in the AST.
    ///
    /// Re-exports come from other files and are the result of resolving export
    /// star statements (i.e. "export * from 'foo'").
    pub resolved_exports: ResolvedExports,
    pub resolved_export_star: ExportData,

    /// Never iterate over "resolvedExports" directly. Instead, iterate over this
    /// array. Some exports in that map aren't meant to end up in generated code.
    /// This array excludes these exports and is also sorted, which avoids non-
    /// determinism due to random map iteration order.
    pub sorted_and_filtered_export_aliases: Box<[Box<[u8]>]>,

    /// This is merged on top of the corresponding map from the parser in the AST.
    /// You should call "TopLevelSymbolToParts" to access this instead of accessing
    /// it directly.
    pub top_level_symbol_to_parts_overlay: TopLevelSymbolToParts,

    /// If this is an entry point, this array holds a reference to one free
    /// temporary symbol for each entry in "sortedAndFilteredExportAliases".
    /// These may be needed to store copies of CommonJS re-exports in ESM.
    pub cjs_export_copies: Box<[Ref]>,

    /// The index of the automatically-generated part used to represent the
    /// CommonJS or ESM wrapper. This part is empty and is only useful for tree
    /// shaking and code splitting. The wrapper can't be inserted into the part
    /// because the wrapper contains other parts, which can't be represented by
    /// the current part system. Only wrapped files have one of these.
    pub wrapper_part_index: Index,

    /// The index of the automatically-generated part used to handle entry point
    /// specific stuff. If a certain part is needed by the entry point, it's added
    /// as a dependency of this part. This is important for parts that are marked
    /// as removable when unused and that are not used by anything else. Only
    /// entry point files have one of these.
    pub entry_point_part_index: Index,

    pub flags: JSMetaFlags,
}

// packed struct(u8) — manual repr(transparent) over u8 with bit accessors
#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct JSMetaFlags(u8);

impl JSMetaFlags {
    /// This is true if this file is affected by top-level await, either by having
    /// a top-level await inside this file or by having an import/export statement
    /// that transitively imports such a file. It is forbidden to call "require()"
    /// on these files since they are evaluated asynchronously.
    pub const fn is_async_or_has_async_dependency(self) -> bool { self.0 & (1 << 0) != 0 }
    pub fn set_is_async_or_has_async_dependency(&mut self, v: bool) { if v { self.0 |= 1 << 0 } else { self.0 &= !(1 << 0) } }

    /// If true, we need to insert "var exports = {};". This is the case for ESM
    /// files when the import namespace is captured via "import * as" and also
    /// when they are the target of a "require()" call.
    pub const fn needs_exports_variable(self) -> bool { self.0 & (1 << 1) != 0 }
    pub fn set_needs_exports_variable(&mut self, v: bool) { if v { self.0 |= 1 << 1 } else { self.0 &= !(1 << 1) } }

    /// If true, the "__export(exports, { ... })" call will be force-included even
    /// if there are no parts that reference "exports". Otherwise this call will
    /// be removed due to the tree shaking pass. This is used when for entry point
    /// files when code related to the current output format needs to reference
    /// the "exports" variable.
    pub const fn force_include_exports_for_entry_point(self) -> bool { self.0 & (1 << 2) != 0 }
    pub fn set_force_include_exports_for_entry_point(&mut self, v: bool) { if v { self.0 |= 1 << 2 } else { self.0 &= !(1 << 2) } }

    /// This is set when we need to pull in the "__export" symbol in to the part
    /// at "nsExportPartIndex". This can't be done in "createExportsForFile"
    /// because of concurrent map hazards. Instead, it must be done later.
    pub const fn needs_export_symbol_from_runtime(self) -> bool { self.0 & (1 << 3) != 0 }
    pub fn set_needs_export_symbol_from_runtime(&mut self, v: bool) { if v { self.0 |= 1 << 3 } else { self.0 &= !(1 << 3) } }

    /// Wrapped files must also ensure that their dependencies are wrapped. This
    /// flag is used during the traversal that enforces this invariant, and is used
    /// to detect when the fixed point has been reached.
    pub const fn did_wrap_dependencies(self) -> bool { self.0 & (1 << 4) != 0 }
    pub fn set_did_wrap_dependencies(&mut self, v: bool) { if v { self.0 |= 1 << 4 } else { self.0 &= !(1 << 4) } }

    /// When a converted CommonJS module is import() dynamically
    /// We need ensure that the "default" export is set to the equivalent of module.exports
    /// (unless a "default" export already exists)
    pub const fn needs_synthetic_default_export(self) -> bool { self.0 & (1 << 5) != 0 }
    pub fn set_needs_synthetic_default_export(&mut self, v: bool) { if v { self.0 |= 1 << 5 } else { self.0 &= !(1 << 5) } }

    pub const fn wrap(self) -> WrapKind {
        // SAFETY: bits 6-7 store a WrapKind discriminant in range [0, 2]
        unsafe { core::mem::transmute((self.0 >> 6) & 0b11) }
    }
    pub fn set_wrap(&mut self, v: WrapKind) { self.0 = (self.0 & 0b0011_1111) | ((v as u8) << 6); }
}

pub use crate::AdditionalFile;

#[derive(Default)]
pub struct EntryPoint {
    /// This may be an absolute path or a relative path. If absolute, it will
    /// eventually be turned into a relative path by computing the path relative
    /// to the "outbase" directory. Then this relative path will be joined onto
    /// the "outdir" directory to form the final output path for this entry point.
    pub output_path: bun_string::PathString,

    /// This is the source index of the entry point. This file must have a valid
    /// entry point kind (i.e. not "none").
    pub source_index: IndexInt,

    /// Manually specified output paths are ignored when computing the default
    /// "outbase" directory, which is computed as the lowest common ancestor of
    /// all automatically generated output paths.
    pub output_path_was_auto_generated: bool,
}

pub type EntryPointList = MultiArrayList<EntryPoint>;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default, strum::IntoStaticStr)]
pub enum EntryPointKind {
    #[default]
    None,
    UserSpecified,
    DynamicImport,
    Html,
}

impl EntryPointKind {
    pub fn output_kind(self) -> crate::options::OutputKind {
        match self {
            Self::UserSpecified => crate::options::OutputKind::EntryPoint,
            _ => crate::options::OutputKind::Chunk,
        }
    }

    #[inline]
    pub fn is_entry_point(self) -> bool {
        self != Self::None
    }

    #[inline]
    pub fn is_user_specified_entry_point(self) -> bool {
        self == Self::UserSpecified
    }

    // TODO: delete
    #[inline]
    pub fn is_server_entry_point(self) -> bool {
        self == Self::UserSpecified
    }
}

struct AstSourceIDMapping {
    id: IndexInt,
    source_index: IndexInt,
}

#[derive(Clone, Copy, Default)]
pub struct PartRange {
    pub source_index: Index,
    pub part_index_begin: u32,
    pub part_index_end: u32,
}

// packed struct(u96) — repr(C, packed) to match exact layout
#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct StableRef {
    pub stable_source_index: IndexInt,
    pub r#ref: Ref,
}

impl StableRef {
    pub fn is_less_than(_: (), a: StableRef, b: StableRef) -> bool {
        a.stable_source_index < b.stable_source_index
            || (a.stable_source_index == b.stable_source_index && a.r#ref.inner_index() < b.r#ref.inner_index())
    }
}

#[derive(Clone, Copy, Default)]
pub struct ImportTracker {
    pub source_index: Index,
    pub name_loc: Logger::Loc,
    pub import_ref: Ref,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ImportTrackerStatus {
    /// The imported file has no matching export
    #[default]
    NoMatch,

    /// The imported file has a matching export
    Found,

    /// The imported file is CommonJS and has unknown exports
    Cjs,

    /// The import is missing but there is a dynamic fallback object
    DynamicFallback,

    /// The import is missing but there is a dynamic fallback object
    /// and the file was originally CommonJS.
    DynamicFallbackInteropDefault,

    /// The import was treated as a CommonJS import but the file is known to have no exports
    CjsWithoutExports,

    /// The imported file was disabled by mapping it to false in the "browser"
    /// field of package.json
    Disabled,

    /// The imported file is external and has unknown exports
    External,

    /// This is a missing re-export in a TypeScript file, so it's probably a type
    ProbablyTypescriptType,
}

#[derive(Default)]
pub struct ImportTrackerIterator {
    pub status: ImportTrackerStatus,
    pub value: ImportTracker,
    pub import_data: Box<[ImportData]>,
}

// `PathTemplate` already in scope via `crate::options`.

// PORT NOTE: `CrossChunkImport`/`CrossChunkImportItem` are TYPE_ONLY-hoisted in
// `ungate_support` so `Chunk::ImportsFromOtherChunks` can name them without a
// cycle. Re-export the canonical definitions here (instead of duplicating) so
// `sorted_cross_chunk_imports` and `Chunk` agree on the element type.
pub use crate::ungate_support::{CrossChunkImport, CrossChunkImportItem, CrossChunkImportItemList};

impl CrossChunkImportItem {
    pub fn less_than(_: (), a: &CrossChunkImportItem, b: &CrossChunkImportItem) -> bool {
        strings::order(&a.export_alias, &b.export_alias) == core::cmp::Ordering::Less
    }
}

impl CrossChunkImport {
    pub fn less_than(_: (), a: &CrossChunkImport, b: &CrossChunkImport) -> bool {
        a.chunk_index < b.chunk_index
    }

    pub fn sorted_cross_chunk_imports(
        list: &mut Vec<CrossChunkImport>,
        chunks: &mut [Chunk],
        imports_from_other_chunks: &mut chunk::ImportsFromOtherChunks,
    ) -> Result<(), Error> {
        // PORT NOTE: reshaped for borrowck — Zig used `defer list.* = result;`.
        list.clear();
        list.reserve(imports_from_other_chunks.count());

        for i in 0..imports_from_other_chunks.count() {
            let chunk_index = imports_from_other_chunks.keys()[i];
            let chunk = &mut chunks[chunk_index as usize];

            // Sort imports from a single chunk by alias for determinism
            let exports_to_other_chunks = &chunk.content.javascript().exports_to_other_chunks;
            let import_items = &mut imports_from_other_chunks.values_mut()[i];
            // TODO: do we need to clone this array?
            for item in import_items.slice_mut() {
                item.export_alias = (*exports_to_other_chunks.get(&item.r#ref).unwrap()).into();
                debug_assert!(!item.export_alias.is_empty());
            }
            import_items.slice_mut().sort_by(|a, b| strings::order(&a.export_alias, &b.export_alias));

            list.push(CrossChunkImport {
                chunk_index,
                sorted_import_items: core::mem::take(import_items),
            });
        }

        list.sort_by(|a, b| a.chunk_index.cmp(&b.chunk_index));
        Ok(())
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DeclInfoKind { Declared, Lexical }

pub struct DeclInfo {
    pub name: Box<[u8]>,
    pub kind: DeclInfoKind,
}

pub enum CompileResult {
    Javascript {
        source_index: IndexInt,
        result: bun_js_printer::PrintResult,
        /// Top-level declarations collected from converted statements during
        /// parallel printing. Used by postProcessJSChunk to populate ModuleInfo
        /// without re-scanning the original (unconverted) AST.
        decls: Box<[DeclInfo]>,
    },
    Css {
        result: Result<Box<[u8]>, Error>,
        source_index: IndexInt,
        source_map: Option<SourceMap::Chunk>,
    },
    Html {
        source_index: IndexInt,
        code: Box<[u8]>,
        /// Offsets are used for DevServer to inject resources without re-bundling
        script_injection_offset: u32,
    },
}

impl CompileResult {
    /// PORT NOTE: was `pub const EMPTY` — `Box<[_]>` can't be const-constructed.
    pub fn empty() -> CompileResult {
        CompileResult::Javascript {
            source_index: 0,
            result: bun_js_printer::PrintResult::Result(bun_js_printer::PrintResultSuccess {
                code: Box::new([]),
                source_map: None,
            }),
            decls: Box::new([]),
        }
    }

    pub fn code(&self) -> &[u8] {
        match self {
            CompileResult::Javascript { result, .. } => match result {
                bun_js_printer::PrintResult::Result(r) => &r.code,
                _ => b"",
            },
            CompileResult::Css { result, .. } => match result {
                Ok(v) => v,
                Err(_) => b"",
            },
            CompileResult::Html { code, .. } => code,
        }
    }

    pub fn source_map_chunk(&self) -> Option<&SourceMap::Chunk> {
        match self {
            CompileResult::Javascript { result, .. } => match result {
                bun_js_printer::PrintResult::Result(r) => r.source_map.as_ref(),
                _ => None,
            },
            CompileResult::Css { source_map, .. } => source_map.as_ref(),
            CompileResult::Html { .. } => None,
        }
    }

    pub fn source_index(&self) -> IndexInt {
        match self {
            CompileResult::Javascript { source_index, .. } => *source_index,
            CompileResult::Css { source_index, .. } => *source_index,
            CompileResult::Html { source_index, .. } => *source_index,
        }
    }
}

pub struct CompileResultForSourceMap {
    pub source_map_chunk: SourceMap::Chunk,
    pub generated_offset: SourceMap::LineColumnOffset,
    pub source_index: u32,
}

#[derive(Default)]
pub struct ContentHasher {
    // xxhash64 outperforms Wyhash if the file is > 1KB or so
    pub hasher: bun_hash::XxHash64Streaming,
}

impl ContentHasher {
    pub fn write(&mut self, bytes: &[u8]) {
        bun_core::scoped_log!(ContentHasher, "HASH_UPDATE {}:\n{}\n----------\n", bytes.len(), bstr::BStr::new(bytes));
        self.hasher.update(&bytes.len().to_ne_bytes());
        self.hasher.update(bytes);
    }

    pub fn run(bytes: &[u8]) -> u64 {
        let mut hasher = ContentHasher::default();
        hasher.write(bytes);
        hasher.digest()
    }

    pub fn write_ints(&mut self, i: &[u32]) {
        bun_core::scoped_log!(ContentHasher, "HASH_UPDATE: {:?}\n", i);
        // SAFETY: [u32] is POD; reinterpret as bytes (std.mem.sliceAsBytes).
        let bytes = unsafe {
            core::slice::from_raw_parts(i.as_ptr().cast::<u8>(), core::mem::size_of_val(i))
        };
        self.hasher.update(bytes);
    }

    pub fn digest(&self) -> u64 {
        self.hasher.digest()
    }
}

// non-allocating
// meant to be fast but not 100% thorough
// users can correctly put in a trailing slash if they want
// this is just being nice
pub fn cheap_prefix_normalizer<'s>(prefix: &'s [u8], suffix: &'s [u8]) -> [&'s [u8]; 2] {
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return [
            if suffix_no_slash.starts_with(b"../") { b"" } else { b"./" },
            suffix_no_slash,
        ];
    }

    // There are a few cases here we want to handle:
    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"] => "/foo/bar.js"
    if strings::ends_with_char(prefix, b'/') || (cfg!(windows) && strings::ends_with_char(prefix, b'\\')) {
        if strings::starts_with_char(suffix, b'/') || (cfg!(windows) && strings::starts_with_char(suffix, b'\\')) {
            return [
                &prefix[..prefix.len()],
                &suffix[1..suffix.len()],
            ];
        }

        // It gets really complicated if we try to deal with URLs more than this
        // These would be ideal:
        // - example.com + ./out.js => example.com/out.js
        // - example.com/foo + ./out.js => example.com/fooout.js
        // - example.com/bar/ + ./out.js => example.com/bar/out.js
        // But it's not worth the complexity to handle these cases right now.
    }

    [
        prefix,
        strings::remove_leading_dot_slash(suffix),
    ]
}

fn get_redirect_id(id: u32) -> Option<u32> {
    if id == u32::MAX {
        return None;
    }
    Some(id)
}

pub fn target_from_hashbang(buffer: &[u8]) -> Option<options::Target> {
    if buffer.len() > b"#!/usr/bin/env bun".len() {
        if buffer.starts_with(b"#!/usr/bin/env bun") {
            match buffer[b"#!/usr/bin/env bun".len()] {
                b'\n' | b' ' => return Some(Target::Bun),
                _ => {}
            }
        }
    }
    None
}

#[derive(Clone, Copy, Default)]
pub struct CssEntryPointMeta {
    /// When this is true, a stub file is added to the Server's IncrementalGraph
    pub imported_on_server: bool,
}

/// The lifetime of this structure is tied to the bundler's arena
pub struct DevServerInput {
    pub css_entry_points: ArrayHashMap<Index, CssEntryPointMeta>,
}

/// The lifetime of this structure is tied to the bundler's arena
pub struct DevServerOutput<'a> {
    pub chunks: &'a mut [Chunk],
    pub css_file_list: ArrayHashMap<Index, CssEntryPointMeta>,
    pub html_files: ArrayHashMap<Index, ()>,
}

impl<'a> DevServerOutput<'a> {
    pub fn js_pseudo_chunk(&mut self) -> &mut Chunk {
        &mut self.chunks[0]
    }

    pub fn css_chunks(&mut self) -> &mut [Chunk] {
        &mut self.chunks[1..][..self.css_file_list.count()]
    }

    pub fn html_chunks(&mut self) -> &mut [Chunk] {
        &mut self.chunks[1 + self.css_file_list.count()..][..self.html_files.count()]
    }
}

pub fn generate_unique_key() -> u64 {
    let key = bun_core::fast_random() & 0x0FFFFFFF_FFFFFFFF_u64;
    // without this check, putting unique_key in an object key would
    // sometimes get converted to an identifier. ensuring it starts
    // with a number forces that optimization off.
    if cfg!(debug_assertions) {
        let mut buf = [0u8; 16];
        let written = {
            let mut cursor = &mut buf[..];
            write!(cursor, "{:016x}", key).expect("unreachable");
            16 - cursor.len()
        };
        let hex = &buf[..written];
        match hex[0] {
            b'0'..=b'9' => {}
            _ => Output::panic(format_args!("unique key is a valid identifier: {}", bstr::BStr::new(hex))),
        }
    }
    key
}

struct ExternalFreeFunctionAllocator {
    free_callback: unsafe extern "C" fn(*mut c_void),
    context: *mut c_void,
}

impl ExternalFreeFunctionAllocator {
    // TODO(port): std.mem.Allocator vtable equivalent — Phase B will define bun_alloc::Allocator trait impl

    pub fn create(free_callback: unsafe extern "C" fn(*mut c_void), context: *mut c_void) -> bun_alloc::StdAllocator {
        // PORT NOTE: Zig built a `std.mem.Allocator` whose `.ptr` was the boxed
        // `ExternalFreeFunctionAllocator` and whose vtable's `free` invoked the
        // plugin callback. `bun_alloc::StdAllocator` is the Rust equivalent.
        let boxed = Box::into_raw(Box::new(ExternalFreeFunctionAllocator { free_callback, context }));
        bun_alloc::StdAllocator {
            ptr: boxed.cast(),
            vtable: &EXTERNAL_FREE_VTABLE,
        }
    }

    fn alloc(_: *mut c_void, _: usize, _: bun_alloc::Alignment, _: usize) -> Option<*mut u8> {
        None
    }

    fn free(ext_free_function: *mut c_void, _: &mut [u8], _: bun_alloc::Alignment, _: usize) {
        // SAFETY: ptr was created by ExternalFreeFunctionAllocator::create
        let info: &mut ExternalFreeFunctionAllocator = unsafe { &mut *(ext_free_function as *mut ExternalFreeFunctionAllocator) };
        // SAFETY: free_callback is a valid C fn provided by plugin
        unsafe { (info.free_callback)(info.context) };
        // SAFETY: info was Box::into_raw'd in create()
        drop(unsafe { Box::from_raw(info) });
    }
}

static EXTERNAL_FREE_VTABLE: bun_alloc::AllocatorVTable = bun_alloc::AllocatorVTable {
    alloc: |_, _, _, _| core::ptr::null_mut(),
    resize: |_, _, _, _, _| false,
    remap: |_, _, _, _, _| core::ptr::null_mut(),
    free: |ctx, buf, a, ra| ExternalFreeFunctionAllocator::free(ctx, buf, a, ra),
};

/// Returns true if `allocator` definitely has a valid `.ptr`.
/// May return false even if `.ptr` is valid.
///
/// This function should check whether `allocator` matches any internal allocator types known to
/// have valid pointers. Allocators defined outside of this file, like `std.heap.ArenaAllocator`,
/// don't need to be checked.
pub fn allocator_has_pointer(allocator: &bun_alloc::StdAllocator) -> bool {
    // bundle_v2.zig:4443 — vtable identity check.
    core::ptr::eq(allocator.vtable, &EXTERNAL_FREE_VTABLE)
}

pub struct BuildResult {
    pub output_files: Vec<options::OutputFile>,
    pub metafile: Option<Box<[u8]>>,
    pub metafile_markdown: Option<Box<[u8]>>,
}

pub enum BundleV2Result {
    Pending,
    Err(Error),
    Value(BuildResult),
}

// re-exports
pub use crate::HTMLScanner::HTMLScanner;
pub use crate::IndexStringMap::IndexStringMap;
pub type BitSet = DynamicBitSetUnmanaged;
pub use Logger::Loc;

// C++ binding for lazy metafile getter (defined in BundlerMetafile.cpp)
// Uses jsc.conv (SYSV_ABI on Windows x64) for proper calling convention
// Sets up metafile object with { json: <lazy parsed>, markdown?: string }

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/bundle_v2.zig (4509 lines)
//   confidence: low
//   todos:      30
//   notes:      Heavy borrowck reshaping needed (overlapping &mut self.graph/transpiler); enqueueEntryPoints split into 3 fns (see PORT NOTE); ParseTask ownership uses Box::leak/from_raw; ssr_transpiler aliases transpiler in init (illegal in Rust); init() should arena-allocate self
// ──────────────────────────────────────────────────────────────────────────


}
