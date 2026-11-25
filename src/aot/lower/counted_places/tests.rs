use bun_ast::Loader;
use bun_code_coverage::find_anchors;

use crate::compile::testing::lower_covered_files;
use crate::ir::Opcode;

/// For each counter of `covered.ts` or `covered.cjs`: what it is tied to, and how many instructions add to it.
fn count_instructions(files: &[(&str, &str)]) -> Vec<(String, usize)> {
    let &(name, text) = (files.iter())
        .find(|it| it.0.starts_with("covered."))
        .expect("a file is covered");
    let loader = match name {
        "covered.ts" => Loader::Ts,
        _ => Loader::Js,
    };
    let anchors = find_anchors(loader, text.as_bytes()).expect("the file can be parsed");
    let mut counters = vec![(String::new(), 0); anchors.counters as usize];
    for it in anchors.all.iter().rev() {
        let word = text[it.loc as usize..].split_whitespace().next();
        let word = word.unwrap_or_default();
        counters[it.counter as usize].0 = format!("{:?} {:?} {word}", it.role, it.event);
    }
    let name = name.to_owned();
    for (_, file) in lower_covered_files(files, move |path| path.ends_with(name.as_bytes())) {
        let functions = file.fragment.functions.iter();
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        for count in values.filter(|value| value.opcode == Opcode::CountExecution) {
            counters[count.fields[2] as usize].1 += 1;
        }
    }
    counters
}

fn never_counted(files: &[(&str, &str)]) -> Vec<String> {
    let counters = count_instructions(files).into_iter();
    let mut found: Vec<String> = (counters.filter(|it| it.1 == 0).map(|it| it.0)).collect();
    found.sort_unstable();
    found
}

#[track_caller]
fn assert_all_counted(source: &str) {
    assert_eq!(never_counted(&[("covered.ts", source)]), [""; 0]);
}

#[test]
fn a_file_that_is_not_covered_counts_nothing() {
    let files = [
        ("main.ts", "import './covered'; if (Date.now()) Date.now();"),
        ("covered.ts", ""),
    ];
    let expected = [("File Reached ".to_owned(), 1)];
    assert_eq!(count_instructions(&files), expected);
}

#[test]
fn what_typescript_adds_to_javascript() {
    assert_all_counted(
        "export enum Shade { Pale, Dark = Date.now() || 1 }
export namespace Measures.Flat { export function area() { return 1; } }
export class Kept { constructor(public first = 1) {} }
export const cast = (a: unknown, b: unknown) => (a as number) || <number>b;
export const sure = (a?: { b?: number }) => a?.b! ?? (a satisfies unknown);
",
    );
}

#[test]
fn members_of_classes() {
    assert_all_counted(
        "function mark(value: unknown, context: unknown) {}
export class Kept {
  readonly named = 1;
  [Symbol.iterator] = 2;
  bare;
  @mark marked = 3;
  accessor read = 4;
  static shared = 5;
  static { Date.now(); }
  @mark #hidden() { return 6; }
  get shown() { return this.#hidden(); }
}
export class Derived extends Kept {
  own = 7;
  constructor() { super(); this.own = 8; }
}
",
    );
}

#[test]
fn statements() {
    assert_all_counted(
        "export async function* all(a: any, i: number) {
  if (a) {} else {}
  if (a) i++; else if (i) i--;
  while (++i < a) await a;
  do i++; while (i < a);
  for (let j = 0; j < a; j++) { if (j) yield j; }
  for (const key in a) continue;
  for (const item of a) break;
  for await (const item of a) i++;
  switch (a) { case 1: case 2: i++; case 3: break; }
  switch (a) { case 'a': i++; default: i--; }
  try { a(); } catch { i++; }
  label: { if (a) break label; i++; }
  const kept = a();
  return kept;
}
",
    );
}

#[test]
fn expressions() {
    assert_all_counted(
        "export function all(a: any, b: any, { c = 1 }, [d = 2], made = () => 1) {
  a ||= b; a.b &&= b; a[b] ??= b;
  ({ a = 1 } = b);
  a ? 'a' : 'b';
  if (a && b || !(a ?? b)) a?.b?.[b]?.(a);
  delete a?.b;
  return [a ? 1 : b ? 2 : 3, a ? () => 2 : made, { ...(a && { b }) }, a?.b ?? b, typeof a?.b];
}
export const again = (n: number, step = 1): number => n > 0 ? again(n - step, step) : 0;
",
    );
}

#[test]
fn an_else_branch_that_is_a_conditional_counts_once() {
    let source = "export function nested(a: boolean, b: boolean) { return a ? 1 : b ? 2 : 3; }\n";
    let counters = count_instructions(&[("covered.ts", source)]);
    let instructions: Vec<usize> = counters.iter().map(|it| it.1).collect();
    assert_eq!(instructions, [1; 6]);
}

#[test]
fn what_nothing_reads() {
    let source = "const used = 1, unused = () => 2;\nexport const unread = 3, other = used;\n";
    let files = [("main.ts", "import './covered';"), ("covered.ts", source)];
    assert_eq!(never_counted(&files), [""; 0]);
}

#[test]
fn a_test_that_the_build_decides_counts_the_way_it_goes() {
    let source = "const ON = true;
export const picked = (a: number) => [ON ? 1 : 2, ON && a, ON || a, ON ?? a];
if (ON) Date.now(); else Date.parse('');
while (!ON) Date.UTC(1);
";
    assert_eq!(
        never_counted(&[("covered.ts", source)]),
        [
            "Expression Reached 2,",
            "Expression Reached a,",
            "Expression Reached a];",
            "Guarded Reached while",
            "Guarded Skipped if",
        ]
    );
}

#[test]
fn a_chain_goes_on_behind_what_the_build_knows() {
    let source = "import * as other from './other';
export const all = () => [other?.a , other?.b (), Math?.PI , require?.('./other') ];
other?.c ;
";
    let other = "export const a = 1, b = () => 2, c = 3;";
    let files = [("covered.ts", source), ("other.ts", other)];
    assert_eq!(never_counted(&files), [""; 0]);
}

#[test]
fn what_other_tools_emit_runs_as_it_is_written() {
    let source = r#"var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => { exports.a = 1; });
var Shade;
(function (Shade) { Shade[Shade["Pale"] = 0] = "Pale"; })(Shade || (Shade = {}));
var other = require("./other.cjs");
Object.defineProperty(exports, "b", { enumerable: true, get: function () { return other.b; } });
exports.c = require(require_a().a ? "bun:os" : other.b);
"#;
    let files = [
        ("main.mjs", "import { b } from './covered.cjs'; b();"),
        ("covered.cjs", source),
        ("other.cjs", "exports.b = function () {};"),
    ];
    assert_eq!(never_counted(&files), [""; 0]);
}
