use super::CodeImportKind::{EntryPoint, Require};
use super::*;
use crate::hir::{ExportId, ExprId, ImportEqualsId, ImportId, StmtId};
use crate::module_format::DeclaredModuleType::{CommonJs, Esm, Unknown};
use crate::resolve::code::memory_host::{format_resolution, resolve_in};
use crate::resolve::code::search::{
    is_directory_specifier, join_unrooted, preserve_trailing_slash,
};

const MODULE_NOT_FOUND: &str = "NotFound(ModuleNotFound)";
const PACKAGE_NOT_FOUND: &str = "NotFound(PackageNotFound)";
const BUILTIN_NOT_FOUND: &str = "NotFound(BuiltinModuleNotFound)";
const NOT_EXPORTED: &str = "NotFound(PackagePathNotExported)";

fn linked_files() -> MemoryHost {
    empty_files(&["/p/a.ts", "/store/pkg/index.js", "/store/real.js"])
        .link("/p/node_modules/pkg", "/store/pkg")
        .link("/p/linked.js", "/store/real.js")
}

fn import(host: &MemoryHost, specifier: &str) -> String {
    resolve_in(host, &bun_run(), "/p/main.ts", specifier, Import)
}

fn entry_point(host: &MemoryHost, specifier: &str) -> String {
    resolve_in(host, &bun_run(), "", specifier, EntryPoint)
}

fn external(specifier: &str, kind: ExternalKind) -> HostResolution {
    HostResolution::External {
        specifier: specifier.into(),
        kind,
    }
}

fn external_kind(host: &MemoryHost, request: &CodeRequest<'_>) -> (String, ExternalKind) {
    with_resolver(host, &bun_run(), |resolver| {
        match resolver.resolve_code(request) {
            CodeResolution::External { specifier, kind } => (text(specifier), kind),
            answer => panic!("{request:?} answers {answer:?}"),
        }
    })
}

fn import_from_each(host: &MemoryHost, importers: [&str; 2], specifier: &str) -> [String; 2] {
    with_resolver(host, &bun_run(), |resolver| {
        importers.map(|importer| {
            format_resolution(resolver.resolve_code(&import_request(importer, specifier)))
        })
    })
}

fn resolve_types(resolver: &Resolver<'_>) {
    resolver.resolve_module_name(b"pkg", b"/p/main.ts", ResolutionMode::Import);
}

#[test]
fn host_claim_wins_over_node_modules() {
    let installed = "/p/node_modules/fs/index.js";
    let claiming = empty_files(&[installed]).module("fs", 3);
    assert_eq!(import(&claiming, "fs"), "HostModule(HostModuleId(3))");
    assert_eq!(import(&empty_files(&[installed]), "fs"), installed);
}

#[test]
fn claimed_path_is_not_searched() {
    let host = linked_files()
        .claim("linked", HostResolution::Path(b"/p/linked.js".to_vec()))
        .claim("missing", HostResolution::Path(b"/virtual/a".to_vec()));
    with_resolver(&host, &bun_run(), |resolver| {
        let find = |specifier| find_file(resolver, &import_request("/p/main.ts", specifier));
        let claimed = find("linked");
        assert_eq!(text(claimed.path), "/p/linked.js");
        assert_eq!(claimed.host_module, None);
        assert_eq!(text(find("missing").path), "/virtual/a");
        assert_eq!(text(find("./linked.js").path), "/store/real.js");
    });
}

#[test]
fn claimed_module_source_records_host_module() {
    let source = HostResolution::ModuleSource {
        module: HostModuleId(5),
        path: b"/bun/fs.ts".to_vec(),
    };
    let host = empty_files(&["/p/a.ts", "/bun/package.json"]).claim("node:fs", source);
    with_resolver(&host, &bun_run(), |resolver| {
        let found = find_file(resolver, &import_request("/p/main.ts", "node:fs"));
        assert_eq!(text(found.path), "/bun/fs.ts");
        assert_eq!(found.host_module, Some(HostModuleId(5)));
        let searched = find_file(resolver, &import_request("/p/main.ts", "./a.ts"));
        assert_eq!(searched.host_module, None);
    });
    assert_eq!(host.reads("/bun/package.json"), 0);
}

