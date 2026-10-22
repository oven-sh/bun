use super::manifest::build_exports_entry;
use super::memory_host::{MemoryHost, parse_json};
use super::*;

const PACKAGE: &str = "/p/node_modules/pkg";
const MANIFEST: &str = "/p/node_modules/pkg/package.json";

fn with_exports<T>(json: &str, run: impl FnOnce(&ExportsEntry<'_>) -> T) -> T {
    let arena = Arena::new();
    let json = parse_json(json.as_bytes()).expect("the test text is valid JSON");
    run(&build_exports_entry(&arena, &json))
}

fn with_resolver<T>(host: &MemoryHost, run: impl FnOnce(&Resolver<'_>) -> T) -> T {
    let session = Session::new();
    let options = Options::default();
    let code = CodeOptions::bun_run(b"/p");
    run(&Resolver::for_compile(&session, host, &options, &code))
}

fn with_manifest<T>(manifest: &str, run: impl FnOnce(&CodeManifest<'_>) -> T) -> T {
    let host = MemoryHost::new(&[(MANIFEST, manifest)]);
    with_resolver(&host, |resolver| {
        let manifest = resolver.code_manifest(PACKAGE.as_bytes());
        run(manifest.expect("the package has a manifest"))
    })
}

fn subpaths_of(exports: &str, file: &str) -> String {
    with_manifest(&format!(r#"{{"exports": {exports}}}"#), |manifest| {
        let exports = manifest.exports.as_ref().expect("the manifest has exports");
        let path = format!("{PACKAGE}/{file}");
        let subpaths = candidate_subpaths(manifest, exports, path.as_bytes());
        let subpaths: Vec<String> = (subpaths.iter())
            .map(|subpath| subpath.as_bstr().to_string())
            .collect();
        subpaths.join(" ")
    })
}

#[test]
fn condition_is_found_at_any_depth() {
    let has = |json| with_exports(json, |exports| has_condition(exports, b"bun-aot"));
    assert!(has(r#"{"bun-aot": "./a.ts"}"#));
    assert!(has(r#"{"./a": [{"node": {"bun-aot": null}}]}"#));
    assert!(!has(r#""bun-aot""#));
    assert!(!has(r#"{"./bun-aot": ["bun-aot"], "./a": {"default": "./bun-aot"}}"#));
    assert!(!has(r#"{"bun-aot": "./a.ts", "./a": "./a.js"}"#));
}

#[test]
fn condition_is_compared_with_whole_key() {
    let has = |condition: &[u8]| {
        with_exports(r#"{"bun-aot": "./a.ts"}"#, |exports| has_condition(exports, condition))
    };
    assert!(has(b"bun-aot"));
    assert!(!has(b"bun"));
    assert!(!has(b"bun-aot-2"));
}

#[test]
fn exported_subpaths_start_at_package_root() {
    let conditions = r#"{"import": "./a.js"}"#;
    for exports in [r#""./a.js""#, r#"["./a.js"]"#, conditions, "false"] {
        assert_eq!(subpaths_of(exports, "a.js"), ".", "{exports}");
    }
    let table = r#"{"./b": "./b.js", ".": "./a.js", "./c/*": "./c/*.js"}"#;
    assert_eq!(subpaths_of(table, "a.js"), ". ./b");
    assert_eq!(subpaths_of(table, "c/x.js"), ". ./b ./c/x");
}

#[test]
fn expansion_key_names_subpath_of_matching_file() {
    let pattern = r#"{"./f/*.js": {"bun-aot": "./typed/*.ts", "default": "./dist/*.js"}}"#;
    assert_eq!(subpaths_of(pattern, "dist/a/b.js"), ". ./f/a/b.js");
    assert_eq!(subpaths_of(pattern, "typed/a/b.ts"), ". ./f/a/b.js");
    assert_eq!(subpaths_of(pattern, "src/a/b.js"), ".");

    let directory = r#"{"./lib/": "./dist/"}"#;
    assert_eq!(subpaths_of(directory, "dist/x.js"), ". ./lib/x.js");
    assert_eq!(subpaths_of(directory, "src/x.js"), ".");
}

#[test]
fn subpath_is_listed_once() {
    let exports = r#"{"./*": ["./dist/*.js", "./dist/*.js"], "./a": "./dist/a.js"}"#;
    assert_eq!(subpaths_of(exports, "dist/a.js"), ". ./a");
}

#[test]
fn key_and_target_have_same_form() {
    let find = |key: &[u8], target: &[u8]| find_matching_subpath(key, target, b"./dist/x.js");
    let subpath = Some(b"./lib/x.js".to_vec());
    assert_eq!(find(b"./lib/*", b"./dist/*"), subpath);
    assert_eq!(find(b"./lib/", b"./dist/"), subpath);
    assert_eq!(find(b"./lib/*", b"./dist/"), None);
    assert_eq!(find(b"./lib/*", b"./dist/x.js"), None);
    assert_eq!(find(b"./lib/", b"./dist/*"), None);
    assert_eq!(find(b"./lib/", b"./dist"), None);
}

#[test]
fn star_of_key_is_replaced_by_matched_text() {
    let find = |relative: &[u8]| find_matching_subpath(b"./f/*.js", b"./src/*.ts", relative);
    assert_eq!(find(b"./src/a/b.ts"), Some(b"./f/a/b.js".to_vec()));
    assert_eq!(find(b"./src/a/b.js"), None);
    assert_eq!(find(b"./lib/a/b.ts"), None);
}

#[test]
fn relative_path_starts_at_manifest_directory() {
    with_manifest("{}", |manifest| {
        let relative = |path: &[u8]| package_relative_path(manifest, path);
        let index = relative(b"/p/node_modules/pkg/index.js");
        assert_eq!(index, Some(b"./index.js".to_vec()));
        let nested = relative(b"/p/node_modules/pkg/dist/a.js");
        assert_eq!(nested, Some(b"./dist/a.js".to_vec()));
        assert_eq!(relative(b"/p/node_modules/other/index.js"), None);
        assert_eq!(relative(b"/p/index.js"), None);
    });
}

#[test]
fn package_exports_are_searched_up_to_node_modules() {
    let host = MemoryHost::new(&[
        ("/p/package.json", r#"{"exports": "./main.js"}"#),
        (MANIFEST, r#"{"exports": "./index.js"}"#),
        ("/p/node_modules/pkg/dist/package.json", r#"{"type": "module"}"#),
        ("/p/node_modules/bare/index.js", ""),
    ]);
    with_resolver(&host, |resolver| {
        let directory_of = |path: &[u8]| {
            let (manifest, _) = resolver.find_package_exports(path)?;
            Some(manifest.directory.as_bstr().to_string())
        };
        assert_eq!(directory_of(b"/p/node_modules/pkg/dist/a.js").as_deref(), Some(PACKAGE));
        assert_eq!(directory_of(b"/p/src/main.js").as_deref(), Some("/p"));
        assert_eq!(directory_of(b"/p/node_modules/bare/index.js"), None);
        assert_eq!(directory_of(b"virtual:main.js"), None);
    });
}

#[test]
fn typed_export_is_other_file_of_same_subpath() {
    let manifest = r#"{
        "exports": {
            ".": {"bun-aot": "./typed.ts", "default": "./index.js"},
            "./same": {"bun-aot": "./same.js", "default": "./same.js"},
            "./untyped": "./untyped.js"
        }
    }"#;
    let host = MemoryHost::new(&[
        (MANIFEST, manifest),
        ("/p/node_modules/pkg/index.js", ""),
        ("/p/node_modules/pkg/typed.ts", ""),
        ("/p/node_modules/pkg/same.js", ""),
        ("/p/node_modules/pkg/untyped.js", ""),
    ]);
    with_resolver(&host, |resolver| {
        let find = |path: &[u8]| resolver.find_typed_export(path, b"bun-aot");
        let index: &[u8] = b"/p/node_modules/pkg/index.js";
        assert_eq!(find(index), Some(b"/p/node_modules/pkg/typed.ts".to_vec()));
        assert_eq!(find(b"/p/node_modules/pkg/same.js"), None);
        assert_eq!(find(b"/p/node_modules/pkg/untyped.js"), None);
        assert_eq!(find(b"/p/node_modules/pkg/typed.ts"), None);
        assert_eq!(resolver.find_typed_export(index, b"types"), None);
    });
}
