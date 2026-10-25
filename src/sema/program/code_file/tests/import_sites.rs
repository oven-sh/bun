use super::*;
use crate::import_sites::ImportSiteKind;
use crate::program::code_test_host::{NATIVE_ADDON_LOADER, RecordedLoaderRequest, TEXT_LOADER};
use crate::resolve::{
    CodeFailure, CodeFile, ComputedCandidate, ComputedResolution, ComputedSpelling,
    ComputedUnknown, ExternalKind, SiteResolution,
};

const ERASED: SiteResolution<'static> = SiteResolution::Constant(CodeResolution::Erased);

#[derive(PartialEq, Eq, Debug)]
struct Target {
    path: String,
    loader: HostLoader,
    host_module: Option<HostModuleId>,
    increases_depth: bool,
}

fn target(path: &str) -> Target {
    Target {
        path: path.to_owned(),
        loader: HostLoader::default(),
        host_module: None,
        increases_depth: false,
    }
}

fn targets_of(parsed: &ParsedCodeFile<'_, '_>) -> Vec<Target> {
    let text = |path: &[u8]| path.as_bstr().to_string();
    let targets = parsed.code.targets.iter();
    let targets = targets.map(|target| Target {
        path: text(target.key.path),
        loader: target.key.loader,
        host_module: target.host_module,
        increases_depth: target.increases_depth,
    });
    targets.collect()
}

const fn code_file(path: &'static str) -> CodeFile<'static> {
    CodeFile {
        path: path.as_bytes(),
        host_module: None,
    }
}

const fn file(path: &'static str) -> SiteResolution<'static> {
    SiteResolution::Constant(CodeResolution::File(code_file(path)))
}

const fn host_module(id: u32) -> SiteResolution<'static> {
    SiteResolution::Constant(CodeResolution::HostModule(HostModuleId(id)))
}

fn node_modules() -> Vec<(&'static str, HostResolution)> {
    vec![
        ("node:fs", HostResolution::Module(HostModuleId(3))),
        ("node:path", HostResolution::Module(HostModuleId(5))),
    ]
}

fn loader_request(path: &str, kind: CodeImportKind) -> RecordedLoaderRequest {
    RecordedLoaderRequest {
        path: path.into(),
        kind,
        type_attribute: None,
        embed_attribute: None,
    }
}

#[test]
fn constant_sites_are_answered_in_site_order() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        ..host_of(&[
            (
                "/p/a.ts",
                "import \"./b\"\nimport \"pkg\"\nimport \"./missing\"\nimport \"node:fs\"",
            ),
            ("/p/b.ts", ""),
            ("/p/node_modules/pkg/index.js", ""),
        ])
    };
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.ts");
        let not_found = CodeResolution::NotFound(CodeFailure::ModuleNotFound);
        let expected = [
            file("/p/b.ts"),
            file("/p/node_modules/pkg/index.js"),
            SiteResolution::Constant(not_found),
            host_module(3),
        ];
        assert_eq!(parsed.code.resolutions, expected);
        let package_file = Target {
            increases_depth: true,
            ..target("/p/node_modules/pkg/index.js")
        };
        assert_eq!(targets_of(&parsed), [target("/p/b.ts"), package_file]);
    });
}

#[test]
fn jsx_runtime_is_followed_like_import() {
    let host = host_of(&[
        ("/p/a.tsx", "<Tag />\nimport \"./b\""),
        ("/p/b.ts", ""),
        ("/p/node_modules/react/jsx-dev-runtime.js", ""),
    ]);
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.tsx");
        let sites = parsed.code.analyzed.analysis.import_sites;
        let kinds: Vec<ImportSiteKind> = sites.iter().map(|site| site.kind).collect();
        assert_eq!(
            kinds,
            [
                ImportSiteKind::JsxRuntime,
                ImportSiteKind::Import(ImportId(0))
            ]
        );
        let runtime = "/p/node_modules/react/jsx-dev-runtime.js";
        assert_eq!(parsed.code.resolutions, [file(runtime), file("/p/b.ts")]);
        let runtime = Target {
            increases_depth: true,
            ..target(runtime)
        };
        assert_eq!(targets_of(&parsed), [runtime, target("/p/b.ts")]);
    });
}

