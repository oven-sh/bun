use super::exports::{
    ExportsStatus, PackageSpecifier, TargetResolution, resolve_exports, resolve_imports,
};
use super::files::{TargetKind, is_in_node_modules};
use super::manifest::ExportsEntry;
use super::search::join_unrooted;
use super::*;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum SubpathImports {
    Allowed,
    Forbidden,
}

struct PackageWalk<'a> {
    specifier: &'a [u8],
    parsed: Option<PackageSpecifier<'a>>,
    is_self_reference: bool,
}

impl<'h> Resolver<'h> {
    pub(super) fn load_package_path(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> SearchResult {
        let Some(start) = ancestors(directory).find(|it| self.is_dir(it)) else {
            return SearchResult::NotFound(CodeFailure::ModuleNotFound);
        };
        self.load_node_modules(specifier, start, search, SubpathImports::Allowed)
    }

    fn load_node_modules(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
        imports: SubpathImports,
    ) -> SearchResult {
        if let Some(found) = self.load_through_config(specifier, directory, search) {
            return SearchResult::File(found);
        }
        let manifest = self.nearest_code_manifest(directory);
        if imports == SubpathImports::Allowed
            && specifier.starts_with(b"#")
            && let Some(manifest) = manifest
            && let Some(table) = &manifest.imports
        {
            return self.load_package_imports(specifier, manifest, table, search);
        }
        let self_reference = manifest.filter(|it| {
            it.exports.is_some() && PackageSpecifier::parse_name(specifier) == Some(it.name)
        });
        let walk = PackageWalk {
            specifier,
            parsed: PackageSpecifier::parse(specifier),
            is_self_reference: self_reference.is_some(),
        };
        let start = self_reference.map_or(directory, |it| it.directory);
        for ancestor in ancestors(start) {
            if let Some(answer) = self.load_from_package_directory(&walk, ancestor, search) {
                return answer;
            }
        }
        for path in &self.code_options().node_paths {
            let candidate = join_unrooted(path, specifier);
            if let Some(found) = self.load_as_file_or_directory(&candidate, search) {
                return SearchResult::File(found);
            }
        }
        SearchResult::NotFound(CodeFailure::ModuleNotFound)
    }

    fn load_through_config(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        let config = self.enclosing_code_config(directory)?;
        if config.has_paths()
            && let Some(found) = self.load_through_paths(config, specifier, search)
        {
            return Some(found);
        }
        self.load_as_file_or_directory(&join_unrooted(config.base_url?, specifier), search)
    }

    fn load_from_package_directory(
        &self,
        walk: &PackageWalk<'_>,
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<SearchResult> {
        let node_modules = match walk.is_self_reference {
            true => None,
            false => Some(self.find_node_modules(directory)?),
        };
        let package = walk.parsed.as_ref().and_then(|parsed| {
            let package_directory = match &node_modules {
                Some(node_modules) => join_unrooted(node_modules, parsed.name),
                None => directory.to_vec(),
            };
            self.is_dir(&package_directory)
                .then_some((parsed, package_directory))
        });
        let orders = &self.code_options().extension_orders;
        let extensions = match &package {
            Some(_) => orders.for_kind(search.kind, true),
            None => search.extensions,
        };
        let search = CodeSearch {
            extensions,
            ..search
        };
        if let Some((parsed, package_directory)) = &package
            && let Some(manifest) = self.code_manifest(package_directory)
            && let Some(exports) = &manifest.exports
        {
            return Some(self.load_package_exports(manifest, exports, &parsed.subpath, search));
        }
        let candidate = match &node_modules {
            Some(node_modules) => join_unrooted(node_modules, walk.specifier),
            None => directory.to_vec(),
        };
        self.load_as_file_or_directory(&candidate, search)
            .map(SearchResult::File)
    }

    pub(super) fn find_node_modules(&self, directory: &[u8]) -> Option<Vec<u8>> {
        if strings::basename_posix(directory) == b"node_modules" {
            return None;
        }
        Some(inside(directory, b"node_modules")).filter(|it| self.is_dir(it))
    }

    pub(super) fn load_package_exports(
        &self,
        manifest: &CodeManifest<'h>,
        exports: &ExportsEntry<'h>,
        subpath: &[u8],
        search: CodeSearch<'_>,
    ) -> SearchResult {
        let options = self.code_options();
        let matches = |condition: &[u8]| options.matches_condition(condition, search);
        let load = |subpath: &[u8]| {
            let resolution = resolve_exports(exports, subpath, &matches);
            self.load_target(&resolution, manifest.directory, search)
        };
        let failure = match load(subpath) {
            Ok(path) => return SearchResult::File(path),
            Err(failure) => failure,
        };
        if bun_paths::extension(subpath) == b".js"
            && subpath.len() > 3
            && let Ok(path) = load(&subpath[..subpath.len() - 3])
        {
            return SearchResult::File(path);
        }
        if subpath == b"./package.json" {
            return SearchResult::File(manifest.path.to_vec());
        }
        SearchResult::NotFound(failure)
    }

    fn load_package_imports(
        &self,
        specifier: &[u8],
        manifest: &CodeManifest<'h>,
        imports: &ExportsEntry<'h>,
        search: CodeSearch<'_>,
    ) -> SearchResult {
        if specifier.len() == 1 || specifier.starts_with(b"#/") {
            return SearchResult::NotFound(CodeFailure::InvalidModuleSpecifier);
        }
        let options = self.code_options();
        let matches = |condition: &[u8]| options.matches_condition(condition, search);
        let resolution = resolve_imports(imports, specifier, &matches);
        let directory = manifest.directory;
        if resolution.status != ExportsStatus::PackageResolve {
            return match self.load_target(&resolution, directory, search) {
                Ok(path) => SearchResult::File(path),
                Err(failure) => SearchResult::NotFound(failure),
            };
        }
        let target = &resolution.path;
        let claim = self.code_host().resolve_runtime_module(target);
        if is_runtime_module(&claim) {
            return SearchResult::Claimed(claim);
        }
        self.load_node_modules(target, directory, search, SubpathImports::Forbidden)
    }

    fn load_target(
        &self,
        resolution: &TargetResolution,
        package_directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Result<Vec<u8>, CodeFailure> {
        let Some(relative) = resolution.path.strip_prefix(b"/") else {
            return Err(resolution.status.failure());
        };
        let target = join_unrooted(package_directory, relative);
        match resolution.status {
            ExportsStatus::Exact => self.load_target_file(target, TargetKind::Exact, search),
            ExportsStatus::ExactEndsWithStar => {
                self.load_target_file(target, TargetKind::Wildcard, search)
            }
            ExportsStatus::Inexact => self
                .load_as_file_or_directory(&target, search)
                .ok_or(CodeFailure::ModuleNotFound),
            _ => Err(resolution.status.failure()),
        }
    }

    fn load_target_file(
        &self,
        target: Vec<u8>,
        kind: TargetKind,
        search: CodeSearch<'_>,
    ) -> Result<Vec<u8>, CodeFailure> {
        let directory = dirname::<Posix>(&target);
        if !self.is_dir(directory) {
            return Err(CodeFailure::ModuleNotFound);
        }
        if self.is_file(&target) {
            return Ok(target);
        }
        let orders = &self.code_options().extension_orders;
        let order = orders.for_kind(search.kind, is_in_node_modules(directory));
        let base = strings::basename_posix(&target);
        let probe = || self.probe_target_extensions(directory, base, order, kind);
        match (self.is_dir(&target), kind) {
            (true, TargetKind::Exact) => Err(CodeFailure::UnsupportedDirectoryImport),
            (true, TargetKind::Wildcard) => probe().ok_or(CodeFailure::UnsupportedDirectoryImport),
            (false, TargetKind::Exact | TargetKind::Wildcard) => {
                probe().ok_or(CodeFailure::ModuleNotFound)
            }
        }
    }
}

fn is_runtime_module(claim: &HostResolution) -> bool {
    match claim {
        HostResolution::Unclaimed | HostResolution::Path(_) | HostResolution::Erased => false,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::CodeImportKind::{Import, Require};
    use super::memory_host::{MemoryHost, resolve_in};
    use super::*;
    use crate::program::HostModuleId;

    const MODULE_NOT_FOUND: &str = "NotFound(ModuleNotFound)";
    const PACKAGE_NOT_FOUND: &str = "NotFound(PackageNotFound)";
    const NOT_EXPORTED: &str = "NotFound(PackagePathNotExported)";
    const NOT_DEFINED: &str = "NotFound(PackageImportNotDefined)";
    const DIRECTORY_IMPORT: &str = "NotFound(UnsupportedDirectoryImport)";
    const INVALID_SPECIFIER: &str = "NotFound(InvalidModuleSpecifier)";
    const INVALID_CONFIGURATION: &str = "NotFound(InvalidPackageConfiguration)";

    fn empty_files(paths: &[&str]) -> MemoryHost {
        let files: Vec<(&str, &str)> = paths.iter().map(|&path| (path, "")).collect();
        MemoryHost::new(&files)
    }

    fn package(directory: &str, manifest: &str, names: &[&str]) -> MemoryHost {
        let to_path = |name: &str| format!("{directory}/{name}");
        let manifest_path = to_path("package.json");
        let paths: Vec<String> = names.iter().map(|name| to_path(name)).collect();
        let mut files = vec![(manifest_path.as_str(), manifest)];
        files.extend(paths.iter().map(|path| (path.as_str(), "")));
        MemoryHost::new(&files)
    }

    fn dependency(manifest: &str, names: &[&str]) -> MemoryHost {
        package("/p/node_modules/pkg", manifest, names)
    }

    fn project(manifest: &str, names: &[&str]) -> MemoryHost {
        package("/p", manifest, names)
    }

    fn resolve_from(host: &MemoryHost, importer: &str, specifier: &str) -> String {
        let options = CodeOptions::bun_run(b"/p");
        resolve_in(host, &options, importer, specifier, Import)
    }

    fn resolve(host: &MemoryHost, specifier: &str) -> String {
        resolve_from(host, "/p/main.ts", specifier)
    }

    fn resolve_from_src(host: &MemoryHost, specifier: &str) -> String {
        resolve_from(host, "/p/src/x.ts", specifier)
    }

    fn external(specifier: &str) -> HostResolution {
        HostResolution::External {
            specifier: specifier.into(),
            kind: ExternalKind::HostValue,
        }
    }

    fn resolve_lib_with_config(compiler_options: &str) -> String {
        let tsconfig = format!(r#"{{"compilerOptions": {compiler_options}}}"#);
        let host = MemoryHost::new(&[
            ("/p/tsconfig.json", tsconfig.as_str()),
            ("/p/mapped/lib.ts", ""),
            ("/p/lib.ts", ""),
            ("/p/node_modules/lib/index.js", ""),
        ]);
        resolve(&host, "lib")
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn nearest_node_modules_wins() {
        let host = empty_files(&[
            "/p/node_modules/a/index.js",
            "/p/node_modules/b/index.js",
            "/p/src/node_modules/a/index.js",
        ]);
        let nearest = resolve_from_src(&host, "a");
        assert_eq!(nearest, "/p/src/node_modules/a/index.js");
        assert_eq!(resolve_from_src(&host, "b"), "/p/node_modules/b/index.js");
        assert_eq!(resolve(&host, "a"), "/p/node_modules/a/index.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn nested_node_modules_is_skipped() {
        let host = empty_files(&[
            "/p/node_modules/a/x.js",
            "/p/node_modules/b/index.js",
            "/p/node_modules/node_modules/b/index.js",
            "/p/node_modules/node_modules/c/index.js",
        ]);
        let importer = "/p/node_modules/a/x.js";
        let found = resolve_from(&host, importer, "b");
        assert_eq!(found, "/p/node_modules/b/index.js");
        assert_eq!(resolve_from(&host, importer, "c"), PACKAGE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn walk_starts_at_first_existing_directory() {
        let host = empty_files(&["/p/node_modules/a/index.js"]);
        let importer = "/p/missing/deep/x.ts";
        let found = resolve_from(&host, importer, "a");
        assert_eq!(found, "/p/node_modules/a/index.js");
        assert_eq!(resolve_from(&host, importer, "b"), PACKAGE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn scoped_package_subpath() {
        let manifest = r#"{"exports": {"./sub": "./lib/sub.js"}}"#;
        let host = package("/p/node_modules/@scope/pkg", manifest, &["lib/sub.js"]);
        let found = resolve(&host, "@scope/pkg/sub");
        assert_eq!(found, "/p/node_modules/@scope/pkg/lib/sub.js");
        assert_eq!(resolve(&host, "@scope/pkg/lib/sub.js"), NOT_EXPORTED);
        assert_eq!(resolve(&host, "@scope/missing"), MODULE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn package_directory_selects_node_modules_order() {
        let host = empty_files(&[
            "/p/node_modules/a/index.ts",
            "/p/node_modules/a/index.js",
            "/p/node_modules/b.ts",
            "/p/node_modules/b.js",
        ]);
        assert_eq!(resolve(&host, "a"), "/p/node_modules/a/index.js");
        assert_eq!(resolve(&host, "b"), "/p/node_modules/b.ts");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn config_paths_then_base_url_then_packages() {
        let paths = r#"{"baseUrl": ".", "paths": {"lib": ["./mapped/lib.ts"]}}"#;
        assert_eq!(resolve_lib_with_config(paths), "/p/mapped/lib.ts");

        let missing_path = r#"{"baseUrl": ".", "paths": {"lib": ["./missing.ts"]}}"#;
        assert_eq!(resolve_lib_with_config(missing_path), "/p/lib.ts");

        assert_eq!(resolve_lib_with_config(r#"{"baseUrl": "."}"#), "/p/lib.ts");

        let found = resolve_lib_with_config("{}");
        assert_eq!(found, "/p/node_modules/lib/index.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn trailing_slash_names_directory() {
        let paths = [
            "/p/node_modules/pkg/lib.js",
            "/p/node_modules/pkg/lib/index.js",
        ];
        let host = empty_files(&paths);
        assert_eq!(resolve(&host, "pkg/lib"), "/p/node_modules/pkg/lib.js");
        let directory = resolve(&host, "pkg/lib/");
        assert_eq!(directory, "/p/node_modules/pkg/lib/index.js");

        let file_only = empty_files(&paths[..1]);
        assert_eq!(resolve(&file_only, "pkg/lib/"), MODULE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn trailing_slash_survives_base_url_and_node_path() {
        let tsconfig = r#"{"compilerOptions": {"baseUrl": "."}}"#;
        let host = MemoryHost::new(&[
            ("/p/tsconfig.json", tsconfig),
            ("/p/lib.ts", ""),
            ("/p/lib/index.ts", ""),
            ("/global/shared.js", ""),
            ("/global/shared/index.js", ""),
        ]);
        let options = CodeOptions {
            node_paths: vec![b"/global".to_vec()],
            ..CodeOptions::bun_run(b"/p")
        };
        let resolve_globally =
            |specifier: &str| resolve_in(&host, &options, "/p/main.ts", specifier, Import);
        assert_eq!(resolve_globally("lib"), "/p/lib.ts");
        assert_eq!(resolve_globally("lib/"), "/p/lib/index.ts");
        assert_eq!(resolve_globally("shared"), "/global/shared.js");
        assert_eq!(resolve_globally("shared/"), "/global/shared/index.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn trailing_slash_survives_imports_target() {
        let names = &["node_modules/pkg/lib.js", "node_modules/pkg/lib/index.js"];
        let host = project(r##"{"imports": {"#x/": "pkg/"}}"##, names);
        assert_eq!(resolve(&host, "#x/lib"), "/p/node_modules/pkg/lib.js");
        let directory = resolve(&host, "#x/lib/");
        assert_eq!(directory, "/p/node_modules/pkg/lib/index.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn exports_hide_unlisted_files() {
        let names = &["index.js", "lib/x.js"];
        let exporting = dependency(r#"{"exports": {".": "./index.js"}}"#, names);
        assert_eq!(resolve(&exporting, "pkg"), "/p/node_modules/pkg/index.js");
        assert_eq!(resolve(&exporting, "pkg/lib/x.js"), NOT_EXPORTED);

        let found = resolve(&dependency("{}", names), "pkg/lib/x.js");
        assert_eq!(found, "/p/node_modules/pkg/lib/x.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn failed_exports_end_walk() {
        let manifest = r#"{"exports": {".": "./index.js"}}"#;
        let host = MemoryHost::new(&[
            ("/p/src/node_modules/pkg/package.json", manifest),
            ("/p/src/node_modules/pkg/index.js", ""),
            ("/p/node_modules/pkg/lib/x.js", ""),
        ]);
        assert_eq!(resolve_from_src(&host, "pkg/lib/x.js"), NOT_EXPORTED);
        let found = resolve(&host, "pkg/lib/x.js");
        assert_eq!(found, "/p/node_modules/pkg/lib/x.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn invalid_exports_resolve_nothing() {
        let invalid = dependency(r#"{"exports": false}"#, &["index.js"]);
        assert_eq!(resolve(&invalid, "pkg"), INVALID_CONFIGURATION);

        let absent = dependency(r#"{"exports": null}"#, &["index.js"]);
        assert_eq!(resolve(&absent, "pkg"), "/p/node_modules/pkg/index.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn exports_lookup_retries_without_js_extension() {
        let host = dependency(r#"{"exports": {"./sub": "./main.js"}}"#, &["main.js"]);
        assert_eq!(resolve(&host, "pkg/sub"), "/p/node_modules/pkg/main.js");
        assert_eq!(resolve(&host, "pkg/sub.js"), "/p/node_modules/pkg/main.js");
        assert_eq!(resolve(&host, "pkg/sub.mjs"), NOT_EXPORTED);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn package_json_needs_no_export() {
        let names = &["index.js", "other.json"];
        let host = dependency(r#"{"exports": {".": "./index.js"}}"#, names);
        let found = resolve(&host, "pkg/package.json");
        assert_eq!(found, "/p/node_modules/pkg/package.json");
        assert_eq!(resolve(&host, "pkg/other.json"), NOT_EXPORTED);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn exact_target_is_rewritten_but_not_extended() {
        let manifest = r#"{"exports": {"./a": "./a.js", "./b": "./src/b", "./c": "./c.js"}}"#;
        let host = dependency(manifest, &["a.ts", "src/b.ts"]);
        assert_eq!(resolve(&host, "pkg/a"), "/p/node_modules/pkg/a.ts");
        assert_eq!(resolve(&host, "pkg/b"), MODULE_NOT_FOUND);
        assert_eq!(resolve(&host, "pkg/c"), MODULE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn wildcard_target_gets_extension() {
        let names = &["src/a.ts", "src/d/index.ts", "src/e.ts", "src/e/index.ts"];
        let host = dependency(r#"{"exports": {"./*": "./src/*"}}"#, names);
        assert_eq!(resolve(&host, "pkg/a"), "/p/node_modules/pkg/src/a.ts");
        assert_eq!(resolve(&host, "pkg/e"), "/p/node_modules/pkg/src/e.ts");
        assert_eq!(resolve(&host, "pkg/d"), DIRECTORY_IMPORT);
        assert_eq!(resolve(&host, "pkg/missing"), MODULE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn exact_directory_target_is_not_probed() {
        let manifest = r#"{"exports": {"./exact": "./lib/d.js", "./any/*": "./lib/*"}}"#;
        let host = dependency(manifest, &["lib/d.js/nested.txt", "lib/d.ts"]);
        assert_eq!(resolve(&host, "pkg/exact"), DIRECTORY_IMPORT);
        let found = resolve(&host, "pkg/any/d.js");
        assert_eq!(found, "/p/node_modules/pkg/lib/d.ts");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn directory_key_loads_files_and_directories() {
        let names = &["src/a.ts", "src/d/index.ts"];
        let host = dependency(r#"{"exports": {"./lib/": "./src/"}}"#, names);
        assert_eq!(resolve(&host, "pkg/lib/a"), "/p/node_modules/pkg/src/a.ts");
        let index = resolve(&host, "pkg/lib/d");
        assert_eq!(index, "/p/node_modules/pkg/src/d/index.ts");
        assert_eq!(resolve(&host, "pkg/lib/missing"), MODULE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn target_path_starts_at_package_root() {
        let host = empty_files(&["/p/a.js"]);
        let session = Session::new();
        let (type_options, options) = (Options::default(), CodeOptions::bun_run(b"/p"));
        let resolver = Resolver::for_compile(&session, &host, &type_options, &options);
        let search = CodeSearch {
            kind: Import,
            extensions: &options.extension_orders.import,
            uses_typed_condition: false,
        };
        let load = |status: ExportsStatus, path: &[u8]| {
            let path = path.to_vec();
            resolver.load_target(&TargetResolution { status, path }, b"/p", search)
        };
        let rooted = load(ExportsStatus::Exact, b"/a.js");
        assert_eq!(rooted, Ok(b"/p/a.js".to_vec()));
        let unrooted = load(ExportsStatus::Exact, b"a.js");
        assert_eq!(unrooted, Err(CodeFailure::ModuleNotFound));
        let disabled = load(ExportsStatus::PackagePathDisabled, b"");
        assert_eq!(disabled, Err(CodeFailure::PackagePathNotExported));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn self_reference_needs_name_and_exports() {
        let names = &[
            "src/x.ts",
            "lib/sub.js",
            "node_modules/pkg/sub.js",
            "node_modules/pkg/other.js",
        ];
        let same_name = r#"{"name": "pkg", "exports": {"./sub": "./lib/sub.js"}}"#;
        let exporting = project(same_name, names);
        assert_eq!(resolve_from_src(&exporting, "pkg/sub"), "/p/lib/sub.js");
        assert_eq!(resolve_from_src(&exporting, "pkg/other"), NOT_EXPORTED);

        let without_exports = project(r#"{"name": "pkg"}"#, names);
        let found = resolve_from_src(&without_exports, "pkg/sub");
        assert_eq!(found, "/p/node_modules/pkg/sub.js");

        let other_name = r#"{"name": "app", "exports": {"./sub": "./lib/sub.js"}}"#;
        let found = resolve_from_src(&project(other_name, names), "pkg/sub");
        assert_eq!(found, "/p/node_modules/pkg/sub.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn only_exports_switch_extension_order() {
        let names = &["src/a.ts", "src/a.js"];
        let manifest = r#"{"name": "pkg", "exports": {"./lib/": "./src/"}}"#;
        let exporting = project(manifest, names);
        assert_eq!(resolve(&exporting, "pkg/lib/a"), "/p/src/a.js");

        let importing = project(r##"{"imports": {"#lib/": "./src/"}}"##, names);
        assert_eq!(resolve(&importing, "#lib/a"), "/p/src/a.ts");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn imports_resolve_files_packages_and_host_modules() {
        let manifest =
            r##"{"imports": {"#file": "./src/a.js", "#package": "other", "#fs": "node:fs"}}"##;
        let names = &["src/a.js", "node_modules/other/index.js"];
        let host = project(manifest, names).module("node:fs", 7);
        assert_eq!(resolve(&host, "#file"), "/p/src/a.js");
        assert_eq!(resolve(&host, "#package"), "/p/node_modules/other/index.js");
        assert_eq!(resolve(&host, "#fs"), "HostModule(HostModuleId(7))");

        let source = HostResolution::ModuleSource {
            module: HostModuleId(7),
            path: b"/bun/fs.ts".to_vec(),
        };
        let with_source = project(manifest, names).runtime_module("node:fs", source);
        assert_eq!(resolve(&with_source, "#fs"), "/bun/fs.ts");

        let without_host_module = project(manifest, names);
        assert_eq!(resolve(&without_host_module, "#fs"), PACKAGE_NOT_FOUND);
    }

    #[test]
    fn only_runtime_modules_claim_imports_target() {
        let module = HostModuleId(7);
        let path = b"/bun/fs.ts".to_vec();
        let source = HostResolution::ModuleSource {
            module,
            path: path.clone(),
        };
        assert!(is_runtime_module(&HostResolution::Module(module)));
        assert!(is_runtime_module(&source));
        assert!(is_runtime_module(&external("node:fs")));

        let other_claims = [
            HostResolution::Unclaimed,
            HostResolution::Path(path),
            HostResolution::Erased,
        ];
        for claim in other_claims {
            assert!(!is_runtime_module(&claim), "{claim:?}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn plugins_and_externals_skip_imports_target() {
        let manifest = r##"{"imports": {"#db": "other"}}"##;
        let names = &["node_modules/other/index.js"];
        let claims = [
            HostResolution::Module(HostModuleId(7)),
            HostResolution::Path(b"/p/mock.ts".to_vec()),
            external("other"),
            HostResolution::Erased,
        ];
        for claim in claims {
            let host = project(manifest, names).claim("other", claim.clone());
            let found = resolve(&host, "#db");
            assert_eq!(found, "/p/node_modules/other/index.js", "{claim:?}");
        }
        let host = project(manifest, names).claim("other", external("other"));
        assert_eq!(resolve(&host, "other"), "External(other)");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn external_imports_target_names_target() {
        let manifest = r##"{"imports": {"#fs": "node:fs", "#any/*": "node:*"}}"##;
        let host = project(manifest, &["node_modules/node:fs/index.js"])
            .runtime_module("node:fs", external("node:fs"))
            .runtime_module("node:path", external("node:path"));
        assert_eq!(resolve(&host, "#fs"), "External(node:fs)");
        assert_eq!(resolve(&host, "#any/path"), "External(node:path)");
        assert_eq!(resolve(&host, "#any/missing"), MODULE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn other_runtime_module_answers_are_ignored() {
        let manifest = r##"{"imports": {"#db": "other"}}"##;
        let names = &["node_modules/other/index.js"];
        let answers = [
            HostResolution::Path(b"/p/mock.ts".to_vec()),
            HostResolution::Erased,
        ];
        for answer in answers {
            let host = project(manifest, names).runtime_module("other", answer.clone());
            let found = resolve(&host, "#db");
            assert_eq!(found, "/p/node_modules/other/index.js", "{answer:?}");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn malformed_and_undefined_imports_fail() {
        let host = project(r##"{"imports": {"#a": "./a.js"}}"##, &["a.js"]);
        assert_eq!(resolve(&host, "#a"), "/p/a.js");
        assert_eq!(resolve(&host, "#"), INVALID_SPECIFIER);
        assert_eq!(resolve(&host, "#/x"), INVALID_SPECIFIER);
        assert_eq!(resolve(&host, "#missing"), NOT_DEFINED);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn imports_target_skips_imports() {
        let manifest = r##"{"imports": {"#a": "#b", "#b": "./b.js"}}"##;
        let host = project(manifest, &["b.js"]);
        assert_eq!(resolve(&host, "#b"), "/p/b.js");
        assert_eq!(resolve(&host, "#a"), PACKAGE_NOT_FOUND);

        let with_package = project(manifest, &["b.js", "node_modules/#b/index.js"]);
        assert_eq!(resolve(&with_package, "#a"), "/p/node_modules/#b/index.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn only_nearest_manifest_provides_imports() {
        let host = MemoryHost::new(&[
            ("/p/package.json", r##"{"imports": {"#a": "./a.js"}}"##),
            ("/p/a.js", ""),
            ("/p/src/x.ts", ""),
            ("/p/nested/package.json", "{}"),
        ]);
        assert_eq!(resolve_from_src(&host, "#a"), "/p/a.js");
        let found = resolve_from(&host, "/p/nested/x.ts", "#a");
        assert_eq!(found, PACKAGE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn hash_specifier_without_imports_is_package_name() {
        let host = project(r#"{"name": "app"}"#, &["node_modules/#a/index.js"]);
        assert_eq!(resolve(&host, "#a"), "/p/node_modules/#a/index.js");
        assert_eq!(resolve(&host, "#b"), PACKAGE_NOT_FOUND);

        let without_manifest = empty_files(&["/p/main.ts"]);
        assert_eq!(resolve(&without_manifest, "#a"), PACKAGE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn node_paths_come_after_walk() {
        let host = MemoryHost::new(&[
            ("/p/node_modules/a/index.js", ""),
            ("/global/a/index.js", ""),
            ("/global/b/index.js", ""),
            ("/global/c/package.json", r#"{"exports": "./exported.js"}"#),
            ("/global/c/exported.js", ""),
            ("/global/c/index.js", ""),
        ]);
        let options = CodeOptions {
            node_paths: vec![b"/global".to_vec()],
            ..CodeOptions::bun_run(b"/p")
        };
        let resolve_globally =
            |specifier: &str| resolve_in(&host, &options, "/p/main.ts", specifier, Import);
        assert_eq!(resolve_globally("a"), "/p/node_modules/a/index.js");
        assert_eq!(resolve_globally("b"), "/global/b/index.js");
        assert_eq!(resolve_globally("c"), "/global/c/index.js");
        assert_eq!(resolve(&host, "b"), PACKAGE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn version_is_dropped_for_exports_only() {
        let manifest = r#"{"exports": {".": "./main.js", "./x": "./x.js"}}"#;
        let exporting = package("/p/node_modules/foo", manifest, &["main.js", "x.js"]);
        let main = resolve(&exporting, "foo@1.0.0");
        assert_eq!(main, "/p/node_modules/foo/main.js");
        let subpath = resolve(&exporting, "foo@1.0.0/x");
        assert_eq!(subpath, "/p/node_modules/foo/x.js");

        let plain = package("/p/node_modules/foo", "{}", &["index.js"]);
        assert_eq!(resolve(&plain, "foo"), "/p/node_modules/foo/index.js");
        assert_eq!(resolve(&plain, "foo@1.0.0"), PACKAGE_NOT_FOUND);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn conditions_follow_import_kind() {
        let manifest = r#"{"exports": {"import": "./esm.mjs", "require": "./cjs.cjs"}}"#;
        let host = dependency(manifest, &["esm.mjs", "cjs.cjs"]);
        let options = CodeOptions::bun_run(b"/p");
        let resolve_as = |kind| resolve_in(&host, &options, "/p/main.ts", "pkg", kind);
        assert_eq!(resolve_as(Import), "/p/node_modules/pkg/esm.mjs");
        assert_eq!(resolve_as(Require), "/p/node_modules/pkg/cjs.cjs");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn custom_condition_matches_when_listed() {
        let manifest = r#"{"exports": {"custom": "./custom.js", "default": "./default.js"}}"#;
        let host = dependency(manifest, &["custom.js", "default.js"]);
        assert_eq!(resolve(&host, "pkg"), "/p/node_modules/pkg/default.js");

        let mut options = CodeOptions::bun_run(b"/p");
        options.conditions.push(b"custom".to_vec());
        let found = resolve_in(&host, &options, "/p/main.ts", "pkg", Import);
        assert_eq!(found, "/p/node_modules/pkg/custom.js");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn first_matching_key_wins() {
        let names = &["default.js", "esm.js"];
        let default_first = r#"{"exports": {"default": "./default.js", "import": "./esm.js"}}"#;
        let found = resolve(&dependency(default_first, names), "pkg");
        assert_eq!(found, "/p/node_modules/pkg/default.js");

        let import_first = r#"{"exports": {"import": "./esm.js", "default": "./default.js"}}"#;
        let found = resolve(&dependency(import_first, names), "pkg");
        assert_eq!(found, "/p/node_modules/pkg/esm.js");

        let unmatched = r#"{"exports": {"browser": "./esm.js"}}"#;
        assert_eq!(resolve(&dependency(unmatched, names), "pkg"), NOT_EXPORTED);
    }
}
