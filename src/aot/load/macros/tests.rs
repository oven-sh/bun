use std::borrow::Cow;

use bun_ast::Log;
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir_from_data::DataModule;
use bun_sema::import_sites::JsxMode;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use bun_threading::Guarded;

use super::*;
use crate::diagnostics::Diagnostics;
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, Resolution, ResolveRequest, SourceFile,
    WithoutServices,
};

const IMPORTER: &[u8] = b"/project/a.ts";
const MAX_FOLDED_STRING_BYTES: usize = 1 << 16;
const ANSWERS: &[(&str, f64)] = &[
    ("default", 7.0),
    ("f", 1.0),
    ("g", 2.0),
    ("inner", 3.0),
    ("outer", 4.0),
    ("zero", 0.0),
];

#[derive(Clone, PartialEq, Debug)]
enum OwnedValue {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(Vec<u8>),
    BigInt(Vec<u8>),
    Array(Vec<OwnedValue>),
    Object(Vec<(Vec<u8>, OwnedValue)>),
}

fn to_owned_value(value: &DataValue<'_>, atoms: &Interner<'_>) -> OwnedValue {
    match *value {
        DataValue::Undefined => OwnedValue::Undefined,
        DataValue::Null => OwnedValue::Null,
        DataValue::Boolean(value) => OwnedValue::Boolean(value),
        DataValue::Number(value) => OwnedValue::Number(value),
        DataValue::String(text) => OwnedValue::String(atoms.bytes(text).to_vec()),
        DataValue::BigInt(digits) => OwnedValue::BigInt(atoms.bytes(digits).to_vec()),
        DataValue::Array(items) => {
            let items = items.iter().map(|item| to_owned_value(item, atoms));
            OwnedValue::Array(items.collect())
        }
        DataValue::Object(properties) => {
            let properties = properties
                .iter()
                .map(|(key, value)| (atoms.bytes(*key).to_vec(), to_owned_value(value, atoms)));
            OwnedValue::Object(properties.collect())
        }
    }
}

fn to_owned_result(result: HostValue<'_>, atoms: &Interner<'_>) -> OwnedValue {
    match result {
        HostValue::Data(value) => to_owned_value(value, atoms),
        HostValue::Deferred => panic!("the result of a macro call is data"),
    }
}

#[derive(Clone, PartialEq, Debug)]
struct RecordedCall {
    importer: Vec<u8>,
    macro_path: Vec<u8>,
    export_name: Vec<u8>,
    arguments: Vec<OwnedValue>,
}

struct RecordingProvider {
    answers: &'static [(&'static str, f64)],
    calls: Guarded<Vec<RecordedCall>>,
}

impl SourceProvider for RecordingProvider {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn run_macro<'s>(
        &self,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        _log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        let arguments = call.arguments.iter();
        let arguments = arguments.map(|value| to_owned_value(value, atoms));
        self.calls.lock().push(RecordedCall {
            importer: call.importer.to_vec(),
            macro_path: call.macro_path.to_vec(),
            export_name: call.export_name.to_vec(),
            arguments: arguments.collect(),
        });
        let mut answers = self.answers.iter();
        match answers.find(|answer| answer.0.as_bytes() == call.export_name) {
            Some(answer) => Ok(&*arena.alloc(DataValue::Number(answer.1))),
            None => Err(Failed),
        }
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

#[derive(Copy, Clone)]
struct Setup {
    importer: &'static [u8],
    answers: &'static [(&'static str, f64)],
    runs_macros: bool,
    lists_every_call_as_pending: bool,
}

const DEFAULT_SETUP: Setup = Setup {
    importer: IMPORTER,
    answers: ANSWERS,
    runs_macros: true,
    lists_every_call_as_pending: false,
};

struct Outcome {
    first_pending_count: usize,
    rounds_with_results: usize,
    calls: Vec<RecordedCall>,
    diagnostics: Vec<(Code, Vec<u8>)>,
    results: Vec<OwnedValue>,
    has_internal_errors: bool,
}

