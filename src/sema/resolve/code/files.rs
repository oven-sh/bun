use super::search::preserve_trailing_slash;
use super::*;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum TargetKind {
    Exact,
    Wildcard,
}

impl<'h> Resolver<'h> {
    pub(super) fn load_as_file_or_directory(
        &self,
        path: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        if let Some(file) = self.load_as_file(path, search.extensions) {
            return Some(file);
        }
        let directory = strings::without_trailing_slash(path);
        if !self.is_dir(directory) {
            return None;
        }
        self.code_manifest(directory)
            .filter(|manifest| manifest.has_main_fields())
            .and_then(|manifest| self.load_from_main_fields(directory, manifest, search))
            .or_else(|| self.load_as_index(directory, search.extensions))
    }

    pub(super) fn load_as_file(&self, path: &[u8], extensions: &[Vec<u8>]) -> Option<Vec<u8>> {
        let trimmed = strings::without_trailing_slash(path);
        if trimmed.is_empty() || trimmed.ends_with(b"/") {
            return None;
        }
        if !self.is_dir(dirname::<Posix>(trimmed)) {
            return None;
        }
        if self.is_file(trimmed) {
            return Some(trimmed.to_vec());
        }
        let has_trailing_separator = trimmed.len() != path.len();
        let with_extension = match has_trailing_separator {
            true => None,
            false => self.find_file_with_extension(trimmed, extensions),
        };
        with_extension
            .or_else(|| self.find_rewritten_file(trimmed))
            .or_else(|| self.find_file_in_another_case(trimmed))
    }

    // `bun run` looks a name up in the listing of its directory without regard to case, and opens the file under the name that is
    // listed. It does so for the name as written: one that it has put an extension to, it opens as it has made it. Asked last:
    // a name that is found in any other way costs no listing.
    fn find_file_in_another_case(&self, path: &[u8]) -> Option<Vec<u8>> {
        let directory = dirname::<Posix>(path);
        let name = &path[strings::last_index_of_char(path, b'/')? + 1..];
        let (files, _) = self.host.entries(directory);
        let listed = files.iter().find(|file| file.eq_ignore_ascii_case(name))?;
        Some(inside(directory, listed))
    }

    pub(super) fn load_as_index(
        &self,
        directory: &[u8],
        extensions: &[Vec<u8>],
    ) -> Option<Vec<u8>> {
        self.find_file_with_extension(&inside(directory, b"index"), extensions)
    }

    pub(super) fn probe_target_extensions(
        &self,
        directory: &[u8],
        base: &[u8],
        extensions: &[Vec<u8>],
        target: TargetKind,
    ) -> Option<Vec<u8>> {
        let path = inside(directory, base);
        let with_extension = match target {
            TargetKind::Wildcard if bun_paths::extension(base).is_empty() => {
                self.find_file_with_extension(&path, extensions)
            }
            TargetKind::Wildcard | TargetKind::Exact => None,
        };
        with_extension.or_else(|| self.find_rewritten_file(&path))
    }

    fn load_from_main_fields(
        &self,
        directory: &[u8],
        manifest: &CodeManifest<'_>,
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        let options = self.code_options();
        let main_order: &[Vec<u8>] = &options.extension_orders.main_field;
        let prefers_main = options.has_default_main_fields
            && !(options.prefers_module_field && search.kind != CodeImportKind::Require);
        for field in &options.main_fields {
            let Some(value) = manifest.main_field(field) else {
                continue;
            };
            let order = match field.as_slice() {
                b"main" => main_order,
                _ => search.extensions,
            };
            let Some(found) = self.load_from_main_field(directory, value, order) else {
                continue;
            };
            if !(prefers_main && matches!(field.as_slice(), b"module" | b"jsnext:main")) {
                return Some(found);
            }
            let main = match manifest.main_field(b"main") {
                Some(main_value) => self.load_from_main_field(directory, main_value, main_order),
                None => self.load_as_index(directory, main_order),
            };
            return main.or(Some(found));
        }
        None
    }

