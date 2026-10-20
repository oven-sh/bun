//! `StandaloneModuleGraph` — the resolver-side trait abstraction over
//! `bun_standalone_graph::Graph` (which depends on `bun_bundler`). Defining
//! the trait here lets the resolver hold a `dyn` object without depending on
//! the higher-tier crate that implements it.

/// How many regions a bytecode payload laid out by an order file has (`JSC::BytecodeLinkRegions`): heads of evaluated
/// modules, the function bodies the recorded run decoded, the ones its build did not have, heads of modules known not
/// to be evaluated, all other bodies, expression info.
pub const LINKED_BYTECODE_REGION_COUNT: usize = 6;

/// A module of the executable together with its ahead-of-time bytecode.
pub struct BytecodeModule {
    pub source: bun_core::String,
    /// The path the bytecode is keyed on.
    pub origin_path: &'static [u8],
    pub is_esm: bool,
    /// The payload the module's cache entry is in, and where in it.
    pub bytecode: *mut [u8],
    pub bytecode_entry_offset: u32,
}

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
    /// Whether the embedded file at `name` is an ES module whose record the loader can build without parsing: it carries
    /// a serialized `module_info` body or is a module of the pre-resolved graph.
    fn has_module_info(&self, _name: &[u8]) -> bool {
        false
    }
    /// The pre-resolved ES module graph (`JSC::PrelinkedModuleGraph` blob) and the module-info slot table its names index
    /// (`ModuleInfoSlotTable` bytes: `u32` count, then the slots); both empty when the executable has no graph.
    fn prelinked_module_graph(&self) -> (&'static [u8], &'static [u8]) {
        (&[], &[])
    }
    /// The graph module index of the embedded file at `name`, or `u32::MAX`.
    fn prelinked_module_index(&self, _name: &[u8]) -> u32 {
        u32::MAX
    }
    /// The canonical embedded name (module key) of graph module `index`.
    fn prelinked_module_name(&self, _index: u32) -> Option<&'static [u8]> {
        None
    }
    /// The embedded module `specifier` names when imported from `source_dir`: an absolute embedded path (in either
    /// path syntax), or a `./` / `../` specifier joined onto `source_dir`, looked up as spelled and then -- since every
    /// entry point is embedded under a `.js` name -- under the `.js` name for a source extension or no extension
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
    /// The payload internal module `id`'s ahead-of-time bytecode is in, and where in it its cache entry starts.
    fn builtin_module_bytecode(&self, _id: u32) -> Option<(*mut [u8], u32)> {
        None
    }
    /// Every internal module that has bytecode: `(id, payload, entry offset)`.
    fn for_each_builtin_bytecode(&self, _each: &mut dyn FnMut(u32, *mut [u8], u32)) {}
    /// The one shared bytecode string table (`JSC::EncoderStringTable::serialize`) every chunk's payload references by ordinal; empty when the executable has none.
    fn bytecode_string_table(&self) -> &'static [u8] {
        &[]
    }
    /// Bytes the VM reads to load the module graph: each module's bytecode (or its source when it has none), module
    /// records, builtin bytecode and the shared string table — not source maps or embedded assets.
    fn module_graph_load_bytes(&self) -> usize {
        0
    }
    /// The bytecode payload an order file laid out (`--bytecode-order`), and where each of its regions ends.
    fn linked_bytecode_payload(
        &self,
    ) -> Option<(*const [u8], [u32; LINKED_BYTECODE_REGION_COUNT])> {
        None
    }
    /// The path of every file, and the path every module's bytecode is keyed on.
    fn for_each_path(&self, _each: &mut dyn FnMut(&'static [u8])) {}
    /// Every module that has bytecode (`BUN_BYTECODE_ORDER_OUT`, `BUN_BYTECODE_DIGEST_OUT`).
    fn for_each_bytecode_module(&self, _each: &mut dyn FnMut(BytecodeModule)) {}
}