#[test]
fn file_candidates_of_pattern_are_targets() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        ..host_of(&[
            (
                "/p/a.ts",
                "import(\"./plugins/\" + name)\nrequire(\"node:\" + name)",
            ),
            ("/p/plugins/x.ts", ""),
            ("/p/plugins/y.ts", ""),
            ("/p/other.ts", ""),
        ])
    };
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.ts");
        let files = ["/p/plugins/x.ts", "/p/plugins/y.ts"].map(code_file);
        let files = files.map(ComputedCandidate::File);
        let host_modules = [3, 5].map(|id| ComputedCandidate::HostModule(HostModuleId(id)));
        let spelling = |text: &'static str, candidate| ComputedSpelling {
            text: text.as_bytes(),
            candidate,
        };
        let spellings = [
            spelling("./plugins/x", 0),
            spelling("./plugins/x.js", 0),
            spelling("./plugins/x.jsx", 0),
            spelling("./plugins/x.ts", 0),
            spelling("./plugins/y", 1),
            spelling("./plugins/y.js", 1),
            spelling("./plugins/y.jsx", 1),
            spelling("./plugins/y.ts", 1),
        ];
        let expected =
            [(&files, &spellings[..]), (&host_modules, &[][..])].map(|(candidates, spellings)| {
                SiteResolution::Computed(ComputedResolution::Candidates {
                    candidates,
                    spellings,
                })
            });
        assert_eq!(parsed.code.resolutions, expected);
        assert_eq!(
            targets_of(&parsed),
            [target("/p/plugins/x.ts"), target("/p/plugins/y.ts")]
        );
        assert!(parsed.code.targets_by_specifier.is_empty());
    });
}

#[test]
fn package_pattern_increases_depth() {
    let host = host_of(&[
        ("/p/a.ts", "import(\"pkg/\" + name)"),
        ("/p/node_modules/pkg/x.js", ""),
    ]);
    with_context(&host, |context| {
        let expected = Target {
            increases_depth: true,
            ..target("/p/node_modules/pkg/x.js")
        };
        assert_eq!(targets_of(&load(context, "/p/a.ts")), [expected]);
    });
}

#[test]
fn bare_specifier_for_same_package_keeps_depth() {
    let host = StatementsHost {
        claims: vec![("#lib/f", HostResolution::Path(b"/p/lib/f.ts".to_vec()))],
        ..host_of(&[
            ("/p/package.json", "app@1.0.0"),
            ("/p/a.ts", "import \"#lib/f\"\nimport \"pkg\""),
            ("/p/lib/f.ts", ""),
            ("/p/node_modules/pkg/index.js", ""),
        ])
    };
    with_context(&host, |context| {
        let package_file = Target {
            increases_depth: true,
            ..target("/p/node_modules/pkg/index.js")
        };
        let targets = targets_of(&load(context, "/p/a.ts"));
        assert_eq!(targets, [target("/p/lib/f.ts"), package_file]);
    });
}

#[test]
fn specifier_without_pattern_may_be_any_module() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        ..host_of(&[("/p/a.js", "require(name)"), ("/p/b.js", "")])
    };
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.js");
        let host_modules = [3, 5].map(|id| ComputedCandidate::HostModule(HostModuleId(id)));
        let expected = SiteResolution::Computed(ComputedResolution::All {
            cause: ComputedUnknown::NoPattern,
            host_modules: &host_modules,
        });
        assert_eq!(parsed.code.resolutions, [expected]);
        assert!(parsed.code.targets.is_empty());
    });
}

#[test]
fn macro_import_statement_is_erased() {
    let host = host_of(&[
        (
            "/p/a.ts",
            "import m from \"./m\" with { type: \"macro\" }\n\
             m(\"x\")\n\
             import(\"./m\", { with: { type: \"macro\" } })",
        ),
        ("/p/m.ts", ""),
    ]);
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.ts");
        assert_eq!(parsed.code.resolutions, [ERASED, file("/p/m.ts")]);
        assert_eq!(targets_of(&parsed), [target("/p/m.ts")]);
    });
    let requests = host.loader_requests();
    assert_eq!(
        requests,
        [loader_request("/p/m.ts", CodeImportKind::Import)]
    );
}

