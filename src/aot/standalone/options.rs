use bun_aot::Options;
use bun_aot::engine::ExecutableIdentity;
use bun_aot::options::{LoadOptions, PathOptions, RemovableOptions};
use bun_ast::Loader;
use bun_core::strings;
use bun_options_types::aot_options::AotOptions;
use bun_sema::resolve::{
    CodeOptions, ancestors, contains_path, displayed_path, get_relative_path_from_directory,
};
use bun_sema::util::SharedSort;
use bun_sema_driver::Libs;
use bun_sema_driver::host::{from_argument, from_native};

const MODULE_PREFIX: &[u8] = if cfg!(windows) {
    b"B:/~BUN/root/"
} else {
    b"/$bunfs/root/"
};

// Every path is native.
pub struct StandaloneBuild {
    pub aot: AotOptions,
    pub working_directory: Vec<u8>,
    pub entry_points: Vec<Vec<u8>>,
    pub conditions: Vec<Vec<u8>>,
    pub preserves_symlinks: bool,
    pub tsconfig_override: Option<Vec<u8>>,
    pub loaders: Vec<(Vec<u8>, Loader)>,
    pub external_packages: Vec<Vec<u8>>,
    pub are_all_packages_external: bool,
    pub root_directory: Option<Vec<u8>>,
    pub runs_macros: bool,
    pub omits_builtin_modules: bool,
}

impl StandaloneBuild {
    pub fn new(working_directory: Vec<u8>, entry_points: Vec<Vec<u8>>) -> StandaloneBuild {
        StandaloneBuild {
            aot: AotOptions::default(),
            working_directory,
            entry_points,
            conditions: Vec::new(),
            preserves_symlinks: false,
            tsconfig_override: None,
            loaders: Vec::new(),
            external_packages: Vec::new(),
            are_all_packages_external: false,
            root_directory: None,
            runs_macros: true,
            omits_builtin_modules: false,
        }
    }

    pub fn options(&self) -> Options<'_> {
        let working_directory = from_native(&self.working_directory);
        Options {
            aot: &self.aot,
            executable_identity: ExecutableIdentity([0; 16]),
            image_form: None,
            entry_points: self.entry_points.clone(),
            code: self.code_options(&working_directory),
            typescript_libs: Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS),
            load: self.load_options(),
            paths: self.path_options(&working_directory),
            removable: RemovableOptions::default(),
            lists_modules: false,
            minifies_identifiers: false,
        }
    }

    fn code_options(&self, working_directory: &[u8]) -> CodeOptions {
        let mut code = CodeOptions::bun_run(working_directory);
        for condition in &self.conditions {
            code.add_custom_condition(condition);
        }
        code.preserves_symlinks = self.preserves_symlinks;
        code.tsconfig_override = self
            .tsconfig_override
            .as_deref()
            .map(|path| from_argument(working_directory, path));
        code
    }

    fn load_options(&self) -> LoadOptions {
        let mut load = LoadOptions::new(self.working_directory.clone());
        for (extension, loader) in &self.loaders {
            let loaders = &mut load.loaders;
            match loaders.binary_search_by(|(known, _)| known.cmp(extension)) {
                Ok(index) => loaders[index].1 = *loader,
                Err(index) => loaders.insert(index, (extension.clone(), *loader)),
            }
        }
        load.externals.packages.clone_from(&self.external_packages);
        load.externals.packages.shared_sort_unstable();
        load.externals.packages.dedup();
        load.externals.are_all_packages = self.are_all_packages_external;
        load.runs_macros = self.runs_macros;
        load.omits_builtin_modules = self.omits_builtin_modules;
        load
    }

    fn path_options(&self, working_directory: &[u8]) -> PathOptions {
        let entry_points: Vec<Vec<u8>> = self
            .entry_points
            .iter()
            .map(|path| from_argument(working_directory, path))
            .collect();
        let root_directory = match &self.root_directory {
            Some(root_directory) => from_argument(working_directory, root_directory),
            None => entry_points
                .iter()
                .map(|path| parent_directory(path))
                .reduce(common_directory)
                .unwrap_or(working_directory)
                .to_vec(),
        };
        let entry_point_names = entry_points
            .iter()
            .enumerate()
            .map(|(index, path)| {
                let mut name = entry_point_name(&root_directory, path);
                if index > 0 {
                    name.extend_from_slice(b".js");
                }
                name
            })
            .collect();
        PathOptions {
            module_prefix: MODULE_PREFIX.to_vec(),
            root_directory: displayed_path(&root_directory).into_owned(),
            entry_point_names,
        }
    }
}