#[test]
fn external_and_erased_claims_pass_through() {
    let host = empty_files(&["/p/a.ts", "/p/b.ts"])
        .claim("./a.ts", external("renamed", ExternalKind::UncompiledCode))
        .claim("./b.ts", HostResolution::Erased);
    assert_eq!(import(&host, "./a.ts"), "External(renamed)");
    assert_eq!(import(&host, "./b.ts"), "Erased");
    assert_eq!(import(&host, "./a"), "/p/a.ts");
}

#[test]
fn claimed_external_kind_is_unchanged() {
    let host = empty_files(&[])
        .claim("react", external("react", ExternalKind::UncompiledCode))
        .claim(
            "./addon.node",
            external("/p/addon.node", ExternalKind::HostValue),
        );
    let kind_of = |specifier| external_kind(&host, &import_request("/p/main.ts", specifier));
    let uncompiled = ("react".to_owned(), ExternalKind::UncompiledCode);
    assert_eq!(kind_of("react"), uncompiled);
    let host_value = ("/p/addon.node".to_owned(), ExternalKind::HostValue);
    assert_eq!(kind_of("./addon.node"), host_value);
}

#[test]
fn external_kind_of_imports_target_is_unchanged() {
    let manifest = (
        "/p/package.json",
        r##"{"imports": {"#omitted": "node:omitted"}}"##,
    );
    let omitted = external("node:omitted", ExternalKind::HostValue);
    let host = MemoryHost::new(&[manifest]).runtime_module("node:omitted", omitted);
    let found = external_kind(&host, &import_request("/p/main.ts", "#omitted"));
    assert_eq!(found, ("node:omitted".to_owned(), ExternalKind::HostValue));
}

#[test]
fn host_is_asked_for_every_request() {
    let installed = "/p/node_modules/dep/index.js";
    let module = HostResolution::Module(HostModuleId(7));
    let host = empty_files(&[installed]).claim_from("/p/a.ts", "dep", module);
    let claimed = "HostModule(HostModuleId(7))";
    let answers = import_from_each(&host, ["/p/a.ts", "/p/b.ts"], "dep");
    assert_eq!(answers, [claimed, installed]);
    let answers = import_from_each(&host, ["/p/b.ts", "/p/a.ts"], "dep");
    assert_eq!(answers, [installed, claimed]);
}

