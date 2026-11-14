use super::super::CodeImportKind::{Import, Require};
use super::super::memory_host::{MemoryHost, resolve_in};
use super::super::*;

const MANIFEST: &str = r##"{
    "name": "shapes",
    "version": "1.0.0",
    "exports": {
        ".": { "types": "./index.d.ts", "aot": "./index.aot.ts", "default": "./index.js" },
        "./nested": {
            "import": { "aot": "./nested.aot.mts", "default": "./nested.mjs" },
            "require": "./nested.cjs"
        },
        "./deep/*": { "aot": "./deep/*.aot.ts", "default": "./deep/*.js" },
        "./plain": "./plain.js"
    }
}"##;

fn host() -> MemoryHost {
    let paths = [
        "index.d.ts",
        "index.aot.ts",
        "index.js",
        "nested.aot.mts",
        "nested.mjs",
        "nested.cjs",
        "deep/a.aot.ts",
        "deep/a.js",
        "plain.js",
    ];
    let paths = paths.map(|path| format!("/p/node_modules/shapes/{path}"));
    let mut files = vec![("/p/node_modules/shapes/package.json", MANIFEST)];
    files.extend(paths.iter().map(|path| (path.as_str(), "")));
    MemoryHost::new(&files)
}

fn resolve(options: &CodeOptions, importer: &str, specifier: &str, kind: CodeImportKind) -> String {
    let found = resolve_in(&host(), options, importer, specifier, kind);
    found.replace("/p/node_modules/shapes/", "")
}

#[test]
#[cfg_attr(miri, ignore)]
fn aot_condition_names_the_module() {
    let options = CodeOptions::bun_run(b"/p");
    let from_main = |specifier, kind| resolve(&options, "/p/main.ts", specifier, kind);
    assert_eq!(from_main("shapes", Import), "index.aot.ts");
    assert_eq!(from_main("shapes", Require), "index.aot.ts");
    assert_eq!(from_main("shapes/nested", Import), "nested.aot.mts");
    assert_eq!(from_main("shapes/nested", Require), "nested.cjs");
    assert_eq!(from_main("shapes/deep/a", Import), "deep/a.aot.ts");
    assert_eq!(from_main("shapes/plain", Import), "plain.js");
}

#[test]
#[cfg_attr(miri, ignore)]
fn aot_condition_is_ignored_when_removed() {
    let mut options = CodeOptions::bun_run(b"/p");
    options.remove_condition(AOT_CONDITION);
    let from_main = |specifier: &str, kind| {
        let search = FileSearch {
            directory: b"/p",
            specifier: specifier.as_bytes(),
            kind,
            prefers_module_field: false,
        };
        match options.find_file_plainly(&host(), &search) {
            FoundCode::File { path, .. } => {
                super::text(&path).replace("/p/node_modules/shapes/", "")
            }
            other => panic!("{specifier} answers {other:?}"),
        }
    };
    assert_eq!(from_main("shapes", Import), "index.js");
    assert_eq!(from_main("shapes", Require), "index.js");
    assert_eq!(from_main("shapes/nested", Import), "nested.mjs");
    assert_eq!(from_main("shapes/deep/a", Import), "deep/a.js");
}

#[test]
#[cfg_attr(miri, ignore)]
fn package_is_an_aot_package_when_its_exports_name_the_condition() {
    let plain = r#"{ "name": "plain", "version": "1.0.0", "exports": "./index.js" }"#;
    let files = [
        ("/p/node_modules/shapes/package.json", MANIFEST),
        (
            "/p/node_modules/shapes/lib/package.json",
            r#"{ "type": "module" }"#,
        ),
        ("/p/node_modules/plain/package.json", plain),
    ];
    let host = MemoryHost::new(&files);
    let session = Session::new();
    let (type_options, options) = (Options::default(), CodeOptions::bun_run(b"/p"));
    let resolver = Resolver::for_compile(&session, &host, &type_options, &options);
    assert!(resolver.is_in_aot_package(b"/p/node_modules/shapes/index.aot.ts"));
    assert!(resolver.is_in_aot_package(b"/p/node_modules/shapes/lib/a.ts"));
    assert!(!resolver.is_in_aot_package(b"/p/node_modules/plain/index.ts"));
    assert!(!resolver.is_in_aot_package(b"/p/main.ts"));
}

#[test]
#[cfg_attr(miri, ignore)]
fn package_is_an_aot_package_when_its_imports_name_the_condition() {
    let manifest = r##"{ "name": "inner", "imports": { "#core": { "aot": "./core.aot.ts", "default": "./core.js" } } }"##;
    let host = MemoryHost::new(&[("/p/node_modules/inner/package.json", manifest)]);
    let session = Session::new();
    let (type_options, options) = (Options::default(), CodeOptions::bun_run(b"/p"));
    let resolver = Resolver::for_compile(&session, &host, &type_options, &options);
    assert!(resolver.is_in_aot_package(b"/p/node_modules/inner/core.aot.ts"));
}
