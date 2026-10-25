use super::CodeImportKind::{EntryPoint, Import, Require};
use super::KeyKind::{Directory, Exact, Pattern};
use super::memory_host::{MemoryHost, parse_json, resolve_in};
use super::*;

const KINDS: [CodeImportKind; 3] = [EntryPoint, Import, Require];

const OTHER_FAILURES: [CodeFailure; 9] = [
    CodeFailure::PackageNotFound,
    CodeFailure::BuiltinModuleNotFound,
    CodeFailure::PackagePathNotExported,
    CodeFailure::PackageImportNotDefined,
    CodeFailure::InvalidModuleSpecifier,
    CodeFailure::InvalidPackageTarget,
    CodeFailure::InvalidPackageConfiguration,
    CodeFailure::UnsupportedDirectoryImport,
    CodeFailure::QueryString,
];

#[test]
fn only_module_not_found_is_refined() {
    let specifiers: [&[u8]; 3] = [b"nope", b"node:nope", b"./nope"];
    for failure in OTHER_FAILURES {
        for specifier in specifiers {
            for kind in KINDS {
                assert_eq!(refine_failure(failure, specifier, kind), failure);
            }
        }
    }
}

#[test]
fn module_not_found_is_refined_by_specifier_form() {
    let refine = |specifier: &[u8], kind: CodeImportKind| {
        refine_failure(CodeFailure::ModuleNotFound, specifier, kind)
    };
    let paths: [&[u8]; 4] = [b"./nope", b"/nope", b"pkg/nope", b"@scope/nope"];
    for kind in KINDS {
        assert_eq!(
            refine(b"node:nope", kind),
            CodeFailure::BuiltinModuleNotFound
        );
        for path in paths {
            assert_eq!(refine(path, kind), CodeFailure::ModuleNotFound);
        }
    }
    assert_eq!(refine(b"nope", Import), CodeFailure::PackageNotFound);
    assert_eq!(refine(b"nope", Require), CodeFailure::PackageNotFound);
    assert_eq!(refine(b"nope", EntryPoint), CodeFailure::ModuleNotFound);
}

#[test]
fn resolution_key_has_directory_kind_and_specifier() {
    let key = code_resolution_key(b"/p", Import, b"a");
    assert_eq!(key, code_resolution_key(b"/p", Import, b"a"));
    assert_ne!(key, code_resolution_key(b"/q", Import, b"a"));
    assert_ne!(key, code_resolution_key(b"/p", Require, b"a"));
    assert_ne!(key, code_resolution_key(b"/p", EntryPoint, b"a"));
    assert_ne!(key, code_resolution_key(b"/p", Import, b"b"));
    assert_ne!(
        code_resolution_key(b"/p/a", Import, b"b"),
        code_resolution_key(b"/p", Import, b"a/b")
    );
}

const CONDITIONS: [&str; 2] = ["import", "default"];
const NOT_EXPORTED: &str = "PackagePathNotExported";
const BAD_SPECIFIER: &str = "InvalidModuleSpecifier";
const BAD_TARGET: &str = "InvalidPackageTarget";
const BAD_CONFIGURATION: &str = "InvalidPackageConfiguration";
const IS_DIRECTORY: &str = "UnsupportedDirectoryImport";
const MODULE_NOT_FOUND: &str = "NotFound(ModuleNotFound)";
const DIRECTORY_IMPORT: &str = "NotFound(UnsupportedDirectoryImport)";

fn describe(resolution: Result<(KeyKind, Vec<u8>), CodeFailure>) -> String {
    match resolution {
        Ok((key, path)) => format!("{key:?} {}", bstr::BStr::new(&path)),
        Err(failure) => format!("{failure:?}"),
    }
}

fn holds(condition: &[u8]) -> bool {
    CONDITIONS.iter().any(|it| it.as_bytes() == condition)
}

