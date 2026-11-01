use core::num::NonZeroUsize;
use std::sync::Arc;

use crate::engine::{ExecutableIdentity, TargetImageForm};
use bun_ast::Loader;
use bun_ast::runtime::ReactCompilerMode;
use bun_options_types::aot_options::AotOptions;
use bun_sema::resolve::CodeOptions;
use bun_sema_driver::Libs;

pub struct Options<'a> {
    pub aot: &'a AotOptions,
    pub executable_identity: ExecutableIdentity,
    pub image_form: Option<TargetImageForm>,
    pub entry_points: Vec<Vec<u8>>,
    // Its paths are in the checker's format. Every other path in these options is native.
    pub code: CodeOptions,
    pub typescript_libs: Libs<'a>,
    pub load: LoadOptions,
    pub paths: PathOptions,
    pub removable: RemovableOptions,
    // --metafile
    pub lists_modules: bool,
    // --minify-identifiers without --keep-names
    pub minifies_identifiers: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct RemovableOptions {
    // --ignore-dce-annotations
    pub ignores_pure_annotations: bool,
    // --jsx-side-effects
    pub jsx_has_side_effects: bool,
}

/// Modules and functions of Bun's own code, by their numbers.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct LibraryCode {
    pub modules: Vec<u32>,
    /// Those of `modules` off which any export may be read.
    pub modules_read_whole: Vec<u32>,
    pub exports_read: Vec<(u32, &'static str)>,
    pub functions: Vec<u32>,
}

/// A file that is left to the loader, or that such a file loads, as the compile that gave the file up has read it.
#[derive(Debug)]
pub struct FileBelowFileLeftToLoader {
    pub path: Vec<u8>,
    /// The files that its import sites load, by their places in `LoadsBelowFilesLeftToLoader::files`.
    pub loads: Vec<u32>,
    /// It may load a file under a name that it does not spell.
    pub loads_unknown_files: bool,
}

/// `export { absent } from "./lib.js"` fails where the loader links it, so the loader has asked for lib.js by then. What the program holds of
/// these files the loader asks the program for. The others it reads from disk, and goes on to what they load.
#[derive(Debug)]
pub struct LoadsBelowFilesLeftToLoader {
    pub files: Vec<FileBelowFileLeftToLoader>,
    /// So many of `files`, the first ones, are left to the loader.
    pub left_count: usize,
}

