use super::*;
use crate::module_format::DeclaredModuleType;
use crate::program::code_test_host::TEXT_LOADER;
use crate::resolve::{
    CodeFailure, ComputedUnknown, EnclosingPackage, ExternalKind, HostResolution,
};

fn node_modules() -> Vec<(&'static str, HostResolution)> {
    vec![
        ("node:path", HostResolution::Module(HostModuleId(5))),
        ("node:fs", HostResolution::Module(HostModuleId(3))),
    ]
}

#[test]
fn constant_answers_follow_site_order() {
    let external = |kind| HostResolution::External {
        specifier: b"rewritten".to_vec(),
        kind,
    };
    let host = StatementsHost {
        runtime_modules: node_modules(),
        claims: vec![
            ("uncompiled", external(ExternalKind::UncompiledCode)),
            ("host-value", external(ExternalKind::HostValue)),
            ("erased", HostResolution::Erased),
        ],
        ..host_of(&[
            (
                "/main.ts",
                "import \"./a\"\n\
                 import \"node:fs\"\n\
                 import \"uncompiled\"\n\
                 import \"host-value\"\n\
                 import \"erased\"\n\
                 import \"./missing\"\n\
                 import \"missing-package\"",
            ),
            ("/a.ts", ""),
        ])
    };
    with_program(&host, &["/main.ts"], |files| {
        let specifier = files.atoms.lookup(b"rewritten");
        let specifier = specifier.expect("the specifier of the host is interned");
        let external = |kind| CodeAnswer::External { specifier, kind };
        let expected = [
            CodeAnswer::File(file_at(files, "/a.ts")),
            CodeAnswer::HostModule(HostModuleId(3)),
            external(ExternalKind::UncompiledCode),
            external(ExternalKind::HostValue),
            CodeAnswer::Erased,
            CodeAnswer::NotFound(CodeFailure::ModuleNotFound),
            CodeAnswer::NotFound(CodeFailure::PackageNotFound),
        ];
        let main = file_at(files, "/main.ts");
        assert_eq!(files.code_answers(main), expected);
        assert_eq!(files.analysis(main).import_sites.len(), expected.len());
    });
}

#[test]
fn computed_answer_lists_sorted_files_and_host_modules() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        ..host_of(&[
            (
                "/main.ts",
                "import \"./plugins/y\"\n\
                 import(\"./plugins/\" + name)\n\
                 require(\"node:\" + name)",
            ),
            ("/plugins/x.ts", ""),
            ("/plugins/y.ts", ""),
        ])
    };
    with_program(&host, &["/main.ts"], |files| {
        let (x, y) = (
            file_at(files, "/plugins/x.ts"),
            file_at(files, "/plugins/y.ts"),
        );
        assert!(y < x);
        let (plugins, host_modules) = ([y, x], [HostModuleId(3), HostModuleId(5)]);
        let spelling = |text: &str, file| {
            (
                files.atoms.intern(text.as_bytes()),
                ComputedTarget::File(file),
            )
        };
        let spellings = [
            spelling("./plugins/x", x),
            spelling("./plugins/x.js", x),
            spelling("./plugins/x.jsx", x),
            spelling("./plugins/x.ts", x),
            spelling("./plugins/y", y),
            spelling("./plugins/y.js", y),
            spelling("./plugins/y.jsx", y),
            spelling("./plugins/y.ts", y),
        ];
        let expected = [
            CodeAnswer::File(y),
            CodeAnswer::Computed(ComputedTargets::Modules {
                files: &plugins,
                host_modules: &[],
                spellings: &spellings,
            }),
            CodeAnswer::Computed(ComputedTargets::Modules {
                files: &[],
                host_modules: &host_modules,
                spellings: &[],
            }),
        ];
        let main = file_at(files, "/main.ts");
        assert_eq!(files.code_answers(main), expected);
        assert_eq!(files.module(main).code_edges, [y, x]);
        assert!(files.is_compiled(x) && files.is_compiled(y));
    });
}

#[test]
fn unknown_specifier_answers_with_cause_and_host_modules() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        ..host_of(&[
            ("/main.js", "require(name)\nrequire(\"lod\" + name)"),
            ("/other.js", ""),
        ])
    };
    with_program(&host, &["/main.js"], |files| {
        let all = |cause, host_modules| {
            CodeAnswer::Computed(ComputedTargets::All {
                cause,
                host_modules,
            })
        };
        let expected = [
            all(
                ComputedUnknown::NoPattern,
                &[HostModuleId(3), HostModuleId(5)][..],
            ),
            all(ComputedUnknown::IncompletePackageName, &[]),
        ];
        let main = file_at(files, "/main.js");
        assert_eq!(files.code_answers(main), expected);
        assert!(files.module(main).code_edges.is_empty());
        assert_eq!(files.by_path.get(b"/other.js"), None);
    });
}

