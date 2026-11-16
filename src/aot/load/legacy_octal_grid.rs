use bun_alloc::Arena as AstArena;
use bun_ast::{ASTMemoryAllocator, Kind, Loader, Log, Source};
use bun_js_parser::{Define, Parser};
use bun_options_types::bundle_enums::ModuleType;
use bun_sema::atom::Interner;
use bun_sema::hir::DiagnosticClass;
use bun_sema::resolve::ScriptKind;
use bun_sema::session::{Arena, Session};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::loaders::script_kind_of;
use super::parser_of_bun_run::parser_options_of_bun_run;

/// A name, the loader that `bun run` reads a file of that name with, and the module type that it gives its parser.
type File = (&'static str, Loader, ModuleType);

const FILES: &[File] = &[
    ("/project/a.js", Loader::Jsx, ModuleType::Unknown),
    ("/project/a.cjs", Loader::Js, ModuleType::Cjs),
    ("/project/a.mjs", Loader::Js, ModuleType::Esm),
    // The `package.json` above it says `"type": "module"`.
    ("/module/a.js", Loader::Jsx, ModuleType::Esm),
    ("/project/tool", Loader::Tsx, ModuleType::Unknown),
];

const TYPESCRIPT: File = FILES[4];

/// True if a parser reports a legacy octal form of a text, and false if it reports nothing. `Err` is another error.
type Verdict = Result<bool, String>;

fn ask_bun_run((path, loader, module_type): File, text: &str, define: &Define) -> Verdict {
    let arena = AstArena::new();
    let mut store = ASTMemoryAllocator::borrowing(&arena);
    let _scope = store.enter();
    let options = parser_options_of_bun_run(loader, module_type);
    let source = Source::init_path_string(path, text.as_bytes());
    let mut log = Log::init();
    if let Ok(parser) = Parser::init(options, &mut log, &source, define, &arena) {
        // What it reports is in the log.
        let _ = parser.parse();
    }
    let mut errors = (log.msgs.iter()).filter(|message| message.kind == Kind::Err);
    let other = errors
        .clone()
        .find(|message| !bun_core::strings::contains(&message.data.text, b"Legacy octal"));
    match other {
        Some(message) => Err(String::from_utf8_lossy(&message.data.text).into_owned()),
        None => Ok(errors.next().is_some()),
    }
}

fn ask_build<'s>(
    (path, loader, _): File,
    text: &str,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> Verdict {
    let script_kind = script_kind_of(loader);
    let parse_options = CompileParseOptions {
        path: path.as_bytes(),
        script_kind: script_kind.filter(|kind| kind.differs_from_name(path.as_bytes())),
        experimental_decorators: false,
        every_file_is_a_module: true,
        reads_jsdoc: script_kind.is_some_and(ScriptKind::is_javascript),
        ignores_pure_comments: false,
    };
    let hir = parse_for_compile(arena, &parse_options, text.as_bytes(), atoms);
    let mut errors = (hir.diagnostics.iter()).filter(|it| it.class == DiagnosticClass::EarlyError);
    let other = errors
        .clone()
        .find(|it| !matches!(it.code, 1121 | 1487 | 1488 | 1489));
    match other {
        Some(error) => Err(format!("TS{}", error.code)),
        None => Ok(errors.next().is_some()),
    }
}

#[rustfmt::skip]
const FORMS: &[&str] = &[
    "010", "00", "-010", "08", "09.5", "08e1", "078", "0708", r#""\1""#, r"'\2'", r#""a\03""#, r#""\101""#, r#""\08""#, r#""\00""#, r#""\377""#, r#""\400""#, r#""\4a""#, r#""\8""#,
    r#""\9""#, r#""\0""#, r#""a\0""#, r#""\\1""#, "0o10", "0.5", "0", "`\\1`", "`a${1}\\1`", "`\\8`", "`\\0`", "f`\\1`", r"/\1(a)[\2]/",
];

#[rustfmt::skip]
const PLACES: &[(&str, &str)] = &[
    ("x = ", ";"), ("x = (", ");"), ("function f() { return ", "; }"), ("function f(a = ", ") { return a; }"), ("x = () => ", ";"), ("if (false) { x = ", "; }"),
    ("with (a) { x = ", "; }"), ("switch (a) { case ", ": }"), ("x = { a: ", " };"), ("x = { [", "]: 1 };"), ("x = [", "];"), ("x = a[", "];"), ("f(", ");"),
    (r#""use strict"; x = "#, ";"), ("'use strict'; x = ", ";"), ("\"use strict\"\nx = ", ";"), (r#""a"; "use strict"; x = "#, ";"), ("// a\n/* b */ \"use strict\"; x = ", ";"),
    ("#!/usr/bin/env bun\n\"use strict\"; x = ", ";"), (r#""use strict"; if (false) { x = "#, "; }"), (r#""use strict"; function f(a = "#, ") {}"), (r#""use strict"; x = ("#, ");"),
    (r#"("use strict"); x = "#, ";"), ("`use strict`; x = ", ";"), (r#""use strict" + 1; x = "#, ";"), (r#""use strict".length; x = "#, ";"), (r#""use strict", 1; x = "#, ";"),
    (r#""use\x20strict"; x = "#, ";"), (r#"y; "use strict"; x = "#, ";"), (r#"{ "use strict"; x = "#, "; }"),
    (r#"function f() { "use strict"; return "#, "; }"), (r#"(function () { "use strict"; return "#, "; })();"), (r#"x = () => { "use strict"; return "#, "; };"),
    (r#"x = async () => { "use strict"; return "#, "; };"), (r#"function* f() { "use strict"; yield "#, "; }"), (r#"x = { m() { "use strict"; return "#, "; } };"),
    (r#"x = { get a() { "use strict"; return "#, "; } };"), (r#"function f() { "use strict"; function g() { return "#, "; } }"), (r#"function f() { "use strict"; return () => () => "#, "; }"),
    (r#"function f() { "use strict"; class A {} return "#, "; }"), (r#"function f() { y; "use strict"; return "#, "; }"), (r#"function f() { "use strict"; } x = "#, ";"),
    ("x = ", r#"; function f() { "use strict"; }"#), (r#"(function () { "use strict"; })(); (function () { return "#, "; })();"), ("x = { [", r#"]() { "use strict"; } };"#),
    ("class A { m() { return ", "; } }"), ("class A { x = ", "; }"), ("class A { static x = ", "; }"), ("class A { static { x = ", "; } }"), ("class A { [", "]() {} }"),
    ("class A { static get [", "]() { return 1; } }"), ("class A { m(a = ", ") {} }"), ("class A { x = (a = ", ") => a; }"), ("class A { x = function () { return ", "; }; }"),
    ("class A { @(d(", ")) m() {} }"), ("class A extends f(", ") {}"), ("class A extends (function () { return ", "; }) {}"), ("x = class extends f(", ") {};"), ("x = class { y = ", "; };"),
    ("if (false) { class A { m() { return ", "; } } }"), ("function f() { class A { x = ", "; } }"), ("class A { m() { class B {} return ", "; } }"), ("class A {} x = ", ";"),
    ("x = ", "; class A {}"), ("function f() { class A {} return ", "; }"), ("x = [", ", class {}];"), ("x = [class {}, ", "];"), ("@(d(", ")) class A {}"),
    (r#"class A { static { "use strict"; } } x = "#, ";"),
    ("x = ", "; export {};"), ("x = ", "; export default 1;"), ("x = ", "; export * from \"m\";"), ("export default ", ";"), ("import \"m\"; x = ", ";"), ("import a from \"m\"; x = ", ";"),
    ("import {} from \"m\"; x = ", ";"), ("x = ", "; import \"m\";"), ("function f() { return ", "; } export {};"), ("if (false) { x = ", "; } export {};"), ("x = ", "; export {}; import.meta.url;"),
    ("x = ", "; await 0;"), ("x = ", "; for await (const a of []) {}"), ("x = ", "; { await using a = null; }"), ("x = ", "; import.meta.url;"), ("x = ", "; import(\"m\");"),
    ("x = ", "; require(\"m\"); module.exports = 1;"), ("x = async () => { await 0; return ", "; };"), ("async function f() { for await (const a of []) {} return ", "; }"),
    ("x = async () => await ", ";"), ("async function f() { await using a = null; return ", "; }"), ("class A { static async m() { await 0; } } x = ", ";"),
    ("x = ", "; z = { await: 1 };"), ("x = ", "; await (0);"), ("x = ", "; if (a) { await 0; }"),
];

#[rustfmt::skip]
const JAVASCRIPT: &[&str] = &[
    r#"function f() { "\1"; "use strict"; }"#, r#""\1"; "use strict";"#, r#"function f() { "\1"; }"#, r#"function f() { "use strict"; "use\040strict"; }"#, r#""use\040strict"; x = 010;"#,
    r#"x = { "\1"() { "use strict"; } };"#, r#"x = { 010() { "use strict"; } };"#, r#"x = { get 010() { "use strict"; return 1; } };"#, "x = 010; class A { y = 011; } z = 012;",
    "class A { x = 010 } 011", "class A {} 010", r#"function f() { "use strict"; } 010"#, r#""use strict"; x = { "\1": 1 };"#, r#""use strict"; x = { 010: 2 };"#, r#""use strict"; ({ "\1": a } = c);"#,
    r#""use strict"; ({ 010: b } = c);"#, r#"class A { "\1"() {} }"#, "class A { 010() {} }", r#"x = { "\1": 1, 010: 2 }; ({ "\1": a, 010: b } = x);"#, r#""use strict"; require("\56/a");"#, r#"import "\56/a";"#,
    r#"export { a as "\101" }; var a;"#, r#"import { "\101" as a } from "m";"#, r#"import a from "m" with { type: "js\157n" };"#, r#"import a from "m" with { "t\171pe": "json" };"#, r#"export * from "\56/a";"#,
    "\"use strict\"; x = 1; // 010 \"\\1\"\n/* 010 \\1 */", r#""use strict"; x = '2024-01-08' + 10.05 + 0x01 + 0o01 + 0b01 + a01;"#,
    r#""use strict"; /** @param {number} a */ function f(a) { return "\1".length; }"#, r#"class A { /** @param {number} a */ m(a) { return "\1".length; } }"#, r#""use strict"; /** @type {number} */ x = 010;"#,
    "\"use strict\"; /** @type {number} */\n010;", r#""use strict"; x = /** @type {number} */ (010);"#, r#""use strict"; x = { /** @type {number} */ a: 010 };"#, "class A { /** @type {number} */ x = 010; }",
    r#""use strict"; x = 010; /** @type {number} */ y = 1; z = "\1";"#, r#"/** @returns {number} */ function f() { "use strict"; return 010; }"#, "\"use strict\"; /** @typedef {number} N */\nx = 010;",
    "/** @type {number} */ x = 010;", r#""use strict"; /** @type {"\1"} */ x = 1;"#, r#""use strict"; /** @type {010} */ x = 1;"#, r#"/** @import { A } from "m" */ x = 010;"#,
    "/** @import */ x = 010;", "/** @typedef {number} N */ x = 010;", "/** @callback C @param {number} a */ x = 010;", r#"/** @import { A } from "m" */ x = 010; class B { y = 011; }"#,
    "x = /** @type {string| */ (y); z = { await: 1 }; a = 010;", r#""use strict"; /** @param {010} a @param {"\1"} b */ function f(a, b) { return 011; }"#,
    "/** @type {{ [await 1]: string }} */ x = 010;", "module.exports = 1;\n/** @type {{ [await 1]: string }} */\nvar x = {};\ny = 010;", "/** @import a from await 1 */ x = 010;",
    "/** @type {(a = await 1) => void} */ x = 010;", "async function f() {\n/** @type {{ [await 1]: string }} */\nvar a; } x = 010;", "/** @type {number} */ x = 010; await 0;",
];

#[rustfmt::skip]
const JSX: &[&str] = &[
    r#"class A { m() { return <a b="\1" />; } }"#, r#""use strict"; x = <a b={"\1"} />;"#, r#""use strict"; x = <a>\2 011{010}</a>;"#, r#"x = <a b="\1">{"\2"}{010}</a>;"#,
];

#[rustfmt::skip]
const TYPESCRIPT_TEXTS: &[&str] = &[
    r#""use strict"; type A = "\1" | 010;"#, r#""use strict"; type A = { b: 1 } | "\1";"#, r#""use strict"; let a: 010 | "\1";"#, r#""use strict"; let a: -010;"#, r#""use strict"; x = y as "\1";"#,
    r#""use strict"; x = y satisfies "\1";"#, r#""use strict"; x = f<"\1">();"#, r#""use strict"; function f<T = "\1">(a?: T) {}"#, r#"function f(a?: "\1"): 010 { "use strict"; }"#,
    r#""use strict"; interface I { "\1": string; 010: number }"#, r#""use strict"; type A = { "\1": string; ["\2"]: number };"#, r#""use strict"; let a: [x: 010, y?: "\1"];"#,
    r#""use strict"; function f(a: "\1"): void; function f(a: any) {}"#, r#"interface I<T> {} class A implements I<"\1"> { x: 010 | number = 1; }"#, r#"class A { [key: string]: "\1" | number; declare y: 010; }"#,
    r#"abstract class A { abstract m(a: "\1"): 010; }"#, r#""use strict"; declare const a: 010, b = "\1";"#, r#""use strict"; declare enum E { A = 010, "\1" = 2 }"#, r#""use strict"; declare class A { x: 010; "\1": string; }"#,
    r#""use strict"; declare function f(a?: "\1", b = 010): void;"#, r#""use strict"; declare namespace N { const a = 010; const b = "\1"; }"#, r#""use strict"; declare module "a\1" { const a: number; }"#,
    "declare global { const a: 010; } export {};", "export declare const a = 010;", r#""use strict"; import type a = require("\56/a");"#, r#""use strict"; x = "\1" as string;"#, r#""use strict"; x = 010!;"#,
    r#""use strict"; x = <T,>(a?: T) => 010;"#, r#""use strict"; enum E { "\1" = 1 }"#, r#""use strict"; enum E { A = 010, B = "\1" }"#, r#""use strict"; const enum E { "\1" = 1 }"#, r#"enum E { "\1" = 010 }"#,
    r#""use strict"; import a = require("\56/a");"#, r#""use strict"; import type { A } from "\56/a";"#, r#"import type { A } from "\56/a";"#, r#"import type { A } from "m"; x = 010;"#, r#"import type A from "m"; x = 010;"#,
    r#"import type * as A from "m"; x = 010;"#, r#"import { type A, type B } from "m"; x = 010;"#, r#"import { type A, b } from "m"; x = 010;"#, r#"import { b } from "m"; x = 010;"#, r#"import a = require("m"); x = 010;"#,
    "x = 010; export type A = 1;", "type A = 1; x = 010; export type { A };", "x = 010; export interface I {}", r#"export type { A } from "\56/a";"#, r#"export type * from "\56/a";"#,
    "namespace N { export const a = 1; } export import a = N.a; x = 010;", "namespace N { export const a = 1; } import a = N.a; x = 010;", "x = 010; export = 1;", "x = 010; export as namespace N;",
    r#"namespace N { "use strict"; export const a = 010; }"#, r#"namespace A.B { "use strict"; export const a = 010; }"#, r#"namespace N { "use strict"; } x = 010;"#, "namespace N { export const a = 010; }",
    "namespace N { export class A { x = 010; } }", "interface I {}\n\"use strict\"; x = 010;", "type A = 1;\n\"use strict\"; x = 010;", "declare const a: number;\n\"use strict\"; x = 010;",
    "import type { A } from \"m\";\n\"use strict\"; x = 010;", r#"function f() { type A = 1; "use strict"; return 010; }"#, r#"class A { constructor(public x = 010) {} "\1"?(): void; }"#, r#"const x: string = "\033[0m";"#,
    r#""use strict"; /** @type {"\1"} */ x = 1;"#, r#""use strict"; /** @param {010} a */ function f(a) { return 011; }"#,
    "\"use strict\";\n/** @param {010} a */ function f(a) { return arguments.length + 011; }", r#""use strict"; @d("\1") declare class A {}"#,
    r#""use strict"; @d("\1") declare abstract class A { x: 010; }"#, r#""use strict"; @d("\1") export declare class A { x: 010; }"#, r#"@d("\1") declare class A {} x = 010;"#,
    r#""use strict"; function f(a = 010): void; function f(a: any) {}"#, r#"class A { m(a = 010): void; m(a: any) {} }"#,
];

fn write_cells() -> Vec<(File, String)> {
    let mut cells = Vec::new();
    for &file in FILES {
        for (before, behind) in PLACES {
            cells.extend(
                FORMS
                    .iter()
                    .map(|form| (file, format!("{before}{form}{behind}"))),
            );
        }
        let texts = match file == TYPESCRIPT {
            true => TYPESCRIPT_TEXTS,
            false => JAVASCRIPT,
        };
        let jsx: &[&str] = match file.1 {
            Loader::Jsx | Loader::Tsx => JSX,
            _ => &[],
        };
        cells.extend(texts.iter().chain(jsx).map(|&text| (file, text.to_owned())));
    }
    cells
}

#[test]
fn a_legacy_octal_form_is_an_error_where_bun_run_reports_it() {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let define = Define::with_pure_globals(false, true);
    let cells = write_cells();
    let (mut counts, mut partings) = ([0usize; 2], Vec::new());
    for (file, text) in &cells {
        let to_bun_run = ask_bun_run(*file, text, &define);
        let said = match (to_bun_run, ask_build(*file, text, &atoms, arena)) {
            (Err(other), _) => format!("bun run reports another error ({other})"),
            (_, Err(other)) => format!("the build reports another error ({other})"),
            (Ok(is_reported), Ok(by_build)) => {
                counts[usize::from(is_reported)] += 1;
                match (is_reported, by_build) {
                    (true, false) => "bun run reports it and the build does not".to_owned(),
                    (false, true) => "the build reports it and bun run does not".to_owned(),
                    _ => continue,
                }
            }
        };
        partings.push(format!("{said}: {}: {text}", file.0));
    }
    assert!(
        partings.is_empty(),
        "{} of {} cells:\n{}",
        partings.len(),
        cells.len(),
        partings.join("\n")
    );
    let [accepted, reported] = counts;
    assert!(
        accepted * 4 > cells.len() && reported * 4 > cells.len(),
        "of {} cells bun run accepts {accepted} and reports the form in {reported}",
        cells.len()
    );
}
