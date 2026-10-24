use crate::support::*;

use Binding::{CommonJs, Free};
use CommonJsVariable::{Dirname, Exports, Filename, Module, Require};
use StoreKind::{Assign, CompoundAssign, Destructure, ForIn, ForOf, Update};

pub(crate) const ONE_EARLY_REDECLARATION: &[(&str, &[&str])] = &[
    (
        "a.cjs",
        &[
            r#"let a; let a;"#,
            r#"let a; var a;"#,
            r#"var a; let a;"#,
            r#"{ let a; { var a; } }"#,
            r#"let f; function f() {}"#,
            r#"function f() {} let f;"#,
            r#"const a = 1; class a {}"#,
            r#"function g(a) { let a; }"#,
            r#"(a, a) => 0;"#,
            r#"({ m(a, a) {} });"#,
            r#"function g(a, a) { "use strict"; }"#,
            r#""use strict"; function g(a, a) {}"#,
            r#"function g(a, [a]) {}"#,
            r#"function g(a, a = 1) {}"#,
            r#"function g(a, ...a) {}"#,
            r#"{ async function f() {} function f() {} }"#,
            r#"{ function* f() {} function f() {} }"#,
            r#"{ function f() {} var f; }"#,
            r#"{ if (a) function f() {} let f; let f; }"#,
            r#"{ const a = require("a"); const a = require("b"); }"#,
            r#"{ const a = require("a"); let a; }"#,
            r#"{ let a; { var a = require("m"); } }"#,
            r#"function g(a) { const a = require("a"); }"#,
            r#"try {} catch (e) { let e; }"#,
            r#"try {} catch ([e]) { var e; }"#,
            r#"class A { #a; #a; }"#,
            r#"class A { #a; get #a() { return 1; } }"#,
            r#"class A { static get #a() { return 1; } set #a(v) {} }"#,
            r#"class A { #m() {} #m() {} }"#,
        ],
    ),
    (
        "a.mjs",
        &[
            r#"function g(a, a) {}"#,
            r#"var f; function f() {}"#,
            r#"import { a } from "m"; const a = 1;"#,
            r#"const a = 1, b = 2; export { a as x, b as x };"#,
            r#"export const a = 1; const b = 2; export { b as a };"#,
            r#"export default 1; export default 2;"#,
        ],
    ),
];

pub(crate) const NO_EARLY_REDECLARATION: &[(&str, &[&str])] = &[
    (
        "a.cjs",
        &[
            r#"let a; { let a; }"#,
            r#"var a; { let a; }"#,
            r#"var a; var a;"#,
            r#"var f; function f() {}"#,
            r#"function f() {} function f() {}"#,
            r#"function g(a) { { let a; } }"#,
            r#"function g(a) { var a; }"#,
            r#"function g(a, a) {}"#,
            r#"{ function f() {} function f() {} }"#,
            r#""use strict"; { function f() {} function f() {} }"#,
            r#""use strict"; function o() { function f() {} function f() {} }"#,
            r#"if (a) function f() {} var f;"#,
            r#"var f; if (a) function f() {}"#,
            r#"if (a) function f() {} else function f() {}"#,
            r#"if (a) function f() {} let f;"#,
            r#"{ if (a) function f() {} var f; }"#,
            r#"function g(k) { if (k) { const a = require("a"); } else { const a = require("b"); } }"#,
            r#"function g(a) { { const a = require("a"); } }"#,
            r#"{ const a = require("a"); } var a;"#,
            r#"try {} catch (e) { var e; }"#,
            r#"try {} catch (e) { { let e; } }"#,
            r#"class A { get #a() { return 1; } set #a(v) {} }"#,
        ],
    ),
    (
        "a.mjs",
        &[
            r#"function f() {} function f() {}"#,
            r#"export const a = 1; export { a as b };"#,
        ],
    ),
    (
        "a.ts",
        &[
            r#"function f(): void; function f() {}"#,
            r#"class A {} namespace A {}"#,
            r#"interface I {} interface I {}"#,
            r#"interface a {} let a;"#,
            r#"import { A } from "m"; class A {}"#,
            r#"import { A } from "m"; export const A = 1;"#,
            r#"class A { #m(a: string): void; #m(a: number): void; #m(a: any) {} }"#,
            r#"declare class A { #m(): void; #m(a: number): void; }"#,
        ],
    ),
];

