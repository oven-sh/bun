use std::borrow::Cow;
use std::iter;

use bun_ast::Loader;
use bun_builtin_sources::Archive;
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{ExprId, ImportId, StmtId};
use bun_sema::import_sites::{ImportSpecifier, JsxMode};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::program::CodeAnswer;
use bun_sema::resolve::{
    CodeFailure, CodeFile, ComputedCandidate, ComputedResolution, ComputedUnknown, ExternalKind,
};
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::*;
use crate::builtins::BuiltinId;
use crate::builtins::table::{self, STARTUP_FUNCTIONS, namespace_of};
use crate::compile::testing::{default_settings, with_bind_input};
use crate::load::host_platform;
use crate::load::loaders::BY_NAME;
use crate::load::sources::parsed_source;

const PROGRAM_PATH: &[u8] = b"/project/main.ts";
const RUNTIME_PATH: &[u8] = b"/$bun/js/node/example.ts";
const TEXT_PATH: &[u8] = b"/$bun/text/%2fproject%2fmain.ts/3.cjs";
const MAX_FOLDED_STRING_BYTES: usize = 1 << 16;
const STDOUT_USE: &str = "process.stdout.write('a');";

struct Finished {
    answers: Vec<HostResolution>,
    source: ParsedSource,
}

fn runtime_modules() -> RuntimeModules {
    RuntimeModules::new(Archive::embedded(), false)
}

fn host_module_id(module: RuntimeModule) -> HostModuleId {
    HostModuleId(module.registry_id())
}

fn module_by_id(module: RuntimeModule) -> HostResolution {
    HostResolution::Module(host_module_id(module))
}

fn host_module(module: RuntimeModule) -> SiteResolution<'static> {
    SiteResolution::Constant(CodeResolution::HostModule(host_module_id(module)))
}

fn external(kind: ExternalKind) -> CodeResolution<'static> {
    CodeResolution::External {
        specifier: b"react",
        kind,
    }
}

