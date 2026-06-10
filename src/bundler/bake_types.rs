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
/// `Target` lives in `bun_ast` (lower tier, cannot name seam types); callers
/// import it from here (`crate::bake_types::TargetExt`).
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

/// Bundler-owned TYPE_ONLY `Framework` view — canonical defs live in
/// `options_impl` (they are made of bundler/parser vocabulary, no bake
/// references); re-exported here so `bun_runtime::bake` keeps reaching them
/// through the seam module when projecting its canonical `bake.Framework`
/// via `as_bundler_view`.
pub use crate::options_impl::{Framework, ReactFastRefresh, ServerComponents};

/// Seam type: the HMR runtime preamble the linker splices ahead of each
/// `Format::InternalBakeDev` chunk.
#[derive(Clone, Copy)]
pub struct HmrRuntime {
    pub code: &'static [u8],
    /// Precomputed `\n` count — sourcemap generation skips this many lines.
    pub line_count: u32,
}
/// Alias used at the crate root (`crate::HmrRuntimeSide`); identical to `Side`.
pub type HmrRuntimeSide = Side;

/// The runtime's bytes are owned by `bun_runtime`'s dev-server module (which
/// embeds the codegen'd files and also hands them to JSC); the bundler only
/// needs `&[u8]` for the chunk preamble + sourcemap line skip and reaches
/// them through the definer-prefixed link-time hook below (same pattern as
/// `__bun_bake_convert_stmts_for_chunk_hmr` in `lib.rs`). Per-side
/// `OnceLock<HmrRuntime>` memoizes the hook result (the definer recounts
/// `\n` per call), so repeat calls are a `Copy`.
pub fn get_hmr_runtime(side: Side) -> HmrRuntime {
    static CLIENT: std::sync::OnceLock<HmrRuntime> = std::sync::OnceLock::new();
    static SERVER: std::sync::OnceLock<HmrRuntime> = std::sync::OnceLock::new();
    let cell = match side {
        Side::Client => &CLIENT,
        Side::Server => &SERVER,
    };
    *cell.get_or_init(|| __bun_bake_get_hmr_runtime(side))
}

unsafe extern "Rust" {
    /// Defined `#[no_mangle]` in `bun_runtime` (`bake/bake_body.rs`). All
    /// argument/return types are safe Rust values (no raw-pointer
    /// preconditions), so the link-time-resolved body upholds Rust's
    /// invariants on its own.
    safe fn __bun_bake_get_hmr_runtime(side: Side) -> HmrRuntime;
}

/// Descriptor for one synthesized virtual module. The bundler creates the two
/// server-components manifest modules from these when
/// `Framework.server_components` is configured; the names are supplied by the
/// framework integration through `BakeOptions.server_component_manifests`
/// (bake passes its `bun:bake/server` / `bun:bake/client` specifiers), so the
/// bundler hardcodes no framework-specific module names.
#[derive(Clone, Copy)]
pub struct VirtualModule {
    /// Import specifier framework/user code writes (matched against
    /// `import_record.path.text`), e.g. `bun:bake/server`.
    pub specifier: &'static [u8],
    /// Stable internal path (chunk naming / sourcemaps), e.g. `_bun/bake/server`.
    pub path: &'static [u8],
    /// Path namespace, e.g. `bun`.
    pub namespace: &'static [u8],
}

impl VirtualModule {
    /// Materialize the `Source` for this virtual module at the bundler's
    /// reserved source `index`.
    ///
    /// `bun_paths::fs::Path<'static>` is the local TYPE_ONLY stub and does not
    /// expose a built-in-path constructor, so the path is built field-by-field.
    pub(crate) fn to_source(self, index: bun_ast::Index) -> bun_ast::Source {
        bun_ast::Source {
            path: bun_paths::fs::Path {
                pretty: self.specifier,
                text: self.path,
                namespace: self.namespace,
                is_disabled: false,
                is_symlink: true,
            },
            index,
            ..Default::default()
        }
    }
}

/// The two server-components manifest modules, at the bundler's fixed reserved
/// source indexes (`Index::BAKE_SERVER_DATA` / `Index::BAKE_CLIENT_DATA`).
#[derive(Clone, Copy)]
pub struct ServerComponentsManifests {
    pub server: VirtualModule,
    pub client: VirtualModule,
}