#[derive(Clone, Debug)]
pub struct LoadOptions {
    pub project_root: Vec<u8>,
    pub loaders: Vec<(Vec<u8>, Loader)>,
    pub externals: Externals,
    pub react_compiler: ReactCompilerMode,
    pub runs_macros: bool,
    pub in_memory_files: Vec<(Vec<u8>, Vec<u8>)>,
    /// Sorted. The key of each of `in_memory_files` as the build's options write it, and its path. An import that spells the key means the file, wherever the import stands.
    pub in_memory_file_keys: Vec<(Vec<u8>, Vec<u8>)>,
    /// The entry points that are no files.
    pub entry_texts: Vec<EntryText>,
    pub omits_builtin_modules: bool,
    pub runs_tests: bool,
    pub has_globals_of_vitest: bool,
    /// What the run time provides is of type `any` where `@types/bun` is not installed.
    pub takes_runtime_as_any: bool,
    /// `BuildFailed::errors_with_bun_types` of the compile that `takes_runtime_as_any` comes from.
    pub errors_with_bun_types: Option<Vec<(Vec<u8>, u32)>>,
    /// What of Bun's own code an earlier compile of the same program lacked, by the word of the engine.
    pub library_code_lacked: LibraryCode,
    /// The program holds all of Bun's own code that can be got at without a name that the build sees.
    pub keeps_library_code_without_names: bool,
    /// An earlier compile of the same program read `process.mainModule`, or the `main` of a `require`, where no file names a way to a module object, by the word of the engine.
    pub reads_main_module_without_its_name: bool,
    /// An earlier compile of the same program stored into `Bun.main`, by the word of the engine: any file may be the main module.
    pub stores_path_of_main_module: bool,
    /// An earlier compile of the same program stored into `Module._resolveFilename` or `Module.prototype.require`, by the word of the engine: the loader hands what stands there the module object of a file that asks it at run time.
    pub stores_loader_functions: bool,
    /// An earlier compile of the same program read them, by the word of the engine, where a module object goes where the front end does not follow it.
    pub ways_read_out_of_sight: WaysBetweenModuleObjects,
    /// An earlier compile of the same program followed them because a file names them, and nobody reads them of a module object, by the word of the engine.
    pub ways_named_that_nobody_reads: WaysBetweenModuleObjects,
    /// Ascending. In an earlier compile of the same program a spy of the test runner may have replaced them, by the word of the engine, and no call spells the module and the name.
    pub replaced_exports: Vec<ReplacedExport>,
    /// Ascending. Files of the test run that the build does not see mock them, or hand their objects on: `ReplacedByTests::modules`.
    pub mocked_modules: Vec<ReplacedModule>,
    /// As if a file called `mock.module` with a specifier that the build does not know: every export can be replaced, and every module mocked.
    /// An earlier compile of the same tests was not analyzed, by the word of the engine, so nobody knows what their spies and mocks replace.
    pub mocks_any_module: bool,
    /// Programs that this build does not see import from its files: every export is compiled and stays, and none of them is replaceable for that.
    pub every_export_is_asked_for: bool,
    /// Ascending. `ReplacedByTests::handed_on_modules`
    pub handed_on_modules: Vec<ReplacedModule>,
    /// `ReplacedByTests::hands_on_any_module`
    pub hands_on_any_module: bool,
    /// `ReplacedByTests::spies_on_unknown_objects`
    pub spies_on_unknown_objects: bool,
    /// `ReplacedByTests::names_spied_on_unknown_objects`
    pub names_spied_on_unknown_objects: Vec<Vec<u8>>,
    /// Ascending. What a test run spies on in code that it holds as text, which it may write to a file and load under a path that nobody reads. No build sees that file.
    pub names_spied_in_text: Vec<Vec<u8>>,
    /// Ascending. The modules that such code replaces whole, as it writes them: `"../lib.js"`, whose folder depends on where the file is written.
    pub modules_replaced_in_text: Vec<Vec<u8>>,
    /// Ascending. `ReplacedByTests::evicted_modules`
    pub evicted_modules: Vec<ReplacedModule>,
    /// `ReplacedByTests::evicts_any_module`
    pub evicts_any_module: bool,
    pub files_that_tests_load: FilesThatTestsLoad,
    /// Ascending, by their numbers in the table. Of a test run: the locked members of built-in objects that the tests replace, so they are compiled as members that may change. `spyOn(String.prototype, "indexOf")`, `Array.from = f`.
    /// What the files spell, and what `AotOptions::replaced_by_tests` brings.
    pub replaced_builtins: Vec<u32>,
    /// Ascending. Of a test run: the names that the tests add to built-in objects which take no new names. `Object.prototype.polluted = 1`.
    /// What the files spell, and what `AotOptions::replaced_by_tests` brings.
    pub opened_names: Vec<OpenedName>,
    /// Ascending. Of a test run: the files that an earlier compile of the same tests could not take, and that are no test files. The loader of the run time loads them where a test asks for them, and throws there what `bun test` throws.
    pub left_to_loader: Vec<Vec<u8>>,
    /// One of each compile that added to `left_to_loader`.
    pub loads_below_files_left_to_loader: Vec<Arc<LoadsBelowFilesLeftToLoader>>,
    /// `AotOptions::host_runs_files_from_disk`: the entry point that says what those files do with the program. Nothing loads it.
    /// Each import statement in it stands for a load by one of those files, so a module that cannot load fails none of the others.
    pub stand_in_for_files_from_disk: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum ReplacedModule {
    /// The path of a file of the application. Where `AotOptions::replaced_by_tests` brings it, also the specifier of a module of the library.
    File(Vec<u8>),
    /// The registry id of a module of the library.
    Runtime(u32),
}

impl ReplacedModule {
    pub fn file_path(&self) -> Option<&Vec<u8>> {
        match self {
            ReplacedModule::File(path) => Some(path),
            ReplacedModule::Runtime(_) => None,
        }
    }
}

/// `ReplacedByTests::files_imported_by_statements`, `files_imported_by_calls` and `files_required`
#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct FilesThatTestsLoad {
    pub by_statements: Vec<ReplacedModule>,
    pub by_calls: Vec<ReplacedModule>,
    pub by_require: Vec<ReplacedModule>,
    /// `ReplacedByTests::files_required_where_throws_are_caught`
    pub where_throws_are_caught: Vec<ReplacedModule>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct OpenedName {
    /// The object's number in the table.
    pub holder: u32,
    pub name: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct ReplacedExport {
    pub module: ReplacedModule,
    pub name: Vec<u8>,
}

/// The members of a module object that lead to other module objects.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct WaysBetweenModuleObjects {
    pub children: bool,
    pub parent: bool,
}

impl WaysBetweenModuleObjects {
    pub fn is_empty(self) -> bool {
        !self.children && !self.parent
    }

