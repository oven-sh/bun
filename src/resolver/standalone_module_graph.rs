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

/// What [`fold_embedded_path`] makes of a path. Each key starts the buffer and has `/` between its parts.
#[derive(Debug, PartialEq, Eq)]
pub enum FoldedPath<'a> {
    /// No part of the path is empty, `.` or `..`.
    AsWritten(&'a [u8]),
    /// The path without those parts.
    Shorter(&'a [u8]),
    /// A `..` leads out of the root of the executable, or the path does not fit the buffer.
    Outside,
    /// One of those parts follows a file.
    BelowFile,
}

/// `path`, which lies under the root of the executable, as a key of its graph. A disk resolves an empty part, `.`
/// and `..` one by one. The graph has no folder that the build left out, so here `..` removes the part in front of
/// it whether the graph holds that part or not, as `path.resolve()` does and as Node does for the files of a single
/// executable (https://github.com/nodejs/node/blob/v26.13.0/lib/internal/vfs/file_system.js#L73-L75). Nothing lies
/// below a file: `is_file` is asked for the key in front of each of those parts.
pub fn fold_embedded_path<'a>(
    path: &[u8],
    buffer: &'a mut [u8],
    mut is_file: impl FnMut(&[u8]) -> bool,
) -> FoldedPath<'a> {
    use bun_core::strings;
    use bun_options_types::standalone_path::{BASE_PUBLIC_PATH, is_bun_standalone_file_path};

    debug_assert!(is_bun_standalone_file_path(path));
    let path = bun_paths::string_paths::without_nt_prefix::<u8>(path);
    if path.len() > buffer.len() {
        return FoldedPath::Outside;
    }
    let root = BASE_PUBLIC_PATH.as_bytes();
    // A key has no `/` at its end, and neither has the root in front of the first part.
    let root_length = root.len() - 1;
    buffer[..root_length].copy_from_slice(&root[..root_length]);
    let mut length = root_length;
    let mut is_as_written = true;
    let separators: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };
    for part in strings::split_any(&path[root.len()..], separators) {
        if !matches!(part, b"" | b"." | b"..") {
            buffer[length] = b'/';
            buffer[length + 1..][..part.len()].copy_from_slice(part);
            length += 1 + part.len();
            continue;
        }
        is_as_written = false;
        if is_file(&buffer[..length]) {
            return FoldedPath::BelowFile;
        }
        if part == b".." {
            if length == root_length {
                return FoldedPath::Outside;
            }
            length = strings::last_index_of_char(&buffer[..length], b'/').unwrap_or(root_length);
            if is_file(&buffer[..length]) {
                return FoldedPath::BelowFile;
            }
        }
    }
    match is_as_written {
        true => FoldedPath::AsWritten(&buffer[..length]),
        false => FoldedPath::Shorter(&buffer[..length]),
    }
}

