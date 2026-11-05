mod module_set;

use super::*;
use crate::compile::testing::{default_settings, with_loaded_build_and_options};
use crate::load::ProjectId;
use crate::load::runtime_modules::HOST_VALUE_MODULE;
use crate::modules::testing::{describe_module, file_named, with_graph};
use crate::modules::{
    Candidates, ModuleFailure, ModuleFailureId, ModuleGraph, SiteAnswer, compare_modules,
};
use bstr::BStr;
use bun_ast::Loader;
use bun_core::strings::split;
use bun_options_types::aot_options::AotOptions;
use bun_sema::hir::ImportEqualsId;
use bun_sema::program::HostModuleId;

const JSX_RUNTIME: &str = "node_modules/react/jsx-dev-runtime.js";
const JSX_PACKAGE: &str = "node_modules/react/index.js";
const ELEMENT: &str = "export const element = <div />;";
const KEY_AFTER_SPREAD: &str = "export const keyed = (props) => <div {...props} key='k' />;";
const UNCOMPILED_MODULE: &str = "https://example.com/z.js";
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
            files,
            sources: program.input.sources,
            runs_tests: program.input.runs_tests,
            asks_loader_where_bundler_does: false,
            hir: files.hir(main),
            compiled,
            named_in_choices: &[],
            candidates: Vec::new(),
            spellings: Vec::new(),
            externals: Vec::new(),
            failures: Vec::new(),
        };
        check(&mut scanner, compiled.analysis.import_sites);
    });
}

fn with_program_that_loads_code_from_disk(
    main: &str,
    check: impl FnOnce(&ModuleGraph, &Files<'_>, FileId),
) {
    let options = AotOptions {
        loads_code_from_disk: true,
        ..AotOptions::default()
    };
    let files = [("main.js", main)];
    with_loaded_build_and_options(&files, &default_settings(), options, |build, loaded| {
        let Ok(bound) = build.bind_modules(loaded) else {
            panic!("the modules were not bound");
        };
        let files = loaded.project(ProjectId::Application).loaded.files();
        check(
            &bound.projects.application.graph,
            files,
            files.entry_points()[0],
        );
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
            is_left_to_loader: false,
        });
        assert_eq!(program.only_candidates("main.ts"), expected);
        assert!(program.request_lines("main.ts").is_empty());
        for name in pages {
            assert!(program.graph.has_record(program.file(name)));
        }
    });
}

#[test]
fn computed_site_beside_a_plugin_leaves_its_files_to_the_loader() {
    const PLUGIN: &str = r#"Bun.plugin({ name: "p", setup() {} });"#;
    const CHOICE: &str = r#"(flag ? "./pages/home.js" : "./pages/about.js")"#;
    // The file, the body of a function, and whether the loader is given the names beside a plugin.
    let rows = [
        (
            "main.mjs",
            "const pick = CHOICE; return import(pick);",
            true,
        ),
        ("main.mjs", "return import(`./pages/${flag}.js`);", true),
        (
            "main.cjs",
            "return require('./pages/' + flag + '.js');",
            true,
        ),
        ("main.mjs", "return import.meta.require(CHOICE);", true),
        // `bun build` links these two.
        ("main.mjs", "return import(CHOICE);", false),
        ("main.cjs", "return require(CHOICE);", false),
    ];
    for (name, body, is_left_beside_plugin) in rows {
        for plugin in [PLUGIN, ""] {
            let body = body.replace("CHOICE", CHOICE);
            let main = format!("{plugin}\nglobalThis.load = function (flag) {{ {body} }};\n");
            let files = [
                (name, &main[..]),
                ("pages/home.js", "globalThis.home = 1;"),
                ("pages/about.js", "globalThis.about = 1;"),
            ];
            with_program(&files, |program| {
                let candidates = program.only_candidates(name).iter();
                let mut spelled: Vec<(String, ModuleRef, bool)> = candidates
                    .map(|it| {
                        let spelling = program.text_of(it.spelling).to_string();
                        (spelling, it.module, it.is_left_to_loader)
                    })
                    .collect();
                spelled.sort_by(|left, right| left.0.cmp(&right.0));
                let is_left = is_left_beside_plugin && !plugin.is_empty();
                let expected = ["pages/about.js", "pages/home.js"]
                    .map(|page| (format!("./{page}"), program.module(page), is_left));
                assert_eq!(spelled, expected, "{main}");
            });
        }
    }
}

