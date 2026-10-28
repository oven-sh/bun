//! `StandaloneModuleGraph` — the resolver-side trait abstraction over
//! `bun_standalone_graph::Graph` (which depends on `bun_bundler`). Defining
//! the trait here lets the resolver hold a `dyn` object without depending on
//! the higher-tier crate that implements it.

pub use crate::compiled_program::{
    CompiledEntryPoint, CompiledProgram, ExtensionSearch, ImageFile, ModuleLookup, PackageLookup,
    compare_source_paths,
};
use crate::resolver::Resolver;

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
    /// The name of the file that an executable compiled in place holds for `path`, an absolute path that the disk no longer has.
    fn file_at_source_path(&self, _path: &[u8]) -> Option<&'static [u8]> {
        None
    }
    /// `resolve` for an embedded path, then the modules compiled ahead of time, which are no files of the graph unless they are entry points.
    fn resolve_module(
        &self,
        source_dir: &[u8],
        specifier: &[u8],
        is_require: bool,
        search: &ExtensionSearch<'_>,
    ) -> Option<&'static [u8]> {
        use bun_options_types::standalone_path::is_bun_standalone_file_path;
        let is_embedded =
            is_bun_standalone_file_path(specifier) || is_bun_standalone_file_path(source_dir);
        // `resolve` adds `.js` to `./a/.`.
        let is_left_to_program =
            self.compiled_program().is_some() && Resolver::import_path_names_directory(specifier);
        let file = match is_embedded && !is_left_to_program {
            true => self.resolve(source_dir, specifier).or_else(|| {
                // An entry point above the root directory of the build is a file of the graph under `_.._`.
                self.compiled_program()?;
                let public_root = self.base_public_path_with_default_suffix();
                let path =
                    crate::compiled_program::join_public_path(public_root, source_dir, specifier)?;
                self.resolve(source_dir, &path)
            }),
            false => None,
        };
        let module = file.map(|name| match self.compiled_entry_point(name) {
            Some(entry_point) => entry_point.module_path,
            None => name,
        });
        module.or_else(|| {
            let program = self.compiled_program()?;
            let public_root = self.base_public_path_with_default_suffix();
            program.resolve_module(public_root, source_dir, specifier, is_require, search)
        })
    }
    /// `CompiledProgram::resolve_package`.
    fn resolve_package(
        &self,
        source_dir: &[u8],
        specifier: &[u8],
        is_require: bool,
        search: &ExtensionSearch<'_>,
    ) -> PackageLookup {
        let Some(program) = self.compiled_program() else {
            return PackageLookup::Unknown;
        };
        let public_root = self.base_public_path_with_default_suffix();
        program.resolve_package(public_root, source_dir, specifier, is_require, search)
    }
    /// `compiled_program::directories_of_importer`.
    fn directories_of_importer(&self, source_dir: &[u8], base: &[u8]) -> Vec<Vec<u8>> {
        if self.compiled_program().is_none() {
            return Vec::new();
        }
        let public_root = self.base_public_path_with_default_suffix();
        crate::compiled_program::directories_of_importer(public_root, source_dir, base)
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
    fn compiled_program(&self) -> Option<&CompiledProgram> {
        None
    }
    /// The entry point whose file in the graph, or whose module, is named `name`.
    fn compiled_entry_point(&self, _name: &[u8]) -> Option<&CompiledEntryPoint> {
        None
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    const ROOT: &[u8] = b"/$bunfs/root/";
    const ENTRY_POINT: &[u8] = b"/$bunfs/root/worker.js";
    const COMPILED_MODULES: [&[u8]; 3] = [
        b"/$bunfs/root/worker.ts",
        b"/$bunfs/root/lib.ts",
        b"/$bunfs/root/worker/index.ts",
    ];

    struct FakeGraph {
        program: Option<CompiledProgram>,
    }

    impl StandaloneModuleGraph for FakeGraph {
        fn find_assume_standalone_path(&self, name: &[u8]) -> Option<&'static [u8]> {
            (name == ENTRY_POINT).then_some(ENTRY_POINT)
        }
        fn base_public_path_with_default_suffix(&self) -> &'static [u8] {
            ROOT
        }
        fn compile_exec_argv(&self) -> &[u8] {
            b""
        }
        fn compiled_program(&self) -> Option<&CompiledProgram> {
            self.program.as_ref()
        }
        fn compiled_entry_point(&self, name: &[u8]) -> Option<&CompiledEntryPoint> {
            let program = self.program.as_ref()?;
            (name == ENTRY_POINT).then(|| &program.entry_points[0])
        }
    }

    fn find_compiled_module(path: &[u8]) -> Option<&'static [u8]> {
        COMPILED_MODULES.into_iter().find(|&module| module == path)
    }

    fn graph_with_compiled_program() -> FakeGraph {
        let entry_point = CompiledEntryPoint {
            file_index: 0,
            module_id: 0,
            source_path: b"/project/worker.ts",
            module_path: COMPILED_MODULES[0],
        };
        let entry_points = Box::new([entry_point]);
        let program = CompiledProgram::new(b"image", None, entry_points, Box::new([0]), false);
        program.set_module_lookup(find_compiled_module);
        FakeGraph {
            program: Some(program),
        }
    }

    fn resolve_module(graph: &FakeGraph, specifier: &[u8]) -> Option<&'static [u8]> {
        resolve_module_from(graph, ROOT, specifier)
    }

    fn resolve_module_from(
        graph: &FakeGraph,
        source_dir: &[u8],
        specifier: &[u8],
    ) -> Option<&'static [u8]> {
        let extensions = [&b".ts"[..], b".js"].map(Box::<[u8]>::from);
        let search = ExtensionSearch {
            extensions: &extensions,
            extra_extensions: &[],
            rewritten_extensions: &|_, _| &[],
        };
        graph.resolve_module(source_dir, specifier, true, &search)
    }

    #[test]
    fn entry_point_found_by_file_name_is_answered_with_module_key() {
        let graph = graph_with_compiled_program();
        for specifier in [
            &b"./worker"[..],
            b"./worker.js",
            b"./worker.mjs",
            b"./worker.ts",
        ] {
            assert_eq!(resolve_module(&graph, specifier), Some(COMPILED_MODULES[0]));
        }
        assert_eq!(
            resolve_module(&graph, ENTRY_POINT),
            Some(COMPILED_MODULES[0])
        );
    }

    #[test]
    fn name_of_directory_beside_entry_point_of_same_name() {
        let graph = graph_with_compiled_program();
        for specifier in [&b"./worker/"[..], b"./worker/.", b"./lib/../worker/"] {
            assert_eq!(resolve_module(&graph, specifier), Some(COMPILED_MODULES[2]));
        }
        assert_eq!(
            resolve_module(&graph, b"/$bunfs/root/worker/"),
            Some(COMPILED_MODULES[2])
        );
        assert_eq!(resolve_module(&graph, b"./lib/"), None);
    }

    #[test]
    fn compiled_module_is_found_after_files_of_graph() {
        let graph = graph_with_compiled_program();
        assert_eq!(resolve_module(&graph, b"./lib"), Some(COMPILED_MODULES[1]));
        assert_eq!(
            resolve_module(&graph, b"./lib.ts"),
            Some(COMPILED_MODULES[1])
        );
        assert_eq!(resolve_module(&graph, b"./absent"), None);
        assert_eq!(resolve_module(&graph, b"lib"), None);
    }

    #[test]
    fn path_on_disk_names_no_compiled_module() {
        let graph = graph_with_compiled_program();
        assert_eq!(resolve_module_from(&graph, b"/project/", b"./lib"), None);
        assert_eq!(
            resolve_module_from(&graph, b"/elsewhere/", b"/project/lib.ts"),
            None
        );
        assert_eq!(resolve_module_from(&graph, b"/elsewhere/", b"./lib"), None);
    }

    #[test]
    fn graph_without_compiled_program_has_only_its_files() {
        let graph = FakeGraph { program: None };
        assert_eq!(resolve_module(&graph, b"./worker"), Some(ENTRY_POINT));
        assert_eq!(resolve_module(&graph, b"./lib"), None);
    }
}
