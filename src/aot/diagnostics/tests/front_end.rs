use bun_ast::{Kind, Log};
use bun_sema::check::aot::Effect;
use bun_sema::fold::{FoldError, FoldErrorKind};
use bun_sema::hir::{ExprId, ExprKind, File, ParenId, PatId};
use bun_sema::module_format::CommonJsEvidence;
use bun_sema::node::NodeData;
use bun_sema::program::FileId;
use bun_sema::resolve::CodeFailure;
use bun_sema_driver::{EntryPointFailure, Incomplete, LoadFailure};

use super::super::front_end::fold_error_diagnostic;
use super::super::{Diagnostics, range_of_node};
use super::{
    checker_error, describe, kinds_and_codes, kinds_and_texts, take_diagnostics, text, with_effect,
    written,
};
use crate::compile::testing::{default_settings, with_loaded_build, with_project_view};
use crate::emit::EmitError;
use crate::link::LinkError;
use crate::load::{ProgramFile, ProjectId};
use crate::statistics::{LimitId, LimitValues, Stage};

fn find_expr(hir: &File<'_>, is_wanted: impl Fn(&ExprKind) -> bool) -> ExprId {
    let index = hir.exprs.iter().position(|expr| is_wanted(&expr.kind));
    ExprId(index.expect("the file has such an expression") as u32)
}

fn bind(files: &[(&str, &str)]) -> Log {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        assert!(build.bind_modules(loaded).is_ok());
        written(take_diagnostics(build))
    })
}

fn written_link_error(error: LinkError, limits: &LimitValues) -> (bool, Vec<(Kind, String)>) {
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_link_errors(vec![error], limits, &|error| {
        format!("{error:?}").into_bytes()
    });
    let is_internal = diagnostics.has_internal_errors();
    (is_internal, kinds_and_texts(&written(diagnostics)))
}

#[test]
fn load_failure_names_entry_points() {
    let entry_points =
        [&b"./missing.ts"[..], b"./main.ts", b"fs", b"outside.ts"].map(<[u8]>::to_vec);
    let failure = LoadFailure {
        unresolved_entry_points: vec![
            (0, EntryPointFailure::NotFound(CodeFailure::ModuleNotFound)),
            (2, EntryPointFailure::BuiltinModule),
            (3, EntryPointFailure::External),
        ],
        diagnostics: Vec::new(),
    };
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_failure(failure, &entry_points);
    let texts = [
        "TS100160: Entry point \"./missing.ts\" was not found",
        "TS100161: Cannot use \"fs\" as an entry point: it resolves to a builtin module",
        "TS100162: The entry point \"outside.ts\" cannot be marked as external",
    ];
    assert_eq!(
        kinds_and_texts(&written(diagnostics)),
        texts.map(|text| (Kind::Err, text.to_string()))
    );
}

#[test]
fn load_failure_carries_configuration_errors() {
    let unreadable = |message| checker_error("", (0, 0), 5083, message);
    let failure = LoadFailure {
        unresolved_entry_points: Vec::new(),
        diagnostics: vec![
            with_effect(unreadable("of the program"), Effect::StopsBuild),
            with_effect(unreadable("of Bun"), Effect::InternalError),
        ],
    };
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_failure(failure, &[]);
    assert_eq!(
        kinds_and_texts(&written(diagnostics)),
        [
            (Kind::Err, "TS5083: of the program".to_string()),
            (
                Kind::Err,
                "internal compiler error (Load): TS5083: of Bun".to_string()
            ),
        ]
    );
}

#[test]
fn build_diagnostics_follow_effect() {
    let error = |message| checker_error("/project/a.ts", (3, 7), 2322, message);
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_build_diagnostics(
        Stage::Check,
        vec![
            with_effect(error("internal"), Effect::InternalError),
            with_effect(error("warns"), Effect::Warns),
            with_effect(error("stops"), Effect::StopsBuild),
        ],
    );
    assert!(diagnostics.has_errors());
    assert!(diagnostics.has_internal_errors());
    let log = written(diagnostics);
    assert_eq!(
        describe(&log),
        [
            "/project/a.ts:3:7 Err TS2322: stops",
            "/project/a.ts:3:7 Warn TS2322: warns",
            "Err internal compiler error (Check): TS2322: internal at /project/a.ts:3:7",
        ]
    );
    assert_eq!((log.errors, log.warnings), (2, 1));
}

