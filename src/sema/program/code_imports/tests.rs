#![cfg(not(miri))]

use super::*;
use crate::program::code_test_host::{
    StatementsHost, TEXT_LOADER, TestBuild, with_compile_context,
};
use crate::resolve::{CodeFailure, ComputedSpelling};

const ALL_KINDS: [ImportSiteKind; 12] = [
    ImportSiteKind::JsxRuntime,
    ImportSiteKind::JsxPackage,
    ImportSiteKind::Import(ImportId(0)),
    ImportSiteKind::ExportFrom(ExportId(0)),
    ImportSiteKind::ExportStar(StmtId(0)),
    ImportSiteKind::ImportEquals(ImportEqualsId(0)),
    ImportSiteKind::ImportCall(ExprId(0)),
    ImportSiteKind::Require(ExprId(0)),
    ImportSiteKind::RequireResolve(ExprId(0)),
    ImportSiteKind::ImportMetaRequire(ExprId(0)),
    ImportSiteKind::ImportMetaResolve(ExprId(0)),
    ImportSiteKind::GetBuiltinModule(ExprId(0)),
];

const STATEMENT_KINDS: [ImportSiteKind; 3] = [
    ImportSiteKind::Import(ImportId(0)),
    ImportSiteKind::ExportFrom(ExportId(0)),
    ImportSiteKind::ExportStar(StmtId(0)),
];

const REQUIRING_KINDS: [ImportSiteKind; 3] = [
    ImportSiteKind::ImportEquals(ImportEqualsId(0)),
    ImportSiteKind::Require(ExprId(0)),
    ImportSiteKind::ImportMetaRequire(ExprId(0)),
];

const IMPORTER: LoadKey<'static> = LoadKey {
    path: b"/p/a.ts",
    loader: HostLoader(0),
};

const FILE: CodeFile<'static> = CodeFile {
    path: b"/p/m.ts",
    host_module: None,
};

const HOST_MODULE_SOURCE: CodeFile<'static> = CodeFile {
    path: b"/bun/os.ts",
    host_module: Some(HostModuleId(7)),
};

const OTHER_RESOLUTIONS: [CodeResolution<'static>; 4] = [
    CodeResolution::HostModule(HostModuleId(7)),
    CodeResolution::External {
        specifier: b"chosen",
        kind: ExternalKind::UncompiledCode,
    },
    CodeResolution::Erased,
    CodeResolution::NotFound(CodeFailure::ModuleNotFound),
];

fn host_of(files: &'static [(&'static str, &'static str)]) -> StatementsHost {
    StatementsHost {
        files,
        ..StatementsHost::default()
    }
}

