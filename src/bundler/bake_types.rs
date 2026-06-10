//! CYCLEBREAK(b0) TYPE_ONLY seam module: pure value types shared between the
//! bundler internals and `bun_runtime::bake`, kept at the lower tier so the
//! bundler can consume them without depending on the full DevServer.
//! `bun_runtime::bake` re-exports these as the canonical defs and constructs
//! values of them (e.g. `Framework` is projected from the runtime-side
//! superset via `as_bundler_view`). The `dispatch::DevServerHandle` vtable in
//! `lib.rs` names `Graph`/`CacheEntry` in its slot signatures, so this module
//! is part of that seam's type surface.

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, core::marker::ConstParamTy)]
pub enum Side {
    Client = 0,
    Server = 1,
}
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Graph {
    Client = 0,
    Server = 1,
    Ssr = 2,
}
/// Used for the per-file `// path (target)` comment
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
        match self {
            Side::Client => Graph::Client,
            Side::Server => Graph::Server,
        }
    }
}
/// Bundler-only `Target` extension: which dev-server graph a file bundled for
/// that target lands in. Declared next to `Graph` because the canonical
/// `Target` lives in `bun_ast` (lower tier, cannot name seam types);
/// `options_impl` re-exports it so `use …::options_impl::TargetExt;` callers
/// resolve the method on the single canonical `Target`.
pub trait TargetExt: Copy {
    fn bake_graph(self) -> Graph;
}
impl TargetExt for bun_ast::Target {
    fn bake_graph(self) -> Graph {
        use bun_ast::Target;
        match self {
            Target::Browser => Graph::Client,
            Target::ServerComponentsSsr => Graph::Ssr,
            Target::BunMacro | Target::Bun | Target::Node => Graph::Server,
        }
    }
}
/// The type of `CacheEntry.kind`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum CacheKind {
    Unknown = 0,
    Js = 1,
    Asset = 2,
    Css = 3,
}
#[derive(Copy, Clone)]
pub struct CacheEntry {
    pub kind: CacheKind,
}
/// Canonical definition lives in `bun_options_types` (T3); re-exported
/// here so bundler and bake (in runtime, T6) share one nominal type.
pub use bun_options_types::BuiltInModule;

/// `EntryPointList` flags.
#[repr(transparent)]
#[derive(Copy, Clone, Default, Eq, PartialEq)]
pub struct EntryPointFlags(pub u8);
impl EntryPointFlags {
    pub const CLIENT: u8 = 1 << 0;
    pub const SERVER: u8 = 1 << 1;
    pub const SSR: u8 = 1 << 2;
    /// When set, `.CLIENT` is also set.
    pub const CSS: u8 = 1 << 3;
    #[inline]
    pub fn client(self) -> bool {
        self.0 & Self::CLIENT != 0
    }
    #[inline]
    pub fn server(self) -> bool {
        self.0 & Self::SERVER != 0
    }
    #[inline]
    pub fn ssr(self) -> bool {
        self.0 & Self::SSR != 0
    }
    #[inline]
    pub fn css(self) -> bool {
        self.0 & Self::CSS != 0
    }
}

/// TYPE_ONLY moved down; bundler
/// reads `.set` (count/keys/values) in `enqueue_entry_points_dev_server`.
#[derive(Default)]
pub struct EntryPointList {
    pub set: bun_collections::StringArrayHashMap<EntryPointFlags>,
}
impl EntryPointList {
    pub fn empty() -> Self {
        Self {
            set: bun_collections::StringArrayHashMap::new(),
        }
    }
}

/// TYPE_ONLY subset of the `Framework` fields
/// the bundler/parser actually consult; `file_system_router_types`
/// stays in T6 because only `bake::FrameworkRouter` reads it.
#[non_exhaustive]
pub struct Framework {
    pub built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
    /// Mirrors `Framework.server_components`.
    pub server_components: Option<ServerComponents>,
    /// Mirrors `Framework.react_fast_refresh` — read by the parser
    /// (`js_parser/ast/Parser.rs:1997` resolves `framework.react_fast_refresh
    /// .import_source`) when `features.react_fast_refresh` is on.
    pub react_fast_refresh: Option<ReactFastRefresh>,
    /// Mirrors `Framework.is_built_in_react` — read by
    /// `linker_context::generateChunksInParallel` to gate `BakeExtra`.
    pub is_built_in_react: bool,
    /// Read by `entry_points.rs` (FallbackEntryPoint/ClientEntryPoint::generate).
    pub client_css_in_js: crate::options::ClientCssInJs,
}
impl Framework {
    /// Construct the bundler-side TYPE_ONLY view. Called from
    /// `bun_runtime::bake::Framework::init_transpiler_with_options`; the
    /// runtime owns the canonical `bake.Framework` and projects the
    /// fields the bundler reads.
    pub fn new(
        built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
        server_components: Option<ServerComponents>,
        react_fast_refresh: Option<ReactFastRefresh>,
        is_built_in_react: bool,
    ) -> Self {
        Self {
            built_in_modules,
            server_components,
            react_fast_refresh,
            is_built_in_react,
            client_css_in_js: crate::options::ClientCssInJs::default(),
        }
    }
}
/// `Framework.ServerComponents` — full string
/// surface so the parser-side projection (ParseTask.rs `run_with_source_code`)
/// can forward user-configured `serverRegisterServerReference` /
/// `clientRegisterServerReference` instead of hardcoding defaults.
#[derive(Default, Clone)]
pub struct ServerComponents {
    pub separate_ssr_graph: bool,
    pub server_runtime_import: Box<[u8]>,
    pub server_register_client_reference: Box<[u8]>,
    pub server_register_server_reference: Box<[u8]>,
    pub client_register_server_reference: Box<[u8]>,
}
#[derive(Clone)]
pub struct ReactFastRefresh {
    pub import_source: Box<[u8]>,
}