pub(crate) const UNHOISTED_FREE_FUNCTIONS: &[(&str, &str)] = &[
    ("a.cjs", r#""use strict"; { function f() {} } f;"#),
    ("a.cjs", r#""use strict"; if (a) function f() {} f;"#),
    ("a.mjs", r#"{ function f() {} } f;"#),
    ("a.cjs", r#"{ async function f() {} } f;"#),
    ("a.cjs", r#"{ function* f() {} } f;"#),
];

pub(crate) const PARAMETER_EXPRESSIONS: &[(&str, bool)] = &[
    ("function f(a) {}", false),
    ("function f({ a }) {}", false),
    ("function f([a]) {}", false),
    ("function f(...r) {}", false),
    ("function f(a = 1) {}", true),
    ("function f({ a = 1 }) {}", true),
    ("function f([a = 1]) {}", true),
    ("function f({ [k]: a }) {}", true),
];

pub(crate) const ARGUMENTS_OBJECT_USES: &[&str] = &[
    "function f() { return arguments; }",
    "function f() { return () => arguments; }",
    "function f() { var arguments = 1; return arguments; }",
    r#"function f() { var arguments = require("m"); return arguments; }"#,
    "function f() { ({ [arguments[0]]() {} }); }",
    "({ f() { return arguments; } });",
];

pub(crate) const FREE_ARGUMENTS: &[&str] = &[
    "arguments;",
    "class A { x = arguments; }",
    "class A { static { arguments; } }",
];

pub(crate) const WRAPPER_ARGUMENTS_USES: &[&str] = &[
    "arguments;",
    "{ arguments; }",
    "() => arguments;",
    "() => () => arguments[0];",
    "class A { [arguments[0]]() {} }",
    "class A extends arguments[0] {}",
];

pub(crate) const NO_ARGUMENTS_OBJECT: &[&str] = &[
    "class A { x = arguments; }",
    "class A { x = () => arguments; }",
    "class A { static { arguments; } }",
];

pub(crate) const EVAL_FLAGS: &[(&str, bool, bool)] = &[
    (r#"function f() { eval(""); }"#, true, true),
    (r#"function f() { return () => eval(""); }"#, true, true),
    (r#"function f() { (0, eval)(""); }"#, false, false),
];

pub(crate) const COMMONJS_NAMES: &[(&str, Binding)] = &[
    ("require", CommonJs(Require)),
    ("module", CommonJs(Module)),
    ("exports", CommonJs(Exports)),
    ("__filename", CommonJs(Filename)),
    ("__dirname", CommonJs(Dirname)),
    ("other", Free),
];

pub(crate) const SHADOWED_COMMONJS_VARIABLES: &[&str] = &[
    "let exports;",
    "const module = 1;",
    "function require() {}",
    "function f() { var module; }",
    "exports.a = 1;",
];

pub(crate) const MEMBER_KEY_IMPORTS: &[(&str, bool)] = &[
    (
        r#"import { k } from "m"; export function f(x: { [k]: number }) {}"#,
        true,
    ),
    (r#"import { k } from "m"; let v: { [k]: 1 };"#, true),
    (r#"import { k } from "m"; ({ [k]: 1 });"#, false),
    (
        r#"import { k } from "m"; abstract class A { abstract [k](): void; }"#,
        true,
    ),
    (
        r#"import { k } from "m"; class A { [k](): void; [k]() {} }"#,
        false,
    ),
    (
        r#"import { k } from "m"; abstract class A { abstract [k]: number; }"#,
        true,
    ),
    (
        r#"import { k } from "m"; class A { declare [k]: number; }"#,
        true,
    ),
    (r#"import { k } from "m"; class A { [k] = 1; }"#, false),
    (r#"import { K } from "m"; declare enum E { A = K.B }"#, true),
    (r#"import { K } from "m"; enum E { A = K.B }"#, false),
];

pub(crate) const UNRESOLVED_ENTITY_ROOTS: &[&str] = &[
    r#"import * as ns from "m"; import type a = ns.b;"#,
    r#"import a = require("m");"#,
    "import a = missing.b;",
];

pub(crate) const DIRECT_EVALS: &[(&str, &str)] = &[
    ("a.cjs", r#"eval("x");"#),
    ("a.cjs", r#"(eval)("x");"#),
    ("a.cjs", r#"function f(eval) { eval("x"); }"#),
    ("a.ts", r#"(eval as any)("x");"#),
];

pub(crate) const INDIRECT_EVALS: &[&str] = &[
    r#"eval?.("x");"#,
    r#"(0, eval)("x");"#,
    r#"globalThis.eval("x");"#,
    r#"new eval("x");"#,
    r#"const e = eval; e("x");"#,
];

pub(crate) const SLOPPY_EVALS: &[(&str, &str, bool)] = &[
    ("a.cjs", r#"eval("");"#, true),
    ("a.cjs", r#""use strict"; eval("");"#, false),
    ("a.mjs", r#"eval("");"#, false),
];

pub(crate) const STORES: &[(&str, StoreKind)] = &[
    ("x = 1;", Assign),
    ("x += 1;", CompoundAssign(BinOp::Add)),
    ("x &&= 1;", CompoundAssign(BinOp::And)),
    ("x ||= 1;", CompoundAssign(BinOp::Or)),
    ("x ??= 1;", CompoundAssign(BinOp::Nullish)),
    ("x++;", Update(UnOp::PostInc)),
    ("--x;", Update(UnOp::PreDec)),
    ("for (x in o);", ForIn),
    ("for (x of o);", ForOf),
    ("[x] = a;", Destructure),
    ("[...x] = a;", Destructure),
    ("[x = 1] = a;", Destructure),
    ("({ x } = a);", Destructure),
    ("({ p: x = 1 } = a);", Destructure),
    ("({ ...x } = a);", Destructure),
    ("(x as any) = 1;", Assign),
    ("(<any>x) = 1;", Assign),
    ("x! = 1;", Assign),
    ("(x satisfies number) = 1;", Assign),
    ("(x as const) = 1;", Assign),
    ("((x)) = 1;", Assign),
    ("(x!)++;", Update(UnOp::PostInc)),
];

pub(crate) const NO_STORES: &[(&str, &str)] = &[
    ("a.ts", "let x = 1;"),
    ("a.cjs", "var x = 1; var x = 2;"),
    ("a.ts", "let x; x.y = 1;"),
    ("a.ts", "let x; delete x.y;"),
    ("a.ts", "let x; typeof x;"),
    ("a.ts", "let x; f(x);"),
    ("a.ts", "let x; for (let x of o);"),
];

pub(crate) const RUNTIME_VALUES: &[(&str, &str, bool)] = &[
    (r#"interface I {}"#, "I", false),
    (r#"type T = 1;"#, "T", false),
    (r#"declare const d: number;"#, "d", false),
    (r#"declare function g(): void;"#, "g", false),
    (r#"declare class K {}"#, "K", false),
    (r#"declare enum E { A }"#, "E", false),
    (r#"declare namespace N { const v: number; }"#, "N", false),
    (r#"namespace Empty {}"#, "Empty", false),
    (
        r#"namespace OnlyTypes { export interface I {} }"#,
        "OnlyTypes",
        false,
    ),
    (r#"import type { A } from "m";"#, "A", false),
    (r#"import { type B } from "m";"#, "B", false),
    (r#"import type D from "m";"#, "D", false),
    (r#"const enum E { A }"#, "E", true),
    (r#"enum F { A }"#, "F", true),
    (r#"namespace N { export const v = 1; }"#, "N", true),
    (r#"namespace O { export const enum E { A } }"#, "O", true),
    (r#"class C {}"#, "C", true),
    (r#"function f() {}"#, "f", true),
    (r#"let v;"#, "v", true),
    (r#"import { c } from "m";"#, "c", true),
    (r#"import * as ns from "m";"#, "ns", true),
    (r#"interface M {} class M {}"#, "M", true),
];
