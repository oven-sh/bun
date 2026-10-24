use super::TypedVersionOrigin::{Host as FromHost, Package as FromPackage};
use super::*;

const TYPED: &str = "/p/node_modules/pkg/typed.ts";
const DIST_MANIFEST: &str = "/p/node_modules/pkg/dist/package.json";
const DIST_FILE: &str = "/p/node_modules/pkg/dist/index.js";
const DIST_TYPED_FILE: &str = "/p/node_modules/pkg/dist/index.full.ts";
const DIST_OTHER_FILE: &str = "/p/node_modules/pkg/dist/other.js";
const MAIN_IN_DIST: &str = r#"{"name": "pkg", "version": "1.0.0", "main": "dist/index.js"}"#;
const DIST_TYPED_EXPORTS: &str =
    r#"{"exports": {".": {"full-types": "./index.full.ts", "default": "./index.js"}}}"#;
const TYPED_EXPORTS: &str = r#"{
    "name": "pkg", "version": "1.0.0",
    "exports": {
        ".": {"full-types": "./typed.ts", "default": "./index.js"},
        "./index.js": "./index.js"
    }
}"#;

type Found = Option<(String, TypedVersionOrigin)>;

fn typed_package() -> MemoryHost {
    MemoryHost::new(&[
        (MANIFEST, TYPED_EXPORTS),
        (INSTALLED, ""),
        (TYPED, ""),
        ("/p/node_modules/pkg/other.js", ""),
        ("/p/local.js", ""),
    ])
}

fn package_with_dist(manifest: &str, dist_manifest: &str) -> MemoryHost {
    MemoryHost::new(&[
        (MANIFEST, manifest),
        (DIST_MANIFEST, dist_manifest),
        (DIST_FILE, ""),
        (DIST_TYPED_FILE, ""),
        (DIST_OTHER_FILE, ""),
    ])
}

fn package_files(manifest: &str, names: &[&str]) -> MemoryHost {
    let paths: Vec<String> = (names.iter())
        .map(|name| format!("/p/node_modules/pkg/{name}"))
        .collect();
    let mut files = vec![(MANIFEST, manifest)];
    files.extend(paths.iter().map(|path| (path.as_str(), "")));
    MemoryHost::new(&files)
}

fn describe(typed: Option<TypedVersionFile<'_>>) -> Found {
    typed.map(|typed| (text(typed.path), typed.origin))
}

fn by(origin: TypedVersionOrigin, path: &str) -> Found {
    Some((path.to_owned(), origin))
}

fn typed_version_with(host: &MemoryHost, options: &CodeOptions, path: &str) -> Found {
    with_resolver(host, options, |resolver| {
        describe(resolver.typed_version_of(path.as_bytes()))
    })
}

fn typed_version(host: &MemoryHost, path: &str) -> Found {
    typed_version_with(host, &bun_run(), path)
}

fn dist_typed_version(manifest: &str, dist_manifest: &str) -> Found {
    let host = package_with_dist(manifest, dist_manifest);
    with_resolver(&host, &bun_run(), |resolver| {
        let file = find_file(resolver, &import_request("/p/main.ts", "pkg"));
        assert_eq!(text(file.path), DIST_FILE);
        describe(resolver.typed_version_of(file.path))
    })
}

#[test]
#[cfg_attr(miri, ignore)]
fn typed_version_comes_from_host_then_condition() {
    assert_eq!(
        typed_version(&typed_package(), INSTALLED),
        by(FromPackage, TYPED)
    );

    let sound = "/p/.full-types/pkg/index.ts";
    let host = typed_package().typed(INSTALLED, sound);
    assert_eq!(typed_version(&host, INSTALLED), by(FromHost, sound));
}

#[test]
#[cfg_attr(miri, ignore)]
fn installed_typed_version_comes_after_condition() {
    let installed_typed = "/p/node_modules/@oven/full-types-pkg/lay/index.js";
    let host = typed_package().installed_typed(INSTALLED, installed_typed);
    assert_eq!(typed_version(&host, INSTALLED), by(FromPackage, TYPED));

    let other = "/p/node_modules/pkg/other.js";
    let other_typed = "/p/node_modules/@oven/full-types-pkg/lay/other.js";
    let host = typed_package().installed_typed(other, other_typed);
    assert_eq!(typed_version(&host, other), by(FromHost, other_typed));
}

#[test]
#[cfg_attr(miri, ignore)]
fn typed_condition_needs_package_exports() {
    assert_eq!(typed_version(&typed_package(), "/p/local.js"), None);

    let sound = "/p/.full-types/local.ts";
    let host = typed_package().typed("/p/local.js", sound);
    assert_eq!(typed_version(&host, "/p/local.js"), by(FromHost, sound));
}