    fn load_from_main_field(
        &self,
        directory: &[u8],
        value: &[u8],
        extensions: &[Vec<u8>],
    ) -> Option<Vec<u8>> {
        let target = preserve_trailing_slash(join(directory, value), value);
        if let Some(file) = self.load_as_file(&target, extensions) {
            return Some(file);
        }
        if !self.is_dir(&target) {
            return None;
        }
        self.load_as_index(&target, extensions)
    }

    fn find_rewritten_file(&self, path: &[u8]) -> Option<Vec<u8>> {
        let base_start = strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
        let dot = base_start + strings::last_index_of_char(&path[base_start..], b'.')?;
        let (stem, extension) = path.split_at(dot);
        let rewritten = rewritten_extensions(extension, is_in_node_modules(path));
        self.find_file_with_extension(stem, rewritten)
    }

    fn find_file_with_extension<E: AsRef<[u8]>>(
        &self,
        stem: &[u8],
        extensions: &[E],
    ) -> Option<Vec<u8>> {
        let longest = extensions.iter().map(|it| it.as_ref().len()).max()?;
        let mut candidate = Vec::with_capacity(stem.len() + longest);
        candidate.extend_from_slice(stem);
        for extension in extensions {
            candidate.extend_from_slice(extension.as_ref());
            if self.is_file(&candidate) {
                return Some(candidate);
            }
            candidate.truncate(stem.len());
        }
        None
    }
}

pub(super) fn rewritten_extensions(
    extension: &[u8],
    is_in_node_modules: bool,
) -> &'static [&'static [u8]] {
    match extension {
        b".js" | b".jsx" => &[b".ts", b".tsx", b".mts"],
        b".mjs" | b".cjs" if is_in_node_modules => &[],
        b".mjs" => &[b".mts"],
        b".cjs" => &[b".cts"],
        _ => &[],
    }
}

pub(super) fn is_in_node_modules(path: &[u8]) -> bool {
    strings::contains(path, b"/node_modules/")
}

#[cfg(test)]
mod tests {
    use super::CodeImportKind::{Import, Require};
    use super::TargetKind::{Exact, Wildcard};
    use super::memory_host::{MemoryHost, resolve_in};
    use super::*;

    const NOT_FOUND: &str = "NotFound(ModuleNotFound)";
    const MODULE_AND_MAIN: &str = r#"{"module": "./esm.js", "main": "./cjs.js"}"#;

    fn empty_files(paths: &[&str]) -> MemoryHost {
        let files: Vec<(&str, &str)> = paths.iter().map(|&path| (path, "")).collect();
        MemoryHost::new(&files)
    }

    fn package(manifest: &str, paths: &[&str]) -> MemoryHost {
        let mut files = vec![("/p/x/package.json", manifest)];
        files.extend(paths.iter().map(|&path| (path, "")));
        MemoryHost::new(&files)
    }

    fn resolve(host: &MemoryHost, specifier: &str, kind: CodeImportKind) -> String {
        let options = CodeOptions::bun_run(b"/p");
        resolve_in(host, &options, "/p/main.ts", specifier, kind)
    }

    fn resolve_in_dependency(host: &MemoryHost, specifier: &str, kind: CodeImportKind) -> String {
        let options = CodeOptions::bun_run(b"/p");
        resolve_in(host, &options, "/p/node_modules/x/m.js", specifier, kind)
    }

    fn resolve_package(host: &MemoryHost, kind: CodeImportKind) -> String {
        resolve_package_with(host, &CodeOptions::bun_run(b"/p"), kind)
    }

    fn resolve_package_with(
        host: &MemoryHost,
        options: &CodeOptions,
        kind: CodeImportKind,
    ) -> String {
        resolve_in(host, options, "/p/main.ts", "./x", kind)
    }

