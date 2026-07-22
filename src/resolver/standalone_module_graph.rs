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

    /// Resolve a `new Worker(path)` / `child_process.fork(path)` specifier to
    /// its embedded canonical name. `bun build --compile` renames sources to
    /// `.js` in the graph, so this joins `specifier` against the virtual root
    /// and probes `.ts` / `.tsx` / `.jsx` / `.mjs` / `.mts` / `.cts` / `.cjs`
    /// (and extensionless) as `.js`. Returns `None` when nothing matched.
    fn resolve_embedded_entry(&self, specifier: &[u8]) -> Option<&[u8]> {
        if let Some(name) = self.find(specifier) {
            return Some(name);
        }

        let mut buf = bun_paths::path_buffer_pool::get();
        let joined = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Loose>(
            self.base_public_path_with_default_suffix(),
            &mut buf[..],
            &[specifier],
        );
        let joined_len = joined.len();
        if let Some(name) = self.find(&buf[..joined_len]) {
            return Some(name);
        }

        let ext_len = bun_paths::extension(&buf[..joined_len]).len();
        let ext = &buf[joined_len - ext_len..joined_len];
        let probe_len = if ext.is_empty() {
            buf[joined_len..joined_len + 3].copy_from_slice(b".js");
            joined_len + 3
        } else if ext == b".ts" {
            buf[joined_len - 3..joined_len].copy_from_slice(b".js");
            joined_len
        } else if matches!(
            ext,
            b".tsx" | b".jsx" | b".mjs" | b".mts" | b".cts" | b".cjs"
        ) {
            let base = joined_len - ext.len();
            buf[base..base + 3].copy_from_slice(b".js");
            base + 3
        } else {
            return None;
        };
        self.find(&buf[..probe_len])
    }
}