#[test]
fn type_attribute_selects_loader() {
    let host = StatementsHost {
        loaders: &[("/p/lib.js", Some("text"), TEXT_LOADER)],
        ..host_of(&[
            (
                "/p/a.ts",
                "import \"./lib.js\"\nimport \"./lib.js\" with { type: \"text\" }\nimport \"./b\"",
            ),
            ("/p/lib.js", ""),
            ("/p/b.ts", ""),
        ])
    };
    with_context(&host, |context| {
        let as_code = target("/p/lib.js");
        let as_text = Target {
            loader: TEXT_LOADER,
            ..target("/p/lib.js")
        };
        let targets = targets_of(&load(context, "/p/a.ts"));
        assert_eq!(targets, [as_code, as_text, target("/p/b.ts")]);
    });
}

#[test]
fn loader_request_carries_kind_and_attributes_of_site() {
    let host = host_of(&[
        (
            "/p/a.js",
            "import \"./statement.txt\"\n\
             require(\"./required.txt\")\n\
             require.resolve(\"./named.txt\")\n\
             import.meta.require(\"./meta.txt\")\n\
             import.meta.resolve(\"./meta-named.txt\")\n\
             import(\"./data.db\", { with: { type: \"sqlite\", embed: \"true\" } })\n\
             require(\"./dir/\" + name)",
        ),
        ("/p/statement.txt", ""),
        ("/p/required.txt", ""),
        ("/p/named.txt", ""),
        ("/p/meta.txt", ""),
        ("/p/meta-named.txt", ""),
        ("/p/data.db", ""),
        ("/p/dir/candidate.txt", ""),
    ]);
    with_context(&host, |context| {
        assert_eq!(load(context, "/p/a.js").code.targets.len(), 7);
    });
    let with_attributes = RecordedLoaderRequest {
        type_attribute: Some(b"sqlite".to_vec()),
        embed_attribute: Some(b"true".to_vec()),
        ..loader_request("/p/data.db", CodeImportKind::Import)
    };
    let expected = [
        loader_request("/p/statement.txt", CodeImportKind::Import),
        loader_request("/p/required.txt", CodeImportKind::Require),
        loader_request("/p/named.txt", CodeImportKind::Import),
        loader_request("/p/meta.txt", CodeImportKind::Require),
        loader_request("/p/meta-named.txt", CodeImportKind::Import),
        with_attributes,
        loader_request("/p/dir/candidate.txt", CodeImportKind::Import),
    ];
    assert_eq!(host.loader_requests(), expected);
}

#[test]
fn entry_point_loader_is_requested_as_entry_point() {
    let host = host_of(&[("/p/a.ts", "")]);
    with_compile_context(&TestBuild::new(&host, &["/p/a.ts"]), |context| {
        assert_eq!(context.entry_points.len(), 1);
    });
    let requests = host.loader_requests();
    assert_eq!(
        requests,
        [loader_request("/p/a.ts", CodeImportKind::EntryPoint)]
    );
}

#[test]
fn get_builtin_module_loads_host_modules_only() {
    let source = HostResolution::ModuleSource {
        module: HostModuleId(7),
        path: b"/bun/os.ts".to_vec(),
    };
    let mut runtime_modules = node_modules();
    runtime_modules.push(("node:os", source));
    let host = StatementsHost {
        runtime_modules,
        ..host_of(&[
            (
                "/p/a.js",
                "process.getBuiltinModule(\"node:fs\")\n\
                 process.getBuiltinModule(\"node:os\")\n\
                 process.getBuiltinModule(\"./local.js\")\n\
                 process.getBuiltinModule(\"missing\")",
            ),
            ("/p/local.js", ""),
            ("/bun/os.ts", ""),
        ])
    };
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.js");
        let source = CodeFile {
            host_module: Some(HostModuleId(7)),
            ..code_file("/bun/os.ts")
        };
        let source = SiteResolution::Constant(CodeResolution::File(source));
        assert_eq!(
            parsed.code.resolutions,
            [host_module(3), source, ERASED, ERASED]
        );
        let expected = Target {
            host_module: Some(HostModuleId(7)),
            increases_depth: true,
            ..target("/bun/os.ts")
        };
        assert_eq!(targets_of(&parsed), [expected]);
    });
}