#[test]
fn stored_answer_does_not_depend_on_importer() {
    let installed = "/p/node_modules/dep/index.js";
    let files = [
        ("/p/package.json", r##"{"imports": {"#dep": "dep"}}"##),
        (installed, ""),
    ];
    let module = HostResolution::Module(HostModuleId(7));
    let by_importer = MemoryHost::new(&files).claim_from("/p/a.ts", "dep", module);
    for importers in [["/p/a.ts", "/p/b.ts"], ["/p/b.ts", "/p/a.ts"]] {
        let answers = import_from_each(&by_importer, importers, "#dep");
        assert_eq!(answers, [installed, installed], "{importers:?}");
    }

    let for_everyone = MemoryHost::new(&files).module("dep", 7);
    let answers = import_from_each(&for_everyone, ["/p/a.ts", "/p/b.ts"], "#dep");
    assert_eq!(answers, ["HostModule(HostModuleId(7))"; 2]);
}

#[test]
fn urls_are_external_for_imports() {
    let host = empty_files(&["/p/a.ts"]);
    for url in ["http://x", "https://x", "//x", "data:,x", "data:,x?y"] {
        assert_eq!(import(&host, url), format!("External({url})"));
    }
    assert_eq!(entry_point(&host, "data:,x"), "External(data:,x)");
    assert_eq!(entry_point(&host, "http://x"), MODULE_NOT_FOUND);
}

#[test]
fn urls_are_uncompiled_code() {
    let host = empty_files(&["/p/a.ts"]);
    for url in ["http://x", "https://x", "//x", "data:,x"] {
        let found = external_kind(&host, &import_request("/p/main.ts", url));
        assert_eq!(found, (url.to_owned(), ExternalKind::UncompiledCode));
        let required = CodeRequest {
            kind: Require,
            ..import_request("/p/main.ts", url)
        };
        let found = external_kind(&host, &required);
        assert_eq!(found, (url.to_owned(), ExternalKind::UncompiledCode));
    }
}

#[test]
fn query_string_is_not_supported() {
    let host = empty_files(&["/p/a.ts", "/p/b?x.ts"]);
    assert_eq!(import(&host, "./a.ts?x"), "NotFound(QueryString)");
    assert_eq!(import(&host, "./a.ts"), "/p/a.ts");
    assert_eq!(entry_point(&host, "b?x.ts"), "/p/b?x.ts");
}

#[test]
fn empty_and_nul_specifiers_find_nothing() {
    let host = empty_files(&["/p/a.ts", "/p/index.ts"]);
    assert_eq!(import(&host, ""), MODULE_NOT_FOUND);
    assert_eq!(import(&host, "./a.ts\0"), MODULE_NOT_FOUND);
    assert_eq!(import(&host, "./"), "/p/index.ts");
}

#[test]
fn empty_specifier_is_not_offered_to_host() {
    let host = empty_files(&["/p/a.ts"]).claim("", HostResolution::Erased);
    assert_eq!(import(&host, ""), MODULE_NOT_FOUND);
}

#[test]
fn dot_names_importer_directory() {
    let host = empty_files(&["/p/b.ts", "/p/b/index.ts"]);
    let import = |specifier| resolve_in(&host, &bun_run(), "/p/b/x.ts", specifier, Import);
    assert_eq!(import("."), "/p/b/index.ts");
    assert_eq!(import("../b"), "/p/b.ts");
}

#[test]
fn bare_entry_point_is_package_then_relative() {
    let host = empty_files(&["/p/index.ts", "/p/util.ts", INSTALLED]);
    assert_eq!(entry_point(&host, "pkg"), INSTALLED);
    assert_eq!(entry_point(&host, "util"), "/p/util.ts");
    assert_eq!(entry_point(&host, "index.ts"), "/p/index.ts");
    assert_eq!(entry_point(&host, "missing"), MODULE_NOT_FOUND);
    assert_eq!(import(&host, "pkg"), INSTALLED);
    assert_eq!(import(&host, "util"), PACKAGE_NOT_FOUND);
    assert_eq!(import(&host, "index.ts"), PACKAGE_NOT_FOUND);

    let both = empty_files(&["/p/pkg.ts", INSTALLED]);
    assert_eq!(entry_point(&both, "pkg"), INSTALLED);
    assert_eq!(entry_point(&both, "./pkg"), "/p/pkg.ts");
}

#[test]
fn entry_point_without_relative_file_keeps_package_answer() {
    let imports = ("/p/package.json", r##"{"imports": {"#fs": "node:fs"}}"##);
    let claimed = MemoryHost::new(&[imports]).module("node:fs", 7);
    assert_eq!(entry_point(&claimed, "#fs"), "HostModule(HostModuleId(7))");
    let with_file = MemoryHost::new(&[imports, ("/p/#fs.ts", "")]).module("node:fs", 7);
    assert_eq!(entry_point(&with_file, "#fs"), "/p/#fs.ts");

    let installed = [
        (MANIFEST, r#"{"exports": {".": "./index.js"}}"#),
        (INSTALLED, ""),
        ("/p/node_modules/pkg/lib.js", ""),
    ];
    let hidden = MemoryHost::new(&installed);
    assert_eq!(entry_point(&hidden, "pkg/lib.js"), NOT_EXPORTED);
    let local = [("/p/pkg/lib.js", "")];
    let with_file = MemoryHost::new(&[&installed[..], &local[..]].concat());
    assert_eq!(entry_point(&with_file, "pkg/lib.js"), "/p/pkg/lib.js");
}

#[test]
fn failure_follows_specifier_form() {
    let host = empty_files(&["/p/a.ts"]);
    assert_eq!(import(&host, "node:nope"), BUILTIN_NOT_FOUND);
    assert_eq!(import(&host, "nope"), PACKAGE_NOT_FOUND);
    assert_eq!(import(&host, "@s/nope"), MODULE_NOT_FOUND);
    assert_eq!(import(&host, "./nope"), MODULE_NOT_FOUND);
    assert_eq!(entry_point(&host, "node:nope"), BUILTIN_NOT_FOUND);
}

#[test]
fn only_module_not_found_follows_specifier_form() {
    let manifest = r#"{"exports": {"./a": "./a.js"}}"#;
    let files = [(MANIFEST, manifest), ("/p/node_modules/pkg/a.js", "")];
    let host = MemoryHost::new(&files);
    assert_eq!(import(&host, "pkg"), NOT_EXPORTED);
    assert_eq!(import(&host, "pkg/a"), "/p/node_modules/pkg/a.js");
}

#[test]
fn symlinks_resolve_to_real_paths() {
    let host = linked_files();
    assert_eq!(import(&host, "pkg"), "/store/pkg/index.js");
    assert_eq!(import(&host, "./linked.js"), "/store/real.js");
    assert_eq!(import(&host, "./a.ts"), "/p/a.ts");
}

#[test]
fn preserved_symlinks_keep_directory_links_only() {
    let host = linked_files();
    let options = CodeOptions {
        preserves_symlinks: true,
        ..bun_run()
    };
    let import = |specifier| resolve_in(&host, &options, "/p/main.ts", specifier, Import);
    assert_eq!(import("pkg"), INSTALLED);
    assert_eq!(import("./linked.js"), "/store/real.js");
    assert_eq!(import("./a.ts"), "/p/a.ts");
}

#[test]
fn module_type_follows_extension_and_package() {
    let host = MemoryHost::new(&[
        ("/p/package.json", r#"{"name": "p", "type": "module"}"#),
        ("/p/a.js", ""),
        ("/p/b.cjs", ""),
        ("/p/c.tsx", ""),
        ("/q/a.js", ""),
        ("/q/b.mts", ""),
    ]);
    with_resolver(&host, &bun_run(), |resolver| {
        let module_type = |path: &str| {
            let path = path.as_bytes();
            let declared = resolver.declared_module_type(path);
            (declared, resolver.is_package_type_module(path))
        };
        assert_eq!(module_type("/p/a.js"), (Esm, true));
        assert_eq!(module_type("/p/b.cjs"), (CommonJs, true));
        assert_eq!(module_type("/p/c.tsx"), (Unknown, true));
        assert_eq!(module_type("/q/a.js"), (Unknown, false));
        assert_eq!(module_type("/q/b.mts"), (Esm, false));
    });
}

#[test]
fn relative_path_has_no_package_module_type() {
    let manifest = ("/package.json", r#"{"name": "root", "type": "module"}"#);
    let host = MemoryHost::new(&[manifest, ("/p/a.js", "")]);
    with_resolver(&host, &bun_run(), |resolver| {
        assert_eq!(resolver.declared_module_type(b"/p/a.js"), Esm);
        assert_eq!(resolver.declared_module_type(b"p/a.js"), Unknown);
        assert_eq!(resolver.declared_module_type(b"/a.js"), Unknown);
        assert_eq!(resolver.declared_module_type(b"a.js"), Unknown);
        assert_eq!(resolver.declared_module_type(b"a.cjs"), CommonJs);
    });
}

#[test]
fn loader_request_has_settings_and_module_type() {
    let config = r#"{"compilerOptions": {"jsxImportSource": "preact"}}"#;
    let host = MemoryHost::new(&[
        ("/p/package.json", r#"{"name": "p", "type": "module"}"#),
        ("/p/tsconfig.json", config),
        ("/p/a.js", ""),
    ]);
    with_resolver(&host, &bun_run(), |resolver| {
        let request = resolver.loader_request(b"/p/a.js", Import, None, None);
        assert_eq!(request.path, b"/p/a.js");
        assert_eq!(request.declared_module_type, Esm);
        assert_eq!(request.settings.jsx.import_source, b"preact");

        let outside = resolver.loader_request(b"/q/a.js", Import, None, None);
        assert_eq!(outside.declared_module_type, Unknown);
        assert_eq!(outside.settings.jsx.import_source, b"react");
    });
}

#[test]
fn loader_request_passes_kind_and_attributes() {
    let host = empty_files(&["/p/a.js"]);
    with_resolver(&host, &bun_run(), |resolver| {
        let plain = resolver.loader_request(b"/p/a.js", EntryPoint, None, None);
        assert_eq!(plain.kind, EntryPoint);
        assert_eq!((plain.type_attribute, plain.embed_attribute), (None, None));

        let (sqlite, embed): (&[u8], &[u8]) = (b"sqlite", b"true");
        let typed = resolver.loader_request(b"/p/a.js", Require, Some(sqlite), None);
        assert_eq!(typed.kind, Require);
        assert_eq!(
            (typed.type_attribute, typed.embed_attribute),
            (Some(sqlite), None)
        );

        let embedded = resolver.loader_request(b"/p/a.js", Import, Some(sqlite), Some(embed));
        assert_eq!(embedded.kind, Import);
        let attributes = (embedded.type_attribute, embedded.embed_attribute);
        assert_eq!(attributes, (Some(sqlite), Some(embed)));
    });
}

#[test]
fn absolute_specifier_tries_paths_first() {
    let sources = [("/p/src/a.ts", ""), ("/virtual/a.ts", "")];
    let paths = r#"{"compilerOptions": {"paths": {"/virtual/*": ["./src/*"]}}}"#;
    let config = [("/p/tsconfig.json", paths)];
    let configured = MemoryHost::new(&[&sources[..], &config[..]].concat());
    let plain = MemoryHost::new(&sources);
    assert_eq!(import(&configured, "/virtual/a"), "/p/src/a.ts");
    assert_eq!(import(&plain, "/virtual/a"), "/virtual/a.ts");
    assert_eq!(import(&plain, "/virtual/b"), MODULE_NOT_FOUND);
}

#[test]
fn paths_substitution_preserves_trailing_slash() {
    let paths = r#"{"@/*": ["./src/*"], "rooted/*": ["/p/src/*"]}"#;
    let config = format!(r#"{{"compilerOptions": {{"paths": {paths}}}}}"#);
    let host = MemoryHost::new(&[
        ("/p/tsconfig.json", config.as_str()),
        ("/p/src/lib.ts", ""),
        ("/p/src/lib/index.ts", ""),
    ]);
    for file in ["@/lib", "rooted/lib"] {
        assert_eq!(import(&host, file), "/p/src/lib.ts", "{file}");
    }
    for directory in ["@/lib/", "rooted/lib/"] {
        assert_eq!(
            import(&host, directory),
            "/p/src/lib/index.ts",
            "{directory}"
        );
    }
}

#[test]
fn rooted_exact_substitution_is_loaded_as_written() {
    let paths = r#"{"exact": ["/lib/."], "pattern/*": ["/lib/*"]}"#;
    let config = format!(r#"{{"compilerOptions": {{"paths": {paths}}}}}"#);
    let file = [("/p/tsconfig.json", config.as_str()), ("/lib.ts", "")];
    let directory = [("/lib/index.ts", "")];
    let host = MemoryHost::new(&[&file[..], &directory[..]].concat());
    assert_eq!(import(&host, "exact"), "/lib/index.ts");
    assert_eq!(import(&host, "pattern/."), "/lib.ts");

    let empty_directory = [("/lib/other.txt", "")];
    let host = MemoryHost::new(&[&file[..], &empty_directory[..]].concat());
    assert_eq!(import(&host, "exact"), PACKAGE_NOT_FOUND);
    assert_eq!(import(&host, "pattern/."), "/lib.ts");
}

#[test]
fn absolute_specifier_is_normalized() {
    let host = empty_files(&["/p/src.ts", "/p/src/index.ts"]);
    assert_eq!(import(&host, "/p/x/../src"), "/p/src.ts");
    assert_eq!(import(&host, "/p/src/x/.."), "/p/src/index.ts");
    assert_eq!(import(&host, "/p/src/"), "/p/src/index.ts");
}

#[test]
fn directory_defaults_to_working_directory() {
    let host = empty_files(&["/p/a.ts"]);
    let finds_file = |directory: &str| {
        let request = CodeRequest {
            directory: directory.as_bytes(),
            ..import_request("", "./a.ts")
        };
        with_resolver(&host, &bun_run(), |resolver| {
            matches!(resolver.resolve_code(&request), CodeResolution::File(_))
        })
    };
    assert!(finds_file(""));
    assert!(finds_file("plugin"));
    assert!(finds_file("/p/"));
    assert!(!finds_file("/q"));
}

#[test]
fn repeated_request_returns_stored_answer() {
    let host = empty_files(&["/p/a.ts"]);
    with_resolver(&host, &bun_run(), |resolver| {
        let stored_path = |kind| {
            let request = CodeRequest {
                kind,
                ..import_request("/p/main.ts", "./a.ts")
            };
            find_file(resolver, &request).path.as_ptr()
        };
        assert_eq!(stored_path(Import), stored_path(Import));
        assert_ne!(stored_path(Import), stored_path(Require));
    });
}

#[test]
fn manifest_text_is_read_once() {
    let files = [(MANIFEST, r#"{"name": "pkg"}"#), (INSTALLED, "")];
    let host = MemoryHost::new(&files);
    with_resolver(&host, &bun_run(), |resolver| {
        resolve_types(resolver);
        resolver.resolve_code(&import_request("/p/main.ts", "pkg"));
    });
    assert_eq!(host.reads(MANIFEST), 1);

    let host = MemoryHost::new(&files);
    let (session, type_options) = (Session::new(), Options::default());
    resolve_types(&Resolver::new(&session, &host, &type_options));
    resolve_types(&Resolver::new(&session, &host, &type_options));
    assert_eq!(host.reads(MANIFEST), 2);
}

#[test]
fn project_resolver_shares_manifest_text() {
    let manifest = "/p/lib/node_modules/pkg/package.json";
    let installed = "/p/lib/node_modules/pkg/index.js";
    let host = MemoryHost::new(&[(manifest, r#"{"name": "pkg"}"#), (installed, "")]);
    let lib = Options {
        config_path: b"/p/lib/tsconfig.json".to_vec(),
        ..Options::default()
    };
    let (session, app, code_options) = (Session::new(), Options::default(), bun_run());
    let program = Resolver::for_compile(&session, &host, &app, &code_options);
    let resolvers = ProjectResolvers::new();
    let of_lib = resolvers.resolver_for(&program, &lib);
    of_lib.resolve_module_name(b"pkg", b"/p/lib/y.ts", ResolutionMode::Import);
    assert_eq!(host.reads(manifest), 1);
    let answer = program.resolve_code(&import_request("/p/lib/y.ts", "pkg"));
    assert_eq!(format_resolution(answer), installed);
    assert_eq!(host.reads(manifest), 1);
}

#[test]
#[should_panic(expected = "for_compile")]
fn resolve_code_requires_for_compile() {
    let host = empty_files(&["/p/a.ts"]);
    let (session, type_options) = (Session::new(), Options::default());
    let resolver = Resolver::new(&session, &host, &type_options);
    resolver.resolve_code(&import_request("/p/main.ts", "./a.ts"));
}

#[test]
fn typescript_file_names_end_in_typescript_extensions() {
    for path in [
        "/p/a.ts",
        "/p/a.tsx",
        "/p/a.mts",
        "/p/a.cts",
        "/p/a.d.ts",
        "/p/A.TS",
    ] {
        assert!(is_typescript_file_name(path.as_bytes()), "{path}");
    }
    for path in [
        "/p/a.js",
        "/p/a.jsx",
        "/p/a.mjs",
        "/p/a.json",
        "/p/ts",
        "/p/a.ts.txt",
    ] {
        assert!(!is_typescript_file_name(path.as_bytes()), "{path}");
    }
}

#[test]
fn directory_specifier_needs_separator_or_dots() {
    for specifier in [".", "..", "./", "a/", "a\\", "a/.", "a/..", "../.."] {
        assert!(is_directory_specifier(specifier.as_bytes()), "{specifier}");
    }
    for specifier in ["", "a", "a.", "a..", "...", ".a", "./a", "a/.b"] {
        assert!(!is_directory_specifier(specifier.as_bytes()), "{specifier}");
    }
}

#[test]
fn join_unrooted_never_replaces_base() {
    assert_eq!(join_unrooted(b"/p", b"c:/x"), b"/p/c:/x");
    assert_eq!(join_unrooted(b"/p", b"/x"), b"/p/x");
    assert_eq!(join_unrooted(b"/p", b"a/../b"), b"/p/b");
    assert_eq!(join(b"/p", b"c:/x"), b"/c:/x");
}

#[test]
fn join_unrooted_preserves_only_written_slash() {
    assert_eq!(join_unrooted(b"/p", b"a/"), b"/p/a/");
    assert_eq!(join_unrooted(b"/p", b"a//"), b"/p/a/");
    for rest in ["a", "a/.", "a/b/..", "a\\"] {
        assert_eq!(join_unrooted(b"/p", rest.as_bytes()), b"/p/a", "{rest}");
    }
    assert_eq!(join_unrooted(b"/p", b""), b"/p");
    assert_eq!(preserve_trailing_slash(b"/".to_vec(), b"./"), b"/");
}

#[test]
fn first_of_repeated_json_keys_is_read() {
    let entries = vec![
        (b"a".to_vec(), Json::Number(1.0)),
        (b"b".to_vec(), Json::Null),
        (b"a".to_vec(), Json::Number(2.0)),
    ];
    let object = Json::Object(entries);
    assert_eq!(get_first(&object, b"a"), Some(&Json::Number(1.0)));
    assert_eq!(get_first(&object, b"b"), Some(&Json::Null));
    assert_eq!(get_first(&object, b"c"), None);
    assert_eq!(get_first(&Json::Array(Vec::new()), b"a"), None);
}

#[test]
fn from_site_maps_every_kind() {
    let imports = [
        ImportSiteKind::JsxRuntime,
        ImportSiteKind::JsxPackage,
        ImportSiteKind::Import(ImportId(0)),
        ImportSiteKind::ExportFrom(ExportId(0)),
        ImportSiteKind::ExportStar(StmtId(0)),
        ImportSiteKind::ImportCall(ExprId(0)),
        ImportSiteKind::ImportMetaResolve(ExprId(0)),
    ];
    let requires = [
        ImportSiteKind::ImportEquals(ImportEqualsId(0)),
        ImportSiteKind::Require(ExprId(0)),
        ImportSiteKind::RequireResolve(ExprId(0)),
        ImportSiteKind::ImportMetaRequire(ExprId(0)),
        ImportSiteKind::GetBuiltinModule(ExprId(0)),
    ];
    for kind in imports {
        assert_eq!(CodeImportKind::from_site(kind), Import, "{kind:?}");
    }
    for kind in requires {
        assert_eq!(CodeImportKind::from_site(kind), Require, "{kind:?}");
    }
}
