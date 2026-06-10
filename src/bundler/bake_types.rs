//! CYCLEBREAK(b0) TYPE_ONLY seam module: pure value types shared between the
//! bundler internals and `bun_runtime::bake`, kept at the lower tier so the
//! bundler can consume them without depending on the full DevServer.
//! `bun_runtime::bake` re-exports these as the canonical defs and constructs
//! values of them (e.g. `Framework` is projected from the runtime-side
//! superset via `as_bundler_view`).

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
/// Canonical definition lives in `bun_options_types` (T3); re-exported
/// here so bundler and bake (in runtime, T6) share one nominal type.
pub use bun_options_types::BuiltInModule;

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