#[test]
fn implied_answers_follow_host_order() {
    let implied = vec![
        HostResolution::Module(HostModuleId(9)),
        HostResolution::Path(b"/runtime.ts".to_vec()),
    ];
    let host = StatementsHost {
        implied: vec![("/main.ts", implied)],
        ..host_of(&[
            ("/main.ts", "import \"./a\""),
            ("/a.ts", ""),
            ("/runtime.ts", ""),
        ])
    };
    with_program(&host, &["/main.ts"], |files| {
        let (a, runtime) = (file_at(files, "/a.ts"), file_at(files, "/runtime.ts"));
        let compiled = compiled_at(files, "/main.ts");
        assert_eq!(compiled.code_answers, [CodeAnswer::File(a)]);
        let expected = [
            CodeAnswer::HostModule(HostModuleId(9)),
            CodeAnswer::File(runtime),
        ];
        assert_eq!(compiled.implied_answers, expected);
        assert_eq!(
            files.module(file_at(files, "/main.ts")).code_edges,
            [a, runtime]
        );
        assert!(files.is_compiled(runtime));
        assert!(compiled_at(files, "/a.ts").implied_answers.is_empty());
        assert_eq!(files.host_modules(), [HostModuleId(9)]);
    });
}

#[test]
fn host_modules_of_program_are_sorted_and_unique() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        implied: vec![("/a.ts", vec![HostResolution::Module(HostModuleId(4))])],
        ..host_of(&[
            (
                "/main.ts",
                "import \"node:path\"\nimport \"./a\"\nimport \"node:fs\"",
            ),
            ("/a.ts", "import \"node:path\"\nrequire(\"node:\" + name)"),
        ])
    };
    with_program(&host, &["/main.ts"], |files| {
        let expected = [3, 4, 5].map(HostModuleId);
        assert_eq!(files.host_modules(), expected);
    });
}

#[test]
fn program_without_host_module_lists_none() {
    let host = StatementsHost {
        runtime_modules: node_modules(),
        ..host_of(&[("/main.ts", "")])
    };
    with_program(&host, &["/main.ts"], |files| {
        assert!(files.host_modules().is_empty());
    });
}

#[test]
fn code_edges_are_unique_in_order_of_first_use() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"./b\"\nimport \"./a\"\nimport \"./b\"\nimport(\"./a\")",
        ),
        ("/a.ts", ""),
        ("/b.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let (a, b) = (file_at(files, "/a.ts"), file_at(files, "/b.ts"));
        let main = file_at(files, "/main.ts");
        assert_eq!(files.module(main).code_edges, [b, a]);
        let answers = [b, a, b, a].map(CodeAnswer::File);
        assert_eq!(files.code_answers(main), answers);
    });
}

#[test]
fn compiled_module_records_how_file_was_loaded() {
    let source = HostResolution::ModuleSource {
        module: HostModuleId(7),
        path: b"/bun/os.cjs".to_vec(),
    };
    let host = StatementsHost {
        claims: vec![("node:os", source)],
        loaders: &[("/note.txt", Some("text"), TEXT_LOADER)],
        ..host_of(&[
            (
                "/main.ts",
                "import \"node:os\"\nimport \"pkg\"\nimport \"./note.txt\" with { type: \"text\" }",
            ),
            ("/tsconfig.json", "experimentalDecorators"),
            ("/bun/os.cjs", ""),
            ("/note.txt", "hello"),
            ("/node_modules/pkg/package.json", "pkg@1.0.0"),
            ("/node_modules/pkg/index.js", ""),
        ])
    };
    with_program(&host, &["/main.ts"], |files| {
        let main = compiled_at(files, "/main.ts");
        assert_eq!(
            (main.loader, main.host_module),
            (HostLoader::default(), None)
        );
        assert_eq!(main.package, None);
        assert!(main.settings.experimental_decorators);
        assert!(std::ptr::eq(main.jsx, &main.settings.jsx));
        assert_eq!(main.declared_module_type, DeclaredModuleType::Unknown);

        let host_source = compiled_at(files, "/bun/os.cjs");
        assert_eq!(host_source.host_module, Some(HostModuleId(7)));
        assert_eq!(
            host_source.declared_module_type,
            DeclaredModuleType::CommonJs
        );

        let CodeAnswer::File(note) = main.code_answers[2] else {
            panic!("the text file is loaded");
        };
        let note = files.compiled(note).expect("the text file is compiled");
        assert_eq!(note.loader, TEXT_LOADER);

        let expected = EnclosingPackage {
            directory: b"/node_modules/pkg",
            name: b"pkg",
            version: b"1.0.0",
        };
        assert_eq!(
            compiled_at(files, "/node_modules/pkg/index.js").package,
            Some(expected)
        );
    });
}