impl Outcome {
    fn export_names(&self) -> Vec<&[u8]> {
        let calls = self.calls.iter();
        calls.map(|call| call.export_name.as_slice()).collect()
    }
}

fn resolve_fixture(specifier: &[u8]) -> Option<Vec<u8>> {
    match specifier {
        b"./m" => Some(b"/project/m.ts".to_vec()),
        _ => None,
    }
}

fn find_calls_without_results(hir: &File<'_>, results: &[MacroResult<'_>]) -> Vec<ExprId> {
    let exprs = (0..hir.exprs.len() as u32).map(ExprId);
    exprs
        .filter(|&expr| matches!(hir[expr].kind, ExprKind::Call(_)))
        .filter(|expr| {
            results
                .binary_search_by_key(expr, |result| result.0)
                .is_err()
        })
        .collect()
}

fn has_internal_errors(messages: &LoadMessages) -> bool {
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_messages(messages);
    diagnostics.has_internal_errors()
}

fn run_rounds(setup: Setup, text: &str) -> Outcome {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let parse_options = CompileParseOptions {
        path: setup.importer,
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
    let provider = RecordingProvider {
        answers: setup.answers,
        calls: Guarded::new(Vec::new()),
    };
    let messages = LoadMessages::default();

    let mut results: Vec<MacroResult<'_>> = Vec::new();
    let mut diagnostics: Vec<FileDiagnostic> = Vec::new();
    let mut first_pending_count = None;
    let mut rounds_with_results = 0;
    loop {
        let file = FileInputs {
            declared_module_type: DeclaredModuleType::Unknown,
            import_meta_main: None,
            is_library: false,
            host_values: arena.alloc_slice_copy(&results),
            jsx: JsxMode::Classic,
        };
        let (bound, mut analysis) =
            analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
        assert!(!hir.has_errors, "syntax error in: {text}");
        first_pending_count.get_or_insert(analysis.pending_macro_calls.len());
        if setup.lists_every_call_as_pending {
            let calls = find_calls_without_results(&hir, &results);
            analysis.pending_macro_calls = arena.alloc_slice_copy(&calls);
        }
        let request = MacroRequest {
            importer: setup.importer,
            hir: &hir,
            bound: &bound,
            analysis: &analysis,
            resolve: &resolve_fixture,
        };
        let round = run_macros(
            &provider,
            &messages,
            setup.runs_macros,
            arena,
            &atoms,
            &request,
            &mut diagnostics,
        );
        assert!(round.is_sorted_by(|a, b| a.0 < b.0));
        if round.is_empty() {
            break;
        }
        rounds_with_results += 1;
        results.extend_from_slice(round);
        results.sort_unstable_by_key(|result| result.0);
    }

    let describe = |diagnostic: &FileDiagnostic| {
        let written = &text.as_bytes()[diagnostic.start as usize..diagnostic.end as usize];
        assert!(diagnostic.arguments.is_empty());
        (diagnostic.code, written.to_vec())
    };
    let results = results.iter();
    let results = results.map(|result| to_owned_result(result.1, &atoms));
    Outcome {
        first_pending_count: first_pending_count.unwrap_or(0),
        rounds_with_results,
        calls: std::mem::take(&mut *provider.calls.lock()),
        diagnostics: diagnostics.iter().map(describe).collect(),
        results: results.collect(),
        has_internal_errors: has_internal_errors(&messages),
    }
}

fn run(text: &str) -> Outcome {
    run_rounds(DEFAULT_SETUP, text)
}

fn string(text: &[u8]) -> OwnedValue {
    OwnedValue::String(text.to_vec())
}

#[test]
fn named_import_receives_written_arguments() {
    let outcome = run("import { f } from './m' with { type: 'macro' };\
         f(1, 'a', [true, null], { k: 2 });");
    let expected = RecordedCall {
        importer: IMPORTER.to_vec(),
        macro_path: b"/project/m.ts".to_vec(),
        export_name: b"f".to_vec(),
        arguments: vec![
            OwnedValue::Number(1.0),
            string(b"a"),
            OwnedValue::Array(vec![OwnedValue::Boolean(true), OwnedValue::Null]),
            OwnedValue::Object(vec![(b"k".to_vec(), OwnedValue::Number(2.0))]),
        ],
    };
    assert_eq!(outcome.calls, [expected]);
    assert_eq!(outcome.results, [OwnedValue::Number(1.0)]);
    assert!(outcome.diagnostics.is_empty());
    assert!(!outcome.has_internal_errors);
}

#[test]
fn folded_arguments_are_data() {
    let outcome = run("import { f } from './m' with { type: 'macro' };\
         const k = 'a';\
         f(k, 2 * 3, [k], { n: k }, k as string, void 0);");
    let arguments = [
        string(b"a"),
        OwnedValue::Number(6.0),
        OwnedValue::Array(vec![string(b"a")]),
        OwnedValue::Object(vec![(b"n".to_vec(), string(b"a"))]),
        string(b"a"),
        OwnedValue::Undefined,
    ];
    assert_eq!(outcome.calls.len(), 1);
    assert_eq!(outcome.calls[0].arguments, arguments);
    assert!(outcome.diagnostics.is_empty());
}

#[test]
fn default_namespace_and_renamed_imports_name_their_exports() {
    let texts: [(&str, &str, &[&[u8]]); 3] = [
        ("d", "d();", &[b"default"]),
        ("* as m", "m.g(); m['g']();", &[b"g", b"g"]),
        ("{ f as h }", "h();", &[b"f"]),
    ];
    for (clause, calls, export_names) in texts {
        let text = format!("import {clause} from './m' with {{ type: 'macro' }}; {calls}");
        assert_eq!(run(&text).export_names(), export_names, "{text}");
    }
}

#[test]
fn type_assertions_around_callee_are_skipped() {
    let named = "import { f } from './m' with { type: 'macro' };";
    let namespace = "import * as m from './m' with { type: 'macro' };";
    let texts = [
        (named, "(f as any)(1);", b"f"),
        (named, "f!(1);", b"f"),
        (namespace, "(m as any).g();", b"g"),
        (namespace, "(m.g satisfies unknown)();", b"g"),
    ];
    for (import, call, export_name) in texts {
        let outcome = run(&[import, call].concat());
        assert_eq!(outcome.export_names(), [export_name], "{call}");
        assert!(!outcome.has_internal_errors, "{call}");
    }
}

#[test]
fn import_without_attribute_is_not_a_macro() {
    let texts = [
        "import { f } from './m'; f(1);",
        "import d from './m'; d();",
        "import * as m from './m'; m.g();",
    ];
    for text in texts {
        let outcome = run(text);
        assert_eq!(outcome.first_pending_count, 0, "{text}");
        assert!(outcome.calls.is_empty(), "{text}");
    }
}

#[test]
fn other_uses_of_macro_bindings_are_not_macro_calls() {
    let texts = [
        "import * as m from './m' with { type: 'macro' }; m();",
        "import { f } from './m' with { type: 'macro' }; f.call(null);",
        "import d from './m' with { type: 'macro' }; d.get();",
        "import type { f } from './m' with { type: 'macro' }; f();",
        "import { type f } from './m' with { type: 'macro' }; f();",
    ];
    for text in texts {
        let outcome = run(text);
        assert_eq!(outcome.first_pending_count, 0, "{text}");
        assert!(outcome.calls.is_empty(), "{text}");
        assert!(!outcome.has_internal_errors, "{text}");
    }
}

#[test]
fn unknown_argument_reports_once_at_whole_argument() {
    let named = "import { f } from './m' with { type: 'macro' }; let x; ";
    let nested = "import { inner, outer } from './m' with { type: 'macro' };let x; ";
    let texts: [(&str, &str, &[u8], usize); 4] = [
        (named, "f(x);", b"x", 1),
        (named, "f(1, [2, x]);", b"[2, x]", 1),
        (nested, "outer(inner(x));", b"x", 2),
        (nested, "outer(inner(x)!);", b"x", 2),
    ];
    for (start, call, written, result_count) in texts {
        let outcome = run(&[start, call].concat());
        assert!(outcome.calls.is_empty(), "{call}");
        let expected = (Code::MacroArgumentNotConstant, written.to_vec());
        assert_eq!(outcome.diagnostics, [expected], "{call}");
        let undefined = vec![OwnedValue::Undefined; result_count];
        assert_eq!(outcome.results, undefined, "{call}");
    }
}

#[test]
fn spread_argument_is_unknown() {
    let outcome = run("import { f } from './m' with { type: 'macro' }; let a = []; f(...a);");
    assert!(outcome.calls.is_empty());
    assert_eq!(outcome.diagnostics.len(), 1);
    assert_eq!(outcome.diagnostics[0].0, Code::MacroArgumentNotConstant);
    assert_eq!(outcome.results, [OwnedValue::Undefined]);
}

#[test]
fn nested_call_runs_first() {
    let outcome = run("import { inner, outer } from './m' with { type: 'macro' };\
         outer(inner());");
    assert_eq!(outcome.export_names(), [&b"inner"[..], &b"outer"[..]]);
    assert_eq!(outcome.calls[1].arguments, [OwnedValue::Number(3.0)]);
    assert!(outcome.diagnostics.is_empty());
}

#[test]
fn call_removed_by_earlier_result_does_not_run() {
    let import = "import { zero, f, g } from './m' with { type: 'macro' };";
    let texts: [(&str, &[&[u8]]); 4] = [
        ("zero() ? f() : g();", &[b"zero", b"g"]),
        ("if (zero()) f();", &[b"zero"]),
        ("zero() && f();", &[b"zero"]),
        ("zero() || f();", &[b"zero", b"f"]),
    ];
    for (text, export_names) in texts {
        let outcome = run(&[import, text].concat());
        assert_eq!(outcome.export_names(), export_names, "{text}");
        assert!(outcome.diagnostics.is_empty(), "{text}");
    }
}

#[test]
fn statements_run_in_source_order_around_nested_calls() {
    let outcome = run(
        "import { inner, outer, g } from './m' with { type: 'macro' };\
         outer(inner()); g();",
    );
    let expected: [&[u8]; 3] = [b"inner", b"outer", b"g"];
    assert_eq!(outcome.export_names(), expected);
    assert_eq!(outcome.rounds_with_results, 2);
}

#[test]
fn call_after_undecided_branch_runs_after_branch() {
    let outcome = run("import { f, g, inner } from './m' with { type: 'macro' };\
         f() && g(); inner();");
    let expected: [&[u8]; 3] = [b"f", b"g", b"inner"];
    assert_eq!(outcome.export_names(), expected);
}

#[test]
fn independent_calls_share_one_round() {
    let outcome = run("import { f, g } from './m' with { type: 'macro' }; f(); g(1); f(2);");
    assert_eq!(outcome.export_names(), [b"f", b"g", b"f"]);
    assert_eq!(outcome.rounds_with_results, 1);
}

#[test]
fn unknown_argument_does_not_delay_later_calls() {
    let outcome = run("import { f, g } from './m' with { type: 'macro' }; let x; f(x); g();");
    assert_eq!(outcome.export_names(), [b"g"]);
    let expected = (Code::MacroArgumentNotConstant, b"x".to_vec());
    assert_eq!(outcome.diagnostics, [expected]);
    let results = [OwnedValue::Undefined, OwnedValue::Number(2.0)];
    assert_eq!(outcome.results, results);
}

#[test]
fn failed_macro_runs_once() {
    let setup = Setup {
        answers: &[],
        ..DEFAULT_SETUP
    };
    let text = "import { f } from './m' with { type: 'macro' }; f();";
    let outcome = run_rounds(setup, text);
    assert_eq!(outcome.calls.len(), 1);
    assert_eq!(outcome.results, [OwnedValue::Undefined]);
    assert!(outcome.diagnostics.is_empty());
}

#[test]
fn disabled_macros_and_importers_in_node_modules_run_nothing() {
    const IN_NODE_MODULES: &[u8] = b"/project/node_modules/p/a.ts";
    let cases = [
        (IMPORTER, false, Code::MacrosDisabled),
        (IN_NODE_MODULES, true, Code::MacroInNodeModules),
        (IN_NODE_MODULES, false, Code::MacrosDisabled),
    ];
    for (importer, runs_macros, code) in cases {
        let setup = Setup {
            importer,
            runs_macros,
            ..DEFAULT_SETUP
        };
        let text = "import { f } from './m' with { type: 'macro' }; f();";
        let outcome = run_rounds(setup, text);
        assert!(outcome.calls.is_empty());
        assert_eq!(outcome.diagnostics, [(code, b"f()".to_vec())]);
        assert_eq!(outcome.results, [OwnedValue::Undefined]);
    }
}

#[test]
fn specifier_without_file_stays_as_written() {
    for specifier in ["node:fs", "./missing"] {
        let outcome = run(&format!(
            "import {{ f }} from '{specifier}' with {{ type: 'macro' }}; f();"
        ));
        assert_eq!(outcome.calls[0].macro_path, specifier.as_bytes());
    }
}

#[test]
fn calls_arrive_in_source_order() {
    let outcome = run("import { f, g } from './m' with { type: 'macro' }; g(); f();");
    assert_eq!(outcome.export_names(), [b"g", b"f"]);
}

#[test]
fn file_without_pending_calls_has_no_results() {
    let outcome = run("import { f } from './m'; f(1);");
    assert_eq!(outcome.first_pending_count, 0);
    assert_eq!(outcome.rounds_with_results, 0);
    assert!(outcome.results.is_empty());
    assert!(outcome.calls.is_empty());
    assert!(outcome.diagnostics.is_empty());
}

#[test]
fn every_call_gets_one_result() {
    let outcome = run("import { f, g } from './m' with { type: 'macro' };\
         let x; f(1); g(); f(x); g(x);");
    assert_eq!(outcome.export_names(), [b"f", b"g"]);
    let expected = [
        OwnedValue::Number(1.0),
        OwnedValue::Number(2.0),
        OwnedValue::Undefined,
        OwnedValue::Undefined,
    ];
    assert_eq!(outcome.results, expected);
    let unknown_argument = (Code::MacroArgumentNotConstant, b"x".to_vec());
    let diagnostics = [unknown_argument.clone(), unknown_argument];
    assert_eq!(outcome.diagnostics, diagnostics);
}

#[test]
fn diagnostic_has_code_and_range() {
    let import = "import { f } from './m' with { type: 'macro' };";
    let disabled = Setup {
        runs_macros: false,
        ..DEFAULT_SETUP
    };
    let cases: [(Setup, &str, Code, &[u8]); 2] = [
        (
            DEFAULT_SETUP,
            "let x; f(1, x);",
            Code::MacroArgumentNotConstant,
            b"x",
        ),
        (disabled, "f(1);", Code::MacrosDisabled, b"f(1)"),
    ];
    for (setup, text, code, written) in cases {
        let outcome = run_rounds(setup, &[import, text].concat());
        assert_eq!(outcome.diagnostics, [(code, written.to_vec())], "{text}");
    }
}

#[test]
fn pending_call_without_macro_callee_is_internal_error() {
    let setup = Setup {
        lists_every_call_as_pending: true,
        ..DEFAULT_SETUP
    };
    let text = "import * as m from './m' with { type: 'macro' }; m();";
    let outcome = run_rounds(setup, text);
    assert_eq!(outcome.first_pending_count, 0);
    assert!(outcome.calls.is_empty());
    assert!(outcome.has_internal_errors);
    assert_eq!(outcome.results, [OwnedValue::Undefined]);
    assert!(outcome.diagnostics.is_empty());
}