// The paths below are absolute, normalized and in the checker's format.

fn parent_directory(path: &[u8]) -> &[u8] {
    ancestors(path).nth(1).unwrap_or(path)
}

fn common_directory<'a>(first: &'a [u8], second: &[u8]) -> &'a [u8] {
    ancestors(first)
        .find(|directory| contains_path(directory, second, true))
        .unwrap_or(b"/")
}

fn without_extension(path: &[u8]) -> &[u8] {
    let base_start = strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
    match strings::last_index_of_char(&path[base_start..], b'.') {
        Some(dot) if dot > 0 => &path[..base_start + dot],
        _ => path,
    }
}

fn entry_point_name(root_directory: &[u8], entry_point: &[u8]) -> Vec<u8> {
    get_relative_path_from_directory(root_directory, without_extension(entry_point), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_aot::options::default_loaders;

    fn byte_strings(texts: &[&str]) -> Vec<Vec<u8>> {
        texts.iter().map(|text| text.as_bytes().to_vec()).collect()
    }

    fn build_with_entry_points(entry_points: &[&str]) -> StandaloneBuild {
        StandaloneBuild::new(b"/project".to_vec(), byte_strings(entry_points))
    }

    fn get_path_options(entry_points: &[&str]) -> PathOptions {
        build_with_entry_points(entry_points).options().paths
    }

    #[test]
    fn product_defaults() {
        let build = build_with_entry_points(&["a.ts"]);
        assert!(build.aot.embeds_function_source);
        assert!(!build.aot.erases_types);
        assert!(!build.aot.reports_type_mismatches);
        assert!(!build.aot.runs_in_place);
        assert!(build.aot.thread_count.is_none());
        assert!(build.runs_macros);
        assert!(!build.omits_builtin_modules);
        assert!(!build.preserves_symlinks);
        assert!(!build.are_all_packages_external);
        assert!(build.conditions.is_empty());
        assert!(build.loaders.is_empty());
        assert!(build.external_packages.is_empty());
        assert!(build.tsconfig_override.is_none());
        assert!(build.root_directory.is_none());
    }

    #[test]
    fn default_options() {
        let build = build_with_entry_points(&["a.ts"]);
        let options = build.options();
        let defaults = CodeOptions::bun_run(b"/project");
        assert!(options.executable_identity == ExecutableIdentity([0; 16]));
        assert_eq!(options.entry_points, byte_strings(&["a.ts"]));
        assert_eq!(options.code.working_directory, b"/project");
        assert_eq!(options.code.conditions, defaults.conditions);
        assert!(options.code.conditions.contains(&b"aot".to_vec()));
        assert!(!options.code.preserves_symlinks);
        assert!(options.code.node_paths.is_empty());
        assert!(options.code.tsconfig_override.is_none());
        assert_eq!(options.load.project_root, b"/project");
        assert_eq!(options.load.loaders, default_loaders());
        assert!(options.load.externals.packages.is_empty());
        assert!(!options.load.externals.are_all_packages);
        assert!(options.load.runs_macros);
        assert!(!options.load.omits_builtin_modules);
        assert_eq!(options.paths.module_prefix, MODULE_PREFIX);
    }

    #[test]
    fn forwarded_switches() {
        let mut build = build_with_entry_points(&["a.ts"]);
        build.conditions = byte_strings(&["worker"]);
        build.preserves_symlinks = true;
        build.tsconfig_override = Some(b"config/../tsconfig.build.json".to_vec());
        build.are_all_packages_external = true;
        build.runs_macros = false;
        build.omits_builtin_modules = true;
        let options = build.options();
        assert_eq!(options.code.conditions.last().unwrap(), b"worker");
        let custom_conditions = byte_strings(&["aot", "worker"]);
        assert_eq!(options.code.custom_conditions, custom_conditions);
        assert!(options.code.preserves_symlinks);
        assert_eq!(
            options.code.tsconfig_override.as_deref(),
            Some(&b"/project/tsconfig.build.json"[..])
        );
        assert!(options.load.externals.are_all_packages);
        assert!(!options.load.runs_macros);
        assert!(options.load.omits_builtin_modules);
    }

    #[test]
    fn loader_overrides() {
        let mut build = build_with_entry_points(&["a.ts"]);
        build.loaders = vec![
            (b".js".to_vec(), Loader::Ts),
            (b".foo".to_vec(), Loader::Text),
            (b".foo".to_vec(), Loader::Json),
        ];
        let loaders = build.options().load.loaders;
        let find_loader = |extension: &[u8]| {
            let mut matches = loaders.iter().filter(|entry| entry.0 == extension);
            let loader = matches.next().map(|entry| entry.1);
            assert!(matches.next().is_none());
            loader
        };
        assert!(loaders.is_sorted_by(|before, after| before.0 < after.0));
        assert_eq!(loaders.len(), default_loaders().len() + 1);
        assert_eq!(find_loader(b".js"), Some(Loader::Ts));
        assert_eq!(find_loader(b".foo"), Some(Loader::Json));
        assert_eq!(find_loader(b".ts"), Some(Loader::Ts));
    }

    #[test]
    fn sorted_external_packages() {
        let mut build = build_with_entry_points(&["a.ts"]);
        build.external_packages = byte_strings(&["react", "@scope/name", "react"]);
        assert_eq!(
            build.options().load.externals.packages,
            byte_strings(&["@scope/name", "react"])
        );
    }

    #[test]
    fn single_entry_point_root() {
        assert_eq!(
            get_path_options(&["src/a.ts"]).root_directory,
            b"/project/src"
        );
        assert_eq!(get_path_options(&["a.ts"]).root_directory, b"/project");
        assert_eq!(get_path_options(&["/a.ts"]).root_directory, b"/");
    }

    #[test]
    fn common_entry_point_root() {
        assert_eq!(
            get_path_options(&["src/a.ts", "lib/b.ts"]).root_directory,
            b"/project"
        );
        assert_eq!(
            get_path_options(&["src/a.ts", "src/lib/b.ts"]).root_directory,
            b"/project/src"
        );
        assert_eq!(
            get_path_options(&["src/a.ts", "src-gen/b.ts"]).root_directory,
            b"/project"
        );
        assert_eq!(
            get_path_options(&["a.ts", "/other/b.ts"]).root_directory,
            b"/"
        );
    }

    #[test]
    fn explicit_root() {
        let mut build = build_with_entry_points(&["src/a.ts"]);
        build.root_directory = Some(b"./src/../lib".to_vec());
        assert_eq!(build.options().paths.root_directory, b"/project/lib");
        build.root_directory = Some(b"/elsewhere".to_vec());
        assert_eq!(build.options().paths.root_directory, b"/elsewhere");
    }

    #[test]
    fn relative_entry_point_names() {
        assert_eq!(
            get_path_options(&["a.ts", "lib/b.ts"]).entry_point_names,
            byte_strings(&["a", "lib/b.js"])
        );
        assert_eq!(
            get_path_options(&["./src/x/../a.test.ts"]).entry_point_names,
            byte_strings(&["a.test"])
        );
        assert_eq!(
            get_path_options(&["v1.2/main", "v1.2/.env"]).entry_point_names,
            byte_strings(&["main", ".env.js"])
        );
    }

    #[test]
    fn entry_point_outside_root() {
        let mut build = build_with_entry_points(&["src/a.ts", "lib/b.ts", "/other/c.ts"]);
        build.root_directory = Some(b"src".to_vec());
        assert_eq!(
            build.options().paths.entry_point_names,
            byte_strings(&["a", "../lib/b.js", "../../other/c.js"])
        );
    }
}
