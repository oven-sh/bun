mod support;
use support::*;

use bun_sema::erasure::{ReplacedText, find_type_ranges_beside, keep_only_comments_beside_types};
use std::borrow::Cow;
use std::sync::Mutex;

type Row = (&'static str, &'static str);

const EXACT_PAIRS: &[Row] = &[
    (
        r#"function f(a: number, b?: string): void { let c: number = a; }"#,
        r#"function f(a, b) { let c = a; }"#,
    ),
    (
        r#"function g<T>(x: T): T { return h<T>(x); } new Map<string, number>(); const k = h<number>;"#,
        r#"function g(x) { return h(x); } new Map(); const k = h;"#,
    ),
    (
        r#"(x as any).y; (x satisfies T); x!.y; (<any>x).y; [1] as const; a!.b = 1;"#,
        r#"x.y; x; x.y; x.y; [1]; a.b = 1;"#,
    ),
    (
        r#"interface I {} type T = 1; declare const d: number; declare function e(): void; declare class K {} declare enum E { A } declare namespace N {} a();"#,
        r#"a();"#,
    ),
    (
        r#"import type { A } from "m"; import { type B, c } from "n"; export type { A }; export { type B, c }; export type * from "o";"#,
        r#"import { c } from "n"; export { c };"#,
    ),
    (
        r#"function o(a: number): void; function o(a: string): void; function o(a: any) {}"#,
        r#"function o(a) {}"#,
    ),
    (
        r#"function t(this: Window, a: number) {}"#,
        r#"function t(a) {}"#,
    ),
    (
        r#"function s(a: { new (b: number): object; (b: string): string }): { (b: number): number; [key: string]: number; (b: string): string } { return a; }"#,
        r#"function s(a) { return a; }"#,
    ),
    (
        r#"abstract class C<T> extends B<T> implements I { declare x: number; abstract y: number; abstract n(): void; private p = 1; readonly z: string = "a"; protected static w?: number; v!: number; public override m(): void {} m2(a: number): void; m2(a: any) {} [k: string]: any; }"#,
        r#"class C extends B { p = 1; z = "a"; static w; v; m() {} m2(a) {} }"#,
    ),
    (
        r#"let x!: number; try {} catch (e: unknown) {} for (const i of y as any[]) {}"#,
        r#"let x; try {} catch (e) {} for (const i of y) {}"#,
    ),
    (
        r#"const f = <T,>(x: T) => x; const g = (x: number): number => x; const h = () => ({} as T);"#,
        r#"const f = (x) => x; const g = x => x; const h = () => ({});"#,
    ),
    (r#"a?.b!.c; (a?.b as T).c;"#, r#"a?.b.c; (a?.b).c;"#),
    (
        r#"(a?.b as T) ?? c; (a?.b as T)?.c; (a?.b as T)?.();"#,
        r#"a?.b ?? c; a?.b?.c; a?.b?.();"#,
    ),
    (
        r#"({ a }); ({ a: a as T }); ({ a: a });"#,
        r#"({ a: a }); ({ a }); ({ a });"#,
    ),
    (
        r#"namespace N { export interface I {} export namespace M { type T = I; } } namespace O {} a();"#,
        r#"a();"#,
    ),
    (
        r#"import { a } from "m"; a();"#,
        r#"import { a } from "m"; a();"#,
    ),
    (
        r#""use strict"; f( a )  // c"#,
        "\"use strict\";\n/* d */ f(a);",
    ),
    (
        r#"let a: number = 1;"#,
        r#"/** @type {number} */ let a = 1;"#,
    ),
    (
        r#"x = `a${b as any}c`; y = /r/g; z = t`u`; w = 1n;"#,
        r#"x = `a${b}c`; y = /r/g; z = t`u`; w = 1n;"#,
    ),
    (
        r#"(a as T).b = function () {}; (a.b as T) = 1; (a) = function () {}; (a as T) = () => 1;"#,
        r#"a.b = function () {}; a.b = 1; (a) = function () {}; (a) = () => 1;"#,
    ),
    (
        r#"[a, { b, c: [d] = [] as T[], ...e }, ...f] = g as U; for (a of b as T[]); for ([a] of b);"#,
        r#"[a, { b, c: [d] = [], ...e }, ...f] = g; for (a of b); for ([a] of b);"#,
    ),
    (
        r#"import { type A } from "m"; import { b } from "n"; export { type A }; export { b };"#,
        r#"import { b } from "n"; export { b };"#,
    ),
    (
        r#"import type { A } from "m"; import { b } from "n"; b();"#,
        r#"import { b } from "n"; b();"#,
    ),
    (r#"import type { A } from "m"; a();"#, r#"a();"#),
    (r#"import { type A } from "m"; a();"#, r#"a();"#),
    (
        r#"({ 1n: a as T }); class A { 1n(): void {} 2n: number = 0; }"#,
        r#"({ 1n: a }); class A { 1n() {} 2n = 0; }"#,
    ),
    (r#"with (a as T) b!;"#, r#"with (a) b;"#),
    (
        r#"const f = () => <T>{}; const g = () => <T>{ a: 1 }.a; <T>function () {}(); <T>class {}.name; const h = <T>{};"#,
        r#"const f = () => ({}); const g = () => ({ a: 1 }).a; (function () {})(); (class {}).name; const h = ({});"#,
    ),
    (
        r#"function f(a) { return<T>a; } typeof<T>b; void<T>c; d = <T>e; f(<T>g); h = <U><T>{};"#,
        r#"function f(a) { return a; } typeof b; void c; d = e; f(g); h = ({});"#,
    ),
];

const TYPED_TEXTS: &[&str] = &[
    "const f = (a: (A | B), b?: ((C))): D => (a as (A)) satisfies (B);",
    "function f<const T extends U = V>(this: T, ...rest: T[]): asserts this is T {}",
    "function f(this: void) {} function g(this /* it */ : void, a?) {}",
    "function f(this, a) {} function g(this) {} const o = { m(this) {} };",
    "class A<in out T> extends B<(T), U[]> implements I<T>, J { [key: string]: T; static readonly x?: T = 1; constructor(a: T); constructor(a) { super(); } }",
    "class A { m?(): void {} n?<T>(a: T) {} x?; y? = 1; z!: T; static w?: T }",
    "x!!!.y; (x)!; x![0]!(); new A<T>; f<T>`t`; a?.<T>(b); a < b > c;",
    "let { a, b: [c] }: T = d, e: () => void = () => {}; for (let i: number = 0;;) {}",
    "const o = { m<T>(this: T, a?: T): T { return a!; }, get p(): T { return 1 as T; }, async *g(): AsyncGenerator<T> {} };",
    "label: { type T = 1; interface I {} a(); }",
    "const f = async <T,>(a: T): Promise<T> => a; const g = function* <T>(): Generator<T> {};",
    "a = b as unknown as T; c = <T><unknown>d; e = (f as T)!; g = <const>[1];",
    "const a = (<T>(b)) as U; const c = <T>(d).e; const f = ((g))!;",
    "class A { private readonly a = 1; protected abstract b(): void; public declare c: T; override d() {} static { f as T; } }",
    "let a: typeof import(\"m\"), b: { c(d: T): U; new (): V; readonly [e: string]: W };",
    "function f(a: T /* b */, /* c */ d: U /* e */) /* f */ : /* g */ V /* h */ {}",
    "let a // b\n  : T = 1; function f() // c\n  : // d\n  T {}",
    "class A { x // b\n  ?: T; y /* c */\n  : T }",
    "const a = \"//\"; function f()\n  : T {}",
    "function f() // c\u{2028}: T {}",
    "class A { x // c\u{2028}: T = 1; y // c\u{2029}: T }",
    "class A // c\u{2028}implements I {}",
    "#!x\u{2028}function f(): T {}",
    "function f()\u{a0}: T {}",
    "class A extends B { constructor(public a: T, private readonly b?: U, protected c = a, override d = 1) { super() } }",
    "class A { constructor(public get: T, readonly set: T, private async: T, protected \\u0061: T) {} }",
];

const KEPT_TEXT_ROWS: &[(&str, &str, &str)] = &[
    (
        "a.ts",
        "class C { a = b\n  public [k]?: T\n  c = d\n  private readonly *[e]() {}\n  f = g\n  protected in = 1 }",
        "class C { a = b\n  ;[k]\n  c = d\n  ;*[e]() {}\n  f = g\n  ;in = 1 }",
    ),
    (
        "a.ts",
        "class C { a = b\n  static readonly [k] = 1\n  c = d\n  public static readonly *[e]() {}\n  static override in = 2 }",
        "class C { a = b\n  static [k] = 1\n  c = d\n  static *[e]() {}\n  static in = 2 }",
    ),
    (
        "a.ts",
        "const f = () => <Foo>{}; function g(a: unknown) { return<number>a; } const h = <T>i;",
        "const f = () => ({}); function g(a) { return a; } const h = i;",
    ),
    (
        "a.ts",
        "if (a) type T = 1;\nb(); if (c) d(); else interface I {}\ne(); for (;;) declare const f: T;\ng(); h: type U = 2;\ni();",
        "if (a) ;\nb(); if (c) d(); else ;\ne(); for (;;) ;\ng(); h: ;\ni();",
    ),
    (
        "a.ts",
        "enum E { A = 1 as number } namespace N { export const v: T = 1; export interface I {} }",
        "enum E { A = 1 } namespace N { export const v = 1;  }",
    ),
    (
        "a.ts",
        "namespace N.M { export interface I {} } namespace O { declare const v: T; } a();",
        "namespace N.M {  }  a();",
    ),
    (
        "a.ts",
        "class A { constructor(private readonly x: T, public y?: U) {} }",
        "class A { x; y; constructor(x, y) { this.x = x; this.y = y;} }",
    ),
    (
        "a.ts",
        "class A { z = 1; m() {} constructor(a: T, public x: T) { f(); } }",
        "class A { x; z = 1; m() {} constructor(a, x) { this.x = x; f(); } }",
    ),
    (
        "a.ts",
        "class A { declare d: T; constructor(x: T); constructor(public x: any) {} }",
        "class A { x;   constructor(x) { this.x = x;} }",
    ),
    (
        "a.ts",
        "class B extends A { constructor(a: T, private b = 1) { super(a); f(); } }",
        "class B extends A { b; constructor(a, b = 1) { super(a); this.b = b; f(); } }",
    ),
    (
        "a.ts",
        "class B extends A { constructor(protected b: T) { f()\n super(b) // c\n } }",
        "class B extends A { b; constructor(b) { f()\n super(b); this.b = b; // c\n } }",
    ),
    (
        "a.ts",
        "class B extends A { constructor(override b: T) { if (b) { super(); } } }",
        "class B extends A { b; constructor(b) { this.b = b; if (b) { super(); } } }",
    ),
    (
        "a.ts",
        "const C = class { constructor(readonly x = class { constructor(public y: T) {} }) {} };",
        "const C = class { x; constructor(x = class { y; constructor(y) { this.y = y;} }) { this.x = x;} };",
    ),
    (
        "a.ts",
        "class A{constructor(public x:T){<T>function(){}()}}",
        "class A{x; constructor(x){ this.x = x;(function(){}())}}",
    ),
    (
        "a.ts",
        "class A { constructor(public { a }: T, b: T) {} static constructor(c: T) {} }",
        "class A { constructor({ a }, b) {} static constructor(c) {} }",
    ),
    (
        "a.ts",
        "class A { accessor x: T = 1; }",
        "class A { accessor x = 1; }",
    ),
    (
        "a.ts",
        "import r = require(\"m\"); export = r as T;",
        "import r = require(\"m\"); export = r;",
    ),
    (
        "a.tsx",
        "const e = <A<T> b={c as U} />;",
        "const e = <A b={c} />;",
    ),
    (
        "a.ts",
        "function f(a: unknown) {\n  return <number>\n    a;\n}",
        "function f(a) {\n  return a;\n}",
    ),
    (
        "a.ts",
        "function f(a: unknown) {\n  throw <number> // why\n    a;\n}",
        "function f(a) {\n  throw a;\n}",
    ),
    (
        "a.ts",
        "function* f(a: unknown) {\n  yield<number>\n    a;\n}",
        "function* f(a) {\n  yield a;\n}",
    ),
    (
        "a.ts",
        "const g = async <T,>\n  (x: T) => x; class A<T>\nextends B {}",
        "const g = async (x) => x; class A\nextends B {}",
    ),
    (
        "a.ts",
        "let x = a\ntype T = number;\n[x].length",
        "let x = a\n;\n[x].length",
    ),
    (
        "a.ts",
        "let x = a\ninterface I { p: number }\n(x)",
        "let x = a\n;\n(x)",
    ),
    ("a.ts", "let x = <A>{} as B\n(x)", "let x = ({});\n(x)"),
    (
        "a.ts",
        "x || a + b as number * c; a * b satisfies T ** c; a ** b as T ** c; a < b as any + c; a + b as T as U % c; a - b as T >> c;",
        "x || (a + b) * c; (a * b) ** c; (a ** b) ** c; (a < b) + c; (a + b) % c; a - b >> c;",
    ),
    (
        "a.ts",
        "a as T * c; a * b as T + c; a + b as T - c; (a + b) as T * c; a + b as number < c; a + (b as T) * c; a + b as T /* d */ / c;",
        "a * c; a * b + c; a + b - c; (a + b) * c; a + b < c; a + (b) * c; (a + b) /* d */ / c;",
    ),
    (
        "a.ts",
        "let x = a\ndeclare const d: number\n`${x}`\ntype T = 1\ny()",
        "let x = a\n;\n`${x}`\n\ny()",
    ),
    (
        "a.ts",
        "let x = a as number\n(x); let y = [1] as const\n[y]; k as string in o; (a as T)(b);",
        "let x = a;\n(x); let y = [1];\n[y]; k in o; (a)(b);",
    ),
    (
        "a.ts",
        "class K {\n  static?: number\n  x = a\n}",
        "class K {\n  static;\n  x = a\n}",
    ),
    (
        "a.ts",
        "class K {\n  get!: number\n  x = a\n  public set: number\n  y = a\n  static?: number;\n  get?: number\n}",
        "class K {\n  get;\n  x = a\n  set;\n  y = a\n  static;\n  get\n}",
    ),
    (
        "a.ts",
        "class K {\n  x = a\n  declare y: number\n  [k] = 1\n  z = a\n  abstract w: number\n  in = 1\n}",
        "class K {\n  x = a\n  ;\n  [k] = 1\n  z = a\n  ;\n  in = 1\n}",
    ),
    (
        "a.ts",
        "function f(a: number) /* see /* above */ : number {\n  return a;\n}",
        "function f(a) {\n  return a;\n}",
    ),
    (
        "a.ts",
        "const quote = /\"/; function g() // the rest  \n  : string { return a; }",
        "const quote = /\"/; function g() { return a; }",
    ),
    (
        "a.ts",
        "const slashes = /[//]/; function g()\n  : string { return a; }",
        "const slashes = /[//]/; function g() { return a; }",
    ),
    (
        "a.ts",
        "const page = `\n// ${a}`; function g()\n  : string { return page; }",
        "const page = `\n// ${a}`; function g() { return page; }",
    ),
];

fn parse_typescript<'s>(w: &Workspace<'s>, path: &str, text: &[u8]) -> File<'s> {
    let options = CompileParseOptions {
        path: path.as_bytes(),
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: true,
        reads_jsdoc: true,
        ignores_pure_comments: false,
    };
    let mut file = parse_for_compile(w.arena, &options, text, &w.atoms);
    file.text = Cow::Borrowed(w.arena.alloc_slice_copy(text));
    file
}

fn has_syntax_errors(file: &File<'_>) -> bool {
    file.has_errors
        || file.has_parse_diagnostics
        || file.ran_out_of_stack
        || (file.diagnostics.iter()).any(|it| it.kind == DiagnosticKind::Js)
}

fn remove_types(typed: &File<'_>) -> Vec<u8> {
    find_type_ranges(typed).remove_from(&typed.text)
}

fn is_javascript(w: &Workspace<'_>, text: &[u8]) -> bool {
    let source = Source {
        reads_jsdoc: false,
        ..Source::from_bytes("a.js", text)
    };
    !has_syntax_errors(&w.parse(&source))
}

fn without_white_space(text: &[u8]) -> String {
    let kept = text.iter().filter(|byte| !byte.is_ascii_whitespace());
    String::from_utf8_lossy(&kept.copied().collect::<Vec<u8>>()).into_owned()
}

#[test]
fn text_without_type_ranges_is_javascript() {
    with_workspace(|w| {
        let typed_texts = EXACT_PAIRS.iter().map(|pair| pair.0);
        for text in typed_texts.chain(TYPED_TEXTS.iter().copied()) {
            let kept = remove_types(&parse_typescript(w, "a.ts", text.as_bytes()));
            let shown = String::from_utf8_lossy(&kept);
            assert!(is_javascript(w, &kept), "{text} => {shown}");
        }
    });
}

#[test]
fn syntax_that_emits_code_is_kept_without_its_types() {
    with_workspace(|w| {
        for &(path, text, expected) in KEPT_TEXT_ROWS {
            let mut typed = parse_typescript(w, path, text.as_bytes());
            let kept = remove_types(&typed);
            assert_eq!(String::from_utf8_lossy(&kept), expected, "{text}");
            let packed = find_type_ranges(&typed).pack();
            let mut unpacked = vec![0; packed.kept_len(text.len())];
            packed.remove_from(text.as_bytes(), &mut unpacked);
            assert_eq!(unpacked, kept, "{text}");
            keep_only_comments_beside_types(&mut typed, w.arena);
            assert_eq!(remove_types(&typed), kept, "{text}");
        }
    });
}

#[test]
fn comments_away_from_types_are_dropped() {
    let text = "// a\nfunction f() // b\n: void {} /* c */";
    with_workspace(|w| {
        let mut typed = parse_typescript(w, "a.ts", text.as_bytes());
        assert_eq!(typed.comments.len(), 3);
        keep_only_comments_beside_types(&mut typed, w.arena);
        let kept: Vec<u32> = typed.comments.iter().map(|comment| comment.pos).collect();
        assert_eq!(kept, [text.find("// b").unwrap() as u32]);
    });
}

#[test]
fn semicolon_on_a_later_line_than_an_erased_statement_stays() {
    let text = "a()\ndeclare const b: number\n;(c)()\n";
    with_workspace(|w| {
        let kept = remove_types(&parse_typescript(w, "a.ts", text.as_bytes()));
        assert_eq!(String::from_utf8_lossy(&kept), "a()\n\n;(c)()\n");
    });
}

#[test]
fn offsets_follow_removed_ranges() {
    let text = "const f = (a: number): number => a as number; g();";
    with_workspace(|w| {
        let typed = parse_typescript(w, "a.ts", text.as_bytes());
        let ranges = find_type_ranges(&typed);
        let kept = ranges.remove_from(text.as_bytes());
        assert_eq!(kept, b"const f = (a) => a; g();");
        let map = |part: &str| ranges.map_offset(text.find(part).unwrap() as u32) as usize;
        assert_eq!(map("const"), 0);
        assert_eq!(&kept[map("(a")..map(";")], b"(a) => a");
        assert_eq!(map(": number)"), map(")"));
        assert_eq!(&kept[map("g()")..], b"g();");
    });
}

#[test]
fn what_is_added_belongs_to_what_stands_in_front_of_it() {
    let text = "class A{m(){}constructor(public x:T){function f(){}}}";
    with_workspace(|w| {
        let typed = parse_typescript(w, "a.ts", text.as_bytes());
        let ranges = find_type_ranges(&typed);
        let kept = ranges.remove_from(text.as_bytes());
        let expected = "class A{x; m(){}constructor(x){ this.x = x;function f(){}}}";
        assert_eq!(String::from_utf8_lossy(&kept), expected);
        for part in ["m(){}", "function f(){}"] {
            let start = text.find(part).unwrap() as u32;
            let end = ranges.map_end(start + part.len() as u32) as usize;
            let mapped = &kept[ranges.map_start(start) as usize..end];
            assert_eq!(String::from_utf8_lossy(mapped), part);
        }
    });
}

#[test]
fn a_part_that_the_caller_replaces_goes_with_the_types_in_it() {
    let text = "const f = (): T => [(E as any).A, <T>E.B as T, E!.C.d, (<any>E).A!, E.B, -E.D]; class A{constructor(public x = E.A){E.B}}";
    let expected = "const f = () => [5, \"a longer text\", 7 .d, 5, \"a longer text\", (-9)]; class A{x; constructor(x = 5){ this.x = x;\"a longer text\"}}";
    let values = [
        ("(E as any).A", "5"),
        ("(<any>E).A", "5"),
        ("E.A", "5"),
        ("E.B", "\"a longer text\""),
        ("E!.C", "7 "),
        ("E.D", "9"),
        ("-E.D", "(-9)"),
    ];
    with_workspace(|w| {
        let typed = parse_typescript(w, "a.ts", text.as_bytes());
        let places = values.iter().flat_map(|&(read, value)| {
            let places = text.match_indices(read);
            places.map(move |(start, _)| ReplacedText {
                start: start as u32,
                end: (start + read.len()) as u32,
                text: value.as_bytes().into(),
            })
        });
        let ranges = find_type_ranges_beside(&typed, places.collect());
        let kept = ranges.remove_from(text.as_bytes());
        assert_eq!(String::from_utf8_lossy(&kept), expected);
        let arrow_end = text.find(';').unwrap() as u32;
        let arrow = &kept[ranges.map_start(10) as usize..ranges.map_end(arrow_end) as usize];
        let expected_arrow = &expected[10..expected.find(';').unwrap()];
        assert_eq!(String::from_utf8_lossy(arrow), expected_arrow);
    });
}

#[test]
fn text_that_the_caller_adds_behind_a_part_is_the_end_of_that_part() {
    let text = "enum E { C = f() + A}";
    let at = |part: &str| text.find(part).unwrap() as u32;
    let part = |start: u32, end: u32, text: &str| ReplacedText {
        start,
        end,
        text: text.as_bytes().into(),
    };
    let end = text.len() as u32;
    let parts = vec![
        part(end - 1, end, "])(E ||= {});"),
        part(end - 1, end - 1, "] = \"C\""),
        part(at("A}"), end - 1, "E.A"),
        part(at("C ="), at("f()"), "E[E[\"C\"] = "),
        part(0, at("C ="), "let E; ((E) => ["),
        part(end - 1, end - 1, "] = \"C\""),
    ];
    with_workspace(|w| {
        let typed = parse_typescript(w, "a.ts", text.as_bytes());
        let kept = find_type_ranges_beside(&typed, parts).remove_from(text.as_bytes());
        let expected = "let E; ((E) => [E[E[\"C\"] = f() + E.A] = \"C\"])(E ||= {});";
        assert_eq!(String::from_utf8_lossy(&kept), expected);
    });
}

#[test]
fn javascript_has_no_type_ranges() {
    with_workspace(|w| {
        for &(_, javascript) in EXACT_PAIRS {
            let file = parse_typescript(w, "a.ts", javascript.as_bytes());
            if !has_syntax_errors(&file) {
                let kept = remove_types(&file);
                assert_eq!(
                    without_white_space(&kept),
                    without_white_space(javascript.as_bytes())
                );
            }
        }
    });
}

#[test]
fn test_programs_without_type_ranges_are_javascript() {
    let different = Mutex::new(Vec::new());
    for_each_program(&[".ts"], |w, path, text| {
        let typed = parse_typescript(w, "a.ts", text);
        if has_syntax_errors(&typed) {
            return;
        }
        let kept = remove_types(&typed);
        if is_javascript(w, &kept) {
            return;
        }
        let still_typescript = parse_typescript(w, "a.ts", &kept);
        if has_syntax_errors(&still_typescript) {
            different.lock().unwrap().push(path.to_owned());
        }
    });
    let mut different = different.into_inner().unwrap();
    different.sort();
    assert!(
        different.is_empty(),
        "{} are no program without their types:\n{}",
        different.len(),
        different.join("\n")
    );
}
