use core::num::NonZeroUsize;

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

#[derive(Clone, Copy)]
pub struct PathFilter(pub &'static (dyn Fn(&[u8]) -> bool + Sync));

impl core::fmt::Debug for PathFilter {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.write_str("PathFilter")
    }
}

#[derive(Clone, Debug)]
pub struct LoadOptions {
    pub project_root: Vec<u8>,
    pub loaders: Vec<(Vec<u8>, Loader)>,
    pub externals: Externals,
    pub react_compiler: ReactCompilerMode,
    /// Of `bun test`: which files of the project it compiles, by their native paths. Those may be `.ts` files.
    pub react_compiler_filter: Option<PathFilter>,
    pub in_memory_files: Vec<(Vec<u8>, Vec<u8>)>,
    /// Sorted. The key of each of `in_memory_files` as the build's options write it, and its path. An import that spells the key means the file, wherever the import stands.
    pub in_memory_file_keys: Vec<(Vec<u8>, Vec<u8>)>,
    /// The entry points that are text, not files.
    pub entry_texts: Vec<EntryText>,
    pub omits_builtin_modules: bool,
    pub runs_tests: bool,
    pub has_globals_of_vitest: bool,
    /// A test file or a preload may import "vitest". While `bun test` loads such a file, what it loads for the first time gets no `jest`, `xit`, `xtest` or `xdescribe`.
    /// `false` says that none of them does.
    pub entry_point_imports_vitest: bool,
    /// Strictly ascending, by their numbers in the table. In a test run: the locked members of built-in objects that the runner itself replaces and no file spells, so they are compiled as members that may change.
    /// These are the globals of a window, which the runner defines for a test file that asks for a DOM, and `process.argv` and `Bun.argv`, which it sets again between test files. The load itself finds what the files replace.
    pub replaced_builtins: Vec<u32>,
    /// In a test run: the files that the runner starts as test files, by their native paths, links followed. The package.json files above them say what the project ships.
    pub test_files: Vec<Vec<u8>>,
    /// In a test run: the file of each `--preload`, by its native path, as it is written and with links followed. An entry point that is none of these is a test file.
    pub paths_of_preloads: Vec<Vec<u8>>,
}

/// An entry point that the build is given as text instead of a file.
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
    /// The name of the file that the executable holds for each of `Options::entry_points`, below its root. The run time finds an entry point by that name too. None where the program runs in place.
    pub entry_point_file_names: Vec<Vec<u8>>,
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
            react_compiler_filter: None,
            in_memory_files: Vec::new(),
            in_memory_file_keys: Vec::new(),
            entry_texts: Vec::new(),
            omits_builtin_modules: false,
            runs_tests: false,
            has_globals_of_vitest: false,
            entry_point_imports_vitest: false,
            replaced_builtins: Vec::new(),
            test_files: Vec::new(),
            paths_of_preloads: Vec::new(),
        }
    }
}

/// A thread has a heap of its own, so beyond sixteen each thread asks for a share of the memory that the process may use.
fn default_thread_count(processors: usize, memory: usize) -> usize {
    const THREADS_WHATEVER_THE_MEMORY: usize = 16;
    const MEMORY_PER_THREAD: usize = 256 << 20;
    let fit_into_memory = (memory / MEMORY_PER_THREAD).max(THREADS_WHATEVER_THE_MEMORY);
    processors.min(fit_into_memory)
}

impl Options<'_> {
    // The inspector evaluates text, and an external package is read from the disk: code that the build does not see.
    pub fn can_load_code_at_run_time(&self) -> bool {
        self.aot.admits_inspector || !self.load.externals.is_empty()
    }

    /// `AotOptions::loads_code_from_disk` without `isolates_code_from_disk`: where the build knows of code that it has not compiled (a package left out, a file that was missing, a copy under a query), that code counts as naming every file of the program and every export.
    /// So does whatever may ask for a data file or for the original beside a mock. Isolated, none of them does: such code names globals, built-ins, what lies on disk and what it is handed.
    pub fn code_from_disk_names_files(&self) -> bool {
        self.aot.loads_code_from_disk && !self.aot.isolates_code_from_disk
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
            replaced_builtins,
            ..
        } = &self.load;
        debug_assert!(!self.entry_points.is_empty());
        debug_assert_eq!(self.paths.entry_point_names.len(), self.entry_points.len());
        // Where the files of the program lie on disk under their own paths, no path tells the image from the disk.
        debug_assert!(
            !self.aot.isolates_code_from_disk
                || (self.aot.loads_code_from_disk
                    && !self.aot.runs_in_place
                    && !self.load.runs_tests)
        );
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
        debug_assert!(is_strictly_ascending(replaced_builtins.iter()));
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
                entry_point_file_names: Vec::new(),
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
    fn only_code_from_disk_that_is_not_isolated_names_files() {
        // `loads_code_from_disk`, `isolates_code_from_disk`, whether that code names the files of the program.
        for (loads, isolates, names_files) in [
            (false, false, false),
            (true, false, true),
            (true, true, false),
        ] {
            let aot = AotOptions {
                loads_code_from_disk: loads,
                isolates_code_from_disk: isolates,
                ..Default::default()
            };
            let options = options_with(&aot);
            options.debug_assert_valid();
            assert_eq!(options.code_from_disk_names_files(), names_files);
        }
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn isolation_without_code_from_disk_is_invalid() {
        let aot = AotOptions {
            isolates_code_from_disk: true,
            ..Default::default()
        };
        options_with(&aot).debug_assert_valid();
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn isolation_of_a_program_that_runs_in_place_is_invalid() {
        let aot = AotOptions {
            loads_code_from_disk: true,
            isolates_code_from_disk: true,
            runs_in_place: true,
            ..Default::default()
        };
        options_with(&aot).debug_assert_valid();
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
            options.load.replaced_builtins = vec![1, 2];
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

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn duplicate_replaced_builtin_is_invalid() {
        assert_valid_after(|options| options.load.replaced_builtins = vec![1, 1]);
    }
}
