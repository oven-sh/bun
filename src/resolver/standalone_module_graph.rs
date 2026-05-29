//! `StandaloneModuleGraph` — the resolver-side trait abstraction over
//! `bun_standalone_graph::Graph` (which depends on `bun_bundler`). Defining
//! the trait here lets the resolver hold a `dyn` object without depending on
//! the higher-tier crate that implements it.

pub trait StandaloneModuleGraph: Send + Sync {
    /// Look up `name` (already known to be under the standalone virtual root)
    /// and return the embedded file's canonical name slice if present.
    fn find_assume_standalone_path(&self, name: &[u8]) -> Option<&[u8]>;
    /// Look up `name` (any path — checks the standalone virtual-root prefix
    /// first) and return the embedded file's canonical name slice if present.
    /// Spec `StandaloneModuleGraph.find`.
    fn find(&self, name: &[u8]) -> Option<&[u8]>;
    fn base_public_path_with_default_suffix(&self) -> &'static [u8];
    fn compile_exec_argv(&self) -> &[u8];
}
