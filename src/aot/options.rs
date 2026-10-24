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
    // --minify-syntax
    pub minifies_syntax: bool,
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
    pub omits_builtin_modules: bool,
    pub runs_tests: bool,
    /// What the run time provides is of type `any` where `@types/bun` is not installed.
    pub takes_runtime_as_any: bool,
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

pub const DEFAULT_LOADERS: &[(&[u8], Loader)] = &[
    (b".cjs", Loader::Js),
    (b".css", Loader::Css),
    (b".cts", Loader::Ts),
    (b".html", Loader::Html),
    // Bun reads JSX in `.js` files.
    (b".js", Loader::Jsx),
    (b".json", Loader::Json),
    (b".json5", Loader::Json5),
    (b".jsonc", Loader::Jsonc),
    (b".jsx", Loader::Jsx),
    (b".mjs", Loader::Js),
    (b".mts", Loader::Ts),
    (b".node", Loader::Napi),
    (b".text", Loader::Text),
    (b".toml", Loader::Toml),
    (b".ts", Loader::Ts),
    (b".tsx", Loader::Tsx),
    (b".txt", Loader::Text),
    (b".wasm", Loader::Wasm),
    (b".yaml", Loader::Yaml),
    (b".yml", Loader::Yaml),
];

pub fn default_loaders() -> Vec<(Vec<u8>, Loader)> {
    DEFAULT_LOADERS
        .iter()
        .map(|&(extension, loader)| (extension.to_vec(), loader))
        .collect()
}

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
            omits_builtin_modules: false,
            runs_tests: false,
            takes_runtime_as_any: false,
        }
    }
}

impl Options<'_> {
    // The inspector evaluates text, and an external package is read from the disk: code that the build does not see.
    pub fn can_load_code_at_run_time(&self) -> bool {
        self.aot.admits_inspector || !self.load.externals.is_empty()
    }

    pub fn thread_count(&self) -> NonZeroUsize {
        const MOST_USEFUL_THREADS: usize = 16;
        let count = match self.aot.thread_count {
            Some(count) => count.get() as usize,
            None => usize::from(bun_core::get_thread_count()).min(MOST_USEFUL_THREADS),
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
    fn default_thread_count_is_between_one_and_sixteen() {
        let aot = AotOptions::default();
        let count = options_with(&aot).thread_count().get();
        assert!((1..=16).contains(&count));
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