#[test]
fn name_that_a_package_json_resolves_is_left_to_the_loader_beside_a_plugin() {
    let files = [
        (
            "main.mjs",
            r#"Bun.plugin({ name: "p", setup() {} });
            globalThis.load = function (flag) { const pick = flag ? "kit" : "./tool"; return import(pick); };"#,
        ),
        (
            "node_modules/kit/package.json",
            r#"{ "name": "kit", "main": "./start.js" }"#,
        ),
        ("node_modules/kit/start.js", "globalThis.kit = 1;"),
        ("tool/package.json", r#"{ "main": "./start.js" }"#),
        ("tool/start.js", "globalThis.tool = 1;"),
    ];
    with_program(&files, |program| {
        let candidates = program.only_candidates("main.mjs");
        let mut spelled: Vec<(String, bool)> = candidates
            .iter()
            .map(|it| {
                (
                    program.text_of(it.spelling).to_string(),
                    it.is_left_to_loader,
                )
            })
            .collect();
        spelled.sort();
        // The names of packages are written down for entry points. A folder whose package.json names its main file stays linked.
        let expected = [("./tool".to_string(), false), ("kit".to_string(), true)];
        assert_eq!(spelled, expected);
        let entry_points = program.input.files.entry_points();
        assert!(entry_points.contains(&program.file("node_modules/kit/start.js")));
        assert!(!entry_points.contains(&program.file("tool/start.js")));
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
            is_left_to_loader: false,
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
                type_attribute: None,
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
fn load_of_file_missing_at_build_is_left_to_loader() {
    let main = "
        export {};
        import('./made.mjs');
        require('./made.cjs');
        require.resolve('./made.cjs');
    ";
    with_program_that_loads_code_from_disk(main, |graph, files, main| {
        let left_to_loader = ["./made.mjs", "./made.cjs"].map(|specifier| ModuleRef::External {
            importer: main,
            specifier: files.atoms.intern(specifier.as_bytes()),
            type_attribute: None,
        });
        let [imported, required] = left_to_loader.map(SiteAnswer::Module);
        // Load lists the calls that load a module, and this one only looks for it.
        let resolved = SiteAnswer::Failed(ModuleFailureId(0));
        let sites = files.analysis(main).import_sites.iter();
        let answers: Vec<_> = sites
            .map(|site| graph.site_answer(main, site.kind))
            .collect();
        assert_eq!(answers, [imported, required, resolved]);
        let kinds = left_to_loader.map(|module| graph.external_kind(module));
        assert_eq!(kinds, [Some(ExternalKind::UncompiledCode); 2]);
        assert!(graph.errors().is_empty());
        assert_eq!(graph.failures().len(), 1);
    });
}

#[test]
fn statement_that_names_file_missing_at_build_is_an_error() {
    with_program_that_loads_code_from_disk("import './made.mjs';", |graph, files, main| {
        let sites = files.analysis(main).import_sites;
        let [site] = sites else {
            panic!("the import sites are {sites:?}");
        };
        assert_eq!(graph.site_answer(main, site.kind), SiteAnswer::Erased);
        let [error] = graph.errors() else {
            panic!("the errors are {:?}", graph.errors());
        };
        assert_eq!(error.site, site.kind);
        assert_eq!(error.effect(), FailureEffect::StopsBuild);
        assert!(graph.failures().is_empty());
    });
}

#[test]
fn import_statement_hands_its_type_to_the_loader() {
    let main = format!(
        "import a from '{UNCOMPILED_MODULE}' with {{ type: 'toml' }};
        import b from '{UNCOMPILED_MODULE}';
        import c from '{UNCOMPILED_MODULE}' with {{ type: 'TEXT' }};
        import d from '{UNCOMPILED_MODULE}' with {{ type: 'no loader' }};
        export {{ e }} from '{UNCOMPILED_MODULE}' with {{ type: 'toml' }};
        export * as f from '{UNCOMPILED_MODULE}' with {{ type: 'text' }};
        import('{UNCOMPILED_MODULE}', {{ with: {{ type: 'toml' }} }});"
    );
    with_program(&[("main.js", main.as_str())], |program| {
        let external = |type_attribute| {
            SiteAnswer::Module(ModuleRef::External {
                importer: program.file("main.js"),
                specifier: program.atom(UNCOMPILED_MODULE),
                type_attribute,
            })
        };
        let answers = program.site_answers("main.js");
        let answers: Vec<_> = answers.iter().map(|&(_, answer)| answer).collect();
        let (toml, text) = (Some(Loader::Toml), Some(Loader::Text));
        let expected = [toml, None, text, None, toml, text, None].map(external);
        assert_eq!(answers, expected);
        // One module for each type, and the one that no attribute asks for comes first.
        let modules = [None, toml, text].map(external);
        let listed = program.graph.other_modules().iter();
        let listed: Vec<_> = listed.map(|&module| SiteAnswer::Module(module)).collect();
        assert_eq!(listed, modules);
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
fn commonjs_file_requires_module_of_its_jsx() {
    with_react_program("module.exports = <div />;", |program| {
        let main = program.file("main.jsx");
        assert_eq!(program.graph.kind(main), ModuleKind::CommonJs);
        let requests = program.graph.requests(main);
        let [request] = requests else {
            panic!("the requests are {requests:?}");
        };
        assert_eq!(request.target, program.module(JSX_RUNTIME));
        assert_eq!(
            request.kind,
            crate::ir::generated::ModuleRequestKind::Require
        );
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
            type_attribute: None,
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
