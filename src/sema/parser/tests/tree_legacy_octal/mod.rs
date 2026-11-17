use crate::parsed;
use crate::tree_support::*;

use DiagnosticClass::EarlyError;

/// A legacy octal form, the code of its error, and where that error starts and ends in the form.
const FORMS: &[(&str, u32, u32, u32)] = &[
    ("010", 1121, 0, 3),
    ("00", 1121, 0, 2),
    ("-010", 1121, 0, 4),
    ("08", 1489, 0, 2),
    ("09.5", 1489, 0, 4),
    ("08e1", 1489, 0, 4),
    ("078", 1489, 0, 3),
    ("0708", 1489, 0, 4),
    (r#""\1""#, 1487, 1, 3),
    (r"'\2'", 1487, 1, 3),
    (r#""a\03""#, 1487, 2, 5),
    (r#""\101""#, 1487, 1, 5),
    (r#""\08""#, 1487, 1, 3),
    (r#""\00""#, 1487, 1, 4),
    (r#""\377""#, 1487, 1, 5),
    (r#""\4a""#, 1487, 1, 3),
    (r#""\8""#, 1488, 1, 3),
    (r#""\9""#, 1488, 1, 3),
];

/// What stands in front of a form and behind it, where the parser of `bun run` reads the form as strict mode code.
const STRICT_CODE: &[(&str, &str)] = &[
    (r#""use strict"; x = "#, ";"),
    ("'use strict'; x = ", ";"),
    ("\"use strict\"\nx = ", ";"),
    (r#""a"; "use strict"; x = "#, ";"),
    ("// a\n/* b */ \"use strict\"; x = ", ";"),
    ("#!/usr/bin/env bun\n\"use strict\"; x = ", ";"),
    (r#""use strict"; if (false) { x = "#, "; }"),
    (r#""use strict"; function f(a = "#, ") {}"),
    (r#""use strict"; x = ("#, ");"),
    (r#"function f() { "use strict"; return "#, "; }"),
    (r#"(function () { "use strict"; return "#, "; })();"),
    (r#"x = () => { "use strict"; return "#, "; };"),
    (r#"x = async () => { "use strict"; return "#, "; };"),
    (r#"function* f() { "use strict"; yield "#, "; }"),
    (r#"x = { m() { "use strict"; return "#, "; } };"),
    (r#"x = { get a() { "use strict"; return "#, "; } };"),
    (
        r#"function f() { "use strict"; function g() { return "#,
        "; } }",
    ),
    (r#"function f() { "use strict"; return () => () => "#, "; }"),
    ("class A { m() { return ", "; } }"),
    ("class A { x = ", "; }"),
    ("class A { static x = ", "; }"),
    ("class A { static { x = ", "; } }"),
    ("class A { [", "]() {} }"),
    ("class A { static get [", "]() { return 1; } }"),
    ("class A { m(a = ", ") {} }"),
    ("class A { x = (a = ", ") => a; }"),
    ("class A { x = function () { return ", "; }; }"),
    ("class A { @(", ", d) m() {} }"),
    ("class A extends (", ", Object) {}"),
    ("class A extends (function () { return ", "; }, Object) {}"),
    ("x = class extends (", ", Object) {};"),
    ("x = class { y = ", "; };"),
    ("if (false) { class A { m() { return ", "; } } }"),
    ("function f() { class A { x = ", "; } }"),
    ("class A { m() { class B {} return ", "; } }"),
    (r#"function f() { "use strict"; class A {} return "#, "; }"),
    ("x = ", "; export {};"),
    ("x = ", "; export default 1;"),
    ("x = ", "; export * from \"m\";"),
    ("export default ", ";"),
    ("import \"m\"; x = ", ";"),
    ("import a from \"m\"; x = ", ";"),
    ("import {} from \"m\"; x = ", ";"),
    ("x = ", "; import \"m\";"),
    ("function f() { return ", "; } export {};"),
    ("if (false) { x = ", "; } export {};"),
    ("x = ", "; export {}; import.meta.url;"),
];

/// The same, where the parser of `bun run` reads the form as sloppy mode code.
const SLOPPY_CODE: &[(&str, &str)] = &[
    ("x = ", ";"),
    ("x = (", ");"),
    ("function f() { return ", "; }"),
    ("function f(a = ", ") { return a; }"),
    ("x = () => ", ";"),
    ("if (false) { x = ", "; }"),
    ("with (a) { x = ", "; }"),
    ("switch (a) { case ", ": }"),
    (r#"function f() { "use strict"; } x = "#, ";"),
    ("x = ", r#"; function f() { "use strict"; }"#),
    (
        r#"(function () { "use strict"; })(); (function () { return "#,
        "; })();",
    ),
    (
        r#"function f() { "use strict"; } function g() { return "#,
        "; }",
    ),
    ("class A {} x = ", ";"),
    ("x = ", "; class A {}"),
    ("function f() { class A {} return ", "; }"),
    ("x = [", ", class {}];"),
    ("x = [class {}, ", "];"),
    ("@(", ", d) class A {}"),
    ("x = { [", r#"]() { "use strict"; } };"#),
    (r#"("use strict"); x = "#, ";"),
    ("`use strict`; x = ", ";"),
    (r#""use strict" + 1; x = "#, ";"),
    (r#""use strict".length; x = "#, ";"),
    (r#""use strict", 1; x = "#, ";"),
    (r#""use\x20strict"; x = "#, ";"),
    (r#"y; "use strict"; x = "#, ";"),
    (r#"{ "use strict"; x = "#, "; }"),
    (r#"function f() { y; "use strict"; return "#, "; }"),
    (r#"class A { static { "use strict"; } } x = "#, ";"),
    ("x = ", "; import.meta.url;"),
    ("x = ", "; import(\"m\");"),
    ("x = ", "; require(\"m\"); module.exports = 1;"),
    ("x = async () => { await 0; return ", "; };"),
    ("x = async () => await ", ";"),
    (
        "async function f() { for await (const a of []) {} return ",
        "; }",
    ),
    ("async function f() { await using a = null; return ", "; }"),
    ("class A { static async m() { await 0; } } x = ", ";"),
];

/// Module syntax that only a JavaScript file has at its top level without more.
const STRICT_CODE_OF_JAVASCRIPT: &[(&str, &str)] = &[
    ("x = ", "; await 0;"),
    ("x = ", "; for await (const a of []) {}"),
    ("x = ", "; { await using a = null; }"),
];

/// A text with legacy octal forms in it, and the ones that are errors, as they are written.
const POSITIONS: &[(&str, &str, &[&str])] = &[
    ("a.js", r#"function f() { "\1"; "use strict"; }"#, &[r"\1"]),
    ("a.js", r#""\1"; "use strict";"#, &[r"\1"]),
    ("a.js", r#"function f() { "\1"; }"#, &[]),
    (
        "a.js",
        r#"function f() { "use strict"; "use\040strict"; }"#,
        &[r"\040"],
    ),
    ("a.js", r#""use\040strict"; x = 010;"#, &[]),
    ("a.js", r#"x = { "\1"() { "use strict"; } };"#, &[]),
    ("a.js", r#"x = { 010() { "use strict"; } };"#, &[]),
    (
        "a.js",
        r#"x = { get 010() { "use strict"; return 1; } };"#,
        &[],
    ),
    ("a.js", "x = 010; class A { y = 011; } z = 012;", &["011"]),
    ("a.js", "class A { x = 010 } 011", &["010"]),
    ("a.js", "class A {} 010", &[]),
    ("a.js", r#"function f() { "use strict"; } 010"#, &[]),
    ("a.js", "x = -010; class A { y = -011 }", &["-011"]),
    (
        "a.js",
        r#""use strict"; x = { "\1": 1, 010: 2 };"#,
        &[r"\1", "010"],
    ),
    (
        "a.js",
        r#""use strict"; ({ "\1": a, 010: b } = c);"#,
        &[r"\1", "010"],
    ),
    ("a.js", r#"class A { "\1"() {} 010() {} }"#, &[r"\1", "010"]),
    (
        "a.js",
        r#""use strict"; switch (a) { case 010: }"#,
        &["010"],
    ),
    ("a.js", r#""use strict"; x = a[01];"#, &["01"]),
    ("a.js", r#""use strict"; require("\56/a");"#, &[r"\56"]),
    ("a.js", r#"import "\56/a";"#, &[r"\56"]),
    ("a.js", r#"export { a as "\101" }; var a;"#, &[r"\101"]),
    (
        "a.js",
        r#"import a from "m" with { type: "js\157n" };"#,
        &[r"\157"],
    ),
    ("a.js", "// @bun\nx = 010;", &["010"]),
    (
        "a.js",
        "#!/usr/bin/env bun\n// @bun\nx = \"\\1\";",
        &[r"\1"],
    ),
    ("a.js", "// @bun @bun-cjs\nx = 010;", &[]),
    ("a.js", "// @bun @bun-cjs\nclass A { x = 010; }", &["010"]),
    (
        "a.js",
        "// @bun @bun-cjs\n\"use strict\"; x = 010;",
        &["010"],
    ),
    ("a.jsx", r#"class A { m() { return <a b="\1" />; } }"#, &[]),
    ("a.jsx", r#""use strict"; x = <a b={"\1"} />;"#, &[r"\1"]),
    (
        "a.jsx",
        r#""use strict"; x = <a>\2 011{010}</a>;"#,
        &["010"],
    ),
    ("a.js", r#""use strict"; x = String.raw`\1`;"#, &[]),
    ("a.js", r#""use strict"; x = /\1(a)[\2]/;"#, &[]),
    (
        "a.js",
        "\"use strict\"; x = 1; // 010 \"\\1\"\n/* 010 \\1 */",
        &[],
    ),
    (
        "a.js",
        r#""use strict"; x = '2024-01-08' + "a\\1" + "\0" + "a\0";"#,
        &[],
    ),
    (
        "a.js",
        r#""use strict"; x = 10.05 + 0x01 + 0o01 + 0b01 + a01 + 0 + 0.5 + 0e1;"#,
        &[],
    ),
];

/// A JSDoc comment with a type is read with the text cut off at its end, behind tokens that are scanned already.
const BEHIND_COMMENTS: &[(&str, &[&str])] = &[
    (
        r#""use strict"; /** @param {number} a */ function f(a) { return "\1".length; }"#,
        &[r"\1"],
    ),
    (
        r#"class A { /** @param {number} a */ m(a) { return "\1".length; } }"#,
        &[r"\1"],
    ),
    (r#""use strict"; /** @type {number} */ x = 010;"#, &["010"]),
    ("\"use strict\"; /** @type {number} */\n010;", &["010"]),
    ("\"use strict\"; /** @type {string} */\n\"\\1\";", &[r"\1"]),
    (
        r#""use strict"; x = /** @type {number} */ (010);"#,
        &["010"],
    ),
    (
        r#""use strict"; x = { /** @type {number} */ a: 010 };"#,
        &["010"],
    ),
    ("class A { /** @type {number} */ x = 010; }", &["010"]),
    (
        r#""use strict"; /** @type {number} */ x = 1; /** @type {number} */ y = 010;"#,
        &["010"],
    ),
    (
        r#""use strict"; x = 010; /** @type {number} */ y = 1; z = "\1";"#,
        &["010", r"\1"],
    ),
    (
        r#"/** @returns {number} */ function f() { "use strict"; return 010; }"#,
        &["010"],
    ),
    (
        "\"use strict\"; /** @typedef {number} N */\nx = 010;",
        &["010"],
    ),
    (r#""use strict"; /** @deprecated */ x = 010;"#, &["010"]),
    ("/** @type {number} */ x = 010;", &[]),
    ("/** @import { A } from \"m\" */ x = 010;", &[]),
    ("/** @import */ x = 010;", &[]),
    ("/** @typedef {number} N */ x = 010;", &[]),
    ("/** @callback C @param {number} a */ x = 010;", &[]),
    (
        "/** @import { A } from \"m\" */ x = 010; class B { y = 011; }",
        &["011"],
    ),
    (
        "x = /** @type {string| */ (y); z = { await: 1 }; a = 010;",
        &[],
    ),
    (
        "/** @param {number} a */ function f(a) { return \"\\1\".length; }",
        &[],
    ),
    (r#""use strict"; /** @type {"\1"} */ x = 1;"#, &[]),
    (r#""use strict"; /** @type {010} */ x = 1;"#, &[]),
    (
        r#""use strict"; /** @param {010} a @param {"\1"} b */ function f(a, b) { return 011; }"#,
        &["011"],
    ),
    ("/** @type {{ [await 1]: string }} */ x = 010;", &[]),
    (
        "module.exports = 1;\n/** @type {{ [await 1]: string }} */\nvar x = {};\ny = 010;",
        &[],
    ),
    ("/** @import a from await 1 */ x = 010;", &[]),
    ("/** @type {(a = await 1) => void} */ x = 010;", &[]),
    (
        "async function f() {\n/** @type {{ [await 1]: string }} */\nvar a; } x = 010;",
        &[],
    ),
    ("/** @type {number} */ x = 010; await 0;", &["010"]),
];

/// In a text that is read as TypeScript: syntax that the parser of `bun run` passes over, and what it reads.
const TYPESCRIPT_POSITIONS: &[(&str, &[&str])] = &[
    (r#""use strict"; type A = "\1" | 010;"#, &[]),
    (r#""use strict"; type A = { b: 1 } | "\1";"#, &[]),
    (r#""use strict"; let a: 010 | "\1";"#, &[]),
    (r#""use strict"; let a: -010;"#, &[]),
    (r#""use strict"; x = y as "\1";"#, &[]),
    (r#""use strict"; x = y satisfies "\1";"#, &[]),
    (r#""use strict"; x = f<"\1">();"#, &[]),
    (r#""use strict"; function f<T = "\1">(a?: T) {}"#, &[]),
    (r#"function f(a?: "\1"): 010 { "use strict"; }"#, &[]),
    (
        r#""use strict"; interface I { "\1": string; 010: number }"#,
        &[],
    ),
    (
        r#""use strict"; type A = { "\1": string; ["\2"]: number };"#,
        &[],
    ),
    (r#""use strict"; let a: [x: 010, y?: "\1"];"#, &[]),
    (
        r#""use strict"; function f(a: "\1"): void; function f(a: any) {}"#,
        &[],
    ),
    (
        r#"interface I<T> {} class A implements I<"\1"> { x: 010 | number = 1; }"#,
        &[],
    ),
    (
        r#"class A { [key: string]: "\1" | number; declare y: 010; }"#,
        &[],
    ),
    (r#"abstract class A { abstract m(a: "\1"): 010; }"#, &[]),
    (r#""use strict"; declare const a: 010, b = "\1";"#, &[]),
    (r#""use strict"; declare enum E { A = 010, "\1" = 2 }"#, &[]),
    (
        r#""use strict"; declare class A { x: 010; "\1": string; }"#,
        &[],
    ),
    (
        r#""use strict"; declare function f(a?: "\1", b = 010): void;"#,
        &[],
    ),
    (
        r#""use strict"; declare namespace N { const a = 010; const b = "\1"; }"#,
        &[],
    ),
    (
        r#""use strict"; declare module "a\1" { const a: number; }"#,
        &[],
    ),
    ("export declare const a = 010;", &[]),
    (
        r#""use strict"; import type a = require("\56/a");"#,
        &[r"\56"],
    ),
    (r#""use strict"; @d("\1") declare class A {}"#, &[r"\1"]),
    (
        r#""use strict"; @d("\1") declare abstract class A { x: 010; }"#,
        &[r"\1"],
    ),
    (
        r#""use strict"; @d("\1") export declare class A { x: 010; }"#,
        &[r"\1"],
    ),
    (r#"@d("\1") declare class A {} x = 010;"#, &[]),
    (r#"class A { m(a = 010): void; m(a: any) {} }"#, &["010"]),
    (
        r#""use strict"; function f(a = 010): void; function f(a: any) {}"#,
        &["010"],
    ),
    (r#""use strict"; x = "\1" as string;"#, &[r"\1"]),
    (r#""use strict"; x = 010!;"#, &["010"]),
    (r#""use strict"; x = <T,>(a?: T) => 010;"#, &["010"]),
    (r#""use strict"; enum E { "\1" = 1 }"#, &[r"\1"]),
    (
        r#""use strict"; enum E { A = 010, B = "\1" }"#,
        &["010", r"\1"],
    ),
    (r#""use strict"; const enum E { "\1" = 1 }"#, &[r"\1"]),
    (r#"enum E { "\1" = 010 }"#, &[]),
    (r#""use strict"; import a = require("\56/a");"#, &[r"\56"]),
    (
        r#""use strict"; import type { A } from "\56/a";"#,
        &[r"\56"],
    ),
    (r#"import type { A } from "\56/a";"#, &[]),
    (r#"import type { A } from "m"; x = 010;"#, &[]),
    (r#"import type A from "m"; x = 010;"#, &[]),
    (r#"import type * as A from "m"; x = 010;"#, &[]),
    (r#"import { type A, type B } from "m"; x = 010;"#, &[]),
    (r#"import { type A, b } from "m"; x = 010;"#, &["010"]),
    (r#"import { b } from "m"; x = 010;"#, &["010"]),
    (r#"import a = require("m"); x = 010;"#, &[]),
    ("x = 010; export type A = 1;", &["010"]),
    ("type A = 1; x = 010; export type { A };", &["010"]),
    ("x = 010; export interface I {}", &["010"]),
    (r#"export type { A } from "\56/a";"#, &[r"\56"]),
    (
        "namespace N { export const a = 1; } export import a = N.a; x = 010;",
        &["010"],
    ),
    (
        "namespace N { export const a = 1; } import a = N.a; x = 010;",
        &[],
    ),
    ("x = 010; export = 1;", &[]),
    (
        r#"namespace N { "use strict"; export const a = 010; }"#,
        &["010"],
    ),
    (
        r#"namespace A.B { "use strict"; export const a = 010; }"#,
        &["010"],
    ),
    (r#"namespace N { "use strict"; } x = 010;"#, &[]),
    ("namespace N { export const a = 010; }", &[]),
    ("namespace N { export class A { x = 010; } }", &["010"]),
    ("interface I {}\n\"use strict\"; x = 010;", &["010"]),
    ("type A = 1;\n\"use strict\"; x = 010;", &["010"]),
    (
        "declare const a: number;\n\"use strict\"; x = 010;",
        &["010"],
    ),
    (
        "import type { A } from \"m\";\n\"use strict\"; x = 010;",
        &["010"],
    ),
    (
        r#"function f() { type A = 1; "use strict"; return 010; }"#,
        &["010"],
    ),
    (
        r#"class A { constructor(public x = 010) {} "\1"?(): void; }"#,
        &["010", r"\1"],
    ),
    (r#"const x: string = "\033[0m";"#, &[]),
    (r#""use strict"; /** @type {"\1"} */ x = 1;"#, &[]),
    (
        r#""use strict"; /** @param {010} a */ function f(a) { return 011; }"#,
        &["011"],
    ),
    (
        "\"use strict\";\n/** @param {010} a */ function f(a) { return arguments.length + 011; }",
        &["011"],
    ),
    (
        "\"use strict\";\n/** @param {\"\\1\"} a */\nfunction f(a) { return arguments.length + 011; }",
        &["011"],
    ),
];

/// The text of each legacy octal form that is an early error of the source, in the order of the text. It has no other early error.
#[track_caller]
fn errors_in<'a>(w: &Workspace<'_>, source: &Source<'a>) -> Vec<&'a str> {
    let hir = w.parse(source);
    let is_early = |error: &&Diagnostic| error.class == EarlyError;
    let mut errors: Vec<&Diagnostic> = hir.diagnostics.iter().filter(is_early).collect();
    errors.sort_unstable_by_key(|error| error.start);
    let written = |error: &&Diagnostic| {
        let is_legacy_octal = error.kind == DiagnosticKind::Grammar
            && matches!(error.code, 1121 | 1487 | 1488 | 1489);
        assert!(is_legacy_octal, "{}: {error:?}", source.path);
        std::str::from_utf8(&source.text[error.start as usize..error.end as usize]).unwrap()
    };
    errors.iter().map(written).collect()
}

#[test]
fn forms_are_errors_in_strict_code_alone() {
    with_workspace(|w| {
        for path in ["a.js", "a.cjs", "a.mjs", "bin/tool"] {
            for &(form, code, start, end) in FORMS {
                let javascript: &[(&str, &str)] = match path {
                    "bin/tool" => &[],
                    _ => STRICT_CODE_OF_JAVASCRIPT,
                };
                for &(before, behind) in STRICT_CODE.iter().chain(javascript) {
                    let text = format!("{before}{form}{behind}");
                    let hir = w.parse(&Source::new(path, &text));
                    let at = before.len() as u32;
                    let found: Vec<_> = (hir.diagnostics.iter())
                        .map(|it| (it.kind, it.class, it.code, it.start, it.end))
                        .collect();
                    let kind = DiagnosticKind::Grammar;
                    let expected = [(kind, EarlyError, code, at + start, at + end)];
                    assert_eq!(found, expected, "{path}: {text}");
                    assert_ne!(hir.rare_syntax & rare::LEGACY_OCTAL, 0, "{path}: {text}");
                }
                for &(before, behind) in SLOPPY_CODE {
                    let text = format!("{before}{form}{behind}");
                    let hir = w.parse(&Source::new(path, &text));
                    let found = &hir.diagnostics;
                    assert!(found.is_empty(), "{path}: {text}: {found:?}");
                    assert_ne!(hir.rare_syntax & rare::LEGACY_OCTAL, 0, "{path}: {text}");
                }
            }
        }
    });
}

#[test]
fn a_text_without_a_form_has_no_error_and_says_so() {
    let without_a_form = [
        "x = '2024-01-08';",
        "x = 1; // 010",
        "x = 1; /* \\1 */",
        r#"x = "a\\1";"#,
        r#"x = "\0" + "a\0" + 10.05 + 0x01 + 0o01 + 0b01 + a01 + 0 + 0.5 + 0e1;"#,
        r#"x = /\1(a)[\2]/ + String.raw`\1`;"#,
    ];
    for text in without_a_form {
        for path in ["a.js", "bin/tool"] {
            for text in [text.to_owned(), format!("\"use strict\"; {text}")] {
                parsed(path, &text, |_, hir| {
                    let found = &hir.diagnostics;
                    assert!(found.is_empty(), "{path}: {text}: {found:?}");
                    assert_eq!(hir.rare_syntax & rare::LEGACY_OCTAL, 0, "{path}: {text}");
                });
            }
        }
    }
}

#[test]
fn forms_are_errors_by_where_they_stand() {
    with_workspace(|w| {
        for &(path, text, errors) in POSITIONS {
            assert_eq!(errors_in(w, &Source::new(path, text)), errors, "{text}");
        }
    });
}

#[test]
fn forms_behind_a_jsdoc_comment_are_kept() {
    with_workspace(|w| {
        for &(text, errors) in BEHIND_COMMENTS {
            for reads_jsdoc in [true, false] {
                let source = Source {
                    reads_jsdoc,
                    ..Source::new("a.js", text)
                };
                assert_eq!(errors_in(w, &source), errors, "{text}");
            }
        }
    });
}

#[test]
fn forms_in_text_read_as_typescript() {
    with_workspace(|w| {
        assert!(!w.parse(&Source::new("bin/tool", "x = 010;")).is_js);
        for &(text, errors) in TYPESCRIPT_POSITIONS {
            assert_eq!(
                errors_in(w, &Source::new("bin/tool", text)),
                errors,
                "{text}"
            );
        }
    });
}

#[test]
fn typescript_files_report_every_form() {
    for &(form, code, ..) in FORMS {
        for text in [
            format!("x = {form};"),
            format!("\"use strict\"; x = {form};"),
        ] {
            parsed("a.ts", &text, |_, hir| {
                let found: Vec<_> = (hir.diagnostics.iter())
                    .map(|it| (it.kind, it.code))
                    .collect();
                assert_eq!(found, [(DiagnosticKind::Parse, code)], "{text}");
            });
        }
    }
}

#[test]
fn untagged_templates_report_a_form_in_sloppy_code_too() {
    for (text, code) in [
        ("x = `\\1`;", 1487),
        ("x = `a${1}\\1`;", 1487),
        ("x = `\\8`;", 1488),
    ] {
        for path in ["a.js", "bin/tool"] {
            parsed(path, text, |_, hir| {
                let found: Vec<_> = (hir.diagnostics.iter())
                    .map(|it| (it.kind, it.code))
                    .collect();
                assert_eq!(found, [(DiagnosticKind::Parse, code)], "{path}: {text}");
            });
        }
    }
    parsed("a.js", "\"use strict\"; x = f`\\1` + `\\0`;", |_, hir| {
        assert!(hir.diagnostics.is_empty(), "{:?}", hir.diagnostics);
    });
}