fn with_finished_file<R>(
    path: &[u8],
    text: &str,
    then: impl FnOnce(&BuiltinUseInput<'_>, &FinishedFile<'_, '_>) -> R,
) -> R {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let names = BuiltinNames::new(&atoms);
    let parse_options = CompileParseOptions {
        path,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        keeps_function_directives: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, text.as_bytes(), &atoms);
    hir.text = Cow::Borrowed(text.as_bytes());
    let fold_options = FoldOptions {
        max_string_bytes: MAX_FOLDED_STRING_BYTES,
        ..FoldOptions::default()
    };
    let fold = FoldInputs::new(fold_options, arena);
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let file = FileInputs {
        declared_module_type: match path.ends_with(b".cjs") {
            true => DeclaredModuleType::CommonJs,
            false => DeclaredModuleType::Unknown,
        },
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
    };
    let (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    assert!(!hir.has_errors, "syntax error in: {text}");
    assert!(
        analysis.import_sites.is_empty(),
        "the fixture resolves no import: {text}"
    );
    let input = BuiltinUseInput {
        names: &names,
        platform: host_platform(),
    };
    let request = FinishedFile {
        path,
        loader: BY_NAME,
        hir: &hir,
        bound: &bound,
        analysis: &analysis,
        atoms: &atoms,
        resolutions: &[],
    };
    then(&input, &request)
}

fn finish_application(text: &str) -> Finished {
    with_finished_file(PROGRAM_PATH, text, |input, request| {
        let mut source = ParsedSource::new(SourceKind::Program, Loader::Ts);
        let texts = EvaluatedTexts::new();
        let answers = finish_application_file(input, Some(&texts), false, request, &mut source);
        Finished { answers, source }
    })
}

fn finish_runtime(text: &str) -> Finished {
    with_finished_file(RUNTIME_PATH, text, |input, request| {
        let mut source = ParsedSource::new(SourceKind::RuntimeFunctions, Loader::Ts);
        let answers = finish_runtime_file(input, &runtime_modules(), request, &mut source);
        Finished { answers, source }
    })
}

fn count_answers(finished: &Finished, expected: &HostResolution) -> usize {
    let answers = finished.answers.iter();
    answers.filter(|&answer| answer == expected).count()
}

#[track_caller]
fn path_of(answer: &HostResolution) -> &[u8] {
    match answer {
        HostResolution::Path(path) => path,
        other => panic!("expected a path, got {other:?}"),
    }
}

#[test]
fn builtin_use_implies_runtime_module() {
    let finished = finish_application(STDOUT_USE);
    let loads = table::entry(BuiltinId::ProcessStdout).loads();
    let mut loaded_modules = loads.iter().map(|load| load.module);
    assert!(loaded_modules.any(|module| module == RuntimeModule::NodeTty));
    for load in loads {
        assert_eq!(
            count_answers(&finished, &module_by_id(load.module)),
            1,
            "{:?}",
            load.module
        );
    }
}

#[test]
fn file_without_builtin_use_implies_nothing() {
    let text = "export const text = 'process.stdout';";
    assert!(finish_application(text).answers.is_empty());
    assert!(finish_runtime(text).answers.is_empty());
}

#[test]
fn two_uses_imply_one_file() {
    let once = finish_application(STDOUT_USE);
    let twice = finish_application("process.stdout.write('a'); process.stdout.write('b');");
    assert_eq!(
        count_answers(&twice, &module_by_id(RuntimeModule::NodeTty)),
        1
    );
    assert_eq!(twice.answers, once.answers);

    let once = finish_runtime(STDOUT_USE);
    let twice = finish_runtime("process.stdout.write('a'); process.stdout.write('b');");
    assert_eq!(twice.answers, once.answers);
}

#[test]
fn application_file_gets_module_ids_not_paths() {
    let application = finish_application(STDOUT_USE);
    let ids = application.answers.iter().map(|answer| match answer {
        HostResolution::Module(id) => *id,
        other => panic!("expected the id of a module, got {other:?}"),
    });
    let ids: Vec<HostModuleId> = ids.collect();
    assert!(!ids.is_empty());
    assert!(ids.is_sorted_by(|a, b| a < b));
    let builtins = &application.source.builtins;
    let mut loaded_modules: Vec<HostModuleId> =
        builtins.loaded_modules().map(host_module_id).collect();
    loaded_modules.sort_unstable();
    assert_eq!(ids, loaded_modules);
    assert!(builtins.called_functions().next().is_some());
}

#[test]
fn runtime_file_gets_sources_and_function_files() {
    let runtime = runtime_modules();
    let finished = finish_runtime(STDOUT_USE);
    let builtins = &finished.source.builtins;
    let mut ids: Vec<HostModuleId> = builtins.loaded_modules().map(host_module_id).collect();
    ids.sort_unstable();
    let (modules, function_files) = finished.answers.split_at(ids.len());
    let expected = ids.into_iter().map(|id| runtime.module_resolution(id));
    let expected: Vec<HostResolution> = expected.collect();
    assert_eq!(modules, expected);
    let tty_path = runtime.module_path(RuntimeModule::NodeTty).unwrap();
    let tty_source = HostResolution::ModuleSource {
        module: host_module_id(RuntimeModule::NodeTty),
        path: tty_path.to_vec(),
    };
    assert!(modules.contains(&tty_source));

    let function_files: Vec<&[u8]> = function_files.iter().map(path_of).collect();
    let called_functions = builtins.called_functions();
    let mut expected_files: Vec<Vec<u8>> = called_functions
        .filter_map(|function| runtime.function_file_path(function))
        .collect();
    expected_files.sort_unstable();
    expected_files.dedup();
    assert!(!expected_files.is_empty());
    assert_eq!(function_files, expected_files);
}

#[test]
fn payload_holds_the_resolved_builtins() {
    for finished in [finish_application(STDOUT_USE), finish_runtime(STDOUT_USE)] {
        let mentioned = finished.source.builtins.mentioned();
        assert!(mentioned.contains(&BuiltinId::ProcessStdout));
    }
    for finished in [
        finish_application("export {};"),
        finish_runtime("export {};"),
    ] {
        assert!(finished.source.builtins.mentioned().is_empty());
    }
}

#[test]
fn only_runtime_modules_are_import_targets() {
    let module = RuntimeModule::NodeFs;
    let module_source = CodeFile {
        path: b"/$bun/js/node/fs.ts",
        host_module: Some(host_module_id(module)),
    };
    assert_eq!(target_module(host_module(module)), Some(module));
    let module_file = SiteResolution::Constant(CodeResolution::File(module_source));
    assert_eq!(target_module(module_file), Some(module));

    let program_file = CodeFile {
        host_module: None,
        ..module_source
    };
    let other_resolutions = [
        CodeResolution::File(program_file),
        CodeResolution::HostModule(HostModuleId(u32::MAX)),
        external(ExternalKind::UncompiledCode),
        external(ExternalKind::HostValue),
        CodeResolution::Erased,
        CodeResolution::NotFound(CodeFailure::ModuleNotFound),
    ];
    for resolution in other_resolutions {
        let site = SiteResolution::Constant(resolution);
        assert_eq!(target_module(site), None, "{resolution:?}");
    }
}

#[test]
fn bun_is_an_import_target_without_builtin_modules() {
    let bun = |kind| {
        SiteResolution::Constant(CodeResolution::External {
            specifier: b"bun",
            kind,
        })
    };
    assert_eq!(
        target_module(bun(ExternalKind::HostValue)),
        Some(RuntimeModule::Bun)
    );
    assert_eq!(target_module(bun(ExternalKind::UncompiledCode)), None);
}

const NO_CANDIDATES: ComputedResolution<'static> = ComputedResolution::Candidates {
    candidates: &[],
    spellings: &[],
};

#[test]
fn computed_site_is_no_import_target() {
    let candidates = [ComputedCandidate::HostModule(host_module_id(
        RuntimeModule::NodeFs,
    ))];
    let resolutions = [
        ComputedResolution::Candidates {
            candidates: &candidates,
            spellings: &[],
        },
        NO_CANDIDATES,
        ComputedResolution::All {
            cause: ComputedUnknown::NoPattern,
            host_modules: &candidates,
        },
    ];
    for resolution in resolutions {
        let site = SiteResolution::Computed(resolution);
        assert_eq!(target_module(site), None, "{resolution:?}");
    }
}

#[test]
fn import_targets_ascend_by_site() {
    let site = |kind| ImportSite {
        kind,
        specifier: ImportSpecifier::Unknown,
        specifier_node: ExprId::NONE,
        attributes: ExprId::NONE,
        consults_resolver: true,
        is_host_value: false,
    };
    let export_star = ImportSiteKind::ExportStar(StmtId(0));
    let import = ImportSiteKind::Import(ImportId(0));
    let require = ImportSiteKind::Require(ExprId(4));
    let import_call = ImportSiteKind::ImportCall(ExprId(9));
    let sites = [export_star, import, require, import_call].map(site);
    let resolutions = [
        host_module(RuntimeModule::NodePath),
        SiteResolution::Constant(external(ExternalKind::UncompiledCode)),
        host_module(RuntimeModule::NodeFs),
        SiteResolution::Computed(NO_CANDIDATES),
    ];
    assert_eq!(
        collect_import_targets(&sites, &resolutions),
        [
            (import, None),
            (export_star, Some(RuntimeModule::NodePath)),
            (import_call, None),
            (require, Some(RuntimeModule::NodeFs)),
        ]
    );
}

#[test]
fn imports_resolve_in_any_statement_order() {
    let source = "export * from 'node:path';\n\
                  import { readFileSync } from 'node:fs';\n\
                  readFileSync;";
    with_bind_input(&[("main.ts", source)], &default_settings(), |input| {
        let main = input.files.entry_points()[0];
        let parsed = parsed_source(input.files, main).expect("a compiled file has a payload");
        let mentioned = parsed.builtins.mentioned();
        for module in [RuntimeModule::NodePath, RuntimeModule::NodeFs] {
            assert!(mentioned.contains(&namespace_of(module)), "{module:?}");
        }
        assert!(!mentioned.contains(&namespace_of(RuntimeModule::NodeOs)));
    });
}

#[test]
fn implied_paths_are_sorted_and_unique() {
    let runtime = runtime_modules();
    let modules = [
        RuntimeModule::NodeTty,
        RuntimeModule::BunJsc,
        RuntimeModule::NodeFs,
        RuntimeModule::NodeTty,
    ];
    let reversed_functions = STARTUP_FUNCTIONS.iter().rev();
    let functions = reversed_functions.chain(STARTUP_FUNCTIONS).copied();
    let answers = collect_implied_answers(&runtime, modules.into_iter(), functions, PROGRAM_PATH);

    let mut ids = [
        RuntimeModule::NodeTty,
        RuntimeModule::BunJsc,
        RuntimeModule::NodeFs,
    ]
    .map(host_module_id);
    ids.sort_unstable();
    let expected_modules = ids.map(|id| runtime.module_resolution(id));
    let (module_answers, function_files) = answers.split_at(expected_modules.len());
    assert_eq!(module_answers, expected_modules);
    assert!(module_answers.contains(&module_by_id(RuntimeModule::BunJsc)));

    let function_files: Vec<&[u8]> = function_files.iter().map(path_of).collect();
    assert!(function_files.is_sorted_by(|a, b| a < b));
    for &function in STARTUP_FUNCTIONS {
        let path = runtime.function_file_path(function).unwrap();
        assert!(function_files.contains(&path.as_slice()), "{function:?}");
    }
}

#[test]
fn own_path_is_not_implied() {
    let runtime = runtime_modules();
    let own_path = runtime.module_path(RuntimeModule::NodeTty).unwrap();
    let modules = [RuntimeModule::NodeTty, RuntimeModule::NodeFs];
    let answers = collect_implied_answers(&runtime, modules.into_iter(), iter::empty(), own_path);
    let fs_source = runtime.module_resolution(host_module_id(RuntimeModule::NodeFs));
    assert_eq!(answers, [fs_source]);

    let function = STARTUP_FUNCTIONS[0];
    let own_file = runtime.function_file_path(function).unwrap();
    let implied_from =
        |path: &[u8]| collect_implied_answers(&runtime, iter::empty(), iter::once(function), path);
    assert!(implied_from(&own_file).is_empty());
    assert_eq!(implied_from(own_path), [HostResolution::Path(own_file)]);
}

#[test]
fn file_without_builtins_has_no_implied_answers() {
    let runtime = runtime_modules();
    let answers = collect_implied_answers(&runtime, iter::empty(), iter::empty(), PROGRAM_PATH);
    assert!(answers.is_empty());
}

#[test]
fn omitted_builtin_modules_imply_no_paths() {
    let runtime = RuntimeModules::new(Archive::embedded(), true);
    let modules = iter::once(RuntimeModule::NodeTty);
    let functions = STARTUP_FUNCTIONS.iter().copied();
    let answers = collect_implied_answers(&runtime, modules, functions, PROGRAM_PATH);
    assert_eq!(answers, [module_by_id(RuntimeModule::NodeTty)]);
}

#[test]
fn evaluated_text_site_indexes_its_answer() {
    let text = "process.stdout;\n\
                Function('return (');\n\
                Function('return 1');\n\
                new Function('a', 'return a');";
    with_finished_file(PROGRAM_PATH, text, |input, request| {
        let texts = EvaluatedTexts::new();
        let mut source = ParsedSource::new(SourceKind::Program, Loader::Ts);
        let answers = finish_application_file(input, Some(&texts), false, request, &mut source);

        assert_eq!(source.builtins.evaluated_texts().len(), 3);
        let is_module = |answer: &&HostResolution| matches!(answer, HostResolution::Module(_));
        let module_count = answers.iter().take_while(is_module).count();
        assert!(module_count > 0);
        assert_eq!(answers.len(), module_count + 2);

        let rejected = source.builtins.evaluated_texts()[0].call;
        let sites = &source.evaluated_text_sites;
        assert_eq!(sites.len(), 2);
        assert!(rejected < sites[0].call && sites[0].call < sites[1].call);
        for (index, site) in sites.iter().enumerate() {
            assert_eq!(site.implied_answer as usize, module_count + index);
            assert!(texts.contains(path_of(&answers[site.implied_answer as usize])));
            assert!(source.builtins.evaluated_text(site.call).is_some());
        }
        assert_ne!(answers[module_count], answers[module_count + 1]);
    });
}

#[test]
fn loader_keeps_implied_answer_order() {
    let source = "process.stdout;\nFunction('return 1');";
    with_bind_input(&[("main.js", source)], &default_settings(), |input| {
        let main = input.files.entry_points()[0];
        let parsed = parsed_source(input.files, main).expect("a compiled file has a payload");
        let [site] = parsed.evaluated_text_sites[..] else {
            panic!("the file evaluates one text");
        };
        let compiled = input.files.compiled(main);
        let compiled = compiled.expect("the entry point is compiled");
        let (modules, others) = compiled
            .implied_answers
            .split_at(site.implied_answer as usize);
        assert!(!modules.is_empty());
        for answer in modules {
            assert!(matches!(answer, CodeAnswer::HostModule(_)), "{answer:?}");
        }
        let [CodeAnswer::File(text_file)] = *others else {
            panic!("expected the file of the text, got {others:?}");
        };
        assert_eq!(input.sources.kind(text_file), SourceKind::EvaluatedText);
    });
}

#[test]
fn forbidden_text_evaluation_compiles_no_text() {
    let text = "new Function('a', 'return a');";
    with_finished_file(PROGRAM_PATH, text, |input, request| {
        let mut source = ParsedSource::new(SourceKind::Program, Loader::Ts);
        let answers = finish_application_file(input, None, false, request, &mut source);
        assert!(source.evaluated_text_sites.is_empty());
        assert!(
            !answers
                .iter()
                .any(|answer| matches!(answer, HostResolution::Path(_)))
        );
    });
}

#[test]
fn react_declarations_come_last() {
    let text = "process.stdout;\nFunction('return 1');";
    with_finished_file(PROGRAM_PATH, text, |input, request| {
        let finish = |needs_react_declarations: bool| {
            let mut source = ParsedSource::new(SourceKind::Program, Loader::Ts);
            let texts = EvaluatedTexts::new();
            finish_application_file(
                input,
                Some(&texts),
                needs_react_declarations,
                request,
                &mut source,
            )
        };
        let without_declarations = finish(false);
        let with_declarations = finish(true);
        let declarations = HostResolution::Path(react_compiler::DECLARATIONS_PATH.to_vec());
        assert!(!without_declarations.contains(&declarations));
        let last_and_others = with_declarations.split_last();
        let (last, others) = last_and_others.expect("the file has answers");
        assert_eq!(*last, declarations);
        assert_eq!(others, without_declarations);
    });
}

#[test]
fn evaluated_function_is_recorded_for_text_files_only() {
    let text = "(function anonymous(\n) {\nreturn this\n})";
    with_finished_file(TEXT_PATH, text, |input, request| {
        let cases = [
            (SourceKind::EvaluatedText, true),
            (SourceKind::Program, false),
        ];
        for (kind, is_recorded) in cases {
            let mut source = ParsedSource::new(kind, Loader::Js);
            let texts = EvaluatedTexts::new();
            let answers = finish_application_file(input, Some(&texts), false, request, &mut source);
            assert!(answers.is_empty());
            assert_eq!(source.evaluated_function.is_some(), is_recorded, "{kind:?}");
        }
    });
}
