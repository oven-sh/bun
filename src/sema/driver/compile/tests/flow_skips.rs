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

/// In a file that is checked as a whole, every result exists before it is read.
/// directive nothing is checked ahead, and each question walks by itself.
fn unchecked(text: &str) -> String {
    format!("// @ts-nocheck\n{text}")
}

fn ask_for_names(text: &str, far_walk: u32) -> (Vec<String>, usize) {
    let text = &unchecked(text);
    with_program(&[("main.ts", text)], &["./main.ts"], 1, |program| {
        let all = program.files();
        let roles = vec![FileRole::Checked; all.modules.len()];
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            alias_mentions: None,
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
                    .filter(|(_, expression)| {
                        matches!(expression.kind, ExprKind::Ident(_) | ExprKind::Dot { .. })
                    })
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
    "for (const item of items) other.push(item);",
    "if (flag) { other.push(1); } else { other.push(2); }",
    "while (other.length < 3) { if (flag) continue; other.push(3); }",
    "switch (other.length) { case 1: other.push(4); break; default: other.push(5); }",
    "try { other.push(6); } catch { other.push(7); } finally { other.push(8); }",
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
        let (through, kept_through) = ask_for_names(&text, u32::MAX);
        let (skipping, kept_skipping) = ask_for_names(&text, 0);
        assert_eq!(skipping, through, "{statement}");
        // Each has walked by itself: what goes through the loops leaves a type at each of them.
        assert!(
            kept_skipping < kept_through,
            "{statement}: {kept_skipping}, {kept_through}"
        );
    }
}

const FAR_WALK_OF_A_BUILD: u32 = 1024;

const STATEMENTS_BETWEEN_LISTS_THAT_GROW: &[&str] = &[
    "grown.push(\"text\");",
    "grown[0] = true;",
    "if (flag) grown.push(null);",
    "if (flag) other.push(null); else grown.push(1n);",
    "(grown as any).push({});",
    "(0, grown).push(\"comma\");",
    "grown!.push(\"sure\");",
    "holder.list.push(\"of a holder\");",
    "holder[key].push(\"under a key\");",
    "for (const item of items) { if (item > 1) grown.push(flag); }",
    "for (const item of items) { other.push(grown[0]); grown.push(flag); }",
    "while (other.length < 3) { other.push(grown.length); if (flag) break; }",
    "do { other[0] = grown[0]; } while (flag);",
    "if (grown.length) other.push(\"asked\");",
    "grown = [];",
    "for (const item of items) { grown = []; grown.push(item); }",
    "switch (other.length) { case 1: grown.push(4); break; default: other.push(5); }",
    "try { grown.push(6); } catch { other.push(7); } finally { other.push(8); }",
    "const read = () => grown; other.push(read);",
    "fail();",
];

const FILLER_WITH_LOOPS: &str = "for (const item of items) other.push(item);\nother[0] = other[1];\nfor (let i = 0; i < 3; i++) other.push(i);\n";
const FILLER_OF_ONE_RUN: &str =
    "other.push(1); spare[0] = 2; spare.push(\"spare\"); other[1] = 3;\n";

fn write_program_of_lists_that_grow(statement: &str, filler: &str, padding: usize) -> String {
    let mut text = String::from(
        "declare const items: number[];
declare const flag: boolean;
declare const key: \"list\";
declare function fail(): void;
const holder: any = { list: [] };
const spare = [];
let grown = [];
grown.push(1);
const other = [];
other.push(\"first\");
other.push(0);
",
    );
    text.push_str(&filler.repeat(padding));
    writeln!(text, "{statement}").unwrap();
    text.push_str(&filler.repeat(padding));
    text.push_str("export const seen = [grown, other];\n");
    text
}

#[test]
fn a_walk_for_a_list_that_grows_finds_behind_what_grows_other_lists_what_a_walk_through_it_finds() {
    for statement in STATEMENTS_BETWEEN_LISTS_THAT_GROW {
        let near = write_program_of_lists_that_grow(statement, "", 0);
        let (near, _) = ask_for_names(&near, u32::MAX);
        let near = types_of_the_last_names(&near, 2);
        assert!(
            near[1].ends_with(")[]"),
            "nothing grows: {statement}: {near:?}"
        );
        for filler in [FILLER_WITH_LOOPS, FILLER_OF_ONE_RUN] {
            let text = write_program_of_lists_that_grow(statement, filler, 40);
            let (through, _) = ask_for_names(&text, u32::MAX);
            assert_eq!(
                types_of_the_last_names(&through, 2)[0],
                near[0],
                "{statement}: {filler}"
            );
            for far_walk in [0, 32, FAR_WALK_OF_A_BUILD] {
                let (skipping, _) = ask_for_names(&text, far_walk);
                assert_eq!(skipping, through, "{statement}: {filler}: {far_walk}");
            }
        }
    }
}

const STATEMENTS_ABOUT_A_FIELD: &[&str] = &[
    "holder.part = 1;",
    "if (flag) holder.part = \"text\";",
    "if (typeof holder.part === \"number\") throw new Error(\"\");",
    "for (const item of items) { if (item > 1) holder.part = item; }",
    "try { holder.part = undefined; } finally { other.push(9); }",
    "holder = { part: 2 };",
    "assertNumber(holder.part);",
];

const FUNCTIONS_AROUND: &[(&str, &str)] = &[
    ("", ""),
    ("function run() {", "}\nrun();"),
    ("const run = () => {", "};\nrun();"),
    ("const runner = { run() {", "} };\nrunner.run();"),
    ("class Runner { run() {", "} }\nnew Runner().run();"),
    (
        "function around(subject: string | number | undefined) { return () => {",
        "}; }\naround(1)();",
    ),
];

fn write_program_of_tests(statement: &str, padding: usize, around: (&str, &str)) -> String {
    let mut text = String::from(
        "declare const items: number[];
declare const flag: boolean;
declare function assertNumber(value: unknown): asserts value is number;
declare function fail(): never;
declare function make(): string | number | undefined;
declare function take(value: unknown): void;
const other: number[] = [];
const constant = make();
const isText = typeof constant === \"string\";
",
    );
    writeln!(text, "{}", around.0).unwrap();
    if !around.0.contains("subject") {
        text.push_str("let subject = make();\n");
    }
    text.push_str("let holder = { part: make() };\n");
    let tests = "if (typeof subject === \"string\") for (const unit of subject) other.push(unit.length); else take(subject);
if (flag && typeof holder.part === \"string\") for (const unit of holder.part) other.push(unit.length); else take(holder.part);
if (typeof constant === \"number\") other.push(constant);
";
    for _ in 0..padding {
        text.push_str(tests);
    }
    writeln!(text, "{statement}").unwrap();
    for _ in 0..padding {
        text.push_str(tests);
    }
    text.push_str("take([subject, holder.part, constant, other]);\n");
    writeln!(text, "{}", around.1).unwrap();
    text
}

#[test]
fn a_walk_that_takes_what_an_earlier_walk_left_finds_what_a_walk_through_the_tests_finds() {
    for &around in FUNCTIONS_AROUND {
        for statement in STATEMENTS_IN_BETWEEN.iter().chain(STATEMENTS_ABOUT_A_FIELD) {
            let text = write_program_of_tests(statement, 6, around);
            let (through, _) = ask_for_names(&text, u32::MAX);
            let (taking, _) = ask_for_names(&text, FAR_WALK_OF_A_BUILD);
            assert_eq!(taking, through, "{}: {statement}", around.0);
        }
    }
}

const STATE_AND_A_TRY_STATEMENT_WITH_A_BRANCH_IN_ITS_FINALLY_BLOCK: (&str, &str) = (
    "// @ts-nocheck
declare function mayThrow(): void;
declare const quiet: boolean;
let state: \"idle\" | \"open\" | \"done\" = \"idle\";
",
    "try { state = \"open\"; mayThrow(); state = \"done\"; } catch { mayThrow(); state = \"idle\"; } finally { if (quiet) void 0; }",
);

fn types_of_the_last_names(types: &[String], count: usize) -> Vec<&str> {
    let last = &types[types.len() - count..];
    (last.iter())
        .map(|it| it.split_once(": ").unwrap().1)
        .collect()
}

/// The walk from the outer `finally` block goes through the inner one twice: as it's left in the normal way, and as an
/// exception leaves it. The second time it ends at what the first time left in `sharedFlows`. The walk from the `catch`
/// clause only goes through it the second way.
#[test]
fn a_walk_that_went_through_a_finally_block_twice_leaves_nothing_for_a_walk_that_goes_through_it_once()
 {
    let (state, inner) = STATE_AND_A_TRY_STATEMENT_WITH_A_BRANCH_IN_ITS_FINALLY_BLOCK;
    let text = format!(
        "{state}try {{\n  try {{\n    {inner}\n  }} finally {{ state; state; }}\n}} catch {{ state; }}\n"
    );
    let (through, _) = ask_for_names(&text, u32::MAX);
    let (taking, _) = ask_for_names(&text, FAR_WALK_OF_A_BUILD);
    assert_eq!(taking, through);
    let twice = "\"done\" | \"idle\"";
    let expected = [twice, twice, "\"done\" | \"idle\" | \"open\""];
    assert_eq!(types_of_the_last_names(&through, 3), expected);
}

/// The other way round: the walk from the `catch` clause comes first.
#[test]
fn a_walk_that_goes_through_a_finally_block_twice_takes_nothing_from_a_walk_that_went_through_it_once()
 {
    let (state, inner) = STATE_AND_A_TRY_STATEMENT_WITH_A_BRANCH_IN_ITS_FINALLY_BLOCK;
    let text =
        format!("{state}try {{\n  {inner}\n}} catch {{ state; state; }} finally {{ state; }}\n");
    let (through, _) = ask_for_names(&text, u32::MAX);
    let (taking, _) = ask_for_names(&text, FAR_WALK_OF_A_BUILD);
    assert_eq!(taking, through);
    let once = "\"done\" | \"idle\" | \"open\"";
    assert_eq!(
        types_of_the_last_names(&through, 3),
        [once, once, "\"done\" | \"idle\""]
    );
}

#[test]
fn what_hangs_on_where_a_field_is_read_is_not_left_for_the_next_walk() {
    let text = "type Fixed = { readonly part: string | number[] };
type Loose = { part: string | number[]; extra: number };
declare function take(value: unknown): void;
export function count(holder: Fixed | Loose) {
  const isText = typeof holder.part === \"string\";
  if (\"extra\" in holder) holder.part = [1, 2, 3];
  if (isText) {
    if (!(\"extra\" in holder)) take(holder.part);
    else take(holder.part);
  }
}
export function apart(holder: { readonly part: string | number[] }, flag: boolean) {
  const isText = typeof holder.part === \"string\";
  if (isText) {
    if (flag) take(holder.part);
    else {
      const { part } = holder;
      take(part);
    }
  }
}
";
    let (through, _) = ask_for_names(text, u32::MAX);
    let (taking, _) = ask_for_names(text, FAR_WALK_OF_A_BUILD);
    assert_eq!(taking, through);
}

#[test]
fn lists_that_grow_behind_many_loops_do_not_each_leave_a_type_at_every_loop() {
    const COUNT: usize = 120;
    let mut text = String::from("declare const items: number[];\n");
    for index in 0..COUNT {
        writeln!(
            text,
            "const made{index} = [];\nfor (const item of items) made{index}.push(item);"
        )
        .unwrap();
    }
    for index in 0..COUNT {
        writeln!(text, "made{index}[0] = made{index}[1];").unwrap();
    }
    let (through, kept_through) = ask_for_names(&text, u32::MAX);
    let (skipping, kept_skipping) = ask_for_names(&text, 32);
    assert_eq!(skipping, through);
    assert!(kept_through > COUNT * COUNT / 4, "{kept_through}");
    assert!(kept_skipping < COUNT * 20, "{kept_skipping}");
}

#[test]
fn a_list_that_grows_in_a_finally_block_has_the_type_that_each_way_out_of_it_brings() {
    for inner in [
        "",
        "grown.push(\"tried\");",
        "if (items.length) grown.push(\"tried\");",
        "for (const item of items) other.push(item);",
    ] {
        for caught in [
            "",
            "catch { grown.push(true); }",
            "catch { other.push(true); }",
        ] {
            let filler = "for (const item of items) other.push(item);\n".repeat(20);
            let mut text =
                String::from("declare const items: number[];\nconst grown = [], other = [];\n");
            text.push_str("grown.push(1); other.push(1);\n");
            text.push_str(&filler);
            writeln!(text, "try {{ {inner}\n{filler} }} {caught}").unwrap();
            writeln!(text, "finally {{\n{filler}grown.push(null); grown;").unwrap();
            writeln!(text, "{filler} }}\n{filler}grown; other;").unwrap();
            text.push_str("try { grown; } finally { grown; }\ngrown;\n");
            let (through, _) = ask_for_names(&text, u32::MAX);
            for far_walk in [0, 32] {
                let (skipping, _) = ask_for_names(&text, far_walk);
                assert_eq!(skipping, through, "{inner} {caught}: {far_walk}");
            }
        }
    }
}

fn write_program_with_calls_beside_commas(filler: usize) -> String {
    let mut text = String::from(
        "var isFirst = x => 0, isSecond = x => 0, fetchRows = () => [], place = 0, drain = () => {}, one = 0, two = 0, spare = 0;
var meter = { total: 0, add(v) { this.total += v } };
function fill(meter) {
  const mark = meter ? 1 : \"s\";
",
    );
    for index in 0..filler {
        writeln!(text, "  meter.add({index}); meter.add({index});").unwrap();
    }
    text.push_str(
        "  return mark;
}
function gather(list) {
  let kept = [];
  let begin = () => {}, end = () => {};
  let current = null;
  for (let [key, item] of list.entries()) {
    let none = 0;
    if (isFirst(item));
    if (isSecond(item));
    if (item.kind && item.inner.kind);
    else if (item.kind && item.inner.kind) {
      let rows = current ? [] : fetchRows();
      {
        let row = rows[place];
        kept.push({ body: [row] });
        if (0) { continue }
        drain(), kept.push(1);
      }
    } else if (item.kind && item.inner.kind);
    else if (item.kind) {
      let left = 0, right = 0;
      if (one && Array.isArray(item));
      if (two && Array.isArray(item)) {
        let a = 0, b = 0, c = 0, d = 0, e = 0;
        if (0) kept.push(2);
      }
      {
        if (0) spare = null;
        begin(), end();
        continue;
      }
    }
  }
  return kept;
}
export const seen = [fill(meter), meter.total, gather([{ kind: \"a\", inner: { kind: \"\" } }]).length];
",
    );
    text
}

fn ask_for_every_expression_from_the_last(text: &str, far_walk: u32) -> Vec<String> {
    let text = &unchecked(text);
    with_program(&[("main.ts", text)], &["./main.ts"], 1, |program| {
        let all = program.files();
        let roles = vec![FileRole::Checked; all.modules.len()];
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            alias_mentions: None,
            max_inference_nodes: 0,
            limits: Default::default(),
        };
        let main = program.file("main.ts");
        let answer = Mutex::new(Vec::new());
        check(program, &|checker, file| {
            if file != main {
                return;
            }
            checker.set_far_walk(far_walk);
            *answer.lock().unwrap() = checker.with_queries(file, &inputs, |queries| {
                let expressions = queries.hir().exprs.iter().enumerate();
                let mut asked: Vec<(u32, u32, ExprId)> = expressions
                    .map(|(index, it)| (it.pos, it.end, ExprId(index as u32)))
                    .collect();
                asked.sort();
                let types = asked.iter().rev().map(|&(position, end, expression)| {
                    let text = match queries.expression_type(expression) {
                        Ok(ty) => String::from_utf8(queries.type_text(ty)).unwrap(),
                        Err(reason) => format!("{reason:?}"),
                    };
                    format!("{position}..{end}: {text}")
                });
                types.collect()
            });
        });
        answer.into_inner().unwrap()
    })
}

/// To learn whether a call in a comma expression is idle, its callee is checked, by a walk that reaches the same calls again.
/// What that walk writes into the table of the far skip may not be undone by the walk around it: two entries named each other,
/// and with 31 lines of filler and the far walk of a build the chase went round for ever.
#[test]
fn a_call_beside_a_comma_that_is_asked_about_in_the_middle_of_a_far_skip_leaves_the_table_whole() {
    for filler in [0, 31] {
        let text = write_program_with_calls_beside_commas(filler);
        let through = ask_for_every_expression_from_the_last(&text, u32::MAX);
        for far_walk in [32, 64] {
            let skipping = ask_for_every_expression_from_the_last(&text, far_walk);
            assert_eq!(
                skipping, through,
                "{filler} lines of filler, a far walk of {far_walk}"
            );
        }
    }
}

/// The far skip from the name takes the walk to the head of the loop. Each `continue` is an antecedent of the head inside the
/// stretch that the skip passed, a few nodes from the head.
#[test]
fn many_ways_back_to_the_head_of_a_loop_do_not_double_the_wait_between_far_skips_past_its_type() {
    let mut text = String::from(
        "declare function next(): boolean;\ndeclare const flags: boolean[];\nlet count = 0;\nlet state: \"a\" | \"b\" | \"c\" = \"a\";\nwhile (next()) {\n",
    );
    for index in 0..40 {
        writeln!(text, "  if (flags[{index}]) continue;").unwrap();
    }
    for _ in 0..40 {
        text.push_str("  if (next()) count = count + 1;\n");
    }
    text.push_str(
        "  state;\n  if (next()) state = \"b\";\n}\nexport const seen = [state, count];\n",
    );
    let (through, _) = ask_for_names(&text, u32::MAX);
    let (skipping, _) = ask_for_names(&text, 32);
    assert_eq!(skipping, through);
}

#[test]
fn what_walks_have_left_goes_with_the_file() {
    const PARTS: usize = 300;
    let part = "export function pick(value: string | number | undefined, flag: boolean) {
    let seen = 0;
    if (flag) { seen = 1; } else { seen = 2; }
    if (typeof value === \"string\") { return value.length + seen; }
    if (flag) { return value; }
    return value;
}
";
    let names: Vec<String> = (0..PARTS).map(|index| format!("part{index}.ts")).collect();
    let mut main = String::new();
    for index in 0..PARTS {
        writeln!(
            main,
            "import {{ pick as pick{index} }} from \"./part{index}\";"
        )
        .unwrap();
        writeln!(main, "pick{index}({index}, true);").unwrap();
    }
    let mut files: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), part)).collect();
    files.push(("main.ts", &main));
    with_program(&files, &["./main.ts"], 1, |program| {
        let main = program.file("main.ts");
        let kept = Mutex::new(Vec::new());
        check(program, &|checker, file| {
            if file != main {
                kept.lock().unwrap().push(checker.count_kept_walks());
            }
        });
        let kept = kept.into_inner().unwrap();
        assert_eq!(kept.len(), PARTS);
        assert_ne!(kept[0], 0);
        assert!(kept.iter().all(|&count| count == kept[0]), "{kept:?}");
    })
}

#[test]
fn names_behind_many_loops_do_not_each_leave_a_type_at_every_loop() {
    const COUNT: usize = 300;
    let mut text =
        String::from("declare const items: number[];\ndeclare function make(): string | number;\n");
    for index in 0..COUNT {
        writeln!(
            text,
            "var made{index} = make();\nfor (const item of items) items.push(item);"
        )
        .unwrap();
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