    pub fn add(&mut self, more: WaysBetweenModuleObjects) {
        self.children |= more.children;
        self.parent |= more.parent;
    }
}

/// Code that the program holds as a text and starts a Worker with.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntryText {
    /// How `Options::entry_points` writes it, and what the run time knows the module by.
    pub name: Vec<u8>,
    pub contents: Vec<u8>,
    pub loader: Loader,
}

#[derive(Clone, Debug, Default)]
pub struct Externals {
    pub are_all_packages: bool,
    pub packages: Vec<Vec<u8>>,
    pub paths: Vec<Vec<u8>>,
    pub patterns: Vec<(Vec<u8>, Vec<u8>)>,
}

impl Externals {
    pub fn is_empty(&self) -> bool {
        let Externals {
            are_all_packages,
            packages,
            paths,
            patterns,
        } = self;
        !are_all_packages && packages.is_empty() && paths.is_empty() && patterns.is_empty()
    }
}

#[derive(Clone, Debug)]
pub struct PathOptions {
    pub module_prefix: Vec<u8>,
    pub root_directory: Vec<u8>,
    pub entry_point_names: Vec<Vec<u8>>,
}

pub use crate::module_keys::DEFAULT_LOADERS;

#[cfg(any(test, feature = "test_support"))]
pub fn default_loaders() -> Vec<(Vec<u8>, Loader)> {
    DEFAULT_LOADERS
        .iter()
        .map(|&(extension, loader)| (extension.to_vec(), loader))
        .collect()
}

#[cfg(any(test, feature = "test_support"))]
impl LoadOptions {
    pub fn new(project_root: Vec<u8>) -> LoadOptions {
        LoadOptions {
            project_root,
            loaders: default_loaders(),
            externals: Externals::default(),
            react_compiler: ReactCompilerMode::Disabled,
            runs_macros: true,
            in_memory_files: Vec::new(),
            in_memory_file_keys: Vec::new(),
            entry_texts: Vec::new(),
            omits_builtin_modules: false,
            runs_tests: false,
            has_globals_of_vitest: false,
            takes_runtime_as_any: false,
            errors_with_bun_types: None,
            library_code_lacked: LibraryCode::default(),
            keeps_library_code_without_names: false,
            reads_main_module_without_its_name: false,
            stores_path_of_main_module: false,
            stores_loader_functions: false,
            ways_read_out_of_sight: WaysBetweenModuleObjects::default(),
            ways_named_that_nobody_reads: WaysBetweenModuleObjects::default(),
            replaced_exports: Vec::new(),
            mocked_modules: Vec::new(),
            mocks_any_module: false,
            every_export_is_asked_for: false,
            handed_on_modules: Vec::new(),
            hands_on_any_module: false,
            spies_on_unknown_objects: false,
            names_spied_on_unknown_objects: Vec::new(),
            names_spied_in_text: Vec::new(),
            modules_replaced_in_text: Vec::new(),
            evicted_modules: Vec::new(),
            evicts_any_module: false,
            files_that_tests_load: FilesThatTestsLoad::default(),
            replaced_builtins: Vec::new(),
            opened_names: Vec::new(),
            left_to_loader: Vec::new(),
            loads_below_files_left_to_loader: Vec::new(),
            stand_in_for_files_from_disk: None,
        }
    }
}

