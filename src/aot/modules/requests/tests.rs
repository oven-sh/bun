mod module_set;

use super::*;
use crate::modules::testing::{describe_module, file_named, with_graph};
use crate::modules::{
    Candidates, ModuleFailure, ModuleFailureId, ModuleGraph, SiteAnswer, compare_modules,
};
use bstr::BStr;
use bun_core::strings::split;
use bun_sema::hir::ImportEqualsId;
use bun_sema::program::HostModuleId;

const JSX_RUNTIME: &str = "node_modules/react/jsx-dev-runtime.js";
const JSX_PACKAGE: &str = "node_modules/react/index.js";
const ELEMENT: &str = "export const element = <div />;";
const KEY_AFTER_SPREAD: &str = "export const keyed = (props) => <div {...props} key='k' />;";
const UNCOMPILED_MODULE: &str = "https://example.com/z.js";
const HOST_VALUE_MODULE: &str = "bun:main";
const PATTERN_REQUIRE: &str = "module.exports = (name) => require(`./pages/${name}.js`);";

struct BoundProgram<'a, 'i, 's> {
    graph: &'a ModuleGraph,
    input: &'a BindInput<'i, 's>,
}

fn with_program(files: &[(&str, &str)], check: impl FnOnce(&BoundProgram<'_, '_, '_>)) {
    with_graph(files, |graph, input| check(&BoundProgram { graph, input }));
}

fn with_react_program(main: &str, check: impl FnOnce(&BoundProgram<'_, '_, '_>)) {
    let files = [
        ("main.jsx", main),
        ("other.js", "export {};"),
        ("node_modules/react/package.json", r#"{ "name": "react" }"#),
        (JSX_RUNTIME, "exports.jsxDEV = () => null;"),
        (JSX_PACKAGE, "exports.createElement = () => null;"),
    ];
    with_program(&files, check);
}

fn with_scanner(source: &str, check: impl FnOnce(&mut FileScanner<'_, '_>, &[ImportSite])) {
    with_program(&[("main.js", source)], |program| {
        let main = program.file("main.js");
        let files = program.input.files;
        let compiled = files.compiled(main);
        let compiled = compiled.expect("the loader compiles the entry point");
        let mut scanner = FileScanner {
            file: main,
            hir: files.hir(main),
            compiled,
            named_in_choices: &[],
            candidates: Vec::new(),
            spellings: Vec::new(),
            externals: Vec::new(),
            failures: Vec::new(),
            sites_over_candidate_limit: Vec::new(),
        };
        check(&mut scanner, compiled.analysis.import_sites);
    });
}

impl BoundProgram<'_, '_, '_> {
    fn file(&self, name: &str) -> FileId {
        file_named(self.input, name)
    }

    fn module(&self, name: &str) -> ModuleRef {
        ModuleRef::File(self.file(name))
    }

    fn atom(&self, text: &str) -> Atom {
        self.input.files.atoms.intern(text.as_bytes())
    }

    fn text_of(&self, atom: Atom) -> &BStr {
        BStr::new(self.input.files.atoms.bytes(atom))
    }

    fn source_text(&self, failure: &ModuleFailure) -> &BStr {
        let text = &self.input.files.hir(failure.importer).text;
        BStr::new(&text[failure.start as usize..failure.end as usize])
    }

    fn request_lines(&self, name: &str) -> Vec<String> {
        let description = describe_module(self.graph, self.input, name);
        let lines = split(description.as_bytes(), b"\n");
        let request_lines = lines.filter(|line| line.starts_with(b"request "));
        request_lines
            .map(|line| BStr::new(line).to_string())
            .collect()
    }

    fn site_answers(&self, name: &str) -> Vec<(ImportSiteKind, SiteAnswer<'_>)> {
        let file = self.file(name);
        let sites = self.input.files.analysis(file).import_sites.iter();
        sites
            .map(|site| (site.kind, self.graph.site_answer(file, site.kind)))
            .collect()
    }

    fn only_candidates(&self, name: &str) -> &[SpelledModule] {
        let answers = self.site_answers(name);
        match answers[..] {
            [(_, SiteAnswer::Computed(Candidates::Modules(modules)))] => modules,
            _ => panic!("the import sites are {answers:?}"),
        }
    }
}

#[test]
fn repeated_import_keeps_first_position() {
    let main = "import './a.js'; import './b.js'; import { x } from './a.js';";
    let files = [
        ("main.js", main),
        ("a.js", "export const x = 1;"),
        ("b.js", "export {};"),
    ];
    with_program(&files, |program| {
        let expected = ["request a.js", "request b.js"];
        assert_eq!(program.request_lines("main.js"), expected);
    });
}

#[test]
fn deferred_import_is_separate_request() {
    let files = [
        (
            "main.js",
            "import defer * as n from './a.js'; import './a.js';",
        ),
        ("a.js", "export const x = 1;"),
    ];
    with_program(&files, |program| {
        let expected = ["request a.js defer", "request a.js"];
        assert_eq!(program.request_lines("main.js"), expected);
        let requests = program.graph.requests(program.file("main.js")).iter();
        let phases: Vec<ImportPhase> = requests.map(|request| request.phase).collect();
        assert_eq!(phases, [ImportPhase::Defer, ImportPhase::Evaluation]);
    });
}

#[test]
fn star_export_of_runtime_names_is_dynamic() {
    let main = "
        import './alias.js';
        import './star.js';
        import './both.js';
        import './outer.js';
        import './static.js';
    ";
    let files = [
        ("main.js", main),
        ("alias.js", "export * as n from './a.cjs';"),
        ("star.js", "export * from './a.cjs';"),
        (
            "both.js",
            "export * as n from './a.cjs'; export * from './a.cjs';",
        ),
        ("outer.js", "export * from './star.js';"),
        ("static.js", "export * from './es.js';"),
        ("a.cjs", "exports.x = 1;"),
        ("es.js", "export const x = 1;"),
    ];
    with_program(&files, |program| {
        let expected_requests = [
            ("alias.js", "request a.cjs"),
            ("star.js", "request a.cjs dynamic-star"),
            ("both.js", "request a.cjs dynamic-star"),
            ("outer.js", "request star.js dynamic-star"),
            ("static.js", "request es.js"),
        ];
        for (name, expected) in expected_requests {
            assert_eq!(program.request_lines(name), [expected], "{name}");
        }
    });
}

#[test]
fn only_a_call_that_evaluates_adds_a_request() {
    let main = "
        export {};
        require('./required.js');
        import('./imported.js');
        require.resolve('./only-resolved.js');
    ";
    let files = [
        ("main.js", main),
        ("required.js", "exports.x = 1;"),
        ("imported.js", "export {};"),
        ("only-resolved.js", "exports.x = 1;"),
    ];
    with_program(&files, |program| {
        let main = program.file("main.js");
        assert_eq!(program.graph.kind(main), ModuleKind::SourceText);
        assert_eq!(
            program.request_lines("main.js"),
            ["request required.js require"]
        );
        let answers = program.site_answers("main.js");
        let targets: Vec<SiteAnswer<'_>> = answers.iter().map(|&(_, answer)| answer).collect();
        let expected = ["required.js", "imported.js", "only-resolved.js"]
            .map(|name| SiteAnswer::Module(program.module(name)));
        assert_eq!(targets, expected);
    });
}

#[test]
fn data_modules_have_no_requests() {
    let files = [
        ("main.js", "import './legacy.cjs'; import './data.json';"),
        ("legacy.cjs", "require('./other.cjs');"),
        ("other.cjs", "exports.x = 1;"),
        ("data.json", "{}"),
    ];
    with_program(&files, |program| {
        let expected = ["request legacy.cjs", "request data.json"];
        assert_eq!(program.request_lines("main.js"), expected);
        assert_eq!(
            program.request_lines("legacy.cjs"),
            ["request other.cjs require"]
        );
        for name in ["other.cjs", "data.json"] {
            assert!(program.request_lines(name).is_empty(), "{name}");
        }
    });
}

#[test]
fn declaration_file_has_record_without_requests() {
    let files = [
        ("main.js", "import './types.d.ts';"),
        ("types.d.ts", "import './unreached.js'; export {};"),
        ("unreached.js", "export {};"),
    ];
    with_program(&files, |program| {
        let types = program.file("types.d.ts");
        assert_eq!(program.request_lines("main.js"), ["request types.d.ts"]);
        assert!(program.graph.record_files().contains(&types));
        assert!(program.graph.requests(types).is_empty());
    });
}

#[test]
fn unresolved_calls_fail_in_site_order() {
    let main = "export {};\n\
                require('./nope.js');\n\
                import('./gone.js');\n\
                require.resolve('./lost.js');\n\
                import.meta.require('./away.js');\n";
    with_program(&[("main.js", main)], |program| {
        let main = program.file("main.js");
        let answers = program.site_answers("main.js");
        let specifiers = ["./nope.js", "./gone.js", "./lost.js", "./away.js"];
        assert_eq!(answers.len(), specifiers.len());
        let code_answers = program.input.files.code_answers(main);
        let cases = answers.iter().zip(code_answers).zip(specifiers).zip(0..);
        for (((&(site, answer), &code_answer), expected_specifier), number) in cases {
            assert_eq!(
                answer,
                SiteAnswer::Failed(ModuleFailureId(number)),
                "{site:?}"
            );
            let failure = program.graph.failure(ModuleFailureId(number));
            let ModuleFailureKind::Unresolved { specifier, reason } = failure.kind else {
                panic!("the failure is {:?}", failure.kind);
            };
            assert_eq!(program.text_of(specifier), expected_specifier);
            assert_eq!(code_answer, CodeAnswer::NotFound(reason));
            assert_eq!(failure.importer, main);
            assert_eq!(failure.site, site);
            assert_eq!(failure.effect(), FailureEffect::ThrowsAtSite);
            let quoted_specifier = format!("'{expected_specifier}'");
            assert_eq!(program.source_text(failure), quoted_specifier.as_str());
        }
        assert_eq!(program.graph.failures().len(), specifiers.len());
        assert!(program.graph.errors().is_empty());
        assert!(program.request_lines("main.js").is_empty());
    });
}

#[test]
fn failed_statement_site_is_erased_and_an_error() {
    let statements = [
        "import './nope.js';",
        "export * from './gone.js';",
        "export { x } from './lost.js';",
    ];
    let main = statements.join("\n");
    with_program(&[("main.js", main.as_str())], |program| {
        let answers = program.site_answers("main.js");
        assert_eq!(answers.len(), statements.len());
        let errors = program.graph.errors();
        assert_eq!(errors.len(), statements.len());
        let specifiers = ["./nope.js", "./gone.js", "./lost.js"];
        let cases = answers.iter().zip(errors).zip(statements).zip(specifiers);
        for (((&(site, answer), error), statement), expected_specifier) in cases {
            assert_eq!(answer, SiteAnswer::Erased, "{statement}");
            assert_eq!(error.site, site, "{statement}");
            assert_eq!(error.effect(), FailureEffect::StopsBuild, "{statement}");
            let ModuleFailureKind::Unresolved { specifier, .. } = error.kind else {
                panic!("the error is {:?}", error.kind);
            };
            assert_eq!(program.text_of(specifier), expected_specifier);
            assert_eq!(program.source_text(error), statement);
        }
        assert!(program.graph.failures().is_empty());
        assert!(program.request_lines("main.js").is_empty());
    });
}

#[test]
fn failed_import_equals_throws_at_its_site() {
    let main = "import legacy = require('./nope.cjs');\nexport const x = legacy;\n";
    with_program(&[("main.ts", main)], |program| {
        let site = ImportSiteKind::ImportEquals(ImportEqualsId(0));
        let answer = SiteAnswer::Failed(ModuleFailureId(0));
        assert_eq!(program.site_answers("main.ts"), [(site, answer)]);
        let [failure] = program.graph.failures() else {
            panic!("the failures are {:?}", program.graph.failures());
        };
        assert_eq!(failure.site, site);
        assert!(matches!(failure.kind, ModuleFailureKind::Unresolved { .. }));
        assert_eq!(failure.effect(), FailureEffect::ThrowsAtSite);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn only_loads_of_erased_module_fail() {
    let main = "
        import { feature } from 'bun:bundle';
        require('bun:bundle');
        import('bun:bundle');
        require.resolve('bun:bundle');
        import.meta.require('bun:bundle');
        import.meta.resolve('bun:bundle');
        process.getBuiltinModule('bun:bundle');
    ";
    with_program(&[("main.js", main)], |program| {
        let answers = program.site_answers("main.js");
        assert_eq!(answers.len(), 7);
        let mut failure_count = 0;
        for (site, answer) in answers {
            let id = match (site_form(site), answer) {
                (SiteForm::Declaration, SiteAnswer::Erased) => continue,
                (SiteForm::Resolve, SiteAnswer::Computed(Candidates::All)) => continue,
                (SiteForm::GetBuiltinModule, SiteAnswer::Erased) => continue,
                (SiteForm::Load, SiteAnswer::Failed(id)) => id,
                _ => panic!("{site:?} has the answer {answer:?}"),
            };
            let failure = program.graph.failure(id);
            let ModuleFailureKind::Unresolved { specifier, reason } = failure.kind else {
                panic!("the failure is {:?}", failure.kind);
            };
            assert_eq!(program.text_of(specifier), "bun:bundle");
            assert_eq!(reason, CodeFailure::ModuleNotFound);
            assert_eq!(failure.site, site);
            failure_count += 1;
        }
        assert_eq!(failure_count, 4);
        assert_eq!(program.graph.failures().len(), 4);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn unresolved_import_meta_resolve_is_no_failure() {
    let files = [("main.js", "import.meta.resolve('./nope.js');")];
    with_program(&files, |program| {
        let answers = program.site_answers("main.js");
        let [(ImportSiteKind::ImportMetaResolve(_), answer)] = answers[..] else {
            panic!("the import sites are {answers:?}");
        };
        assert_eq!(answer, SiteAnswer::Computed(Candidates::All));
        assert!(program.graph.failures().is_empty());
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn get_builtin_module_binds_only_runtime_modules() {
    let main = "
        process.getBuiltinModule('node:buffer');
        process.getBuiltinModule('./a.js');
        process.getBuiltinModule('node:nope');
    ";
    let files = [("main.js", main), ("a.js", "export {};")];
    with_program(&files, |program| {
        let answers = program.site_answers("main.js");
        for &(site, _) in &answers {
            assert!(
                matches!(site, ImportSiteKind::GetBuiltinModule(_)),
                "{site:?}"
            );
        }
        let [(_, runtime_module), (_, file), (_, unknown_module)] = answers[..] else {
            panic!("the import sites are {answers:?}");
        };
        let module = ModuleRef::Runtime(RuntimeModule::NodeBuffer);
        assert_eq!(runtime_module, SiteAnswer::Module(module));
        assert!(program.graph.other_modules().contains(&module));
        assert_eq!(file, SiteAnswer::Erased);
        assert_eq!(unknown_module, SiteAnswer::Erased);
        assert!(program.graph.failures().is_empty());
        assert!(program.graph.errors().is_empty());
        assert!(program.request_lines("main.js").is_empty());
    });
}

#[test]
fn get_builtin_module_of_unknown_host_module_is_erased() {
    with_scanner(
        "process.getBuiltinModule('node:buffer');",
        |scanner, sites| {
            let [site] = sites else {
                panic!("the import sites are {sites:?}");
            };
            let unknown_module = CodeAnswer::HostModule(HostModuleId(u32::MAX));
            let not_found = CodeAnswer::NotFound(CodeFailure::ModuleNotFound);
            for answer in [unknown_module, not_found] {
                let scanned = scanner.scan_site(0, site, answer);
                assert_eq!(scanned, ScannedSite::Erased, "{answer:?}");
            }
            assert!(scanner.failures.is_empty());
        },
    );
}

#[test]
fn stars_to_compared_external_bindings_are_dynamic() {
    let re_export = format!("export {{ z }} from '{UNCOMPILED_MODULE}';");
    let files = [
        ("main.js", "import './outer.js'; import './single.js';"),
        ("outer.js", "export * from './index.js';"),
        (
            "index.js",
            "export * from './middle.js'; export * from './b.js';",
        ),
        ("middle.js", "export * from './a.js';"),
        ("a.js", re_export.as_str()),
        ("b.js", re_export.as_str()),
        ("single.js", "export * from './a.js';"),
    ];
    with_program(&files, |program| {
        let expected_requests: [(&str, &[&str]); 4] = [
            ("outer.js", &["request index.js dynamic-star"]),
            (
                "index.js",
                &[
                    "request middle.js dynamic-star",
                    "request b.js dynamic-star",
                ],
            ),
            ("middle.js", &["request a.js dynamic-star"]),
            ("single.js", &["request a.js"]),
        ];
        for (name, expected) in expected_requests {
            assert_eq!(program.request_lines(name), expected, "{name}");
        }
    });
}

#[test]
fn unknown_specifier_is_all() {
    with_program(&[("main.cjs", "require(process.argv[2]);")], |program| {
        let answers = program.site_answers("main.cjs");
        let [(ImportSiteKind::Require(_), answer)] = answers[..] else {
            panic!("the import sites are {answers:?}");
        };
        assert_eq!(answer, SiteAnswer::Computed(Candidates::All));
        assert!(program.graph.failures().is_empty());
    });
}

#[test]
fn pattern_site_lists_candidates() {
    let files = [
        (
            "main.ts",
            "export const load = (name: string) => import(`./pages/${name}.ts`);",
        ),
        ("pages/home.ts", "export {};"),
        ("pages/about.ts", "export {};"),
        ("pages/style.css", "body {}"),
    ];
    with_program(&files, |program| {
        let pages = ["pages/about.ts", "pages/home.ts"];
        let expected = pages.map(|name| SpelledModule {
            spelling: program.atom(&format!("./{name}")),
            module: program.module(name),
        });
        assert_eq!(program.only_candidates("main.ts"), expected);
        assert!(program.request_lines("main.ts").is_empty());
        for name in pages {
            assert!(program.graph.has_record(program.file(name)));
        }
    });
}

#[test]
fn pattern_without_match_lists_nothing() {
    with_program(&[("main.cjs", PATTERN_REQUIRE)], |program| {
        assert!(program.only_candidates("main.cjs").is_empty());
        assert!(program.graph.failures().is_empty());
    });
}

#[test]
fn pattern_over_bun_modules_lists_runtime_modules() {
    let main = "module.exports = (name) => require('node:' + name);";
    with_program(&[("main.cjs", main)], |program| {
        assert!(program.only_candidates("main.cjs").is_empty());
        let modules = program.graph.other_modules();
        for module in [RuntimeModule::NodeFs, RuntimeModule::NodeBuffer] {
            assert!(modules.contains(&ModuleRef::Runtime(module)), "{module:?}");
        }
        assert!(!modules.contains(&ModuleRef::Runtime(RuntimeModule::Bun)));
        for module in modules {
            assert!(matches!(module, ModuleRef::Runtime(_)), "{module:?}");
        }
    });
}

#[test]
fn candidates_of_each_site_are_a_range() {
    with_scanner(PATTERN_REQUIRE, |scanner, sites| {
        let [site] = sites else {
            panic!("the import sites are {sites:?}");
        };
        let fs = HostModuleId(RuntimeModule::NodeFs.registry_id());
        let host_modules = [fs, HostModuleId(u32::MAX)];
        let first = CodeAnswer::Computed(ComputedTargets::Modules {
            files: &[FileId(5), FileId(7)],
            host_modules: &host_modules,
            spellings: &[
                (Atom(1), ComputedTarget::File(FileId(5))),
                (Atom(2), ComputedTarget::HostModule(HostModuleId(u32::MAX))),
                (Atom(3), ComputedTarget::HostModule(fs)),
            ],
        });
        let second = CodeAnswer::Computed(ComputedTargets::Modules {
            files: &[FileId(5)],
            host_modules: &[],
            spellings: &[(Atom(1), ComputedTarget::File(FileId(5)))],
        });
        assert_eq!(
            scanner.scan_site(0, site, first),
            ScannedSite::Candidates(0..2)
        );
        assert_eq!(
            scanner.scan_site(1, site, second),
            ScannedSite::Candidates(2..3)
        );
        let expected = [
            ModuleRef::File(FileId(5)),
            ModuleRef::File(FileId(7)),
            ModuleRef::Runtime(RuntimeModule::NodeFs),
            ModuleRef::File(FileId(5)),
        ];
        assert_eq!(scanner.candidates, expected);
        let spelled = |spelling, module| SpelledModule {
            spelling: Atom(spelling),
            module,
        };
        let expected = [
            spelled(1, ModuleRef::File(FileId(5))),
            spelled(3, ModuleRef::Runtime(RuntimeModule::NodeFs)),
            spelled(1, ModuleRef::File(FileId(5))),
        ];
        assert_eq!(scanner.spellings, expected);
        assert!(scanner.failures.is_empty());
    });
}

#[test]
fn site_over_candidate_limit_is_recorded() {
    with_scanner(PATTERN_REQUIRE, |scanner, sites| {
        let [site] = sites else {
            panic!("the import sites are {sites:?}");
        };
        let unknown_for = |cause| {
            CodeAnswer::Computed(ComputedTargets::All {
                cause,
                host_modules: &[],
            })
        };
        let other_causes = [
            ComputedUnknown::NoPattern,
            ComputedUnknown::NoConstantPrefix,
            ComputedUnknown::IncompletePackageName,
            ComputedUnknown::PackageImports,
            ComputedUnknown::ConfigPaths,
            ComputedUnknown::ExternalCandidate,
        ];
        for cause in other_causes {
            let scanned = scanner.scan_site(0, site, unknown_for(cause));
            assert_eq!(scanned, ScannedSite::AllModules, "{cause:?}");
        }
        assert!(scanner.sites_over_candidate_limit.is_empty());

        let over_limit = unknown_for(ComputedUnknown::TooManyCandidates);
        assert_eq!(
            scanner.scan_site(0, site, over_limit),
            ScannedSite::AllModules
        );
        let [span] = scanner.sites_over_candidate_limit[..] else {
            panic!("the sites are {:?}", scanner.sites_over_candidate_limit);
        };
        assert_eq!(span.file, scanner.file);
        let text = &scanner.hir.text[span.start as usize..span.end as usize];
        assert_eq!(BStr::new(text), "`./pages/${name}.js`");
        assert!(scanner.candidates.is_empty());
        assert!(scanner.failures.is_empty());
    });
}

#[test]
fn external_kind_is_recorded() {
    let main = format!("import '{UNCOMPILED_MODULE}'; import '{HOST_VALUE_MODULE}';");
    with_program(&[("main.js", main.as_str())], |program| {
        let importer = program.file("main.js");
        let expected = [
            (
                program.atom(UNCOMPILED_MODULE),
                ExternalKind::UncompiledCode,
            ),
            (program.atom(HOST_VALUE_MODULE), ExternalKind::HostValue),
        ];
        assert_eq!(scan_files(program.input).of(importer).externals, expected);
        let answers = program.site_answers("main.js");
        assert_eq!(answers.len(), expected.len());
        for (&(_, answer), (specifier, kind)) in answers.iter().zip(expected) {
            let module = ModuleRef::External {
                importer,
                specifier,
            };
            assert_eq!(answer, SiteAnswer::Module(module));
            assert_eq!(program.graph.external_kind(module), Some(kind));
            assert!(program.graph.other_modules().contains(&module));
        }
        let expected_requests = [UNCOMPILED_MODULE, HOST_VALUE_MODULE]
            .map(|specifier| format!("request external:{specifier}"));
        assert_eq!(program.request_lines("main.js"), expected_requests);
    });
}

#[test]
fn jsx_modules_are_requested_first() {
    let main = format!("import './other.js';\n{ELEMENT}\n{KEY_AFTER_SPREAD}\n");
    with_react_program(&main, |program| {
        let requested_files = [JSX_RUNTIME, JSX_PACKAGE, "other.js"];
        let expected = requested_files.map(|name| format!("request {name}"));
        assert_eq!(program.request_lines("main.jsx"), expected);
        let expected_sites = [
            ImportSiteKind::JsxRuntime,
            ImportSiteKind::JsxPackage,
            ImportSiteKind::Import(ImportId(0)),
        ];
        let expected_answers: Vec<_> = expected_sites
            .into_iter()
            .zip(requested_files.map(|name| SiteAnswer::Module(program.module(name))))
            .collect();
        assert_eq!(program.site_answers("main.jsx"), expected_answers);
    });
}

#[test]
fn unused_jsx_package_is_not_requested() {
    with_react_program(ELEMENT, |program| {
        let expected = [format!("request {JSX_RUNTIME}")];
        assert_eq!(program.request_lines("main.jsx"), expected);
    });
}

#[test]
fn key_after_spread_requests_package_only() {
    with_react_program(KEY_AFTER_SPREAD, |program| {
        let expected = [format!("request {JSX_PACKAGE}")];
        assert_eq!(program.request_lines("main.jsx"), expected);
    });
}

#[test]
fn file_without_jsx_requests_no_jsx_module() {
    with_react_program("export const x = 1;", |program| {
        assert!(program.request_lines("main.jsx").is_empty());
        assert!(program.site_answers("main.jsx").is_empty());
    });
}

#[test]
fn commonjs_file_has_jsx_site_without_request() {
    with_react_program("module.exports = <div />;", |program| {
        let main = program.file("main.jsx");
        assert_eq!(program.graph.kind(main), ModuleKind::CommonJs);
        assert!(program.graph.requests(main).is_empty());
        let runtime = SiteAnswer::Module(program.module(JSX_RUNTIME));
        let expected = [(ImportSiteKind::JsxRuntime, runtime)];
        assert_eq!(program.site_answers("main.jsx"), expected);
    });
}

#[test]
fn erased_jsx_module_is_not_found() {
    with_scanner(ELEMENT, |scanner, sites| {
        let [site] = sites else {
            panic!("the import sites are {sites:?}");
        };
        assert_eq!(site.kind, ImportSiteKind::JsxRuntime);
        let scanned = scanner.scan_site(0, site, CodeAnswer::Erased);
        assert_eq!(scanned, ScannedSite::Unresolved);
        let [pending] = scanner.failures[..] else {
            panic!("the failures are {:?}", scanner.failures);
        };
        assert_eq!(pending.failure.site, ImportSiteKind::JsxRuntime);
        assert_eq!((pending.failure.start, pending.failure.end), (0, 0));
        assert!(matches!(
            pending.failure.kind,
            ModuleFailureKind::Unresolved {
                reason: CodeFailure::ModuleNotFound,
                ..
            }
        ));
    });
}

#[test]
fn runtime_module_is_listed_once() {
    let files = [
        ("main.js", "import 'node:buffer'; import './a.js';"),
        ("a.js", "import 'node:buffer';"),
    ];
    with_program(&files, |program| {
        let module = ModuleRef::Runtime(RuntimeModule::NodeBuffer);
        assert_eq!(
            program.site_answers("main.js")[0].1,
            SiteAnswer::Module(module)
        );
        assert_eq!(
            program.site_answers("a.js")[0].1,
            SiteAnswer::Module(module)
        );
        let other_modules = program.graph.other_modules();
        let atoms = &program.input.files.atoms;
        let is_less = |a: &ModuleRef, b: &ModuleRef| compare_modules(*a, *b, atoms).is_lt();
        assert!(other_modules.contains(&module));
        assert!(other_modules.is_sorted_by(is_less));
    });
}

#[test]
fn unknown_host_module_is_not_found() {
    with_scanner("export {};", |scanner, _| {
        let result = scanner.answer_of(CodeAnswer::HostModule(HostModuleId(u32::MAX)));
        assert_eq!(result, Err(CodeFailure::BuiltinModuleNotFound));
        let known_module = HostModuleId(RuntimeModule::NodeFs.registry_id());
        let module = ModuleRef::Runtime(RuntimeModule::NodeFs);
        let result = scanner.answer_of(CodeAnswer::HostModule(known_module));
        assert_eq!(result, Ok(ScannedSite::Module(module)));
    });
}

#[test]
fn external_module_names_importer_and_specifier() {
    with_scanner("export {};", |scanner, _| {
        let (specifier, kind) = (Atom(0), ExternalKind::HostValue);
        let module = ModuleRef::External {
            importer: scanner.file,
            specifier,
        };
        let result = scanner.answer_of(CodeAnswer::External { specifier, kind });
        assert_eq!(result, Ok(ScannedSite::Module(module)));
        assert_eq!(scanner.externals, [(specifier, kind)]);
    });
}

#[test]
fn requests_merge_past_scan_limit() {
    let create_draft = |file: u32, is_star_export: bool| RequestDraft {
        target: ModuleRef::File(FileId(file)),
        phase: ImportPhase::Evaluation,
        is_star_export,
    };
    let limit = MAX_SCANNED_REQUESTS as u32;
    for count in [limit, limit + 1, 3 * limit] {
        let mut requests = RequestList::default();
        for file in 0..count {
            requests.add(create_draft(file, false));
        }
        for file in (0..count).rev() {
            requests.add(create_draft(file, file % 2 == 0));
        }
        requests.add(RequestDraft {
            phase: ImportPhase::Defer,
            ..create_draft(0, false)
        });

        let (deferred, drafts) = requests.drafts.split_last().unwrap();
        assert_eq!(deferred.target, ModuleRef::File(FileId(0)));
        assert_eq!(deferred.phase, ImportPhase::Defer);
        assert_eq!(drafts.len(), count as usize);
        for (file, draft) in (0..count).zip(drafts) {
            assert_eq!(draft.target, ModuleRef::File(FileId(file)));
            assert_eq!(draft.phase, ImportPhase::Evaluation);
            assert_eq!(draft.is_star_export, file % 2 == 0);
        }
    }
}