#[test]
fn warning_effect_does_not_fail_build() {
    let error = checker_error("/project/a.ts", (3, 7), 2322, "warns");
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_build_diagnostics(Stage::Check, vec![with_effect(error, Effect::Warns)]);
    assert!(!diagnostics.has_errors());
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "report_package_errors groups these by package")]
fn withdrawn_trust_is_grouped_before_sink() {
    let error = checker_error("/project/a.ts", (3, 7), 2322, "wrong type");
    let reported = vec![with_effect(error, Effect::WithdrawsTrust)];
    Diagnostics::new().add_build_diagnostics(Stage::Check, reported);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "the driver returns no dropped diagnostic")]
fn dropped_diagnostic_does_not_reach_sink() {
    let error = checker_error("/project/a.ts", (3, 7), 2322, "wrong type");
    let reported = vec![with_effect(error, Effect::Dropped)];
    Diagnostics::new().add_build_diagnostics(Stage::Check, reported);
}

#[test]
fn range_of_node_excludes_parentheses() {
    let files = [("main.ts", "const value = (1 + 2);\n")];
    with_project_view(&files, |view| {
        let hir = view.files().hir(view.files().entry_points()[0]);
        let text_in = |(start, end): (u32, u32)| text(&hir.text[start as usize..end as usize]);
        let sum = find_expr(hir, |kind| matches!(kind, ExprKind::Binary { .. }));
        assert_eq!(text_in(range_of_node(hir, NodeData::Expr(sum))), "1 + 2");
        let parentheses = range_of_node(hir, NodeData::Paren(ParenId(0)));
        assert_eq!(text_in(parentheses), "(1 + 2)");
        let statement = hir.ids(hir.body).next().unwrap();
        let statement = range_of_node(hir, NodeData::Stmt(statement));
        assert_eq!(text_in(statement), "const value = (1 + 2);");
        assert_eq!(range_of_node(hir, NodeData::Pat(PatId(0))), (6, 6));
        assert_eq!(range_of_node(hir, NodeData::File), (0, 0));
        assert_eq!(range_of_node(hir, NodeData::None), (0, 0));
    });
}

#[test]
fn import_statement_in_commonjs_lists_evidence_in_order() {
    let files = [
        ("main.ts", "import { b } from \"./b\";\nb;\n"),
        ("b.ts", "export const b = 1;\n"),
    ];
    with_project_view(&files, |view| {
        let file = view.files().entry_points()[0];
        let hir = view.files().hir(file);
        let evidence = CommonJsEvidence::MODULE | CommonJsEvidence::WITH_STATEMENT;
        let error = FoldError {
            kind: FoldErrorKind::ImportStatementInCommonJs(evidence),
            node: NodeData::Stmt(hir.ids(hir.body).next().unwrap()),
        };
        let diagnostic = fold_error_diagnostic(hir, &view.files().atoms, file, &error);
        let mut notes = diagnostic.related.iter();
        assert!(notes.all(|note| note.span == diagnostic.span));

        let mut diagnostics = Diagnostics::new();
        diagnostics.add(Some(view), diagnostic);
        let log = written(diagnostics);
        assert_eq!(
            describe(&log),
            ["/project/main.ts:1:1 Err TS100106: \
                 Cannot use import statement with CommonJS-only features"]
        );
        let notes = log.msgs[0].notes.iter();
        let notes: Vec<String> = notes.map(|note| text(&note.text)).collect();
        assert_eq!(
            notes,
            [
                "TS100111: Try require(\"./b\") instead",
                "TS100112: This file is CommonJS because 'module' was used",
                "TS100110: This file is CommonJS because a \"with\" statement is used",
            ]
        );
    });
}

#[test]
fn failed_calls_warn_and_failed_statements_stop() {
    let failed_imports = |source| kinds_and_texts(&bind(&[("main.ts", source)]));
    let message = "TS100150: Could not resolve: \"./missing\"".to_string();
    assert_eq!(
        failed_imports("require(\"./missing\");\n"),
        [(Kind::Warn, message.clone())]
    );
    assert_eq!(
        failed_imports("import \"./missing\";\n"),
        [(Kind::Err, message.clone())]
    );
    assert_eq!(
        failed_imports("try {\n  await import(\"./missing\");\n} catch {}\n"),
        [(Kind::Warn, message)]
    );
}

#[test]
fn failed_import_is_located_at_import_site() {
    let log = bind(&[("main.ts", "export {};\nimport \"./missing\";\n")]);
    let [message] = &log.msgs[..] else {
        panic!("{:?}", describe(&log));
    };
    let location = message.data.location.as_ref().expect("a location");
    assert_eq!(text(&location.file), "/project/main.ts");
    assert_eq!(location.line, 2);
}

