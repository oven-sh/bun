//! `StandaloneModuleGraph` — the resolver-side trait abstraction over
//! `bun_standalone_graph::Graph` (which depends on `bun_bundler`). Defining
//! the trait here lets the resolver hold a `dyn` object without depending on
//! the higher-tier crate that implements it.

/// Resolver's view of a compiled-standalone-binary module graph. The concrete
/// `bun_standalone_graph::Graph` (which depends on `bun_bundler`) implements
/// this; the resolver holds a trait object so it stays below both in the dep
/// graph. The path-prefix predicate lives in
/// `bun_options_types::standalone_path` (MOVE_DOWN) and is callable without a
/// graph instance.
pub trait StandaloneModuleGraph: Send + Sync {
    /// Look up `name` (already known to be under the standalone virtual root)
    /// and return the embedded file's canonical name slice if present.
    fn find_assume_standalone_path(&self, name: &[u8]) -> Option<&[u8]>;
    /// Look up `name` (any path — checks the standalone virtual-root prefix
    /// first) and return the embedded file's canonical name slice if present.
    /// Spec `StandaloneModuleGraph.find`.
    fn find(&self, name: &[u8]) -> Option<&[u8]>;
    /// `StandaloneModuleGraph.base_public_path_with_default_suffix` — the
    /// virtual-root prefix used for embedded modules (e.g. `/$bunfs/root/`).
    /// Baked-in `'static` constant; surfaced here so low-tier callers
    /// (worker entry-point resolution) don't need the concrete graph type.
    fn base_public_path_with_default_suffix(&self) -> &'static [u8];
    /// `StandaloneModuleGraph.compile_exec_argv` — the `--compile-exec-argv`
    /// string baked into a `bun build --compile` binary. Exposed via the trait
    /// so `process.execArgv` (lower-tier `bun_jsc` callers holding only the
    /// trait object) can read it without downcasting to the concrete graph.
    fn compile_exec_argv(&self) -> &[u8];
}
