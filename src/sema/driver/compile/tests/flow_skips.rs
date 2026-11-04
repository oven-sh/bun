use super::support::{check, with_program};
use bun_sema::check::aot::{BuiltinTypeSymbols, NamedValue, NamedValues, QueryInputs};
use bun_sema::hir::{ExprId, ExprKind};
use bun_sema::program::{FileId, FileRole};
use std::fmt::Write;
use std::sync::Mutex;

struct NoNamedValues;

impl NamedValues for NoNamedValues {
    fn find_named_value(&self, _: FileId, _: ExprId) -> Option<NamedValue> {
        None
    }
}

/// The type of each name in the text, in the order of the text, and how many types of loops the checker has kept.
fn ask_for_names(text: &str, far_walk: u32) -> (Vec<String>, usize) {
    with_program(&[("main.ts", text)], &["./main.ts"], 1, |program| {
        let all = program.files();
        let roles = vec![FileRole::Checked; all.modules.len()];
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            max_inference_nodes: 0,
            limits: Default::default(),
        };
        let main = program.file("main.ts");
        let answer = Mutex::new((Vec::new(), 0));
        check(program, &|checker, file| {
            if file != main {
                return;
            }
            checker.set_far_walk(far_walk);
            let types = checker.with_queries(file, &inputs, |queries| {
                let expressions = queries.hir().exprs.iter().enumerate();
                let mut names: Vec<(u32, ExprId)> = expressions
                    .filter(|(_, expression)| matches!(expression.kind, ExprKind::Ident(_)))
                    .map(|(index, expression)| (expression.pos, ExprId(index as u32)))
                    .collect();
                names.sort();
                let mut types = Vec::new();
                for (position, name) in names {
                    let text = match queries.expression_type(name) {
                        Ok(ty) => String::from_utf8(queries.type_text(ty)).unwrap(),
                        Err(reason) => format!("{reason:?}"),
                    };
                    types.push(format!("{position}: {text}"));
                }
                types
            });
            *answer.lock().unwrap() = (types, checker.count_cached_loop_types());
        });
        answer.into_inner().unwrap()
    })
}

const STATEMENTS_IN_BETWEEN: &[&str] = &[
    // Nothing here concerns `subject`.
    "for (const item of items) other.push(item);",
    "if (flag) { other.push(1); } else { other.push(2); }",
    "while (other.length < 3) { if (flag) continue; other.push(3); }",
    "switch (other.length) { case 1: other.push(4); break; default: other.push(5); }",
    "try { other.push(6); } catch { other.push(7); } finally { other.push(8); }",
    // Each of these does.
    "for (const item of items) { if (item > 1) subject = item; }",
    "for (const item of items) { if (typeof subject === \"number\") break; other.push(item); }",
    "if (typeof subject === \"string\") throw new Error(subject);",
    "if (!isText) throw new Error(\"\");",
    "assertNumber(subject);",
    "if (flag) fail();",
    "if (flag) { subject = \"text\"; }",
    "do { subject = undefined; } while (flag);",
    "label: for (const a of items) { for (const b of items) { if (a > b) { subject = a; continue label; } } }",
    "try { subject = 1; } finally { other.push(9); }",
];

fn write_program(statement: &str, padding: usize) -> String {
    let mut text = String::from(
        "declare const items: number[];
declare const flag: boolean;
declare function assertNumber(value: unknown): asserts value is number;
declare function fail(): never;
declare function make(): string | number | undefined;
const other: number[] = [];
let subject = make();
const constant = make();
const isText = typeof constant === \"string\";
",
    );
    for _ in 0..padding {
        text.push_str("for (const item of items) other.push(item);\nif (flag) other.push(0);\n");
    }
    writeln!(text, "{statement}").unwrap();
    for _ in 0..padding {
        text.push_str("for (const item of items) other.push(item);\nif (flag) other.push(0);\n");
    }
    text.push_str("export const seen = [subject, constant, other];\n");
    text
}

#[test]
fn a_walk_that_skips_whole_statements_finds_what_a_walk_through_them_finds() {
    for statement in STATEMENTS_IN_BETWEEN {
        let text = write_program(statement, 12);
        let (through, _) = ask_for_names(&text, u32::MAX);
        let (skipping, _) = ask_for_names(&text, 0);
        assert_eq!(skipping, through, "{statement}");
    }
}

#[test]
fn names_behind_many_loops_do_not_each_leave_a_type_at_every_loop() {
    const COUNT: usize = 300;
    let mut text = String::from("declare const items: number[];\ndeclare function make(): string | number;\n");
    for index in 0..COUNT {
        writeln!(text, "var made{index} = make();\nfor (const item of items) items.push(item);").unwrap();
    }
    text.push_str("export const all = [");
    for index in 0..COUNT {
        write!(text, "made{index}, ").unwrap();
    }
    text.push_str("];\n");
    let (through, kept_through) = ask_for_names(&text, u32::MAX);
    let (skipping, kept_skipping) = ask_for_names(&text, 32);
    assert_eq!(skipping, through);
    assert!(kept_through > COUNT * COUNT / 4, "{kept_through}");
    assert!(kept_skipping < COUNT * 40, "{kept_skipping}");
}
