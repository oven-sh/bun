mod support;
use support::*;

use ErasureMismatchKind::{ChildCount, EmitsCode, Flags, Literal, Name, NodeKind, Operator};
use std::borrow::Cow;
use std::sync::Mutex;

type Row = (&'static str, &'static str);

const CHAIN_LENGTH: usize = 100_000;
const NESTING_DEPTH: usize = 100_000;
const PACKAGES_ROOT: &str = "packages/bun-sound";
const SDK_VERSIONS: [&str; 2] = ["0.128.0", "0.112.1"];
const SDK_FILES: [&str; 4] = [
    "core/streaming.mjs",
    "internal/decoders/line.mjs",
    "internal/tslib.mjs",
    "internal/utils/bytes.mjs",
];

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

const NODE_KIND_ROWS: &[Row] = &[
    (r#"a + b;"#, r#"a(b);"#),
    (r#"if (a) b();"#, r#"while (a) b();"#),
    (r#"("use strict"); f();"#, r#""use strict"; f();"#),
    (r#"() => ({});"#, r#"() => {};"#),
    (r#"({ __proto__ });"#, r#"({ __proto__: __proto__ });"#),
    (r#"({ __proto__: __proto__ as T });"#, r#"({ __proto__ });"#),
    (r#"a! = function () {};"#, r#"a = function () {};"#),
    (r#"a! = function () {};"#, r#"(a) = function () {};"#),
    (r#"[a! = class {}] = [];"#, r#"[a = class {}] = [];"#),
    (r#"with (a) b;"#, r#"{ a; b; }"#),
];

const NAME_ROWS: &[Row] = &[
    (r#"let a = 1;"#, r#"let b = 1;"#),
    (r#"x.a;"#, r#"x.b;"#),
    (r#"a;"#, r#"b;"#),
    (r#"function f() {}"#, r#"function g() {}"#),
    (r#"l: for (;;) break l;"#, r#"m: for (;;) break m;"#),
    (r#"import { a } from "m";"#, r#"import { a } from "n";"#),
    (r#"({ a: 1 });"#, r#"({ b: 1 });"#),
    (r#"({ 1n: a });"#, r#"({ 2n: a });"#),
    (r#"class A { 1n() {} }"#, r#"class A { 2n() {} }"#),
    (r#"class A { 1n = 0; }"#, r#"class A { 2n = 0; }"#),
];

const LITERAL_ROWS: &[Row] = &[
    (r#"f(1);"#, r#"f(1.5);"#),
    (r#"f("a");"#, r#"f("b");"#),
    (r#"/a/g;"#, r#"/a/i;"#),
    (r#"/a/;"#, r#"/b/;"#),
    (r#"1n;"#, r#"2n;"#),
    (r#"x = `a${b}`;"#, r#"x = `c${b}`;"#),
    (r#"f`\x41${a}`;"#, r#"f`A${a}`;"#),
    (r#"f`\x41`;"#, r#"f`A`;"#),
    (r#"function f() { "a"; }"#, r#"function f() { "b"; }"#),
];

const OPERATOR_ROWS: &[Row] = &[
    (r#"a + b;"#, r#"a - b;"#),
    (r#"a += 1;"#, r#"a -= 1;"#),
    (r#"a = 1;"#, r#"a += 1;"#),
    (r#"++a;"#, r#"--a;"#),
    (r#"a++;"#, r#"++a;"#),
    (r#"a && b;"#, r#"a || b;"#),
];

const FLAGS_ROWS: &[Row] = &[
    (r#"a?.b;"#, r#"a.b;"#),
    (r#"(a?.b as T).c;"#, r#"a?.b.c;"#),
    (r#"let a = 1;"#, r#"const a = 1;"#),
    (r#"async function f() {}"#, r#"function f() {}"#),
    (r#"function* f() {}"#, r#"function f() {}"#),
    (r#"class A { static m() {} }"#, r#"class A { m() {} }"#),
    (r#"f('a');"#, r#"f(`a`);"#),
    (r#"function f(...a) {}"#, r#"function f(a) {}"#),
    (r#"for await (const a of b);"#, r#"for (const a of b);"#),
    (r#"export const a = 1;"#, r#"const a = 1;"#),
    (
        r#"function* f() { yield* a; }"#,
        r#"function* f() { yield a; }"#,
    ),
    (r#"a = function () {};"#, r#"(a) = function () {};"#),
    (r#"(a) = function () {};"#, r#"a = function () {};"#),
    (r#"(a as T) = function () {};"#, r#"a = function () {};"#),
    (r#"(a as T) ||= () => 1;"#, r#"a ||= () => 1;"#),
    (r#"[(a as T) = class {}] = [];"#, r#"[a = class {}] = [];"#),
    (r#"({ a: (b as T) } = c);"#, r#"({ a: b } = c);"#),
];

const CHILD_COUNT_ROWS: &[Row] = &[
    (r#"f(a, b);"#, r#"f(a);"#),
    (r#"a(); b();"#, r#"a();"#),
    (r#"a();"#, r#"a(); b();"#),
    (r#"a();;"#, r#"a();"#),
    (r#"class A { x: number; }"#, r#"class A {}"#),
    (r#"import { A } from "m"; a();"#, r#"a();"#),
    (r#"import { type A } from "m";"#, r#"import {} from "m";"#),
    (r#"export { type A } from "m";"#, r#"export {} from "m";"#),
    (r#"function f(a, b) {}"#, r#"function f(a) {}"#),
    (r#"[a, b];"#, r#"[a];"#),
    (r#"if (a) b(); else c();"#, r#"if (a) b();"#),
];

const EMITS_CODE_ROWS: &[Row] = &[
    (r#"enum E { A }"#, r#"var E;"#),
    (r#"const enum E { A }"#, r#"var E;"#),
    (r#"namespace N { export const v = 1; }"#, r#"var N;"#),
    (r#"namespace N { export declare const v: number; }"#, r#";"#),
    (
        r#"namespace N { declare namespace M { interface I {} } }"#,
        r#";"#,
    ),
    (r#"import r = require("m");"#, r#"const r = require("m");"#),
    (r#"export = a;"#, r#"module.exports = a;"#),
    (
        r#"class A { constructor(private x: number) {} }"#,
        r#"class A { constructor(x) {} }"#,
    ),
    (r#"class A { accessor x = 1; }"#, r#"class A { x = 1; }"#),
    (r#"@d class A {}"#, r#"class A {}"#),
    (r#"class A { @d m() {} }"#, r#"class A { m() {} }"#),
    (r#"export interface I {} a();"#, r#"a();"#),
    (r#"a(); enum E { A }"#, r#"a();"#),
    (r#"a(); namespace N { export const v = 1; }"#, r#"a();"#),
    (r#"a(); import r = require("m");"#, r#"a();"#),
    (r#"a(); export = a;"#, r#"a();"#),
    (
        r#"class A { accessor x = 1; y = 2; }"#,
        r#"class A { y = 2; }"#,
    ),
    (
        r#"class A { constructor(private x: number, y) {} }"#,
        r#"class A { constructor(y) {} }"#,
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

fn source<'a>(path: &'a str, text: &'a [u8], reads_jsdoc: bool) -> Source<'a> {
    Source {
        reads_jsdoc,
        ..Source::from_bytes(path, text)
    }
}

fn parse_typed_version<'s>(w: &Workspace<'s>, path: &str, text: &[u8]) -> File<'s> {
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
    file.is_typed_version = true;
    file
}

fn erasure(typed: (&str, &str), untyped: (&str, &str)) -> Erasure {
    let result = Mutex::new(None);
    with_workspace(|w| {
        let typed_file = parse_typed_version(w, typed.0, typed.1.as_bytes());
        let untyped_file = w.parse(&source(untyped.0, untyped.1.as_bytes(), false));
        *result.lock().unwrap() = Some(check_erasure(&typed_file, &untyped_file));
    });
    result.into_inner().unwrap().unwrap()
}

fn of(typed: &str, untyped: &str) -> Erasure {
    erasure(("a.ts", typed), ("a.js", untyped))
}

fn kind_of(result: Erasure) -> ErasureMismatchKind {
    match result {
        Erasure::Mismatch(mismatch) => mismatch.kind,
        Erasure::Exact | Erasure::Unknown => panic!("expected a mismatch, got {result:?}"),
    }
}

fn assert_kind(
    expected: ErasureMismatchKind,
    typed: (&str, &str),
    untyped: (&str, &str),
) -> ErasureMismatch {
    let result = erasure(typed, untyped);
    let Erasure::Mismatch(mismatch) = result else {
        panic!("{typed:?} => {untyped:?}: expected {expected:?}, got {result:?}");
    };
    assert_eq!(
        mismatch.kind, expected,
        "{typed:?} => {untyped:?}: {mismatch:?}"
    );
    mismatch
}

fn assert_emits_code(typed: (&str, &str), untyped: (&str, &str)) {
    let mismatch = assert_kind(EmitsCode, typed, untyped);
    assert_ne!(
        mismatch.typed,
        NodeData::None,
        "{typed:?} => {untyped:?}: {mismatch:?}"
    );
}

fn operator_chain(last_operand: &str) -> String {
    let mut text = "a".to_owned();
    text.push_str(&"+a".repeat(CHAIN_LENGTH - 1));
    text.push('+');
    text.push_str(last_operand);
    text.push(';');
    text
}

fn nested_blocks<'s>(w: &Workspace<'s>, depth: usize) -> File<'s> {
    let mut f = FileBuilder::default();
    let mut inner = f.stmt(StmtKind::Empty, 0);
    for _ in 0..depth {
        let list = f.list(&[inner]);
        inner = f.stmt(StmtKind::Block(list), 0);
    }
    f.body = f.list(&[inner]);
    f.into_arena(w.arena, w.atoms.session()).0
}

fn has_jsx(hir: &File<'_>) -> bool {
    !find_exprs(hir, |kind| {
        matches!(kind, ExprKind::Jsx(..) | ExprKind::JsxText(..))
    })
    .is_empty()
}

fn has_typescript_syntax(javascript: &File<'_>) -> bool {
    (javascript.diagnostics.iter()).any(|it| it.kind == bun_sema::hir::DiagnosticKind::Js)
}

fn package_pairs() -> Vec<(String, String, String)> {
    let mut pairs = vec![
        (
            "react-reconciler/0.33.0/lay/cjs/react-reconciler.production.js".to_owned(),
            "client".to_owned(),
            "react-reconciler/cjs/react-reconciler.production.js".to_owned(),
        ),
        (
            "seroval/1.6.9/lay/dist/index.js".to_owned(),
            "seroval".to_owned(),
            "seroval/dist/index.js".to_owned(),
        ),
    ];
    for version in SDK_VERSIONS {
        for file in SDK_FILES {
            pairs.push((
                format!("@anthropic-ai/sdk/{version}/lay/{file}"),
                format!("sdk-{version}"),
                format!("@anthropic-ai/sdk/{file}"),
            ));
        }
    }
    pairs
}

fn typescript_name(path: &str) -> String {
    const EXTENSIONS: [(&str, &str); 3] = [(".mjs", ".mts"), (".cjs", ".cts"), (".js", ".ts")];
    let renamed = EXTENSIONS.iter().find_map(|&(javascript, typescript)| {
        Some(format!("{}{typescript}", path.strip_suffix(javascript)?))
    });
    renamed.unwrap_or_else(|| path.to_owned())
}

#[test]
fn exact_pairs() {
    for &(typed, untyped) in EXACT_PAIRS {
        assert_eq!(of(typed, untyped), Erasure::Exact, "{typed} => {untyped}");
    }
}

#[test]
fn mismatches() {
    let tables = [
        (NodeKind, NODE_KIND_ROWS),
        (Name, NAME_ROWS),
        (Literal, LITERAL_ROWS),
        (Operator, OPERATOR_ROWS),
        (Flags, FLAGS_ROWS),
        (ChildCount, CHILD_COUNT_ROWS),
    ];
    for (kind, rows) in tables {
        for &(typed, untyped) in rows {
            assert_kind(kind, ("a.ts", typed), ("a.js", untyped));
        }
    }
    assert_kind(NodeKind, ("a.ts", "x;"), ("b.ts", "x as T;"));
    for &(typed, untyped) in EMITS_CODE_ROWS {
        assert_emits_code(("a.ts", typed), ("a.js", untyped));
    }
    assert_emits_code(("a.tsx", "<a>t</a>;"), ("a.jsx", "<a>t</a>;"));
    assert_emits_code(("a.tsx", "let x = <a/>;"), ("a.jsx", "let x;"));
}

#[test]
fn syntax_errors_are_unknown() {
    assert_eq!(of("let = ;", "a();"), Erasure::Unknown);
    assert_eq!(of("a();", "let = ;"), Erasure::Unknown);
    assert_eq!(of("let x: = 1;", "let x = 1;"), Erasure::Unknown);
}

#[test]
fn symmetric_cases_are_not_assumed() {
    assert_eq!(of("a();", "a();"), Erasure::Exact);
    for &(_, text) in EXACT_PAIRS {
        assert_eq!(
            erasure(("a.js", text), ("b.js", text)),
            Erasure::Exact,
            "{text}"
        );
    }
}

fn without_types(w: &Workspace<'_>, typed: &File<'_>) -> (Erasure, String) {
    let kept = find_type_ranges(typed).remove_from(&typed.text);
    let untyped = w.parse(&source("a.js", &kept, false));
    let erasure = check_erasure(typed, &untyped);
    if erasure != Erasure::Unknown {
        return (erasure, String::from_utf8_lossy(&kept).into_owned());
    }
    let still_typescript = parse_typed_version(w, "a.ts", &kept);
    if let Erasure::Mismatch(mismatch) = check_erasure(typed, &still_typescript)
        && mismatch.kind == EmitsCode
    {
        return (
            Erasure::Mismatch(mismatch),
            String::from_utf8_lossy(&kept).into_owned(),
        );
    }
    let at = untyped
        .diagnostics
        .first()
        .map_or(0, |it| it.start as usize)
        .min(kept.len());
    let around = &kept[at.saturating_sub(60)..(at + 40).min(kept.len())];
    (erasure, String::from_utf8_lossy(around).replace('\n', " "))
}

fn is_bare_assertion_target(typed: &File<'_>, node: NodeData) -> bool {
    let NodeData::Expr(written) = node else {
        return false;
    };
    let is_assigned_to =
        |it: &Expr| matches!(it.kind, ExprKind::Assign { target, .. } if target == written);
    typed.type_assertion_operand(written).is_some() && typed.exprs.iter().any(is_assigned_to)
}

// `() => <T>{ a: 1 }`: without `<T>` the brace opens a block.
fn is_object_literal_behind_prefix_assertion(typed: &File<'_>, node: NodeData) -> bool {
    let NodeData::Expr(written) = node else {
        return false;
    };
    let starts_with_type = typed.text.get(typed[written].pos as usize) == Some(&b'<');
    let operand = typed.skip_type_assertions(written);
    starts_with_type && matches!(typed[operand].kind, ExprKind::Object(_))
}

fn is_mismatch_by_design(typed: &File<'_>, mismatch: &ErasureMismatch) -> bool {
    let is_known_form = || {
        is_bare_assertion_target(typed, mismatch.typed)
            || is_object_literal_behind_prefix_assertion(typed, mismatch.typed)
    };
    mismatch.kind == EmitsCode || mismatch.kind == NodeKind && is_known_form()
}

#[test]
fn text_without_type_ranges_is_same_code() {
    with_workspace(|w| {
        for text in EXACT_PAIRS
            .iter()
            .map(|pair| pair.0)
            .chain(TYPED_TEXTS.iter().copied())
        {
            let typed = parse_typed_version(w, "a.ts", text.as_bytes());
            let (erasure, kept) = without_types(w, &typed);
            assert_eq!(erasure, Erasure::Exact, "{text} => {kept}");
        }
    });
}

#[test]
fn syntax_that_emits_code_is_kept_without_its_types() {
    with_workspace(|w| {
        for &(path, text, expected) in KEPT_TEXT_ROWS {
            let typed = parse_typed_version(w, path, text.as_bytes());
            let (erasure, kept) = without_types(w, &typed);
            assert_eq!(kept, expected, "{text}");
            assert_eq!(kind_of(erasure), EmitsCode, "{text} => {kept}");
        }
    });
}

#[test]
fn assertions_that_hold_the_syntax_together_are_mismatches_by_design() {
    with_workspace(|w| {
        for text in [
            "a! = function () {};",
            "[a! = class {}] = [];",
            "const f = () => <T>{ a: 1 };",
        ] {
            let typed = parse_typed_version(w, "a.ts", text.as_bytes());
            let (erasure, kept) = without_types(w, &typed);
            let Erasure::Mismatch(mismatch) = erasure else {
                panic!("{text} => {kept}: expected a mismatch, got {erasure:?}");
            };
            assert!(
                is_mismatch_by_design(&typed, &mismatch),
                "{text} => {kept}: {mismatch:?}"
            );
        }
    });
}

#[test]
fn semicolon_on_a_later_line_than_an_erased_statement_stays() {
    let text = "a()\ndeclare const b: number\n;(c)()\n";
    with_workspace(|w| {
        let typed = parse_typed_version(w, "a.ts", text.as_bytes());
        let (erasure, kept) = without_types(w, &typed);
        assert_eq!(kept, "a()\n\n;(c)()\n");
        assert_eq!(erasure, Erasure::Exact);
    });
}

#[test]
fn offsets_follow_removed_ranges() {
    let text = "const f = (a: number): number => a as number; g();";
    with_workspace(|w| {
        let typed = parse_typed_version(w, "a.ts", text.as_bytes());
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
fn test_programs_without_type_ranges_are_same_code() {
    let different = Mutex::new(Vec::new());
    for_each_program(&[".ts"], |w, path, text| {
        let typed = parse_typed_version(w, "a.ts", text);
        if check_erasure(&typed, &typed) == Erasure::Unknown {
            return;
        }
        let found = match without_types(w, &typed) {
            (Erasure::Exact, _) => return,
            (Erasure::Mismatch(mismatch), _) if is_mismatch_by_design(&typed, &mismatch) => return,
            (Erasure::Unknown, around) => around,
            (other, _) => format!("{other:?}"),
        };
        different.lock().unwrap().push(format!("{path}: {found}"));
    });
    let mut different = different.into_inner().unwrap();
    different.sort();
    assert!(
        different.is_empty(),
        "{} differ:\n{}",
        different.len(),
        different.join("\n")
    );
}

#[test]
fn functions_and_classes_are_found_in_untyped_text() {
    let typed_text = "export function f<T>(a: T): T { return a!; }\n\
                      const g = async (b: number): Promise<number> => b as number;\n\
                      class C<T> { declare x: T; static m(this: void, c?: T): void {} }\n\
                      const o = { get p(): number { return 1; } };\n";
    let untyped_text = "export function f(a) { return a; }\n\
                        const g = async (b) => b;\n\
                        class C { static m(c) {} }\n\
                        const o = { get p() { return 1; } };\n";
    with_workspace(|w| {
        let typed = parse_typed_version(w, "a.ts", typed_text.as_bytes());
        let untyped = w.parse(&source("a.js", untyped_text.as_bytes(), false));
        let (erasure, ranges) = check_erasure_with_ranges(&typed, &untyped);
        assert_eq!(erasure, Erasure::Exact);
        let text_of = |&(start, end): &(u32, u32)| &untyped_text[start as usize..end as usize];
        let mut functions: Vec<&str> = ranges.functions.iter().map(text_of).collect();
        functions.sort_unstable();
        let expected = [
            "async (b) => b",
            "function f(a) { return a; }",
            "get p() { return 1; }",
            "m(c) {}",
        ];
        assert_eq!(functions, expected);
        let classes: Vec<&str> = ranges.classes.iter().map(text_of).collect();
        assert_eq!(classes, ["class C { static m(c) {} }"]);
    });
}

#[test]
fn token_offsets_lead_from_typed_text_to_untyped_text() {
    let typed_text = "interface I { b: number }\n\
                      export function f(a: I): number {\n  return g<I>(a!).b;\n}\n";
    let untyped_text = "export function f(a) { return g(a).b; }\n";
    with_workspace(|w| {
        let typed = parse_typed_version(w, "a.ts", typed_text.as_bytes());
        let untyped = w.parse(&source("a.js", untyped_text.as_bytes(), false));
        let (erasure, ranges) = check_erasure_with_ranges(&typed, &untyped);
        assert_eq!(erasure, Erasure::Exact);
        assert!(
            ranges
                .token_offsets
                .is_sorted_by(|first, second| first.0 < second.0)
        );
        let tokens = [
            ("export", "export"),
            ("return", "return"),
            ("g<I>", "g(a)"),
            ("a!", "a)."),
            ("b;", "b;"),
        ];
        for (typed_token, untyped_token) in tokens {
            let typed_offset = typed_text.find(typed_token).unwrap() as u32;
            let untyped_offset = untyped_text.find(untyped_token).unwrap() as u32;
            assert!(
                ranges
                    .token_offsets
                    .contains(&(typed_offset, untyped_offset)),
                "{typed_token}"
            );
        }
    });
}

#[test]
fn deep_trees_do_not_overflow_in_parsed_chains() {
    let same = operator_chain("a");
    let renamed = operator_chain("b");
    with_workspace(|w| {
        let typed = parse_typed_version(w, "a.ts", same.as_bytes());
        let untyped = w.parse(&source("a.js", same.as_bytes(), false));
        let other = w.parse(&source("a.js", renamed.as_bytes(), false));

        let exact = check_erasure(&typed, &untyped);
        if typed.ran_out_of_stack || untyped.ran_out_of_stack {
            assert_eq!(exact, Erasure::Unknown);
        } else {
            assert_eq!(exact, Erasure::Exact);
        }

        let mismatch = check_erasure(&typed, &other);
        if typed.ran_out_of_stack || other.ran_out_of_stack {
            assert_eq!(mismatch, Erasure::Unknown);
        } else {
            assert_eq!(kind_of(mismatch), Name);
        }
    });
}

#[test]
fn deep_trees_do_not_overflow_in_built_blocks() {
    with_workspace(|w| {
        let typed = nested_blocks(w, NESTING_DEPTH);
        let same = nested_blocks(w, NESTING_DEPTH);
        let shallower = nested_blocks(w, NESTING_DEPTH - 1);
        assert_eq!(check_erasure(&typed, &same), Erasure::Exact);
        assert_eq!(kind_of(check_erasure(&typed, &shallower)), NodeKind);
    });
}

#[test]
fn every_javascript_program_with_and_without_jsdoc() {
    for_each_program(&JAVASCRIPT_EXTENSIONS, |w, path, text| {
        if path.ends_with(".jsx") {
            return;
        }
        let typed = parse_typed_version(w, path, text);
        let untyped = w.parse(&source(path, text, false));
        if typed.has_errors
            || typed.has_parse_diagnostics
            || untyped.has_errors
            || untyped.has_parse_diagnostics
            || has_typescript_syntax(&untyped)
            || has_jsx(&typed)
        {
            return;
        }
        let is_accessor_field = |node: NodeData| matches!(node, NodeData::Member(member) if typed[member].flags.contains(bun_sema::hir::Flags::ACCESSOR));
        let has_decorators = !typed.decorators.is_empty();
        match check_erasure(&typed, &untyped) {
            Erasure::Mismatch(found)
                if found.kind == EmitsCode
                    && (has_decorators || is_accessor_field(found.typed)) => {}
            result => assert_eq!(result, Erasure::Exact, "{path}"),
        }
    });
}

#[test]
fn typed_packages() {
    let root = repository_path(PACKAGES_ROOT);
    let pairs = package_pairs();
    with_workspace(|w| {
        for (typed_path, set, package_file) in &pairs {
            let installed_path = format!("trees/installs/{set}/node_modules/{package_file}");
            let Some(installed_text) = read_file(&root.join(&installed_path)) else {
                eprintln!(
                    "SKIPPED: {installed_path}: run bun install in {PACKAGES_ROOT}/trees/installs/{set}"
                );
                continue;
            };
            let typed_text = read_file(&root.join(typed_path))
                .unwrap_or_else(|| panic!("{typed_path}: the typed version is missing"));
            let typed = parse_typed_version(w, &typescript_name(typed_path), &typed_text);
            let installed = w.parse(&source(&installed_path, &installed_text, false));
            let result = check_erasure(&typed, &installed);
            eprintln!("{typed_path}: {result:?}");
            assert_ne!(result, Erasure::Unknown, "{typed_path} => {installed_path}");
        }
    });
}