#[test]
#[cfg_attr(miri, ignore)]
fn typed_versions_can_be_off() {
    let options = CodeOptions {
        typed_condition: None,
        ..bun_run()
    };
    let host = typed_package().typed(INSTALLED, "/p/.full-types/pkg/index.ts");
    assert_eq!(typed_version_with(&host, &options, INSTALLED), None);
    assert_eq!(host.typed_version_calls(), 0);
}

#[test]
#[cfg_attr(miri, ignore)]
fn condition_name_comes_from_options() {
    let options = CodeOptions {
        typed_condition: Some(b"other-condition".to_vec()),
        ..bun_run()
    };
    assert_eq!(
        typed_version_with(&typed_package(), &options, INSTALLED),
        None
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn typed_version_does_not_depend_on_request() {
    let requests = [
        ("/p/main.ts", "pkg"),
        ("/p/main.ts", "pkg/index.js"),
        ("/p/main.ts", "./node_modules/pkg/index.js"),
        ("/p/node_modules/pkg/other.js", "./index.js"),
        ("/p/node_modules/pkg/other.js", "./index"),
    ];
    let host = typed_package();
    for (importer, specifier) in requests {
        let typed = with_resolver(&host, &bun_run(), |resolver| {
            let file = find_file(resolver, &import_request(importer, specifier));
            assert_eq!(text(file.path), INSTALLED, "{specifier} from {importer}");
            describe(resolver.typed_version_of(file.path))
        });
        assert_eq!(typed, by(FromPackage, TYPED), "{specifier} from {importer}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn host_is_asked_once_per_path() {
    let host = typed_package().typed(INSTALLED, "/p/.full-types/pkg/index.ts");
    with_resolver(&host, &bun_run(), |resolver| {
        let first = resolver.typed_version_of(INSTALLED.as_bytes());
        assert_eq!(resolver.typed_version_of(INSTALLED.as_bytes()), first);
        assert_eq!(host.typed_version_calls(), 1);
        assert_eq!(resolver.typed_version_of(b"/p/local.js"), None);
        assert_eq!(resolver.typed_version_of(b"/p/local.js"), None);
        assert_eq!(host.typed_version_calls(), 2);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn nearest_manifest_with_exports_names_typed_version() {
    let typed = by(FromPackage, DIST_TYPED_FILE);
    let exports_in_dist = r#"{"exports": {".": {"import": "./dist/index.js"}}}"#;
    let other_typed_version =
        r#"{"exports": {".": {"full-types": "./dist/other.js", "default": "./dist/index.js"}}}"#;
    for manifest in [MAIN_IN_DIST, exports_in_dist, other_typed_version] {
        let found = dist_typed_version(manifest, DIST_TYPED_EXPORTS);
        assert_eq!(found, typed, "{manifest}");
    }
    let dist_manifests = [
        r#"{"exports": {"full-types": "./index.full.ts", "default": "./index.js"}}"#,
        r#"{"exports": [{"full-types": "./index.full.ts"}, "./index.js"]}"#,
        r#"{"exports": {".": [{"node": {"full-types": "./index.full.ts"}}, "./index.js"]}}"#,
        r#"{"exports": {
            "./other": "./other.js",
            "./main": {"full-types": "./index.full.ts", "default": "./index.js"}
        }}"#,
    ];
    for dist_manifest in dist_manifests {
        let found = dist_typed_version(MAIN_IN_DIST, dist_manifest);
        assert_eq!(found, typed, "{dist_manifest}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn manifest_without_exports_does_not_hide_package_exports() {
    let manifest = r#"{
        "exports": {".": {"full-types": "./dist/index.full.ts", "default": "./dist/index.js"}}
    }"#;
    let found = dist_typed_version(manifest, r#"{"type": "module"}"#);
    assert_eq!(found, by(FromPackage, DIST_TYPED_FILE));
}

#[test]
#[cfg_attr(miri, ignore)]
fn manifest_must_export_file_and_other_typed_file() {
    let dist_manifests = [
        r#"{"name": "dist"}"#,
        r#"{"exports": {".": "./index.js"}}"#,
        r#"{"exports": {".": {"full-types": "./index.js", "default": "./index.js"}}}"#,
        r#"{"exports": {".": {"full-types": null, "default": "./index.js"}}}"#,
        r#"{"exports": {"./full-types": "./index.full.ts", ".": {"default": "./index.js"}}}"#,
    ];
    for dist_manifest in dist_manifests {
        let found = dist_typed_version(MAIN_IN_DIST, dist_manifest);
        assert_eq!(found, None, "{dist_manifest}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn file_that_exports_does_not_name_has_its_typed_file_beside_it() {
    let dist_manifest =
        r#"{"exports": {".": {"full-types": "./other.full.ts", "default": "./other.js"}}}"#;
    let found = dist_typed_version(MAIN_IN_DIST, dist_manifest);
    assert_eq!(found, by(FromPackage, DIST_TYPED_FILE));
}

#[test]
#[cfg_attr(miri, ignore)]
fn typed_file_that_condition_names_can_be_missing() {
    let dist_manifest =
        r#"{"exports": {".": {"full-types": "./missing.full.ts", "default": "./index.js"}}}"#;
    let host = package_with_dist(MAIN_IN_DIST, dist_manifest);
    with_resolver(&host, &bun_run(), |resolver| {
        let typed = resolver.typed_version_of(DIST_FILE.as_bytes()).unwrap();
        assert_eq!(text(typed.path), "/p/node_modules/pkg/dist/missing.full.ts");
        assert!(typed.is_missing);
    });
    let host = package_with_dist(MAIN_IN_DIST, DIST_TYPED_EXPORTS);
    with_resolver(&host, &bun_run(), |resolver| {
        let typed = resolver.typed_version_of(DIST_FILE.as_bytes()).unwrap();
        assert!(!typed.is_missing);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn unexported_file_has_no_typed_version() {
    let host = package_with_dist(MAIN_IN_DIST, DIST_TYPED_EXPORTS);
    assert_eq!(
        typed_version(&host, DIST_FILE),
        by(FromPackage, DIST_TYPED_FILE)
    );
    assert_eq!(typed_version(&host, DIST_OTHER_FILE), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn pattern_key_names_typed_version() {
    let manifest = r#"{
        "exports": {"./*": {"full-types": "./typed/*.ts", "default": "./dist/*.js"}}
    }"#;
    let names = [
        "dist/a/b.js",
        "typed/a/b.ts",
        "dist/untyped.js",
        "src/a/b.js",
    ];
    let host = package_files(manifest, &names);
    let typed = typed_version(&host, "/p/node_modules/pkg/dist/a/b.js");
    assert_eq!(typed, by(FromPackage, "/p/node_modules/pkg/typed/a/b.ts"));
    assert_eq!(
        typed_version(&host, "/p/node_modules/pkg/dist/untyped.js"),
        None
    );
    assert_eq!(typed_version(&host, "/p/node_modules/pkg/src/a/b.js"), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn directory_key_names_typed_version() {
    let manifest = r#"{
        "exports": {"./lib/": {"full-types": "./typed/", "default": "./dist/"}}
    }"#;
    let host = package_files(manifest, &["dist/x.js", "typed/x.ts", "dist/untyped.js"]);
    let typed = typed_version(&host, "/p/node_modules/pkg/dist/x.js");
    assert_eq!(typed, by(FromPackage, "/p/node_modules/pkg/typed/x.ts"));
    assert_eq!(
        typed_version(&host, "/p/node_modules/pkg/dist/untyped.js"),
        None
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn file_exported_for_require_only_has_typed_version() {
    let manifest = r#"{
        "exports": {
            ".": {
                "import": "./index.mjs",
                "require": {"full-types": "./index.cts", "default": "./index.cjs"}
            }
        }
    }"#;
    let host = package_files(manifest, &["index.mjs", "index.cjs", "index.cts"]);
    let typed = typed_version(&host, "/p/node_modules/pkg/index.cjs");
    assert_eq!(typed, by(FromPackage, "/p/node_modules/pkg/index.cts"));
    assert_eq!(typed_version(&host, "/p/node_modules/pkg/index.mjs"), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn application_exports_name_typed_version_of_own_file() {
    let application = r#"{
        "name": "app", "version": "1.0.0",
        "exports": {"./*": {"full-types": "./typed/*.ts", "default": "./*.js"}}
    }"#;
    let host = MemoryHost::new(&[
        ("/p/package.json", application),
        ("/p/own.js", ""),
        ("/p/typed/own.ts", ""),
        (INSTALLED, ""),
    ]);
    assert_eq!(
        typed_version(&host, "/p/own.js"),
        by(FromPackage, "/p/typed/own.ts")
    );
    assert_eq!(typed_version(&host, INSTALLED), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn linked_package_is_looked_up_by_real_path() {
    let host = MemoryHost::new(&[
        ("/store/pkg/package.json", TYPED_EXPORTS),
        ("/store/pkg/index.js", ""),
        ("/store/pkg/typed.ts", ""),
    ])
    .link("/p/node_modules/pkg", "/store/pkg");
    with_resolver(&host, &bun_run(), |resolver| {
        let file = find_file(resolver, &import_request("/p/main.ts", "pkg"));
        assert_eq!(text(file.path), "/store/pkg/index.js");
        let typed = describe(resolver.typed_version_of(file.path));
        assert_eq!(typed, by(FromPackage, "/store/pkg/typed.ts"));
    });
}
