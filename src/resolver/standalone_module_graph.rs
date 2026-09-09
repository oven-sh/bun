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
    fn find_assume_standalone_path(&self, name: &[u8]) -> Option<&'static [u8]>;
    /// Whether the embedded file at `name` carries a serialized ES module record (`module_info`).
    fn has_module_info(&self, _name: &[u8]) -> bool {
        false
    }
    /// The embedded module whose entry point was spelled `name` at build time (`/$bunfs/root/data.json` for the
    /// module embedded as `/$bunfs/root/data.js`), when the executable recorded it.
    fn find_entry_point_alias(&self, _name: &[u8]) -> Option<&'static [u8]> {
        None
    }
    /// The embedded module `specifier` names when imported from `source_dir`: an absolute embedded path (in either
    /// path syntax), or a `./` / `../` specifier joined onto `source_dir`, looked up as spelled, then as the source
    /// spelling of an entry point (`./data.json` -> `/$bunfs/root/data.js`), and then -- since every entry point is
    /// embedded under a `.js` name -- under the `.js` name for a source extension or no extension
    /// (`./w.ts` -> `/$bunfs/root/w.js`). Returns the graph's own name for the module, which is what the module
    /// loader keys on; `None` for anything else (bare specifiers, other absolute paths, misses).
    fn resolve(&self, source_dir: &[u8], specifier: &[u8]) -> Option<&'static [u8]> {
        let is_relative = matches!(specifier, [b'.', s, ..] | [b'.', b'.', s, ..] if bun_paths::is_sep_native(*s));
        let is_embedded_path =
            bun_options_types::standalone_path::is_bun_standalone_file_path(specifier);
        if (!is_relative && !is_embedded_path)
            || specifier
                .last()
                .is_some_and(|&c| bun_paths::is_sep_native(c))
        {
            return None;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let path_len = if is_embedded_path {
            if specifier.len() > buf.len() {
                return None;
            }
            buf[..specifier.len()].copy_from_slice(specifier);
            specifier.len()
        } else {
            bun_paths::resolve_path::join_abs_string_buf_checked::<bun_paths::platform::Loose>(
                source_dir,
                &mut buf[..],
                &[specifier],
            )?
            .len()
        };
        if let Some(name) = self.find_assume_standalone_path(&buf[..path_len]) {
            return Some(name);
        }
        if let Some(name) = self.find_entry_point_alias(&buf[..path_len]) {
            return Some(name);
        }
        // Entry points are embedded under a `.js` name whatever the (case-insensitive) source extension was.
        let extension = bun_paths::extension(&buf[..path_len]);
        let extension_len = extension.len();
        let is_source_extension = extension.is_empty()
            || [
                b"ts".as_slice(),
                b"tsx",
                b"jsx",
                b"mjs",
                b"mts",
                b"cjs",
                b"cts",
            ]
            .iter()
            .any(|source| extension[1..].eq_ignore_ascii_case(source));
        if !is_source_extension {
            return None;
        }
        let stem_len = path_len - extension_len;
        if stem_len + 3 > buf.len() {
            return None;
        }
        buf[stem_len..stem_len + 3].copy_from_slice(b".js");
        self.find_assume_standalone_path(&buf[..stem_len + 3])
    }
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
    /// Ahead-of-time bytecode for InternalModuleRegistry module `id` embedded by `bun build --compile`, if any.
    /// A raw pointer because JSC reads (and may patch) it in place; the bytes live for the process.
    fn builtin_module_bytecode(&self, _id: u32) -> Option<*mut [u8]> {
        None
    }
    /// The one shared bytecode string table (`JSC::EncoderStringTable::serialize`) every chunk's payload references by ordinal; empty when the executable has none.
    fn bytecode_string_table(&self) -> &'static [u8] {
        &[]
    }
    /// Bytes the VM reads to load the module graph: each module's bytecode (or its source when it has none), module
    /// records, builtin bytecode and the shared string table — not source maps or embedded assets.
    fn module_graph_load_bytes(&self) -> usize {
        0
    }
    /// Ask the kernel to reclaim the resident pages of the embedded graph (clean file-backed pages are dropped and
    /// re-read from the executable when touched). May block on the syscall; call off the JS thread.
    fn page_out(&self) {}
}