#[test]
fn missing_and_ambiguous_exports_stop_build() {
    let missing = bind(&[
        ("main.ts", "import { missing } from \"./b\";\nmissing;\n"),
        ("b.ts", "export const b = 1;\n"),
    ]);
    assert_eq!(kinds_and_codes(&missing), [(Kind::Err, 100200)]);

    let ambiguous = bind(&[
        ("main.ts", "import { x } from \"./both\";\nx;\n"),
        (
            "both.ts",
            "export * from \"./a\";\nexport * from \"./b\";\n",
        ),
        ("a.ts", "export const x = 1;\n"),
        ("b.ts", "export const x = 2;\n"),
    ]);
    assert_eq!(kinds_and_codes(&ambiguous), [(Kind::Err, 100201)]);
}

#[test]
fn resolved_imports_report_nothing() {
    let log = bind(&[
        ("main.ts", "import { b } from \"./b\";\nb;\n"),
        ("b.ts", "export const b = 1;\n"),
    ]);
    assert!(log.msgs.is_empty(), "{:?}", describe(&log));
}

#[test]
#[should_panic(expected = "the build failed in stage \"Load\":\n/project/main.js:1:1: TS100106: ")]
fn fold_errors_stop_load() {
    let files = [
        (
            "main.js",
            "import { b } from \"./b.js\";\nmodule.exports = b;\n",
        ),
        ("b.js", "export const b = 1;\n"),
    ];
    with_project_view(&files, |_| {});
}

#[test]
#[should_panic(expected = "the build failed in stage \"Load\":\n\
                           /project/main.ts:1:1: TS100113: cannot use macro in export statement\n\
                           /project/main.ts:2:1: TS100114: export from cannot be used with")]
fn macro_exports_stop_load() {
    let files = [
        (
            "main.ts",
            "export * from \"./b\" with { type: \"macro\" };\n\
             export { b } from \"./b\" with { type: \"macro\" };\n",
        ),
        ("b.ts", "export const b = 1;\n"),
    ];
    with_project_view(&files, |_| {});
}

#[test]
fn incomplete_files_stop_build() {
    let written_for = |is_nested_too_deeply: bool| {
        let mut diagnostics = Diagnostics::new();
        diagnostics.add_incomplete_files(&[Incomplete {
            path: b"/project/a.ts".to_vec(),
            is_nested_too_deeply,
        }]);
        let is_internal = diagnostics.has_internal_errors();
        (is_internal, kinds_and_texts(&written(diagnostics)))
    };
    let nested = "TS100060: The code in \"/project/a.ts\" is nested too deeply to be compiled";
    assert_eq!(
        written_for(true),
        (false, vec![(Kind::Err, nested.to_string())])
    );
    let out_of_stack = "internal compiler error (Check): \
                        ran out of stack in /project/a.ts. \
                        This is a bug in Bun: errors in this file may be missing.";
    assert_eq!(
        written_for(false),
        (true, vec![(Kind::Err, out_of_stack.to_string())])
    );
}

#[test]
fn only_link_limits_are_user_errors() {
    let limits = LimitValues::for_host();
    let limit = LimitId::MaxProgramIds;
    let limit_message = format!(
        "TS100202: The program is too large to compile: \
         {} is limited to {}, and it needs 5000000000",
        limit.purpose(),
        limits.get(limit)
    );
    let count = 5_000_000_000;
    assert_eq!(
        written_link_error(LinkError::LimitExceeded { limit, count }, &limits),
        (false, vec![(Kind::Err, limit_message)])
    );
    let missing_unit = || LinkError::MissingUnit {
        file: ProgramFile {
            project: ProjectId::Application,
            file: FileId(3),
        },
    };
    let missing = format!(
        "internal compiler error (LinkAndEmit): {:?}",
        missing_unit()
    );
    assert_eq!(
        written_link_error(missing_unit(), &limits),
        (true, vec![(Kind::Err, missing)])
    );
}

#[test]
fn link_limit_message_uses_build_limit_value() {
    let limit = LimitId::MaxTypeNodes;
    let mut limits = LimitValues::for_host();
    limits.lower(limit, 3);
    let (_, printed) = written_link_error(LinkError::LimitExceeded { limit, count: 4 }, &limits);
    assert!(
        printed[0].1.ends_with(" is limited to 3, and it needs 4"),
        "{}",
        printed[0].1
    );
}

#[test]
fn oversized_program_is_user_error() {
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_emit_error(EmitError::ProgramTooLarge {
        bytes: 5_000_000_000,
    });
    assert!(!diagnostics.has_internal_errors());
    let size_message = "TS100055: The program is too large to compile: its IR is 5000000000 bytes, \
                     and the limit is 4 GB";
    assert_eq!(
        kinds_and_texts(&written(diagnostics)),
        [(Kind::Err, size_message.to_string())]
    );
}
