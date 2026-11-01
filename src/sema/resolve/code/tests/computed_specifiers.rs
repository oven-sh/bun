use super::CodeImportKind::Require;
use super::*;
use crate::resolve::code::memory_host::{
    ComputedPattern, resolve_computed_in, resolve_computed_with,
};

const NO_CANDIDATE: &str = "";

fn import_pattern(host: &MemoryHost, prefix: &str, suffix: &str) -> String {
    resolve_computed_in(host, "/p/main.ts", prefix, suffix, Import)
}

fn installed_package(manifest: &str, names: &[&str]) -> MemoryHost {
    let paths: Vec<String> = (names.iter())
        .map(|name| format!("/p/node_modules/pkg/{name}"))
        .collect();
    let mut files = vec![(MANIFEST, manifest)];
    files.extend(paths.iter().map(|path| (path.as_str(), "")));
    MemoryHost::new(&files)
}

fn configured_project(compiler_options: &str) -> MemoryHost {
    let config = format!(r#"{{"compilerOptions": {compiler_options}}}"#);
    MemoryHost::new(&[
        ("/p/tsconfig.json", config.as_str()),
        ("/p/node_modules/pkg/a.js", ""),
        ("/p/d/b.ts", ""),
        ("/virtual/c.ts", ""),
    ])
}

fn external(specifier: &str, kind: ExternalKind) -> HostResolution {
    HostResolution::External {
        specifier: specifier.into(),
        kind,
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn relative_prefix_lists_files_below_directory() {
    let host = empty_files(&[
        "/p/main.ts",
        "/p/locales/en.json",
        "/p/locales/fr.json",
        "/p/locales/regions/ca.json",
        "/p/locales/notes.txt",
        "/p/other/de.json",
    ]);
    let found = import_pattern(&host, "./locales/", ".json");
    let expected = "/p/locales/en.json, /p/locales/fr.json, /p/locales/regions/ca.json";
    assert_eq!(found, expected);
}

#[test]
#[cfg_attr(miri, ignore)]
fn name_prefix_selects_files_and_directories() {
    let host = empty_files(&[
        "/p/main.ts",
        "/p/plugin-a.ts",
        "/p/plugin-b/index.ts",
        "/p/other.ts",
        "/p/other/plugin-c.ts",
    ]);
    let found = import_pattern(&host, "./plugin-", "");
    assert_eq!(found, "/p/plugin-a.ts, /p/plugin-b/index.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn every_spelling_reaches_file_once() {
    let host = empty_files(&[
        "/p/main.ts",
        "/p/mods/a.ts",
        "/p/mods/b.mts",
        "/p/mods/c.cts",
    ]);
    let all = "/p/mods/a.ts, /p/mods/b.mts, /p/mods/c.cts";
    assert_eq!(import_pattern(&host, "./mods/", ""), all);
    assert_eq!(
        import_pattern(&host, "./mods/", ".js"),
        "/p/mods/a.ts, /p/mods/b.mts"
    );
    assert_eq!(
        import_pattern(&host, "./mods/", ".jsx"),
        "/p/mods/a.ts, /p/mods/b.mts"
    );
    assert_eq!(import_pattern(&host, "./mods/", ".mjs"), "/p/mods/b.mts");
    assert_eq!(import_pattern(&host, "./mods/", ".cjs"), "/p/mods/c.cts");
    assert_eq!(import_pattern(&host, "./mods/", ".json"), NO_CANDIDATE);
}

#[test]
#[cfg_attr(miri, ignore)]
fn rewritten_spelling_matches_name_prefix() {
    let host = empty_files(&["/p/main.ts", "/p/mods/a.ts", "/p/mods/b.ts"]);
    assert_eq!(import_pattern(&host, "./mods/a.j", ""), "/p/mods/a.ts");
    assert_eq!(import_pattern(&host, "./mods/a.m", ""), NO_CANDIDATE);
}

#[test]
#[cfg_attr(miri, ignore)]
fn dot_directories_and_node_modules_are_not_entered() {
    let host = empty_files(&[
        "/p/main.ts",
        "/p/d/a.ts",
        "/p/d/.hidden/x.ts",
        "/p/d/node_modules/y/index.js",
    ]);
    assert_eq!(import_pattern(&host, "./d/", ""), "/p/d/a.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn prefix_without_known_form_is_unknown() {
    let host = empty_files(&["/p/main.ts", "/p/a/b.ts"]);
    let cases = [
        ("", ".js", "All(NoConstantPrefix)"),
        (".", "", "All(NoConstantPrefix)"),
        ("..", "", "All(NoConstantPrefix)"),
        (".hidden", "", "All(NoConstantPrefix)"),
        ("./a/..", "", "All(NoConstantPrefix)"),
        ("./a/", "/../b", "All(NoConstantPrefix)"),
        ("./a\\", "", "All(NoConstantPrefix)"),
        ("h", "", "All(NoConstantPrefix)"),
        ("/", "", "All(NoConstantPrefix)"),
        ("#x/", "", "All(PackageImports)"),
        ("https://x/", "", "All(ExternalCandidate)"),
        ("//cdn/", "", "All(ExternalCandidate)"),
        ("data:", "", "All(ExternalCandidate)"),
    ];
    for (prefix, suffix, expected) in cases {
        assert_eq!(
            import_pattern(&host, prefix, suffix),
            expected,
            "{prefix:?} {suffix:?}"
        );
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn unresolvable_specifier_has_no_candidate() {
    let host = empty_files(&["/p/main.ts", "/p/a/b.ts"]);
    assert_eq!(import_pattern(&host, "./a/", ""), "/p/a/b.ts");
    for (prefix, suffix) in [
        ("./a/", "?x"),
        ("./a/?", ""),
        ("./a/\0", ""),
        ("./a/", "\0"),
    ] {
        assert_eq!(
            import_pattern(&host, prefix, suffix),
            NO_CANDIDATE,
            "{prefix:?} {suffix:?}"
        );
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn missing_directory_has_no_candidate() {
    let host = empty_files(&["/p/main.ts"]);
    assert_eq!(import_pattern(&host, "./missing/", ""), NO_CANDIDATE);
    assert_eq!(import_pattern(&host, "missing/", ""), NO_CANDIDATE);
}

#[test]
#[cfg_attr(miri, ignore)]
fn host_scheme_lists_matching_host_modules() {
    let host = empty_files(&["/p/main.ts"])
        .module("fs", 3)
        .module("node:fs", 3)
        .module("node:path", 5);
    assert_eq!(import_pattern(&host, "node:", ""), "host:3, host:5");
    assert_eq!(import_pattern(&host, "node:f", ""), "host:3");
    assert_eq!(import_pattern(&host, "node:", "th"), "host:5");
    assert_eq!(import_pattern(&host, "node:x", ""), NO_CANDIDATE);
    assert_eq!(import_pattern(&host, "bun:", ""), NO_CANDIDATE);
}

#[test]
#[cfg_attr(miri, ignore)]
fn host_module_source_is_file_candidate() {
    let source = HostResolution::ModuleSource {
        module: HostModuleId(3),
        path: b"/bun/fs.ts".to_vec(),
    };
    let host = empty_files(&["/p/main.ts"]).runtime_module("node:fs", source);
    with_resolver(&host, &bun_run(), |resolver| {
        let answer = resolver.resolve_computed_code(&ComputedCodeRequest {
            prefix: b"node:",
            suffix: b"",
            importer: b"/p/main.ts",
            directory: b"/p",
            kind: Import,
            form: CodeImportForm::Static,
        });
        let file = CodeFile {
            path: b"/bun/fs.ts",
            host_module: Some(HostModuleId(3)),
        };
        let expected = ComputedResolution::Candidates {
            candidates: &[ComputedCandidate::File(file)],
            spellings: &[],
        };
        assert_eq!(answer, expected);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn unknown_answer_keeps_matching_host_modules() {
    let host = empty_files(&["/p/main.ts"])
        .module("fs", 3)
        .module("node:fs", 3)
        .module("path", 5);
    assert_eq!(import_pattern(&host, "f", ""), "host:3");
    assert_eq!(
        import_pattern(&host, "", "fs"),
        "All(NoConstantPrefix), host:3"
    );
    assert_eq!(
        import_pattern(&host, "", ""),
        "All(NoConstantPrefix), host:3, host:5"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn start_of_package_name_lists_installed_packages_that_begin_so() {
    let host = MemoryHost::new(&[
        ("/p/main.ts", ""),
        (
            "/p/node_modules/app-linux-x64/package.json",
            r#"{"name": "app-linux-x64", "main": "app.node"}"#,
        ),
        ("/p/node_modules/app-linux-x64/app.node", ""),
        (
            "/p/node_modules/app-darwin-arm64/package.json",
            r#"{"name": "app-darwin-arm64", "exports": {".": "./lib/app.js", "./extra": "./lib/extra.js"}}"#,
        ),
        ("/p/node_modules/app-darwin-arm64/lib/app.js", ""),
        ("/p/node_modules/app-darwin-arm64/lib/extra.js", ""),
        ("/p/node_modules/app-darwin-arm64/lib/hidden.js", ""),
        ("/p/node_modules/apple/index.js", ""),
        ("/p/node_modules/other/index.js", ""),
        (
            "/p/node_modules/@my/app-linux-x64/package.json",
            r#"{"name": "@my/app-linux-x64", "main": "app.node"}"#,
        ),
        ("/p/node_modules/@my/app-linux-x64/app.node", ""),
        ("/p/node_modules/@my/other/index.js", ""),
    ]);
    let darwin = "/p/node_modules/app-darwin-arm64/lib/app.js, /p/node_modules/app-darwin-arm64/lib/extra.js, /p/node_modules/app-darwin-arm64/package.json";
    let linux =
        "/p/node_modules/app-linux-x64/app.node, /p/node_modules/app-linux-x64/package.json";
    assert_eq!(
        import_pattern(&host, "app-", ""),
        format!("{darwin}, {linux}")
    );
    assert_eq!(import_pattern(&host, "app-linux-", ""), linux);
    assert_eq!(
        import_pattern(&host, "app-", "/app.node"),
        "/p/node_modules/app-linux-x64/app.node"
    );
    assert_eq!(
        import_pattern(&host, "@my/app-", "x64"),
        "/p/node_modules/@my/app-linux-x64/app.node"
    );
    assert_eq!(
        import_pattern(&host, "@m", "/index.js"),
        "/p/node_modules/@my/other/index.js"
    );
    assert_eq!(import_pattern(&host, "absent-", ""), "");
}

#[test]
#[cfg_attr(miri, ignore)]
fn package_without_exports_lists_files() {
    let host = empty_files(&[
        "/p/main.ts",
        "/p/node_modules/pkg/a.js",
        "/p/node_modules/pkg/lib/b.js",
        "/p/node_modules/other/c.js",
    ]);
    let all = "/p/node_modules/pkg/a.js, /p/node_modules/pkg/lib/b.js";
    assert_eq!(import_pattern(&host, "pkg/", ""), all);
    assert_eq!(
        import_pattern(&host, "pkg/lib/", ""),
        "/p/node_modules/pkg/lib/b.js"
    );
    assert_eq!(
        import_pattern(&host, "pkg/", "a.js"),
        "/p/node_modules/pkg/a.js"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn package_with_exports_lists_exported_files_only() {
    let manifest = r#"{
        "name": "pkg",
        "exports": {
            ".": "./index.js", "./a": "./lib/a.js", "./features/*": "./lib/features/*.js",
            "./hidden/*": null, "./internal": null
        }
    }"#;
    let names = [
        "index.js",
        "lib/a.js",
        "lib/features/x.js",
        "lib/features/y.js",
        "lib/secret.js",
        "hidden/z.js",
        "internal.js",
    ];
    let host = installed_package(manifest, &names);
    let features = "/p/node_modules/pkg/lib/features/x.js, /p/node_modules/pkg/lib/features/y.js";
    let all = format!("/p/node_modules/pkg/lib/a.js, {features}, {MANIFEST}");
    assert_eq!(import_pattern(&host, "pkg/", ""), all);
    assert_eq!(import_pattern(&host, "pkg/features/", ""), features);
    assert_eq!(import_pattern(&host, "pkg/hidden/", ""), NO_CANDIDATE);
    assert_eq!(import_pattern(&host, "pkg/lib/", ""), NO_CANDIDATE);
}

#[test]
#[cfg_attr(miri, ignore)]
fn exported_candidates_follow_request_conditions() {
    let manifest = r#"{"exports": {"./c": {"require": "./c.cjs", "import": "./c.mjs"}}}"#;
    let host = installed_package(manifest, &["c.cjs", "c.mjs"]);
    assert_eq!(
        import_pattern(&host, "pkg/c", ""),
        "/p/node_modules/pkg/c.mjs"
    );
    let required = resolve_computed_in(&host, "/p/main.ts", "pkg/c", "", Require);
    assert_eq!(required, "/p/node_modules/pkg/c.cjs");
}

#[test]
#[cfg_attr(miri, ignore)]
fn self_reference_lists_own_exports() {
    let manifest = r#"{"name": "app", "exports": {"./x": "./x.ts"}}"#;
    let files = [
        ("/p/package.json", manifest),
        ("/p/main.ts", ""),
        ("/p/x.ts", ""),
        ("/p/y.ts", ""),
    ];
    let host = MemoryHost::new(&files);
    assert_eq!(
        import_pattern(&host, "app/", ""),
        "/p/package.json, /p/x.ts"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn installed_copies_in_ancestor_directories_are_listed() {
    let host = empty_files(&[
        "/p/src/main.ts",
        "/p/src/node_modules/pkg/a.js",
        "/p/node_modules/pkg/a.js",
        "/p/node_modules/pkg/b.js",
    ]);
    let found = resolve_computed_in(&host, "/p/src/main.ts", "pkg/", "", Import);
    assert_eq!(
        found,
        "/p/node_modules/pkg/b.js, /p/src/node_modules/pkg/a.js"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn files_sort_before_host_modules() {
    let host = empty_files(&["/p/main.ts", "/p/node_modules/pkg/a.js"])
        .module("pkg/second", 9)
        .module("pkg/first", 4);
    let found = import_pattern(&host, "pkg/", "");
    assert_eq!(found, "/p/node_modules/pkg/a.js, host:4, host:9");
}

#[test]
#[cfg_attr(miri, ignore)]
fn paths_and_base_url_add_folders_of_the_project_to_the_installed_package() {
    let configs = [
        r#"{"paths": {"pkg/*": ["./d/*"]}}"#,
        r#"{"paths": {"*": ["./d/unused/*", "./*"]}}"#,
        r#"{"paths": {"*": ["./*"], "@/*": ["./*"], "exact": ["./d/b.ts"]}}"#,
        r#"{"baseUrl": "."}"#,
        r#"{"baseUrl": "./d", "paths": {"other/*": ["./src/*"]}}"#,
    ];
    for config in configs {
        let host = configured_project(config);
        let found = import_pattern(&host, "pkg/", "");
        assert_eq!(found, "/p/node_modules/pkg/a.js", "{config}");
    }

    let through = |written: &str| HostResolution::Path(format!("/p/{written}").into_bytes());
    let catch_all = configured_project(r#"{"paths": {"*": ["./*"]}}"#)
        .claim("d/b.ts", through("d/b.ts"))
        .claim("d/b", through("d/b.ts"));
    assert_eq!(import_pattern(&catch_all, "d/", ""), "/p/d/b.ts");
    let base_url = configured_project(r#"{"baseUrl": "."}"#).claim("d/b", through("d/b.ts"));
    assert_eq!(import_pattern(&base_url, "d/", ""), "/p/d/b.ts");
    let alias =
        configured_project(r#"{"paths": {"@/*": ["./d/*"]}}"#).claim("@/b", through("d/b.ts"));
    assert_eq!(import_pattern(&alias, "@/", ""), "/p/d/b.ts");
    assert_eq!(import_pattern(&alias, "@", ""), "/p/d/b.ts");
    let whole = configured_project(r#"{"paths": {"pkg/exact": ["./d/b.ts"]}}"#)
        .claim("pkg/exact", through("d/b.ts"));
    assert_eq!(
        import_pattern(&whole, "pkg/", ""),
        "/p/d/b.ts, /p/node_modules/pkg/a.js"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn executable_takes_in_no_installed_package_where_the_config_makes_the_name_uncertain() {
    let executable = CodeOptions {
        builds_executable: true,
        ..CodeOptions::bun_run(b"/p")
    };
    let resolve = |host: &MemoryHost, prefix| {
        let pattern = ComputedPattern {
            importer: "/p/main.ts",
            prefix,
            suffix: "",
            kind: Import,
        };
        resolve_computed_with(host, &executable, pattern)
    };
    for config in [r#"{"paths": {"*": ["./*"]}}"#, r#"{"baseUrl": "."}"#] {
        let in_project = HostResolution::Path(b"/p/d/b.ts".to_vec());
        let host = configured_project(config).claim("d/b", in_project);
        assert_eq!(resolve(&host, "pkg/"), "All(ConfigPaths)", "{config}");
        assert_eq!(resolve(&host, "d/"), "/p/d/b.ts", "{config}");
        let in_place = import_pattern(&host, "pkg/", "");
        assert_eq!(in_place, "/p/node_modules/pkg/a.js", "{config}");
    }
    let other_key = configured_project(r#"{"paths": {"other/*": ["./src/*"]}}"#);
    assert_eq!(resolve(&other_key, "pkg/"), "/p/node_modules/pkg/a.js");
    let no_config = empty_files(&["/p/main.ts", "/p/node_modules/pkg/a.js"]);
    assert_eq!(resolve(&no_config, "pkg/"), "/p/node_modules/pkg/a.js");
}

#[test]
#[cfg_attr(miri, ignore)]
fn inherited_paths_start_from_the_config_that_writes_them() {
    let host = MemoryHost::new(&[
        ("/p/tsconfig.json", r#"{"extends": "./config/base.json"}"#),
        (
            "/p/config/base.json",
            r#"{"compilerOptions": {"paths": {"lib/*": ["./x/*"]}}}"#,
        ),
        ("/p/config/x/c.ts", ""),
        ("/p/x/wrong.ts", ""),
    ])
    .claim("lib/c", HostResolution::Path(b"/p/config/x/c.ts".to_vec()))
    .claim("lib/wrong", HostResolution::Path(b"/p/x/wrong.ts".to_vec()));
    assert_eq!(import_pattern(&host, "lib/", ""), "/p/config/x/c.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn paths_that_name_no_folder_or_have_another_form_make_the_prefix_unknown() {
    let cases = [
        (r#"{"paths": {"@/*": ["./*"]}}"#, "@/"),
        (r#"{"paths": {"@/*": ["../*"]}}"#, "@/"),
        (r#"{"paths": {"*": ["./*"]}}"#, "pk"),
        (r#"{"baseUrl": "."}"#, "pk"),
        (r#"{"baseUrl": "./d"}"#, "pk"),
        (r#"{"paths": {"pkg/*": ["./packages/*/src"]}}"#, "pkg/"),
        (r#"{"paths": {"pkg/*": ["./d/pre-*"]}}"#, "pkg/"),
        (r#"{"paths": {"pkg/*": ["./d/b.ts"]}}"#, "pkg/"),
        (r#"{"paths": {"pkg/*.js": ["./d/*"]}}"#, "pkg/"),
    ];
    for (config, prefix) in cases {
        let host = configured_project(config);
        let found = import_pattern(&host, prefix, "");
        assert_eq!(found, "All(ConfigPaths)", "{config} {prefix}");
    }

    let other_key = configured_project(r#"{"paths": {"other/*": ["./src/*"]}}"#);
    assert_eq!(
        import_pattern(&other_key, "pkg/", ""),
        "/p/node_modules/pkg/a.js"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn paths_apply_to_absolute_prefix_and_not_to_relative_prefix() {
    let host = configured_project(r#"{"paths": {"/virtual/*": ["./src/*"], "*": ["./src/*"]}}"#);
    assert_eq!(import_pattern(&host, "/virtual/", ""), "All(ConfigPaths)");
    assert_eq!(import_pattern(&host, "./d/", ""), "/p/d/b.ts");

    let other_key = configured_project(r#"{"paths": {"pkg/*": ["./src/*"]}}"#);
    assert_eq!(import_pattern(&other_key, "/virtual/", ""), "/virtual/c.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn uncompiled_candidate_makes_answer_unknown() {
    let files = ["/p/main.ts", "/p/plugins/a.ts", "/p/plugins/b.ts"];
    let uncompiled = external("./plugins/b.ts", ExternalKind::UncompiledCode);
    let host = empty_files(&files).claim("./plugins/b.ts", uncompiled);
    assert_eq!(
        import_pattern(&host, "./plugins/", ""),
        "All(ExternalCandidate)"
    );
    assert_eq!(import_pattern(&host, "./plugins/a", ""), "/p/plugins/a.ts");

    let host_value = external("./plugins/b.ts", ExternalKind::HostValue);
    let host = empty_files(&files).claim("./plugins/b.ts", host_value);
    assert_eq!(
        import_pattern(&host, "./plugins/", ".ts"),
        "/p/plugins/a.ts"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn uncompiled_host_module_makes_answer_unknown() {
    let uncompiled = external("node:omitted", ExternalKind::UncompiledCode);
    let host = empty_files(&["/p/main.ts"])
        .module("node:fs", 3)
        .runtime_module("node:omitted", uncompiled);
    assert_eq!(
        import_pattern(&host, "node:", ""),
        "All(ExternalCandidate), host:3"
    );
    assert_eq!(import_pattern(&host, "node:f", ""), "host:3");

    let host_value = external("node:omitted", ExternalKind::HostValue);
    let host = empty_files(&["/p/main.ts"])
        .module("node:fs", 3)
        .runtime_module("node:omitted", host_value);
    assert_eq!(import_pattern(&host, "node:", ""), "host:3");
}

#[test]
#[cfg_attr(miri, ignore)]
fn path_that_leads_out_of_the_package_of_the_importer_is_a_name_made_at_run_time() {
    let host = MemoryHost::new(&[
        ("/w/package.json", r#"{ "name": "workspace" }"#),
        ("/w/beside.ts", ""),
        ("/w/app/package.json", r#"{ "name": "app" }"#),
        ("/w/app/top.ts", ""),
        ("/w/app/src/main.ts", ""),
        ("/w/app/src/a.ts", ""),
    ]);
    let from_main = |prefix| resolve_computed_in(&host, "/w/app/src/main.ts", prefix, "", Import);
    assert_eq!(from_main("./"), "/w/app/src/a.ts, /w/app/src/main.ts");
    assert_eq!(
        from_main("../"),
        "/w/app/package.json, /w/app/src/a.ts, /w/app/src/main.ts, /w/app/top.ts"
    );
    assert_eq!(from_main("../../"), "All(NoConstantPrefix)");
    assert_eq!(from_main("/"), "All(NoConstantPrefix)");
    // A folder that is named is meant, wherever it lies. The walk stays out of the package below it.
    assert_eq!(from_main("/w/"), "/w/beside.ts, /w/package.json");
    assert_eq!(
        from_main("../../app/src/"),
        "/w/app/src/a.ts, /w/app/src/main.ts"
    );
    assert_eq!(
        from_main("/w/app/src/"),
        "/w/app/src/a.ts, /w/app/src/main.ts"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn walk_from_a_path_stays_out_of_the_folders_of_other_packages() {
    let host = MemoryHost::new(&[
        ("/p/package.json", r#"{ "name": "app" }"#),
        ("/p/main.ts", ""),
        ("/p/d/a.ts", ""),
        ("/p/d/esm/package.json", r#"{ "type": "module" }"#),
        ("/p/d/esm/b.ts", ""),
        ("/p/d/other/package.json", r#"{ "name": "other" }"#),
        ("/p/d/other/c.ts", ""),
    ]);
    assert_eq!(
        import_pattern(&host, "./d/", ".ts"),
        "/p/d/a.ts, /p/d/esm/b.ts"
    );
    // The prefix lies inside it already.
    assert_eq!(
        import_pattern(&host, "./d/other/", ".ts"),
        "/p/d/other/c.ts"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn every_file_and_folder_that_matches_is_a_candidate_however_many() {
    let names: Vec<String> = (0..3000)
        .map(|n| format!("/p/d/x{}/f{n}.ts", n % 1500))
        .collect();
    let mut paths = vec!["/p/main.ts"];
    paths.extend(names.iter().map(String::as_str));
    let found = import_pattern(&empty_files(&paths), "./d/", "");
    assert_eq!(found.split(", ").count(), 3000);
}

#[test]
#[cfg_attr(miri, ignore)]
fn linked_directory_is_listed_under_real_paths() {
    let files = ["/p/main.ts", "/store/lang/en.json"];
    let host = empty_files(&files).link("/p/locales", "/store/lang");
    assert_eq!(
        import_pattern(&host, "./locales/", ".json"),
        "/store/lang/en.json"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn link_cycle_ends() {
    let host = empty_files(&["/p/main.ts", "/p/d/a.ts"]).link("/p/d/loop", "/p/d");
    assert_eq!(import_pattern(&host, "./d/", ""), "/p/d/a.ts");
}