fn exports(json: &str, subpath: &str) -> String {
    let arena = Arena::new();
    let root = build_exports_entry(&arena, &parse_json(json.as_bytes()).unwrap());
    describe(resolve_exports(&root, subpath.as_bytes(), &holds))
}

fn target(json: &str) -> String {
    exports(&format!(r#"{{".": {json}}}"#), ".")
}

fn target_text(target: &str, subpath: &str, key: KeyKind) -> String {
    let path = resolve_target_text(target.as_bytes(), key, subpath.as_bytes());
    describe(path.map(|path| (key, path)))
}

fn exported_text(target: &str) -> String {
    target_text(target, "", Exact)
}

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

fn resolve(host: &MemoryHost, specifier: &str) -> String {
    let options = CodeOptions::bun_run(b"/p");
    resolve_in(host, &options, "/p/main.ts", specifier, Import)
}

fn search_for(
    specifier: &[u8],
    kind: CodeImportKind,
    prefers_module_field: bool,
) -> FileSearch<'_> {
    FileSearch {
        directory: b"/p",
        specifier,
        kind,
        prefers_module_field,
    }
}

fn in_package(name: &str) -> Vec<u8> {
    format!("/p/node_modules/pkg/{name}").into_bytes()
}

fn probe(host: &MemoryHost, path: &str, target: TargetKind) -> String {
    let orders = &BUN_RUN.extension_orders;
    let search = PlainSearch {
        host,
        parse_manifest: Host::parse_package_json,
        orders,
        kind: Import,
        prefers_module_field: false,
        holds: &holds,
        arena: OnceCell::new(),
    };
    match search.probe_target_extensions(path.as_bytes(), &orders.import, target) {
        Some(path) => String::from_utf8(path).unwrap(),
        None => "None".to_owned(),
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn main_export_and_subpath_keys() {
    let cases = [
        (r#""./a.js""#, ".", "Exact /a.js"),
        (r#"{"import": "./a.js"}"#, ".", "Exact /a.js"),
        (r#"{".": "./a.js"}"#, ".", "Exact /a.js"),
        (r#"{".": null}"#, ".", NOT_EXPORTED),
        (r#"{"./b": "./b.js"}"#, ".", NOT_EXPORTED),
        ("null", ".", NOT_EXPORTED),
        (r#"{"deno": "./a.js"}"#, ".", NOT_EXPORTED),
        (
            r#"{".": "./a.js", "import": "./b.js"}"#,
            ".",
            BAD_CONFIGURATION,
        ),
        ("true", ".", BAD_CONFIGURATION),
        (r#"{"./a": "./a.js"}"#, "./a", "Exact /a.js"),
        (r#"{"./a": null}"#, "./a", NOT_EXPORTED),
        (r#"{"import": "./a.js"}"#, "./a", NOT_EXPORTED),
        (r#""./a.js""#, "./a", NOT_EXPORTED),
        ("true", "./a", BAD_CONFIGURATION),
        (r#"{"./*": "./src/*"}"#, "", NOT_EXPORTED),
    ];
    for (json, subpath, expected) in cases {
        assert_eq!(exports(json, subpath), expected, "{json}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn pattern_keys() {
    let by_base = r#"{"./*": "./any/*.js", "./a/*": "./deep/*.js"}"#;
    assert_eq!(exports(by_base, "./a/x"), "Pattern /deep/x.js");
    assert_eq!(exports(by_base, "./b"), "Pattern /any/b.js");
    assert_eq!(exports(by_base, "./a/"), "Pattern /deep/.js");

    let first_match = r#"{"./*": "./any/*.js", "./a/*": null}"#;
    assert_eq!(exports(first_match, "./a/x"), NOT_EXPORTED);
    assert_eq!(exports(first_match, "./b"), "Pattern /any/b.js");

    let trailer = r#"{"./*.js": "./src/*.ts"}"#;
    assert_eq!(exports(trailer, "./x.js"), "Pattern /src/x.ts");
    assert_eq!(exports(trailer, "./x.css"), NOT_EXPORTED);
    assert_eq!(exports(trailer, "./.js"), NOT_EXPORTED);
}

#[test]
#[cfg_attr(miri, ignore)]
fn only_undefined_conditions_fall_through() {
    let nested = r#"{"import": {"deno": "./x.js"}, "default": "./d.js"}"#;
    assert_eq!(target(nested), "Exact /d.js");
    let nested_array = r#"{"import": [{"deno": "./x.js"}], "default": "./d.js"}"#;
    assert_eq!(target(nested_array), "Exact /d.js");
    assert_eq!(target(r#"{"import": {"deno": "./x.js"}}"#), NOT_EXPORTED);

    let null = r#"{"import": null, "default": "./d.js"}"#;
    assert_eq!(target(null), NOT_EXPORTED);
    let invalid = r#"{"import": "bad", "default": "./d.js"}"#;
    assert_eq!(target(invalid), BAD_TARGET);
}

#[test]
#[cfg_attr(miri, ignore)]
fn arrays_and_leaves() {
    let cases = [
        (r#""./a.js""#, "Exact /a.js"),
        ("null", NOT_EXPORTED),
        ("true", BAD_TARGET),
        ("[]", NOT_EXPORTED),
        (r#"["./a.js", "./b.js"]"#, "Exact /a.js"),
        (r#"[[["./a.js"]]]"#, "Exact /a.js"),
        (r#"[{"deno": "./x.js"}, "./b.js"]"#, "Exact /b.js"),
        (r#"[{"deno": "./x.js"}]"#, NOT_EXPORTED),
        (r#"["bad", "./b.js"]"#, BAD_TARGET),
        (r#"[null, "./b.js"]"#, NOT_EXPORTED),
        (r#"[[], "./b.js"]"#, NOT_EXPORTED),
    ];
    for (json, expected) in cases {
        assert_eq!(target(json), expected, "{json}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn deep_nesting_is_invalid_configuration() {
    const STACK_SIZE: usize = 4 << 20;
    let pick_nested = || {
        bun_sema_standalone::native::set_stack_size(STACK_SIZE / 2);
        let arena = Arena::new();
        let mut entry = ExportsEntry::Target(b"./a.js");
        let mut nest_and_pick = |levels: usize| {
            for _ in 0..levels {
                entry = ExportsEntry::Array(arena.alloc_slice_copy(&[entry]));
            }
            pick_target(entry, &holds).map(|picked| picked.map(<[u8]>::to_vec))
        };
        (nest_and_pick(64), nest_and_pick(100_000))
    };
    let thread = std::thread::Builder::new().stack_size(STACK_SIZE);
    let (shallow, deep) = thread.spawn(pick_nested).unwrap().join().unwrap();
    assert_eq!(shallow, Some(Ok(b"./a.js".to_vec())));
    assert_eq!(deep, Some(Err(CodeFailure::InvalidPackageConfiguration)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn target_length_limit() {
    let longest = MAX_PATH_BYTES - PACKAGE_URL.len() - JOIN_HEADROOM;
    let fitting = format!("./{}", "a".repeat(longest - 2));
    assert!(exported_text(&fitting).starts_with("Exact /aaa"));
    assert_eq!(exported_text(&format!("{fitting}a")), BAD_TARGET);

    let substitute = |subpath: &str| target_text("./*", subpath, Pattern);
    let fitting = "a".repeat(longest - 3);
    assert!(substitute(&fitting).starts_with("Pattern /aaa"));
    assert_eq!(substitute(&format!("{fitting}a")), BAD_TARGET);

    let subpath = "a".repeat(MAX_PATH_BYTES / 4);
    assert!(target_text("./*/*", &subpath, Pattern).starts_with("Pattern /aaa"));
    assert_eq!(target_text("./********", &subpath, Pattern), BAD_SPECIFIER);
}

#[test]
#[cfg_attr(miri, ignore)]
fn leftover_subpath_needs_directory_target() {
    let cases = [
        ("./x/", "y", Directory, "Directory /x/y"),
        ("./x", "y", Directory, BAD_SPECIFIER),
        ("./x", "", Directory, "Directory /x"),
        ("./x", "y", Pattern, "Pattern /x"),
    ];
    for (target, subpath, key, expected) in cases {
        assert_eq!(target_text(target, subpath, key), expected);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn invalid_subpaths() {
    for subpath in ["../x", "x/./y", "x\\..\\y", "NODE_MODULES/x", "%2e%2e/x"] {
        let pattern = target_text("./src/*", subpath, Pattern);
        assert_eq!(pattern, BAD_SPECIFIER, "{subpath}");
        let directory = target_text("./src/", subpath, Directory);
        assert_eq!(directory, BAD_SPECIFIER, "{subpath}");
    }
    let valid = target_text("./src/*", "..x/.y/node_modules.js", Pattern);
    assert_eq!(valid, "Pattern /src/..x/.y/node_modules.js");
    assert_eq!(
        target_text("./node_*/x.js", "modules", Pattern),
        BAD_SPECIFIER
    );
    assert_eq!(target_text("./%2*/x.js", "e", Pattern), BAD_SPECIFIER);
}

#[test]
#[cfg_attr(miri, ignore)]
fn target_outside_package() {
    for target in ["../x", "/x", "pkg", "src/x.ts", ""] {
        assert_eq!(exported_text(target), BAD_TARGET, "{target}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn invalid_target_segments() {
    for target in ["./a/../b", "./a\\..\\b", "./node_modules/x", "./%2e%2e/x"] {
        assert_eq!(exported_text(target), BAD_TARGET, "{target}");
    }
    assert_eq!(exported_text("./a/..b/.c"), "Exact /a/..b/.c");
    assert_eq!(exported_text("./a//b.js"), "Exact /a/b.js");
}

#[test]
#[cfg_attr(miri, ignore)]
fn resolved_path_is_decoded() {
    let cases = [
        (r#""./a%20b.js""#, "Exact /a b.js"),
        (r#""./%41.js""#, "Exact /A.js"),
        (r#""./a%2fb.js""#, BAD_SPECIFIER),
        (r#""./a%2Fb.js""#, BAD_SPECIFIER),
        (r#""./a%5cb.js""#, BAD_SPECIFIER),
        (r#""./a%5Cb.js""#, BAD_SPECIFIER),
        (r#""./a%zz.js""#, BAD_SPECIFIER),
        (r#""./a%2""#, BAD_SPECIFIER),
    ];
    for (json, expected) in cases {
        assert_eq!(exports(json, "."), expected, "{json}");
    }

    let pattern = r#"{"./*": "./src/*.js"}"#;
    assert_eq!(exports(pattern, "./a%20b"), "Pattern /src/a b.js");
    assert_eq!(exports(pattern, "./a%2fb"), BAD_SPECIFIER);
    let directory = r#"{"./a/": "./src/"}"#;
    assert_eq!(exports(directory, "./a/b%20c"), "Directory /src/b c");
}

#[test]
#[cfg_attr(miri, ignore)]
fn resolved_directory_is_unsupported() {
    for json in [r#""./dir/""#, r#""./""#, r#""./dir\\""#, r#""./a%20/""#] {
        assert_eq!(exports(json, "."), IS_DIRECTORY, "{json}");
    }
    assert_eq!(exports(r#"{"./a/": "./src/"}"#, "./a/"), IS_DIRECTORY);
    assert_eq!(exports(r#""./dir""#, "."), "Exact /dir");
}

#[test]
#[cfg_attr(miri, ignore)]
fn package_specifiers() {
    let parts = |name: &str, subpath: &str| Some([name, subpath].map(str::to_owned));
    let cases = [
        ("react", parts("react", ".")),
        ("react/jsx-runtime", parts("react", "./jsx-runtime")),
        ("@s/p/x/y", parts("@s/p", "./x/y")),
        ("a@1.2.3/b", parts("a", "./b")),
        ("@s/p@2", parts("@s/p", ".")),
        ("@s/p@2/x", parts("@s/p", "./x")),
        ("pkg/@scope/x", parts("pkg", "./@scope/x")),
        ("a@", parts("a", ".")),
        ("a@/b", parts("a", ".")),
        ("", None),
        ("@scope", None),
        (".hidden", None),
        ("a%b", None),
        ("a\\b", None),
    ];
    for (specifier, expected) in cases {
        let parsed = parse_package_specifier(specifier.as_bytes());
        let parsed = parsed.map(|(name, subpath)| {
            [name, &subpath].map(|field| bstr::BStr::new(field).to_string())
        });
        assert_eq!(parsed, expected, "{specifier}");
    }

    let fitting = format!("a/{}", "b".repeat(SUBPATH_CAPACITY - 2));
    let (_, subpath) = parse_package_specifier(fitting.as_bytes()).unwrap();
    assert_eq!(subpath.len(), SUBPATH_CAPACITY);
    let too_long = format!("{fitting}b");
    let (name, subpath) = parse_package_specifier(too_long.as_bytes()).unwrap();
    assert_eq!(name, b"a");
    assert!(subpath.is_empty());
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

    let host = empty_files(&["/p/src/a.ts", "/p/src/b.c.ts", "/p/src/.env.ts"]);
    assert_eq!(
        probe(&host, "/p/src/a", TargetKind::Wildcard),
        "/p/src/a.ts"
    );
    assert_eq!(probe(&host, "/p/src/a", TargetKind::Exact), "None");
    assert_eq!(probe(&host, "/p/src/b.c", TargetKind::Wildcard), "None");
    let hidden = probe(&host, "/p/src/.env", TargetKind::Wildcard);
    assert_eq!(hidden, "/p/src/.env.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn wildcard_target_takes_order_of_its_directory() {
    let names = &["lib/a.js", "lib/a.ts"];
    let installed = dependency(r#"{"exports": {"./*": "./lib/*"}}"#, names);
    assert_eq!(resolve(&installed, "pkg/a"), "/p/node_modules/pkg/lib/a.js");
    let own = package(
        "/p",
        r#"{"name": "app", "exports": {"./*": "./lib/*"}}"#,
        names,
    );
    assert_eq!(resolve(&own, "app/a"), "/p/lib/a.ts");
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
fn target_in_node_modules_keeps_mjs_without_the_aot_condition() {
    let project = empty_files(&["/p/src/a.mts"]);
    let rewritten = probe(&project, "/p/src/a.mjs", TargetKind::Exact);
    assert_eq!(rewritten, "/p/src/a.mts");

    let dependency = empty_files(&["/p/node_modules/a.mts", "/p/node_modules/b.ts"]);
    let probe_exact = |path| probe(&dependency, path, TargetKind::Exact);
    assert_eq!(probe_exact("/p/node_modules/a.mjs"), "None");
    assert_eq!(probe_exact("/p/node_modules/b.js"), "/p/node_modules/b.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn aot_condition_finds_mts_and_cts_in_node_modules() {
    let names = ["a.mts", "b.ts", "c.cts"].map(|name| format!("/p/node_modules/x/{name}"));
    let host = empty_files(&names.each_ref().map(String::as_str));
    let find = |options: &CodeOptions, specifier: &str| {
        let importer = "/p/node_modules/x/index.js";
        resolve_in(&host, options, importer, specifier, Import)
    };
    let options = CodeOptions::bun_run(b"/p");
    assert_eq!(find(&options, "./a.mjs"), "/p/node_modules/x/a.mts");
    assert_eq!(find(&options, "./b.js"), "/p/node_modules/x/b.ts");
    assert_eq!(find(&options, "./c.cjs"), "/p/node_modules/x/c.cts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn missing_targets_say_why() {
    let manifest = r#"{"exports": {"./a": "./a.js", "./any/*": "./lib/*", "./d": "./lib"}}"#;
    let host = dependency(manifest, &["lib/b.js"]);
    let find = |specifier: &[u8]| find_file_plainly(&host, &search_for(specifier, Import, false));
    assert_eq!(find(b"pkg/a"), FoundCode::not_found());
    assert_eq!(find(b"pkg/any/c"), FoundCode::not_found());
    let directory = FoundCode::NotFound(CodeFailure::UnsupportedDirectoryImport);
    assert_eq!(find(b"pkg/d"), directory);
}

#[test]
#[cfg_attr(miri, ignore)]
fn module_is_taken_where_search_prefers_it() {
    let manifest = r#"{"module": "./esm.js", "main": "./cjs.js"}"#;
    let host = dependency(manifest, &["esm.js", "cjs.js"]);
    let find = |kind, prefers_module_field| {
        find_file_plainly(&host, &search_for(b"pkg", kind, prefers_module_field))
    };
    let module = FoundCode::File {
        path: in_package("esm.js"),
        required: Some(in_package("cjs.js")),
    };
    assert_eq!(find(Import, true), module);
    assert_eq!(find(Require, true), found_file(in_package("cjs.js")));
    assert_eq!(find(Import, false), found_file(in_package("cjs.js")));

    let without_main = dependency(r#"{"module": "./esm.js"}"#, &["esm.js"]);
    let found = find_file_plainly(&without_main, &search_for(b"pkg", Import, false));
    assert_eq!(found, found_file(in_package("esm.js")));
}

#[test]
#[cfg_attr(miri, ignore)]
fn main_uses_main_field_extension_order() {
    let names = &["lib.js", "lib.ts"];
    let main = dependency(r#"{"main": "./lib"}"#, names);
    assert_eq!(resolve(&main, "pkg"), "/p/node_modules/pkg/lib.js");
    let folder = package(
        "/p/x",
        r#"{"main": "./lib"}"#,
        &["lib.js", "lib.ts", "index.ts"],
    );
    assert_eq!(resolve(&folder, "./x"), "/p/x/lib.js");
}

#[test]
#[cfg_attr(miri, ignore)]
fn directory_specifier_gets_no_extension() {
    let host = empty_files(&["/p/a.ts", "/p/a/index.ts", "/p.ts", "/p/index.ts"]);
    assert_eq!(resolve(&host, "./a"), "/p/a.ts");
    assert_eq!(resolve(&host, "./a/"), "/p/a/index.ts");
    assert_eq!(resolve(&host, "."), "/p/index.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn conditions_and_orders_of_build_are_handed_in() {
    let manifest = r#"{"exports": {
        ".": {"worker": "./worker.js", "default": "./index.js"},
        "./*": "./lib/*"
    }}"#;
    let host = dependency(manifest, &["worker.js", "index.js", "lib/a.js", "lib/a.ts"]);
    let mut options = CodeOptions::bun_run(b"/p");
    let main = search_for(b"pkg", Import, false);
    let found = options.find_file_plainly(&host, &main);
    assert_eq!(found, found_file(in_package("index.js")));

    options.add_custom_condition(b"worker");
    options.extension_orders.node_modules_import = vec![b".ts".to_vec(), b".js".to_vec()];
    let found = options.find_file_plainly(&host, &main);
    assert_eq!(found, found_file(in_package("worker.js")));
    let found = options.find_file_plainly(&host, &search_for(b"pkg/a", Import, false));
    assert_eq!(found, found_file(in_package("lib/a.ts")));
}