    fn with_resolver<T>(host: &MemoryHost, run: impl FnOnce(&Resolver<'_>) -> T) -> T {
        let session = Session::new();
        let options = Options::default();
        let code = CodeOptions::bun_run(b"/p");
        let resolver = Resolver::for_compile(&session, host, &options, &code);
        run(&resolver)
    }

    fn text(path: Option<Vec<u8>>) -> String {
        match path {
            Some(path) => String::from_utf8(path).unwrap(),
            None => "None".to_owned(),
        }
    }

    fn load_file(host: &MemoryHost, path: &str) -> String {
        with_resolver(host, |resolver| {
            let extensions = &resolver.code_options().extension_orders.import;
            text(resolver.load_as_file(path.as_bytes(), extensions))
        })
    }

    fn probe(host: &MemoryHost, path: &str, target: TargetKind) -> String {
        let (directory, base) = path.rsplit_once('/').unwrap();
        let (directory, base) = (directory.as_bytes(), base.as_bytes());
        with_resolver(host, |resolver| {
            let extensions = &resolver.code_options().extension_orders.import;
            text(resolver.probe_target_extensions(directory, base, extensions, target))
        })
    }

    #[test]
    fn name_as_written_is_found_in_another_case() {
        let sources = empty_files(&["/p/foo.ts", "/p/common.cjs", "/p/Lib/inner.mjs"]);
        assert_eq!(resolve(&sources, "./Foo.ts", Import), "/p/foo.ts");
        assert_eq!(resolve(&sources, "./foo.ts", Import), "/p/foo.ts");
        assert_eq!(resolve(&sources, "./Common.cjs", Require), "/p/common.cjs");
        assert_eq!(resolve(&sources, "./Lib/INNER.mjs", Import), "/p/Lib/inner.mjs");
        let not_found = resolve(&sources, "./absent.ts", Import);
        for specifier in ["./FOO", "./Foo", "./lib/inner.mjs", "./lib/Inner.mjs"] {
            assert_eq!(resolve(&sources, specifier, Import), not_found, "{specifier}");
        }

        let both = empty_files(&["/p/foo.ts", "/p/Foo.ts"]);
        assert_eq!(resolve(&both, "./Foo.ts", Import), "/p/Foo.ts");
        assert_eq!(resolve(&both, "./foo.ts", Import), "/p/foo.ts");
    }

    #[test]
    fn extension_order_follows_import_kind() {
        let sources = empty_files(&["/p/a.ts", "/p/a.js"]);
        assert_eq!(resolve(&sources, "./a", Import), "/p/a.ts");
        assert_eq!(resolve(&sources, "./a", Require), "/p/a.ts");

        let formats = empty_files(&["/p/a.mjs", "/p/a.cjs"]);
        assert_eq!(resolve(&formats, "./a", Import), "/p/a.mjs");
        assert_eq!(resolve(&formats, "./a", Require), "/p/a.cjs");
    }

    #[test]
    fn node_modules_prefers_javascript() {
        let sources = empty_files(&["/p/node_modules/x/a.ts", "/p/node_modules/x/a.js"]);
        let source = |kind| resolve_in_dependency(&sources, "./a", kind);
        assert_eq!(source(Import), "/p/node_modules/x/a.js");
        assert_eq!(source(Require), "/p/node_modules/x/a.js");

        let formats = empty_files(&["/p/node_modules/x/a.mjs", "/p/node_modules/x/a.cjs"]);
        let format = |kind| resolve_in_dependency(&formats, "./a", kind);
        assert_eq!(format(Import), "/p/node_modules/x/a.mjs");
        assert_eq!(format(Require), "/p/node_modules/x/a.cjs");
    }

    #[test]
    fn unlisted_extension_is_not_added() {
        let host = empty_files(&["/p/a.css"]);
        assert_eq!(resolve(&host, "./a", Import), NOT_FOUND);
        assert_eq!(resolve(&host, "./a.css", Import), "/p/a.css");
    }

    #[test]
    fn exact_name_wins_over_rewrite() {
        let both = empty_files(&["/p/a.js", "/p/a.ts"]);
        assert_eq!(resolve(&both, "./a.js", Import), "/p/a.js");

        let typescript_only = empty_files(&["/p/a.ts"]);
        assert_eq!(resolve(&typescript_only, "./a.js", Import), "/p/a.ts");
    }

    #[test]
    fn node_modules_rewrites_js_but_not_mjs() {
        let project = empty_files(&["/p/a.mts"]);
        assert_eq!(resolve(&project, "./a.mjs", Import), "/p/a.mts");

        let dependency = empty_files(&["/p/node_modules/x/a.mts", "/p/node_modules/x/b.ts"]);
        let import = |specifier| resolve_in_dependency(&dependency, specifier, Import);
        assert_eq!(import("./a.mjs"), NOT_FOUND);
        assert_eq!(import("./b.js"), "/p/node_modules/x/b.ts");
    }

    #[test]
    fn node_addon_extension_is_for_require_only() {
        let host = empty_files(&["/p/a.node"]);
        assert_eq!(resolve(&host, "./a", Require), "/p/a.node");
        assert_eq!(resolve(&host, "./a", Import), NOT_FOUND);
    }

    #[test]
    fn file_wins_over_directory() {
        let host = empty_files(&["/p/d.ts", "/p/d/index.ts"]);
        assert_eq!(resolve(&host, "./d", Import), "/p/d.ts");
        assert_eq!(resolve(&host, "./d/", Import), "/p/d/index.ts");
    }

    #[test]
    fn directory_specifier_adds_no_extension() {
        let host = empty_files(&["/p/d.ts"]);
        assert_eq!(resolve(&host, "./d/", Import), NOT_FOUND);
        assert_eq!(resolve(&host, "./d", Import), "/p/d.ts");
    }

    #[test]
    fn index_needs_listed_extension() {
        let host = empty_files(&["/p/d/index", "/p/d/index.css", "/p/e/index.json"]);
        assert_eq!(resolve(&host, "./d", Import), NOT_FOUND);
        assert_eq!(resolve(&host, "./e", Import), "/p/e/index.json");
    }

    #[test]
    fn trailing_separator_keeps_exact_name_and_rewrite() {
        let host = empty_files(&["/p/a", "/p/b.ts", "/p/c.ts"]);
        assert_eq!(load_file(&host, "/p/a/"), "/p/a");
        assert_eq!(load_file(&host, "/p/b/"), "None");
        assert_eq!(load_file(&host, "/p/b"), "/p/b.ts");
        assert_eq!(load_file(&host, "/p/c.js/"), "/p/c.ts");
    }

    #[test]
    fn root_and_missing_directory_have_no_file() {
        let host = empty_files(&["/p/a.ts", "/.ts"]);
        assert_eq!(load_file(&host, "/"), "None");
        assert_eq!(load_file(&host, "/missing/a"), "None");
        assert_eq!(load_file(&host, "/p/a"), "/p/a.ts");
    }

    #[test]
    fn main_wins_over_module_by_default() {
        let host = package(MODULE_AND_MAIN, &["/p/x/esm.js", "/p/x/cjs.js"]);
        assert_eq!(resolve_package(&host, Import), "/p/x/cjs.js");
        assert_eq!(resolve_package(&host, Require), "/p/x/cjs.js");
    }

    #[test]
    fn preferred_module_field_wins_for_import_only() {
        let host = package(MODULE_AND_MAIN, &["/p/x/esm.js", "/p/x/cjs.js"]);
        let options = CodeOptions {
            prefers_module_field: true,
            ..CodeOptions::bun_run(b"/p")
        };
        let entry = |kind| resolve_package_with(&host, &options, kind);
        assert_eq!(entry(Import), "/p/x/esm.js");
        assert_eq!(entry(Require), "/p/x/cjs.js");
    }

    #[test]
    fn custom_main_fields_use_list_order() {
        let host = package(MODULE_AND_MAIN, &["/p/x/esm.js", "/p/x/cjs.js"]);
        let module_first = CodeOptions {
            has_default_main_fields: false,
            ..CodeOptions::bun_run(b"/p")
        };
        let main_first = CodeOptions {
            main_fields: vec![b"main".to_vec(), b"module".to_vec()],
            has_default_main_fields: false,
            ..CodeOptions::bun_run(b"/p")
        };
        let entry = |options, kind| resolve_package_with(&host, options, kind);
        assert_eq!(entry(&module_first, Import), "/p/x/esm.js");
        assert_eq!(entry(&module_first, Require), "/p/x/esm.js");
        assert_eq!(entry(&main_first, Import), "/p/x/cjs.js");
    }

    #[test]
    fn module_without_main_falls_back_to_index() {
        let manifest = r#"{"module": "./esm.js"}"#;
        let with_index = package(manifest, &["/p/x/esm.js", "/p/x/index.js"]);
        assert_eq!(resolve_package(&with_index, Import), "/p/x/index.js");

        let without_index = package(manifest, &["/p/x/esm.js"]);
        assert_eq!(resolve_package(&without_index, Import), "/p/x/esm.js");
    }

    #[test]
    fn main_uses_main_field_extension_order() {
        let files = &["/p/x/lib.js", "/p/x/lib.ts"];
        let main = package(r#"{"main": "./lib"}"#, files);
        assert_eq!(resolve_package(&main, Import), "/p/x/lib.js");

        let module = package(r#"{"module": "./lib"}"#, files);
        assert_eq!(resolve_package(&module, Import), "/p/x/lib.ts");
    }

    #[test]
    fn main_directory_loads_index() {
        let host = package(r#"{"main": "./lib"}"#, &["/p/x/lib/index.js", "/p/x/index.js"]);
        assert_eq!(resolve_package(&host, Import), "/p/x/lib/index.js");
    }

    #[test]
    fn main_field_trailing_slash_adds_no_extension() {
        let files = &["/p/x/lib.js", "/p/x/lib/index.js"];
        for field in ["main", "module", "jsnext:main"] {
            let directory = package(&format!(r#"{{"{field}": "./lib/"}}"#), files);
            assert_eq!(resolve_package(&directory, Import), "/p/x/lib/index.js", "{field}");

            let file = package(&format!(r#"{{"{field}": "./lib"}}"#), files);
            assert_eq!(resolve_package(&file, Import), "/p/x/lib.js", "{field}");
        }
        for manifest in [r#"{"main": "./lib/."}"#, r#"{"main": "./lib\\"}"#] {
            let host = package(manifest, files);
            assert_eq!(resolve_package(&host, Import), "/p/x/lib.js", "{manifest}");
        }
    }

    #[test]
    fn main_field_slash_stays_in_package() {
        let host = package(r#"{"main": "./"}"#, &["/p/x.js", "/p/x/index.js"]);
        assert_eq!(resolve(&host, "./x/", Import), "/p/x/index.js");
        assert_eq!(resolve(&host, "./x", Import), "/p/x.js");
    }

    #[test]
    fn main_directory_manifest_is_not_read() {
        let host = MemoryHost::new(&[
            ("/p/x/package.json", r#"{"main": "./lib"}"#),
            ("/p/x/lib/package.json", r#"{"main": "./other.js"}"#),
            ("/p/x/lib/other.js", ""),
            ("/p/x/lib/index.js", ""),
        ]);
        assert_eq!(resolve_package(&host, Import), "/p/x/lib/index.js");
        assert_eq!(resolve(&host, "./x/lib", Import), "/p/x/lib/other.js");
    }

    #[test]
    fn absolute_main_replaces_package_directory() {
        let manifest = r#"{"main": "/p/other/entry.js"}"#;
        let host = package(manifest, &["/p/other/entry.js"]);
        assert_eq!(resolve_package(&host, Import), "/p/other/entry.js");
    }

    #[test]
    fn missing_main_field_target_continues_search() {
        let manifest = r#"{"module": "./missing.js", "main": "./cjs.js"}"#;
        let next_field = package(manifest, &["/p/x/cjs.js"]);
        assert_eq!(resolve_package(&next_field, Import), "/p/x/cjs.js");

        let manifest = r#"{"main": "./missing.js"}"#;
        let with_index = package(manifest, &["/p/x/index.ts"]);
        assert_eq!(resolve_package(&with_index, Import), "/p/x/index.ts");

        let without_index = package(manifest, &["/p/x/other.ts"]);
        assert_eq!(resolve_package(&without_index, Import), NOT_FOUND);
    }

    #[test]
    fn main_wins_over_jsnext_main() {
        let manifest = r#"{"jsnext:main": "./next.js", "main": "./cjs.js"}"#;
        let host = package(manifest, &["/p/x/next.js", "/p/x/cjs.js"]);
        assert_eq!(resolve_package(&host, Import), "/p/x/cjs.js");
        assert_eq!(resolve_package(&host, Require), "/p/x/cjs.js");

        let jsnext_first = CodeOptions {
            main_fields: vec![b"jsnext:main".to_vec(), b"main".to_vec()],
            ..CodeOptions::bun_run(b"/p")
        };
        let entry = resolve_package_with(&host, &jsnext_first, Import);
        assert_eq!(entry, "/p/x/cjs.js");

        let custom = CodeOptions {
            has_default_main_fields: false,
            ..jsnext_first
        };
        let entry = resolve_package_with(&host, &custom, Import);
        assert_eq!(entry, "/p/x/next.js");
    }

    #[test]
    fn jsnext_main_without_main_falls_back_to_index() {
        let manifest = r#"{"jsnext:main": "./next.js"}"#;
        let with_index = package(manifest, &["/p/x/next.js", "/p/x/index.js"]);
        assert_eq!(resolve_package(&with_index, Import), "/p/x/index.js");

        let without_index = package(manifest, &["/p/x/next.js"]);
        assert_eq!(resolve_package(&without_index, Import), "/p/x/next.js");
    }

    #[test]
    fn wildcard_target_gets_extension() {
        let host = empty_files(&["/p/src/a.ts", "/p/src/b.c.ts", "/p/src/.env.ts"]);
        assert_eq!(probe(&host, "/p/src/a", Wildcard), "/p/src/a.ts");
        assert_eq!(probe(&host, "/p/src/a", Exact), "None");
        assert_eq!(probe(&host, "/p/src/b.c", Wildcard), "None");
        assert_eq!(probe(&host, "/p/src/.env", Wildcard), "/p/src/.env.ts");
    }

    #[test]
    fn target_extension_is_rewritten() {
        let host = empty_files(&["/p/src/a.ts", "/p/src/b.scss", "/p/src/.ts"]);
        for target in [Exact, Wildcard] {
            assert_eq!(probe(&host, "/p/src/a.js", target), "/p/src/a.ts");
            assert_eq!(probe(&host, "/p/src/.js", target), "/p/src/.ts");
            assert_eq!(probe(&host, "/p/src/b.css", target), "None");
        }
    }

    #[test]
    fn target_in_node_modules_keeps_mjs() {
        let project = empty_files(&["/p/src/a.mts"]);
        assert_eq!(probe(&project, "/p/src/a.mjs", Exact), "/p/src/a.mts");

        let dependency = empty_files(&["/p/node_modules/a.mts", "/p/node_modules/b.ts"]);
        let probe_exact = |path| probe(&dependency, path, Exact);
        assert_eq!(probe_exact("/p/node_modules/a.mjs"), "None");
        assert_eq!(probe_exact("/p/node_modules/b.js"), "/p/node_modules/b.ts");
    }

    #[test]
    fn rewritten_extension_table() {
        let typescript: &[&[u8]] = &[b".ts", b".tsx", b".mts"];
        let mts: &[&[u8]] = &[b".mts"];
        let cts: &[&[u8]] = &[b".cts"];
        for is_dependency in [false, true] {
            assert_eq!(rewritten_extensions(b".js", is_dependency), typescript);
            assert_eq!(rewritten_extensions(b".jsx", is_dependency), typescript);
            assert!(rewritten_extensions(b".ts", is_dependency).is_empty());
            assert!(rewritten_extensions(b".JS", is_dependency).is_empty());
            assert!(rewritten_extensions(b"js", is_dependency).is_empty());
        }
        assert_eq!(rewritten_extensions(b".mjs", false), mts);
        assert_eq!(rewritten_extensions(b".cjs", false), cts);
        assert!(rewritten_extensions(b".mjs", true).is_empty());
        assert!(rewritten_extensions(b".cjs", true).is_empty());
    }

    #[test]
    fn node_modules_must_be_ancestor_directory() {
        assert!(is_in_node_modules(b"/p/node_modules/x/a.js"));
        assert!(is_in_node_modules(b"/p/node_modules/a.js"));
        assert!(is_in_node_modules(&inside(b"/p/node_modules", b"")));
        assert!(!is_in_node_modules(b"/p/node_modules"));
        assert!(!is_in_node_modules(b"/p/not_node_modules/a.js"));
    }
}
