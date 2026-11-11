use bun_sema::bind::Parent;
use bun_sema::hir::StmtKind;
use bun_sema::import_sites::ends_in_call_that_reads_frame_of_caller;

use crate::modules::testing::{file_named, member_named, with_test_run_graph};

fn keeps_frame(head: &str, receiver: &str) -> bool {
    let text = format!("{head} export const actual = () => {receiver}.requireActual('./dep.cjs');");
    let files = [
        ("a.test.ts", text.as_str()),
        ("dep.cjs", "module.exports = 1;"),
    ];
    with_test_run_graph(&files, |_, input| {
        let file = file_named(input, "a.test.ts");
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let Parent::Expr(call) = bound.parent_of_expr(member_named(input, file, "requireActual"))
        else {
            panic!("the member is called");
        };
        let decisions = &input.files.analysis(file).decisions;
        ends_in_call_that_reads_frame_of_caller(hir, bound, decisions, call)
    })
}

#[test]
fn frame_is_kept_for_the_name_that_an_import_binds_and_for_no_other() {
    assert!(keeps_frame("import { jest } from 'bun:test';", "jest"));
    assert!(keeps_frame(
        "import { jest as runner } from 'bun:test';",
        "runner"
    ));
    assert!(keeps_frame(
        "import { jest } from '@jest/globals';",
        "(jest as any)"
    ));
    assert!(!keeps_frame(
        "import { jest } from 'bun:test'; const alias = jest;",
        "alias"
    ));
    assert!(!keeps_frame(
        "const { jest: required } = require('bun:test');",
        "required"
    ));
    assert!(!keeps_frame(
        "import * as runner from 'bun:test';",
        "runner.jest"
    ));
    assert!(!keeps_frame("import { vi } from 'bun:test';", "vi"));
}

const HEAD_OF_KEYS: &str = r#"import { expect, jest, vi } from "bun:test";
enum Names { Import = "import", ImportActual = "importActual" }
enum Numbers { Zero, One }
"#;

/// The body of a function that is handed `handed`, and whether plain `bun test` keeps the frame of that function for
/// the call that the body returns.
const RETURNED_THROUGH_KEYS: &[(&str, bool)] = &[
    (
        r#"const k = "importActual"; return vi[k]("./dep.cjs");"#,
        true,
    ),
    (r#"return vi["import" + "Actual"]("./dep.cjs");"#, true),
    (
        r#"const a = "import", b = "Actual"; return vi[a + b]("./dep.cjs");"#,
        true,
    ),
    (
        r#"const part = "Actual"; return vi[`import${part}`]("./dep.cjs");"#,
        true,
    ),
    (
        r#"return vi[true ? "importActual" : "x"]("./dep.cjs");"#,
        true,
    ),
    (r#"return vi[(0, "importActual")]("./dep.cjs");"#, true),
    (r#"return vi[["importActual"][0]]("./dep.cjs");"#, true),
    (r#"return vi["importActual" as any]("./dep.cjs");"#, true),
    (r#"return vi["importActual" || "x"]("./dep.cjs");"#, true),
    (r#"return vi[null ?? "importActual"]("./dep.cjs");"#, true),
    (
        r#"const k = "importActual"; return vi?.[k]("./dep.cjs");"#,
        true,
    ),
    (
        r#"const k = "importActual"; return handed && vi[k]("./dep.cjs");"#,
        true,
    ),
    (r#"return vi[Names.ImportActual]("./dep.cjs");"#, true),
    (r#"return vi[Names["ImportActual"]]("./dep.cjs");"#, true),
    (
        r#"const k = Names.ImportActual; return vi[k]("./dep.cjs");"#,
        true,
    ),
    (
        r#"return vi[true ? Names.ImportActual : "x"]("./dep.cjs");"#,
        true,
    ),
    (r#"return vi[Names.Import + "Actual"]("./dep.cjs");"#, true),
    (r#"return vi[`${Names.Import}Actual`]("./dep.cjs");"#, true),
    (r#"return vi[(handed, "importActual")]("./dep.cjs");"#, true),
    (
        r#"const k = "doMock"; return jest[k]("./dep.cjs", () => ({}));"#,
        true,
    ),
    (
        r#"const k = "requireActual"; return jest[k]("./dep.cjs");"#,
        true,
    ),
    (r#"const k = "doUnmock"; return vi[k]("./dep.cjs");"#, true),
    (
        r#"const k = "toMatchInlineSnapshot"; return expect(handed)[k]();"#,
        true,
    ),
    (
        r#"let k = "importActual"; return (vi as any)[k]("./dep.cjs");"#,
        false,
    ),
    (
        r#"handed++; const k = "importActual"; return vi[k]("./dep.cjs");"#,
        false,
    ),
    (r#"return (vi as any)[handed]("./dep.cjs");"#, false),
    (
        r#"return (vi as any)[{} && "importActual"]("./dep.cjs");"#,
        false,
    ),
    (r#"const k = "fn"; return vi[k]();"#, false),
    (
        r#"const k = "requireActual"; return (vi as any)[k]("./dep.cjs");"#,
        false,
    ),
    (r#"return (vi as any)[Numbers.One]("./dep.cjs");"#, false),
];

#[test]
fn frame_is_kept_for_the_key_that_the_transpiler_folds_to_a_listed_name() {
    let functions = RETURNED_THROUGH_KEYS.iter().enumerate();
    let functions: String = functions
        .map(|(index, (body, _))| format!("export function f{index}(handed: any) {{ {body} }}\n"))
        .collect();
    let text = format!("{HEAD_OF_KEYS}{functions}");
    let files = [
        ("a.test.ts", text.as_str()),
        ("dep.cjs", "module.exports = 1;"),
    ];
    let kept: Vec<bool> = with_test_run_graph(&files, |_, input| {
        let file = file_named(input, "a.test.ts");
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let decisions = &input.files.analysis(file).decisions;
        let returned = hir
            .stmts
            .iter()
            .filter_map(|statement| match statement.kind {
                StmtKind::Return(value) => Some(value),
                _ => None,
            });
        returned
            .map(|value| ends_in_call_that_reads_frame_of_caller(hir, bound, decisions, value))
            .collect()
    });
    assert_eq!(kept.len(), RETURNED_THROUGH_KEYS.len());
    let answers = RETURNED_THROUGH_KEYS.iter().zip(kept);
    let wrong: Vec<&str> = answers
        .filter(|(row, kept)| row.1 != *kept)
        .map(|(row, _)| row.0)
        .collect();
    assert_eq!(wrong, [""; 0]);
}