/// The file of `graph` at the first `path_len` bytes of `buf`, or the one under the `.js` name that an entry point
/// with a source extension, or with none, is embedded under.
fn find_file_or_entry_point<Graph: StandaloneModuleGraph + ?Sized>(
    graph: &Graph,
    buf: &mut [u8],
    path_len: usize,
) -> Option<&'static [u8]> {
    if let Some(name) = graph.find_assume_standalone_path(&buf[..path_len]) {
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
    graph.find_assume_standalone_path(&buf[..stem_len + 3])
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
    /// (`./w.ts` -> `/$bunfs/root/w.js`). Without a compiled program, an absolute path that names no file as spelled
    /// is looked up once more without its empty parts, `.` and `..`. Returns the graph's own name for the module,
    /// which is what the module loader keys on; `None` for anything else (bare specifiers, other absolute paths,
    /// misses).
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
        if let Some(name) = find_file_or_entry_point(self, &mut buf[..], path_len) {
            return Some(name);
        }
        // The join has folded a relative specifier, and `resolve_module` folds for a compiled program, which asks here
        // once for each module that is no file of the graph. A specifier that names a directory names no file.
        if !is_embedded_path
            || self.compiled_program().is_some()
            || Resolver::import_path_names_directory(specifier)
        {
            return None;
        }
        let FoldedPath::Shorter(folded) = fold_embedded_path(specifier, &mut buf[..], |_| false)
        else {
            return None;
        };
        let folded_len = folded.len();
        find_file_or_entry_point(self, &mut buf[..], folded_len)
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
        // `require(__dirname + "/data.json")`: the path is that of the machine that built the program, a second name for a file that
        // `--asset` gave the executable. So is `createRequire(__filename)("./data.json")`. The disk wins where it has the path.
        let file = file.or_else(|| {
            use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
            let program = self.compiled_program().filter(|_| !is_left_to_program)?;
            let public_root = self.base_public_path_with_default_suffix();
            let mut buffer = bun_paths::path_buffer_pool::get();
            let on_build_machine = match bun_paths::is_absolute(specifier) {
                true => specifier,
                false if crate::compiled_program::is_relative_specifier(specifier) => {
                    join_abs_string_buf_checked::<platform::Auto>(
                        source_dir,
                        &mut buffer[..],
                        &[specifier],
                    )?
                }
                false => return None,
            };
            let path = program.public_path_of_source(public_root, on_build_machine)?;
            match bun_sys::exists(on_build_machine) {
                true => None,
                false => self.resolve(public_root, &path),
            }
        });
        let module = file.map(|name| match self.compiled_entry_point(name) {
            Some(entry_point) => entry_point.module_path,
            None => name,
        });
        module.or_else(|| {
            let program = self.compiled_program()?;
            let public_root = self.base_public_path_with_default_suffix();
            let module =
                program.resolve_module(public_root, source_dir, specifier, is_require, search);
            let module = module.or_else(|| {
                program.resolve_module_through_root_folders(
                    public_root,
                    source_dir,
                    specifier,
                    is_require,
                    search,
                )
            });
            let resolve_below = |root_on_disk: Vec<u8>| {
                program.resolve_module_on_disk(
                    public_root,
                    &root_on_disk,
                    source_dir,
                    specifier,
                    is_require,
                    search,
                )
            };
            // `require(__dirname + "/a.js")`: the path is that of the machine that built the program, and the module is in the executable.
            let module =
                module.or_else(|| resolve_below(program.root_on_build_machine()?.to_vec()));
            let beside_executable =
                module.or_else(|| resolve_below(self.root_beside_executable()?));
            beside_executable.or_else(|| {
                let program = self.compiled_program()?;
                if !program.knows_root_on_disk() {
                    return None;
                }
                resolve_below(program.root_on_disk(crate::fs::FileSystem::get().top_level_dir())?)
            })
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
        // `createRequire(__filename)("a-package")`
        let known_to_program = program.public_path_of_source(public_root, source_dir);
        let source_dir = known_to_program.as_deref().unwrap_or(source_dir);
        program.resolve_package(public_root, source_dir, specifier, is_require, search)
    }
    /// `CompiledProgram::root_beside_executable`
    fn root_beside_executable(&self) -> Option<Vec<u8>> {
        let program = self.compiled_program()?;
        let executable = bun_core::self_exe_path().ok()?;
        program.root_beside_executable(executable.as_bytes())
    }
    /// The root directory on disk: below the folder of the executable, else below the working directory of the process.
    fn root_on_disk(&self) -> Option<Vec<u8>> {
        if let Some(root) = self.root_beside_executable() {
            return Some(root);
        }
        let program = self.compiled_program()?;
        if !program.knows_root_on_disk() {
            return None;
        }
        program.root_on_disk(crate::fs::FileSystem::get().top_level_dir())
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

    #[test]
    fn absolute_path_that_names_no_file_as_spelled_is_folded() {
        let graph = FakeGraph { program: None };
        for specifier in [
            &b"/$bunfs/root/./worker.js"[..],
            b"/$bunfs/root//worker.js",
            b"/$bunfs//root/worker.js",
            b"/$bunfs/root/lib/../worker.js",
            b"/$bunfs/root/../root/worker.js",
            b"/$bunfs/root/./worker.ts",
            b"/$bunfs/root/./worker",
        ] {
            assert_eq!(
                graph.resolve(ROOT, specifier),
                Some(ENTRY_POINT),
                "{}",
                String::from_utf8_lossy(specifier)
            );
        }
        for specifier in [
            &b"/$bunfs/root/./absent.js"[..],
            b"/$bunfs/root/../worker.js",
            b"/$bunfs/root/../../$bunfs/root/worker.js",
            b"/$bunfs/root/./worker.js/",
            b"/$bunfs/root/./worker.js/.",
            b"/$bunfs/root/./worker.js/lib/..",
        ] {
            assert_eq!(
                graph.resolve(ROOT, specifier),
                None,
                "{}",
                String::from_utf8_lossy(specifier)
            );
        }
        // A compiled program folds the path in `resolve_module`.
        let compiled = graph_with_compiled_program();
        let specifier = b"/$bunfs/root/./worker.js";
        assert_eq!(compiled.resolve(ROOT, specifier), None);
        assert_eq!(
            resolve_module(&compiled, specifier),
            Some(COMPILED_MODULES[0])
        );
    }

    fn fold(path: &str, files: &[&str]) -> String {
        let mut buffer = [0u8; 48];
        let is_file = |key: &[u8]| files.iter().any(|file| file.as_bytes() == key);
        match fold_embedded_path(path.as_bytes(), &mut buffer, is_file) {
            FoldedPath::AsWritten(key) => format!("as written: {}", String::from_utf8_lossy(key)),
            FoldedPath::Shorter(key) => String::from_utf8_lossy(key).into_owned(),
            FoldedPath::Outside => "outside".to_owned(),
            FoldedPath::BelowFile => "below a file".to_owned(),
        }
    }

    #[test]
    fn empty_parts_and_dots_are_folded_out_of_an_embedded_path() {
        for (path, expected) in [
            ("/$bunfs/root/a/b.txt", "as written: /$bunfs/root/a/b.txt"),
            (
                "/$bunfs/root/.../..a/.b",
                "as written: /$bunfs/root/.../..a/.b",
            ),
            ("/$bunfs/root/a/./b.txt", "/$bunfs/root/a/b.txt"),
            ("/$bunfs/root/a//b.txt", "/$bunfs/root/a/b.txt"),
            ("/$bunfs/root/a/c/../b.txt", "/$bunfs/root/a/b.txt"),
            ("/$bunfs/root/a/c/d/../../b.txt", "/$bunfs/root/a/b.txt"),
            ("/$bunfs//root/a", "/$bunfs/root/a"),
            ("/$bunfs/./root/a", "/$bunfs/root/a"),
            ("/$bunfs/root/../root/a", "/$bunfs/root/a"),
            ("/$bunfs/root/a/", "/$bunfs/root/a"),
            ("/$bunfs/root/a/.", "/$bunfs/root/a"),
            ("/$bunfs/root/a/..", "/$bunfs/root"),
            ("/$bunfs/root/..", "/$bunfs"),
            ("/$bunfs/", "/$bunfs"),
            ("/$bunfs/..", "outside"),
            ("/$bunfs/root/../..", "outside"),
            ("/$bunfs/root/../../etc/hostname", "outside"),
            (
                "/$bunfs/root/a/./a-name-that-is-longer-than-the-buffer-of-this-test",
                "outside",
            ),
        ] {
            assert_eq!(fold(path, &[]), expected, "{path}");
        }
    }

    #[test]
    fn nothing_lies_below_a_file_of_an_embedded_path() {
        let files = ["/$bunfs/root/a/b.txt"];
        for (path, expected) in [
            ("/$bunfs/root/a/./b.txt", "/$bunfs/root/a/b.txt"),
            // The graph does not hold `c`: it cannot tell a folder that is absent from one that the build left out.
            ("/$bunfs/root/a/c/../b.txt", "/$bunfs/root/a/b.txt"),
            // The lookup finds nothing at a part below a file that stays.
            ("/$bunfs/root/a/./b.txt/d", "/$bunfs/root/a/b.txt/d"),
            ("/$bunfs/root/a/b.txt/", "below a file"),
            ("/$bunfs/root/a/b.txt/.", "below a file"),
            ("/$bunfs/root/a/b.txt/..", "below a file"),
            ("/$bunfs/root/a/b.txt//d", "below a file"),
            ("/$bunfs/root/a/b.txt/../b.txt", "below a file"),
            ("/$bunfs/root/a/b.txt/d/..", "below a file"),
            ("/$bunfs/root/a/b.txt/d/../e", "below a file"),
            ("/$bunfs/root/a/b.txt/d/e/../..", "below a file"),
        ] {
            assert_eq!(fold(path, &files), expected, "{path}");
        }
    }
}