/// A thread has a heap of its own, so beyond sixteen each thread asks for a share of the memory that the process may use.
fn default_thread_count(processors: usize, memory: usize) -> usize {
    const THREADS_WHATEVER_THE_MEMORY: usize = 16;
    const MEMORY_PER_THREAD: usize = 256 << 20;
    // The flow analysis deals its graph to this many threads at most.
    const MOST_USEFUL_THREADS: usize = 64;
    let fit_into_memory = (memory / MEMORY_PER_THREAD).max(THREADS_WHATEVER_THE_MEMORY);
    processors.min(fit_into_memory).min(MOST_USEFUL_THREADS)
}

impl Options<'_> {
    // The inspector evaluates text, and an external package is read from the disk: code that the build does not see.
    pub fn can_load_code_at_run_time(&self) -> bool {
        self.aot.admits_inspector || !self.load.externals.is_empty()
    }

    /// Unless somebody chose a number: every processor that the process may use, as far as its memory goes.
    pub fn thread_count(&self) -> NonZeroUsize {
        let count = match self.aot.thread_count {
            Some(count) => count.get() as usize,
            None => default_thread_count(
                usize::from(bun_core::get_thread_count()),
                bun_core::get_total_memory_size(),
            ),
        };
        NonZeroUsize::new(count).unwrap_or(NonZeroUsize::MIN)
    }

    pub fn debug_assert_valid(&self) {
        let LoadOptions {
            loaders,
            externals,
            in_memory_files,
            ..
        } = &self.load;
        debug_assert!(!self.entry_points.is_empty());
        debug_assert_eq!(self.paths.entry_point_names.len(), self.entry_points.len());
        debug_assert!(is_strictly_ascending(
            loaders.iter().map(|(extension, _)| extension)
        ));
        debug_assert!(
            loaders
                .iter()
                .all(|(extension, _)| extension.starts_with(b"."))
        );
        debug_assert!(is_strictly_ascending(
            in_memory_files.iter().map(|(path, _)| path)
        ));
        debug_assert!(is_strictly_ascending(externals.packages.iter()));
        debug_assert!(is_strictly_ascending(externals.paths.iter()));
        debug_assert!(is_strictly_ascending(externals.patterns.iter()));
    }
}