#[test]
fn get_builtin_module_of_computed_name_is_ordinary_call() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        ..host_of(&[("/p/a.js", "process.getBuiltinModule(\"node:\" + name)")])
    };
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.js");
        assert!(parsed.code.analyzed.analysis.import_sites.is_empty());
        assert!(parsed.code.resolutions.is_empty());
    });
}

#[test]
fn runtime_require_of_data_module_is_host_value() {
    let host = host_of(&[("/p/addon.node", "")]);
    with_context(&host, |context| {
        let parsed = load_with_loader(context, "/p/addon.node", NATIVE_ADDON_LOADER);
        let expected = SiteResolution::Constant(CodeResolution::External {
            specifier: b"/p/addon.node",
            kind: ExternalKind::HostValue,
        });
        assert_eq!(parsed.code.resolutions, [expected]);
        assert!(parsed.code.targets.is_empty());
    });
    assert_eq!(host.code_request_count(), 0);
}

#[test]
fn written_require_of_same_path_asks_resolver() {
    let host = host_of(&[
        ("/p/a.js", "import.meta.require(\"/p/addon.node\")"),
        ("/p/addon.node", ""),
    ]);
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.js");
        assert_eq!(parsed.code.resolutions, [file("/p/addon.node")]);
    });
    assert_ne!(host.code_request_count(), 0);
}

#[test]
fn implied_imports_follow_site_targets() {
    let module_source = HostResolution::ModuleSource {
        module: HostModuleId(7),
        path: b"/bun/y.ts".to_vec(),
    };
    let external = HostResolution::External {
        specifier: b"z".to_vec(),
        kind: ExternalKind::UncompiledCode,
    };
    let implied = vec![
        HostResolution::Path(b"/p/x.ts".to_vec()),
        HostResolution::Unclaimed,
        module_source,
        external,
        HostResolution::Module(HostModuleId(9)),
        HostResolution::Erased,
    ];
    let host = StatementsHost {
        implied: vec![("/p/a.ts", implied)],
        ..host_of(&[("/p/a.ts", "import \"./b\""), ("/p/b.ts", "")])
    };
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.ts");
        let source = CodeFile {
            host_module: Some(HostModuleId(7)),
            ..code_file("/bun/y.ts")
        };
        let expected = [
            CodeResolution::File(code_file("/p/x.ts")),
            CodeResolution::File(source),
            CodeResolution::HostModule(HostModuleId(9)),
        ];
        assert_eq!(parsed.code.implied, expected);
        assert_eq!(parsed.code.resolutions, [file("/p/b.ts")]);
        let source = Target {
            host_module: Some(HostModuleId(7)),
            ..target("/bun/y.ts")
        };
        assert_eq!(
            targets_of(&parsed),
            [target("/p/b.ts"), target("/p/x.ts"), source]
        );

        assert!(load(context, "/p/b.ts").code.implied.is_empty());
    });
}

#[test]
fn first_target_of_specifier_and_kind_is_recorded() {
    let host = host_of(&[
        (
            "/p/a.js",
            "import \"./b.js\"\nimport \"./c.js\"\nimport \"./b.js\"\nrequire(\"./b.js\")",
        ),
        ("/p/b.js", ""),
        ("/p/c.js", ""),
    ]);
    with_context(&host, |context| {
        let parsed = load(context, "/p/a.js");
        assert_eq!(parsed.code.targets.len(), 4);
        let (b, c) = (
            context.atoms.intern(b"./b.js"),
            context.atoms.intern(b"./c.js"),
        );
        let mut recorded: Vec<((Atom, CodeImportKind), u32)> = (parsed.code.targets_by_specifier)
            .iter()
            .map(|(&key, &target)| (key, target))
            .collect();
        recorded.sort_by_key(|entry| entry.1);
        let expected = [
            ((b, CodeImportKind::Import), 0),
            ((c, CodeImportKind::Import), 1),
            ((b, CodeImportKind::Require), 3),
        ];
        assert_eq!(recorded, expected);
    });
}
