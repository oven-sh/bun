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
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct RemovableOptions {
    // --ignore-dce-annotations
    pub ignores_pure_annotations: bool,
    // --jsx-side-effects
    pub jsx_has_side_effects: bool,
}

#[derive(Clone, Debug)]
pub struct LoadOptions {
    pub project_root: Vec<u8>,
    pub loaders: Vec<(Vec<u8>, Loader)>,
    pub externals: Externals,
    pub react_compiler: ReactCompilerMode,
    pub runs_macros: bool,
    pub in_memory_files: Vec<(Vec<u8>, Vec<u8>)>,
    pub omits_builtin_modules: bool,
    pub runs_tests: bool,
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
            omits_builtin_modules: false,
            runs_tests: false,
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