fn is_strictly_ascending<T: Ord>(items: impl Iterator<Item = T>) -> bool {
    items.is_sorted_by(|a, b| a < b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_loader(extension: &[u8]) -> Option<Loader> {
        default_loaders()
            .into_iter()
            .find(|(candidate, _)| candidate == extension)
            .map(|(_, loader)| loader)
    }

    fn options_with(aot: &AotOptions) -> Options<'_> {
        Options {
            aot,
            executable_identity: ExecutableIdentity([0; 16]),
            image_form: None,
            entry_points: vec![b"main.ts".to_vec()],
            code: CodeOptions::bun_run(b"/project"),
            typescript_libs: Libs::Directory(b"/project"),
            load: LoadOptions::new(b"/project".to_vec()),
            paths: PathOptions {
                module_prefix: b"/$bunfs/root/".to_vec(),
                root_directory: b"/project".to_vec(),
                entry_point_names: vec![b"main".to_vec()],
            },
            removable: RemovableOptions::default(),
            lists_modules: false,
            minifies_identifiers: false,
        }
    }

    fn assert_valid_after(change: impl FnOnce(&mut Options<'_>)) {
        let aot = AotOptions::default();
        let mut options = options_with(&aot);
        change(&mut options);
        options.debug_assert_valid();
    }

    #[test]
    fn requested_thread_count_is_used() {
        let aot = AotOptions {
            thread_count: core::num::NonZeroU32::new(3),
            ..Default::default()
        };
        assert_eq!(options_with(&aot).thread_count().get(), 3);
    }

    #[test]
    fn requested_thread_count_may_exceed_the_default_cap() {
        let aot = AotOptions {
            thread_count: core::num::NonZeroU32::new(64),
            ..Default::default()
        };
        assert_eq!(options_with(&aot).thread_count().get(), 64);
    }

    #[test]
    fn default_thread_count_is_between_one_and_the_processors() {
        let aot = AotOptions::default();
        let count = options_with(&aot).thread_count().get();
        assert!((1..=usize::from(bun_core::get_thread_count())).contains(&count));
    }

    #[test]
    fn default_thread_count_follows_processors_and_memory() {
        const GB: usize = 1 << 30;
        assert_eq!(default_thread_count(4, 64 * GB), 4);
        assert_eq!(default_thread_count(16, GB), 16);
        assert_eq!(default_thread_count(64, 2 * GB), 16);
        assert_eq!(default_thread_count(64, 8 * GB), 32);
        assert_eq!(default_thread_count(64, 16 * GB), 64);
        assert_eq!(default_thread_count(32, 64 * GB), 32);
        assert_eq!(default_thread_count(192, 512 * GB), 64);
    }

    #[test]
    fn default_loaders_ascend_strictly() {
        assert!(is_strictly_ascending(
            default_loaders().iter().map(|(extension, _)| extension)
        ));
        assert_eq!(default_loaders().len(), DEFAULT_LOADERS.len());
    }

    #[test]
    fn js_extension_uses_jsx_loader() {
        assert_eq!(default_loader(b".js"), Some(Loader::Jsx));
    }

    #[test]
    fn xml_has_no_default_loader() {
        assert_eq!(default_loader(b".xml"), None);
    }

    #[test]
    fn equal_neighbors_are_not_strictly_ascending() {
        assert!(is_strictly_ascending([1, 2, 3].iter()));
        assert!(!is_strictly_ascending([1, 2, 2].iter()));
        assert!(!is_strictly_ascending([2, 1].iter()));
    }

    #[test]
    fn new_load_options_are_valid() {
        assert_valid_after(|_| {});
    }

    #[test]
    fn sorted_lists_are_valid() {
        assert_valid_after(|options| {
            options.load.in_memory_files = vec![
                (b"/project/a.ts".to_vec(), Vec::new()),
                (b"/project/b.ts".to_vec(), Vec::new()),
            ];
            options.load.externals.packages = vec![b"a".to_vec(), b"b".to_vec()];
            options.load.externals.paths = vec![b"/a".to_vec(), b"/b".to_vec()];
            options.load.externals.patterns = vec![
                (b"a".to_vec(), b"x".to_vec()),
                (b"a".to_vec(), b"y".to_vec()),
            ];
        });
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn missing_entry_points_are_invalid() {
        assert_valid_after(|options| {
            options.entry_points.clear();
            options.paths.entry_point_names.clear();
        });
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn unnamed_entry_point_is_invalid() {
        assert_valid_after(|options| options.entry_points.push(b"worker.ts".to_vec()));
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn unsorted_loaders_are_invalid() {
        assert_valid_after(|options| options.load.loaders.reverse());
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn extension_without_dot_is_invalid() {
        assert_valid_after(|options| options.load.loaders = vec![(b"ts".to_vec(), Loader::Ts)]);
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn duplicate_in_memory_file_is_invalid() {
        assert_valid_after(|options| {
            options.load.in_memory_files = vec![
                (b"/project/a.ts".to_vec(), b"1".to_vec()),
                (b"/project/a.ts".to_vec(), b"2".to_vec()),
            ];
        });
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn duplicate_external_package_is_invalid() {
        assert_valid_after(|options| {
            options.load.externals.packages = vec![b"a".to_vec(), b"a".to_vec()];
        });
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn unsorted_external_paths_are_invalid() {
        assert_valid_after(|options| {
            options.load.externals.paths = vec![b"/b".to_vec(), b"/a".to_vec()];
        });
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn unsorted_external_patterns_are_invalid() {
        assert_valid_after(|options| {
            options.load.externals.patterns =
                vec![(b"b".to_vec(), Vec::new()), (b"a".to_vec(), Vec::new())];
        });
    }
}