fn with_context<R>(
    host: &StatementsHost,
    test: impl FnOnce(&CodeLoadContext<'_, '_, '_>) -> R,
) -> R {
    with_compile_context(&TestBuild::new(host, &[]), test)
}

fn with_attributes<R>(
    attributes: &[(Atom, Atom)],
    test: impl FnOnce(&hir::File<'_>, ExprId) -> R,
) -> R {
    let session = Session::new();
    let mut file = FileBuilder::default();
    let properties: Vec<Prop> = (attributes.iter())
        .map(|&(key, value)| Prop {
            kind: PropKind::Init,
            key: PropKey::Name(key),
            name_kind: NameKind::Identifier,
            value: file.expr(ExprKind::String(value), 0, 0),
            pos: 0,
            start: 0,
            end: 0,
            postfix_token: 0,
        })
        .collect();
    let properties = file.add_props(&properties);
    let object = file.expr(ExprKind::Object(properties), 0, 0);
    let (hir, _) = file.into_arena(session.arena(), &session);
    test(&hir, object)
}

fn site_of(kind: ImportSiteKind, specifier: ImportSpecifier, attributes: ExprId) -> ImportSite {
    ImportSite {
        kind,
        specifier,
        specifier_node: ExprId::NONE,
        attributes,
        consults_resolver: true,
        is_host_value: false,
    }
}

fn constant_site(kind: ImportSiteKind, attributes: ExprId) -> ImportSite {
    site_of(kind, ImportSpecifier::Constant(known::require), attributes)
}

#[test]
fn only_file_resolutions_have_files() {
    assert_eq!(file_of(CodeResolution::File(FILE)), Some(FILE));
    for other in OTHER_RESOLUTIONS {
        assert_eq!(file_of(other), None, "{other:?}");
    }
}

#[test]
fn only_file_candidates_have_files() {
    assert_eq!(
        file_of_candidate(&ComputedCandidate::File(FILE)),
        Some(FILE)
    );
    let host_module = ComputedCandidate::HostModule(HostModuleId(7));
    assert_eq!(file_of_candidate(&host_module), None);
}

#[test]
fn unknown_answer_has_host_modules_as_candidates() {
    let candidates = [
        ComputedCandidate::File(HOST_MODULE_SOURCE),
        ComputedCandidate::HostModule(HostModuleId(9)),
    ];
    let known_set = ComputedResolution::Candidates {
        candidates: &candidates,
        spellings: &[],
    };
    assert_eq!(candidates_of(known_set), candidates);
    let unknown = ComputedResolution::All {
        cause: ComputedUnknown::ConfigPaths,
        host_modules: &candidates,
    };
    assert_eq!(candidates_of(unknown), candidates);
}

#[test]
fn get_builtin_module_returns_host_modules_only() {
    let host_module = CodeResolution::HostModule(HostModuleId(7));
    assert_eq!(builtin_module_or_erased(host_module), host_module);
    let source = CodeResolution::File(HOST_MODULE_SOURCE);
    assert_eq!(builtin_module_or_erased(source), source);
    let host_value = CodeResolution::External {
        specifier: b"node:buffer",
        kind: ExternalKind::HostValue,
    };
    assert_eq!(builtin_module_or_erased(host_value), host_value);

    let program_file = CodeResolution::File(FILE);
    assert_eq!(
        builtin_module_or_erased(program_file),
        CodeResolution::Erased
    );
    for other in &OTHER_RESOLUTIONS[1..] {
        assert_eq!(
            builtin_module_or_erased(*other),
            CodeResolution::Erased,
            "{other:?}"
        );
    }
}

#[test]
fn one_site_kind_is_get_builtin_module() {
    for kind in ALL_KINDS {
        let expected = kind == ImportSiteKind::GetBuiltinModule(ExprId(0));
        assert_eq!(is_get_builtin_module(kind), expected, "{kind:?}");
    }
}

#[test]
fn only_statement_imports_macro() {
    with_attributes(&[(known::r#type, known::r#macro)], |hir, attributes| {
        for kind in ALL_KINDS {
            let site = constant_site(kind, attributes);
            let is_statement = STATEMENT_KINDS.contains(&kind);
            assert_eq!(is_macro_import(hir, &site), is_statement, "{kind:?}");
        }
    });
}

#[test]
fn statement_with_other_type_imports_no_macro() {
    with_attributes(&[(known::r#type, known::embed)], |hir, attributes| {
        for kind in STATEMENT_KINDS {
            assert!(
                !is_macro_import(hir, &constant_site(kind, attributes)),
                "{kind:?}"
            );
            assert!(
                !is_macro_import(hir, &constant_site(kind, ExprId::NONE)),
                "{kind:?}"
            );
        }
    });
    with_attributes(&[(known::embed, known::r#macro)], |hir, attributes| {
        for kind in STATEMENT_KINDS {
            assert!(
                !is_macro_import(hir, &constant_site(kind, attributes)),
                "{kind:?}"
            );
        }
    });
}

#[test]
fn macro_type_selects_no_loader() {
    with_attributes(&[(known::r#type, known::r#macro)], |hir, attributes| {
        for kind in ALL_KINDS {
            let site = constant_site(kind, attributes);
            assert_eq!(type_attribute(hir, &site), Some(known::r#macro), "{kind:?}");
            assert_eq!(loader_attribute(hir, &site), None, "{kind:?}");
        }
    });
}

#[test]
fn type_and_embed_attributes_are_read_by_key() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let (sqlite, yes) = (atoms.intern(b"sqlite"), atoms.intern(b"true"));
    with_attributes(
        &[(known::embed, yes), (known::r#type, sqlite)],
        |hir, attributes| {
            let site = constant_site(ImportSiteKind::ImportCall(ExprId(0)), attributes);
            assert_eq!(type_attribute(hir, &site), Some(sqlite));
            assert_eq!(loader_attribute(hir, &site), Some(sqlite));
            assert_eq!(embed_attribute(hir, &site), Some(yes));
        },
    );
}

#[test]
fn site_without_attributes_has_none() {
    with_attributes(&[(known::r#type, known::embed)], |hir, _| {
        let site = constant_site(ImportSiteKind::Import(ImportId(0)), ExprId::NONE);
        assert_eq!(type_attribute(hir, &site), None);
        assert_eq!(loader_attribute(hir, &site), None);
        assert_eq!(embed_attribute(hir, &site), None);
    });
}

#[test]
fn constant_require_selects_loader_as_require() {
    let pattern = ImportSpecifier::Pattern {
        prefix: known::require,
        suffix: known::empty,
    };
    for kind in ALL_KINDS {
        let expected = match REQUIRING_KINDS.contains(&kind) {
            true => CodeImportKind::Require,
            false => CodeImportKind::Import,
        };
        assert_eq!(
            loader_kind(&constant_site(kind, ExprId::NONE)),
            expected,
            "{kind:?}"
        );
        for specifier in [pattern, ImportSpecifier::Unknown] {
            let site = site_of(kind, specifier, ExprId::NONE);
            assert_eq!(loader_kind(&site), CodeImportKind::Import, "{kind:?}");
        }
    }
}

#[test]
fn constant_prefix_is_specifier_or_start_of_pattern() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let (prefix, suffix) = (atoms.intern(b"./plugins/"), atoms.intern(b".ts"));
    assert_eq!(
        constant_prefix(&atoms, ImportSpecifier::Constant(prefix)),
        b"./plugins/"
    );
    let pattern = ImportSpecifier::Pattern { prefix, suffix };
    assert_eq!(constant_prefix(&atoms, pattern), b"./plugins/");
    assert_eq!(constant_prefix(&atoms, ImportSpecifier::Unknown), b"");
}

#[test]
fn target_has_loader_of_file() {
    let host = StatementsHost {
        loaders: &[("/p/lib.js", Some("text"), TEXT_LOADER)],
        ..host_of(&[("/p/lib.js", ""), ("/bun/os.ts", "")])
    };
    with_context(&host, |context| {
        let library = CodeFile {
            path: b"/p/lib.js",
            host_module: None,
        };
        let as_text = TargetOrigin {
            type_attribute: Some(b"text"),
            increases_depth: true,
            ..IMPLIED_IMPORT
        };
        let mut targets = Vec::new();
        assert_eq!(
            add_target(context, &mut targets, IMPLIED_IMPORT, library),
            0
        );
        assert_eq!(add_target(context, &mut targets, as_text, library), 1);
        assert_eq!(
            add_target(context, &mut targets, IMPLIED_IMPORT, HOST_MODULE_SOURCE),
            2
        );

        let keys: Vec<LoadKey<'_>> = targets.iter().map(|target| target.key).collect();
        let key = |path: &'static [u8], loader: HostLoader| LoadKey { path, loader };
        let expected = [
            key(b"/p/lib.js", HostLoader::default()),
            key(b"/p/lib.js", TEXT_LOADER),
            key(b"/bun/os.ts", HostLoader::default()),
        ];
        assert_eq!(keys, expected);
        let host_modules: Vec<Option<HostModuleId>> =
            (targets.iter()).map(|target| target.host_module).collect();
        assert_eq!(host_modules, [None, None, Some(HostModuleId(7))]);
        let steps: Vec<bool> = targets
            .iter()
            .map(|target| target.increases_depth)
            .collect();
        assert_eq!(steps, [false, true, false]);
    });
}

#[test]
fn macro_statement_is_erased_without_request() {
    let host = host_of(&[("/p/a.ts", ""), ("/p/m.ts", "")]);
    with_context(&host, |context| {
        let specifier = ImportSpecifier::Constant(context.atoms.intern(b"./m"));
        with_attributes(&[(known::r#type, known::r#macro)], |hir, attributes| {
            for kind in STATEMENT_KINDS {
                let site = site_of(kind, specifier, attributes);
                let resolution = resolve_site(context, IMPORTER, hir, &site);
                let erased = SiteResolution::Constant(CodeResolution::Erased);
                assert_eq!(resolution, erased, "{kind:?}");
            }
            assert_eq!(host.code_request_count(), 0);

            let call = site_of(ImportSiteKind::ImportCall(ExprId(0)), specifier, attributes);
            let resolution = resolve_site(context, IMPORTER, hir, &call);
            assert_eq!(
                resolution,
                SiteResolution::Constant(CodeResolution::File(FILE))
            );
            assert_eq!(host.code_request_count(), 1);
        });
    });
}

#[test]
fn host_value_site_is_external_without_request() {
    let host = host_of(&[("/p/a.ts", ""), ("/p/m.ts", "")]);
    with_context(&host, |context| {
        let specifier = ImportSpecifier::Constant(context.atoms.intern(b"./m"));
        let kind = ImportSiteKind::ImportMetaRequire(ExprId(0));
        let written = site_of(kind, specifier, ExprId::NONE);
        let host_value = ImportSite {
            is_host_value: true,
            ..written
        };
        with_attributes(&[], |hir, _| {
            let expected = SiteResolution::Constant(CodeResolution::External {
                specifier: b"./m",
                kind: ExternalKind::HostValue,
            });
            assert_eq!(resolve_site(context, IMPORTER, hir, &host_value), expected);
            assert_eq!(host.code_request_count(), 0);

            let expected = SiteResolution::Constant(CodeResolution::File(FILE));
            assert_eq!(resolve_site(context, IMPORTER, hir, &written), expected);
        });
    });
}

#[test]
fn specifier_is_resolved_from_directory_of_importer() {
    let host = host_of(&[
        ("/p/m.ts", ""),
        ("/p/sub/m.ts", ""),
        ("/p/sub/plugins/x.ts", ""),
    ]);
    with_context(&host, |context| {
        let import = (CodeImportKind::Import, CodeImportForm::Static);
        let nested = LoadKey {
            path: b"/p/sub/a.ts",
            ..IMPORTER
        };
        let found = resolve_specifier(context, nested, b"./m", import);
        let expected = CodeFile {
            path: b"/p/sub/m.ts",
            host_module: None,
        };
        assert_eq!(found, CodeResolution::File(expected));
        let found = resolve_specifier(context, IMPORTER, b"./m", import);
        assert_eq!(found, CodeResolution::File(FILE));

        let plugin = ComputedCandidate::File(CodeFile {
            path: b"/p/sub/plugins/x.ts",
            host_module: None,
        });
        let spellings: [&[u8]; 4] = [
            b"./plugins/x",
            b"./plugins/x.js",
            b"./plugins/x.jsx",
            b"./plugins/x.ts",
        ];
        let spellings = spellings.map(|text| ComputedSpelling { text, candidate: 0 });
        let expected = ComputedResolution::Candidates {
            candidates: &[plugin],
            spellings: &spellings,
        };
        let found = resolve_pattern(context, nested, b"./plugins/", b"", import);
        assert_eq!(found, expected);
        let nothing = ComputedResolution::Candidates {
            candidates: &[],
            spellings: &[],
        };
        let found = resolve_pattern(context, IMPORTER, b"./plugins/", b"", import);
        assert_eq!(found, nothing);
    });
}