/// TYPE_ONLY moved down so the
/// linker can splice the runtime preamble without depending on bun_bake.
#[derive(Clone, Copy)]
pub struct HmrRuntime {
    pub code: &'static [u8],
    /// Precomputed `\n` count — sourcemap generation skips this many lines.
    pub line_count: u32,
}
impl HmrRuntime {
    pub const fn init(code: &'static [u8]) -> Self {
        // const-fn newline counter.
        let mut n: u32 = 0;
        let mut i = 0usize;
        while i < code.len() {
            if code[i] == b'\n' {
                n += 1;
            }
            i += 1;
        }
        Self {
            code,
            line_count: n,
        }
    }
}
/// Alias used at the crate root (`crate::HmrRuntimeSide`); identical to `Side`.
pub type HmrRuntimeSide = Side;

/// MOVE_DOWN bake→bundler:
/// the codegen'd `bake.client.js` / `bake.server.js` are loaded via
/// `bun_core::runtime_embed_file!` (same per-site `OnceLock<String>` cache
/// `js_parser/runtime.rs` uses for `runtime.out.js`), so the storage lives
/// HERE — no upward link to `bun_runtime`. `bun_runtime::bake` keeps its
/// own `&'static ZStr` flavour for JSC/C++ handoff; this bundler-side copy
/// only needs `&[u8]` for the chunk preamble + sourcemap line skip, so the
/// NUL-termination dance is unnecessary. Per-side `OnceLock<HmrRuntime>`
/// memoizes the `\n` count (`runtime_embed_file!` already caches the file
/// load, this caches the `init` scan so repeat calls are a `Copy`).
pub fn get_hmr_runtime(side: Side) -> HmrRuntime {
    static CLIENT: std::sync::OnceLock<HmrRuntime> = std::sync::OnceLock::new();
    static SERVER: std::sync::OnceLock<HmrRuntime> = std::sync::OnceLock::new();
    match side {
        Side::Client => *CLIENT.get_or_init(|| {
            HmrRuntime::init(
                bun_core::runtime_embed_file!(CodegenEager, "bake.client.js").as_bytes(),
            )
        }),
        // Server runtime is loaded once; non-eager.
        Side::Server => *SERVER.get_or_init(|| {
            HmrRuntime::init(bun_core::runtime_embed_file!(Codegen, "bake.server.js").as_bytes())
        }),
    }
}

/// `bun_ast::Source` is not `const`-constructible (owns a `fs::Path`), so these
/// are lazy statics.
pub(crate) static SERVER_VIRTUAL_SOURCE: std::sync::LazyLock<bun_ast::Source> =
    std::sync::LazyLock::new(|| {
        // Inlined because `bun_paths::fs::Path<'static>` is the local TYPE_ONLY stub and
        // does not expose a built-in-path constructor.
        bun_ast::Source {
            path: bun_paths::fs::Path {
                pretty: b"bun:bake/server",
                text: b"_bun/bake/server",
                namespace: b"bun",
                is_disabled: false,
                is_symlink: true,
            },
            index: bun_ast::Index(crate::Index::BAKE_SERVER_DATA.get()),
            ..Default::default()
        }
    });
pub(crate) static CLIENT_VIRTUAL_SOURCE: std::sync::LazyLock<bun_ast::Source> =
    std::sync::LazyLock::new(|| bun_ast::Source {
        path: bun_paths::fs::Path {
            pretty: b"bun:bake/client",
            text: b"_bun/bake/client",
            namespace: b"bun",
            is_disabled: false,
            is_symlink: true,
        },
        index: bun_ast::Index(crate::Index::BAKE_CLIENT_DATA.get()),
        ..Default::default()
    });
