mod support;
use support::*;

use std::borrow::Cow;
use std::sync::Mutex;

type Row = (&'static str, &'static str);

/// TypeScript, and the same code as JavaScript.
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
];

const KEPT_TEXT_ROWS: &[(&str, &str, &str)] = &[
    (
        "a.ts",
        "enum E { A = 1 as number } namespace N { export const v: T = 1; export interface I {} }",
        "enum E { A = 1 } namespace N { export const v = 1;  }",
    ),
    (
        "a.ts",
        "class A { constructor(private readonly x: T, public y?: U) {} }",
        "class A { constructor(x, y) {} }",
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
];

fn parse_typescript<'s>(w: &Workspace<'s>, path: &str, text: &[u8]) -> File<'s> {
    let options = CompileParseOptions {
        path: path.as_bytes(),
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: true,
        reads_jsdoc: true,
        keeps_function_directives: false,
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
            let kept = remove_types(&parse_typescript(w, path, text.as_bytes()));
            assert_eq!(String::from_utf8_lossy(&kept), expected, "{text}");
        }
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

// What is left is JavaScript, or TypeScript syntax that emits code and has no types left in it.
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
