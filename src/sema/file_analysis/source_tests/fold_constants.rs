mod support;
use bun_sema::fold::MadeByCall;
use support::*;

use Data::{Boolean, Number, String as Text};
use Expected::{OutsideDeadZone, Pure, Unknown};

const DEPTH: usize = 100_000;

#[derive(Copy, Clone, Debug)]
enum Expected {
    Unknown,
    Pure(Data<'static>),
    OutsideDeadZone(Data<'static>),
}

#[derive(Copy, Clone, Debug)]
enum Specifier {
    Unknown,
    Constant(&'static str),
    Pattern(&'static str, &'static str),
    OneOf(&'static [Specifier], &'static Specifier),
}

type FoldedRow = (&'static str, &'static str, Expected);
type SpecifierRow = (&'static str, &'static str, Specifier);
type LiteralRow = (&'static str, &'static str);

const UNDEFINED_DEFINE: Fold<'static> = Fold {
    defines: &[(
        Path::Global(&["undefined"]),
        Defined::Value(Data::Undefined),
    )],
    ..Fold::NONE
};
const GLOBAL_PATH_DEFINE: Fold<'static> = Fold {
    defines: &[(Path::Global(&["ALIAS"]), Defined::GlobalPath(&["a", "b"]))],
    ..Fold::NONE
};
const SHORT_STRINGS: Fold<'static> = Fold {
    max_string_bytes: 8,
    ..Fold::NONE
};

const PUBLISHED_CONSTANTS: &[FoldedRow] = &[
    ("a.mjs", "v(1 << 2);", Pure(Number(4.0))),
    ("a.mjs", "v(-1);", Pure(Number(-1.0))),
    ("a.mjs", "v(`a${1}`);", Pure(Text("a1"))),
    ("a.mjs", r#"v("a" + "b");"#, Pure(Text("ab"))),
    ("a.mjs", "v((0, 1));", Pure(Number(1.0))),
    ("a.mjs", "v(void 0);", Pure(Data::Undefined)),
    ("a.mjs", r#"v(typeof "a");"#, Pure(Text("string"))),
    ("a.mjs", "v(1 ? 2 : f());", Pure(Number(2.0))),
    ("a.mjs", "v(0 || null);", Pure(Data::Null)),
    ("a.ts", "v(1 satisfies number);", Pure(Number(1.0))),
    ("a.ts", "v(1!);", Pure(Number(1.0))),
    ("a.ts", "v(1 as const);", Pure(Number(1.0))),
    ("a.mjs", "v(1);", Pure(Number(1.0))),
    ("a.mjs", "v(1n);", Pure(Data::BigInt("1"))),
    ("a.mjs", r#"v("quire".replace(/^/, "re"));"#, Unknown),
    ("a.mjs", "v(f());", Unknown),
    ("a.mjs", "v(x);", Unknown),
    ("a.mjs", "v((f(), 1));", Unknown),
    ("a.mjs", "v(void f());", Unknown),
    ("a.mjs", "v(f() ? 1 : 1);", Unknown),
    ("a.ts", "v(1 as number);", OutsideDeadZone(Number(1.0))),
    (
        "a.ts",
        "v((1 as number) + 1);",
        OutsideDeadZone(Number(2.0)),
    ),
    ("a.ts", "v(-(1 as any));", OutsideDeadZone(Number(-1.0))),
    (
        "a.ts",
        r#"v(-("2" as unknown as number));"#,
        OutsideDeadZone(Number(-2.0)),
    ),
    ("a.ts", "v(-(f() as number));", Unknown),
    ("a.ts", "v(-((f(), 1) as number));", Unknown),
];

const LOCKED_REPLACE: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["String", "prototype", "replace"]),
            Defined::RuntimeValue(RuntimeValueKind::Function),
        ),
        (
            Path::Global(&["RegExp", "prototype", "exec"]),
            Defined::RuntimeValue(RuntimeValueKind::Function),
        ),
    ],
    ..Fold::NONE
};

const REPLACED_AT_AN_END: &[FoldedRow] = &[
    (
        "a.mjs",
        r#"v("quire".replace(/^/, "re"));"#,
        Pure(Text("require")),
    ),
    (
        "a.mjs",
        r#"v("requir".replace(/$/, "e"));"#,
        Pure(Text("require")),
    ),
    (
        "a.mjs",
        r#"v(("b" + "c").replace(/^/, `a`));"#,
        Pure(Text("abc")),
    ),
    ("a.mjs", r#"v("".replace(/$/, ""));"#, Pure(Text(""))),
    ("a.mjs", r#"v("a".replace(/^/g, "b"));"#, Unknown),
    ("a.mjs", r#"v("a".replace(/^/, "$&"));"#, Unknown),
    ("a.mjs", r#"v("a".replace(/a/, "b"));"#, Unknown),
    ("a.mjs", r#"v("a".replace("a", "b"));"#, Unknown),
    ("a.mjs", r#"v("a".replace(/^/, "b", f()));"#, Unknown),
    ("a.mjs", r#"v("a".replace(/^/, f()));"#, Unknown),
    ("a.mjs", r#"v("a".replace(/^/));"#, Unknown),
    ("a.mjs", r#"v(x.replace(/^/, "b"));"#, Unknown),
    ("a.mjs", r#"v("a".replaceAll(/^/, "b"));"#, Unknown),
    ("a.mjs", r#"v("a".exec(/^/, "b"));"#, Unknown),
    ("a.mjs", r#"v((1).replace(/^/, "b"));"#, Unknown),
];

const CONST_READS: &[FoldedRow] = &[
    (
        "a.mjs",
        "f(); const X = 1; v(X);",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 1; v(X + 1);",
        OutsideDeadZone(Number(2.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 1; v(`${X}`);",
        OutsideDeadZone(Text("1")),
    ),
    (
        "a.mjs",
        "f(); const X = 1; v(-X);",
        OutsideDeadZone(Number(-1.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 1; v((X, 2));",
        OutsideDeadZone(Number(2.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 1; v(X ? 3 : 4);",
        OutsideDeadZone(Number(3.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 1; v(X && 5);",
        OutsideDeadZone(Number(5.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 1, Y = X + 1; v(Y);",
        OutsideDeadZone(Number(2.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 1; function g() { v(X); }",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        "function g() { f(); const X = 1; v(X); }",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        "const X = (f(), 1); v(X);",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        "f(); export const X = 1; v(X);",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.ts",
        "namespace N { f(); const X = 1; v(X); }",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        "let a = 1; const X = 1; v(X);",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        r#"export { a } from "./a"; const X = 1; v(X);"#,
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        r#"const X = "a" + "b"; v(X);"#,
        OutsideDeadZone(Text("ab")),
    ),
    (
        "a.mjs",
        r#"const X = ["a" + "b"][0]; v(X);"#,
        OutsideDeadZone(Text("ab")),
    ),
    (
        "a.ts",
        "const X = 1 as number; v(X);",
        OutsideDeadZone(Number(1.0)),
    ),
    ("a.mjs", "f(); const X = 0; v(X / X);", Unknown),
    ("a.mjs", "f(); const X = void 0; v(-X);", Unknown),
    ("a.mjs", "f(); const X = 0, Y = X / X; v(Y);", Unknown),
    (
        "a.mjs",
        "f(); const X = 2; v(X / X);",
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "a.mjs",
        "f(); const X = 0; v(X / X ? 1 : 2);",
        OutsideDeadZone(Number(2.0)),
    ),
    ("a.mjs", "v(-(void 0 + 1));", Unknown),
    ("a.mjs", "let X = 1; v(X);", Unknown),
    ("a.cjs", "var X = 1; v(X);", Unknown),
    ("a.ts", "namespace N { export const X = 1; v(X); }", Unknown),
    ("a.ts", "declare const X = 1; v(X);", Unknown),
    ("a.mjs", "const { X } = { X: 1 }; v(X);", Unknown),
    ("a.mjs", "const [X] = [1]; v(X);", Unknown),
    ("a.mjs", "v(X); const X = 1;", Unknown),
    ("a.mjs", "function g() { v(X); } const X = 1;", Unknown),
    ("a.mjs", "const X = f(); v(X);", Unknown),
    ("a.mjs", "const X = 1; function g(X) { v(X); }", Unknown),
    ("a.cjs", "const X = 1; with (o) v(X);", Unknown),
    (
        "a.cjs",
        "const X = 1; function g() { eval(s); v(X); }",
        Unknown,
    ),
];

const REPLACED_READS: &[FoldedRow] = &[
    ("a.mjs", "const X = 1; v(X);", Pure(Number(1.0))),
    ("a.mjs", "const X = 1; v(X + 1);", Pure(Number(2.0))),
    ("a.mjs", "const X = 1; v(typeof X);", Pure(Text("number"))),
    ("a.mjs", "const X = 1, Y = X + 1; v(Y);", Pure(Number(2.0))),
    (
        "a.mjs",
        "const X = g(), Y = 1; function g() { v(Y); }",
        Pure(Number(1.0)),
    ),
    (
        "a.mjs",
        "function g() { const X = 1; v(X); }",
        Pure(Number(1.0)),
    ),
    ("a.mjs", "{ const X = 1; v(X); }", Pure(Number(1.0))),
    (
        "a.mjs",
        "switch (a) { case 1: const X = 1; v(X); }",
        Pure(Number(1.0)),
    ),
    ("a.mjs", "export const X = 1; v(X);", Pure(Number(1.0))),
    (
        "a.mjs",
        "let a; var b; const { c } = o; const X = 1; v(X);",
        Pure(Number(1.0)),
    ),
    (
        "a.ts",
        "namespace N { const X = 1; v(X); }",
        Pure(Number(1.0)),
    ),
    (
        "a.ts",
        r#"import type { T } from "./t"; declare const a: T; const X = 1; v(X);"#,
        Pure(Number(1.0)),
    ),
    (
        "a.mjs",
        r#"const X = true ? "a" : "b"; v(X);"#,
        Pure(Text("a")),
    ),
    ("a.mjs", "const X = typeof 1; v(X);", Pure(Text("number"))),
    (
        "a.mjs",
        r#"const X = "abc".length; v(X);"#,
        Pure(Number(3.0)),
    ),
    ("a.mjs", r#"const X = "abc"[1]; v(X);"#, Pure(Text("b"))),
    (
        "a.mjs",
        r#"const X = ["a", "b"][1]; v(X);"#,
        Pure(Text("b")),
    ),
    ("a.mjs", "const X = [[1]][0][0]; v(X);", Pure(Number(1.0))),
    ("a.mjs", "const X = { a: 1 }.a; v(X);", Pure(Number(1.0))),
];

const LIBRARY_READS: &[(&str, Option<Data<'static>>, Expected)] = &[
    ("const X = 1; v(X);", Some(Number(1.0)), Pure(Number(1.0))),
    (
        "const X = 1; function g() { v(X); }",
        Some(Number(1.0)),
        Pure(Number(1.0)),
    ),
    (
        "const X = 1, Y = X + 1; v(Y);",
        Some(Number(2.0)),
        Pure(Number(2.0)),
    ),
    (
        "const X = false; v(X);",
        Some(Boolean(false)),
        Pure(Boolean(false)),
    ),
    (
        "export const X = 1; v(X);",
        Some(Number(1.0)),
        Pure(Number(1.0)),
    ),
    (
        "function g() { f(); const X = 1; v(X); }",
        None,
        OutsideDeadZone(Number(1.0)),
    ),
    (
        "const X = (f(), 1); v(X);",
        None,
        OutsideDeadZone(Number(1.0)),
    ),
    ("const X = f(); v(X);", None, Unknown),
    ("let X = 1; v(X);", None, Unknown),
    ("v(X); const X = 1;", None, Unknown),
    ("const { X } = { X: 1 }; v(X);", None, Unknown),
    ("const X = 1; function g(X) { v(X); }", None, Unknown),
];

const READS_DECIDED_UNDER_MINIFY_SYNTAX_ALONE: &[(&str, Data<'static>)] = &[
    ("function g() { const X = 1; v(X); }", Number(1.0)),
    ("{ const X = 1; v(X); }", Number(1.0)),
];

const READS_DECIDED_IN_A_LIBRARY_ALONE: &[(&str, Data<'static>)] = &[
    (r#"const X = "a" + "b"; v(X);"#, Text("ab")),
    ("f(); const X = 1; v(X);", Number(1.0)),
];

const SPECIFIERS: &[SpecifierRow] = &[
    (
        "a.cjs",
        "require(`./l/${x}.json`);",
        Specifier::Pattern("./l/", ".json"),
    ),
    (
        "a.cjs",
        r#"require("./a/" + x + ".js");"#,
        Specifier::Pattern("./a/", ".js"),
    ),
    (
        "a.cjs",
        r#"require(dir + "/x.js");"#,
        Specifier::Pattern("", "/x.js"),
    ),
    (
        "a.cjs",
        r#"require("./" + x);"#,
        Specifier::Pattern("./", ""),
    ),
    (
        "a.cjs",
        r#"require(1 + 2 + "a" + x);"#,
        Specifier::Pattern("3a", ""),
    ),
    (
        "a.cjs",
        r#"require(x + 1 + "a");"#,
        Specifier::Pattern("", "a"),
    ),
    (
        "a.cjs",
        r#"const p = "./a/" + x; require(p);"#,
        Specifier::Pattern("./a/", ""),
    ),
    (
        "a.cjs",
        r#"const p = "./a/" + x; require(p + ".js");"#,
        Specifier::Pattern("./a/", ".js"),
    ),
    (
        "a.cjs",
        r#"require(`./${c ? "a" : "b"}.js`);"#,
        Specifier::OneOf(
            &[Specifier::Constant("./a.js"), Specifier::Constant("./b.js")],
            &Specifier::Pattern("./", ".js"),
        ),
    ),
    (
        "a.cjs",
        r#"require(c ? "./d/one.cjs" : "./d/two.cjs");"#,
        Specifier::OneOf(
            &[
                Specifier::Constant("./d/one.cjs"),
                Specifier::Constant("./d/two.cjs"),
            ],
            &Specifier::Pattern("./d/", ".cjs"),
        ),
    ),
    (
        "a.cjs",
        r#"require("./" + (c ? "a/x" : "a/y") + ".js");"#,
        Specifier::OneOf(
            &[
                Specifier::Constant("./a/x.js"),
                Specifier::Constant("./a/y.js"),
            ],
            &Specifier::Pattern("./a/", ".js"),
        ),
    ),
    (
        "a.cjs",
        r#"require(c ? "./a/x" : d ? "./a/y" : "./a/z");"#,
        Specifier::OneOf(
            &[
                Specifier::Constant("./a/x"),
                Specifier::Constant("./a/y"),
                Specifier::Constant("./a/z"),
            ],
            &Specifier::Pattern("./a/", ""),
        ),
    ),
    (
        "a.cjs",
        r#"require(c ? "./a/" + x : "./a/b.js");"#,
        Specifier::OneOf(
            &[
                Specifier::Pattern("./a/", ""),
                Specifier::Constant("./a/b.js"),
            ],
            &Specifier::Pattern("./a/", ""),
        ),
    ),
    (
        "a.cjs",
        r#"require(c ? "./a/" + (d ? 1 : 2) : "./a/z");"#,
        Specifier::OneOf(
            &[
                Specifier::Constant("./a/1"),
                Specifier::Constant("./a/2"),
                Specifier::Constant("./a/z"),
            ],
            &Specifier::Pattern("./a/", ""),
        ),
    ),
    (
        "a.cjs",
        r#"require(c ? "ab" : "aab");"#,
        Specifier::OneOf(
            &[Specifier::Constant("aab"), Specifier::Constant("ab")],
            &Specifier::Pattern("a", "b"),
        ),
    ),
    (
        "a.cjs",
        r#"require(c ? "./a" : "./a");"#,
        Specifier::OneOf(
            &[Specifier::Constant("./a")],
            &Specifier::Pattern("./a", ""),
        ),
    ),
    (
        "a.cjs",
        r#"require(c ? "./\u00e9.js" : "./\u00e8.js");"#,
        Specifier::OneOf(
            &[
                Specifier::Constant("./\u{e8}.js"),
                Specifier::Constant("./\u{e9}.js"),
            ],
            &Specifier::Pattern("./", ".js"),
        ),
    ),
    (
        "a.ts",
        r#"require((c ? "./a/x" : "./a/y") as string);"#,
        Specifier::OneOf(
            &[Specifier::Constant("./a/x"), Specifier::Constant("./a/y")],
            &Specifier::Pattern("./a/", ""),
        ),
    ),
    (
        "a.cjs",
        r#"require("a" + (1 + x));"#,
        Specifier::Pattern("a", ""),
    ),
    (
        "a.cjs",
        r#"require("a" + ("b" + x));"#,
        Specifier::Pattern("ab", ""),
    ),
    (
        "a.cjs",
        r#"require(("./a/" + x));"#,
        Specifier::Pattern("./a/", ""),
    ),
    (
        "a.cjs",
        r#"require(("./a/") + (x));"#,
        Specifier::Pattern("./a/", ""),
    ),
    (
        "a.ts",
        r#"require(("./a/" + x) as string);"#,
        Specifier::Pattern("./a/", ""),
    ),
    (
        "a.ts",
        r#"require(("./a/" as string) + x!);"#,
        Specifier::Pattern("./a/", ""),
    ),
    (
        "a.ts",
        r#"require(`./${x as any}.js` satisfies string);"#,
        Specifier::Pattern("./", ".js"),
    ),
    (
        "a.mjs",
        "import(`./l/${x}.js`);",
        Specifier::Pattern("./l/", ".js"),
    ),
    (
        "a.cjs",
        "require.resolve(`./l/${x}.js`);",
        Specifier::Pattern("./l/", ".js"),
    ),
    (
        "a.cjs",
        r"require(`a\ud83d${x}\ude00b`);",
        Specifier::Pattern("a", "b"),
    ),
    (
        "a.cjs",
        r#"require((f(), "./x"));"#,
        Specifier::Constant("./x"),
    ),
    ("a.cjs", "require(1 + x);", Specifier::Unknown),
    ("a.cjs", "require(x + 1);", Specifier::Unknown),
    ("a.cjs", "require(x);", Specifier::Unknown),
    ("a.cjs", "require(f());", Specifier::Unknown),
    ("a.cjs", r#"require(c ? "./a" : x);"#, Specifier::Unknown),
    (
        "a.cjs",
        r#"require(c ? "./a" : "b");"#,
        Specifier::OneOf(
            &[Specifier::Constant("./a"), Specifier::Constant("b")],
            &Specifier::Unknown,
        ),
    ),
    ("a.cjs", "require(`${a}${b}`);", Specifier::Unknown),
    ("a.cjs", "require(1);", Specifier::Unknown),
    (
        "a.cjs",
        r#"let p = "./a/" + x; require(p);"#,
        Specifier::OneOf(&[Specifier::Pattern("./a/", "")], &Specifier::Unknown),
    ),
    ("a.cjs", r"require(`\ud83d${x}\ude00`);", Specifier::Unknown),
];

const PATHS_FROM_OWN_DIRECTORY: &[SpecifierRow] = &[
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib", "a.js"));"#,
        Specifier::Constant("./lib/a.js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "./lib/", "./a.js"));"#,
        Specifier::Constant("./lib/a.js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib/x", "..", "a.js"));"#,
        Specifier::Constant("./lib/a.js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "..", "a.json"));"#,
        Specifier::Constant("./../a.json"),
    ),
    (
        "a.cjs",
        r#"const { resolve } = require("path"); require(resolve(__dirname, "lib/a.js"));"#,
        Specifier::Constant("./lib/a.js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname));"#,
        Specifier::Constant("."),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib/"));"#,
        Specifier::Constant("./lib/"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib/", ""));"#,
        Specifier::Constant("./lib/"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib/x", "../"));"#,
        Specifier::Constant("./lib/"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib/."));"#,
        Specifier::Constant("./lib"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.resolve(__dirname, "lib/"));"#,
        Specifier::Constant("./lib"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "/lib/a.js"));"#,
        Specifier::Constant("./lib/a.js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib/", x + ".js"));"#,
        Specifier::Pattern("./lib/", ".js"),
    ),
    (
        "a.mjs",
        r#"import path from "path"; import(path.join(import.meta.dir, "lib", "a.js"));"#,
        Specifier::Constant("./lib/a.js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib", x + ".js"));"#,
        Specifier::Pattern("./lib/", ".js"),
    ),
    (
        "a.mjs",
        r#"import path from "path"; import(path.join(import.meta.dirname, "lib", `${x}.js`));"#,
        Specifier::Pattern("./lib/", ".js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "..", x + "/b.js"));"#,
        Specifier::OneOf(
            &[Specifier::Pattern("./../", "/b.js")],
            &Specifier::Pattern("", "b.js"),
        ),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, x, "b.js"));"#,
        Specifier::OneOf(
            &[Specifier::Pattern("./", "/b.js")],
            &Specifier::Pattern("", "b.js"),
        ),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.resolve(__dirname, "/lib", "b.js"));"#,
        Specifier::Pattern("", "b.js"),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(y, __dirname, "b.js"));"#,
        Specifier::Pattern("", "b.js"),
    ),
];

const MODIFIED_IMPORT_META_PATHS: &[SpecifierRow] = &[
    (
        "a.mjs",
        r#"import.meta.dir = d; import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"import.meta.dirname += d; import(`${import.meta.dirname}/a.js`);"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"import.meta["dir"] = d; import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"[import.meta.dir] = d; import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"delete import.meta.dir; import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"const meta = import.meta; import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"f(import.meta); import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"import.meta.f(); import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mts",
        r#"(import.meta as any).dir = d; import(import.meta.dir + "/a.js");"#,
        Specifier::Pattern("", "/a.js"),
    ),
    (
        "a.mjs",
        r#"import path from "path"; import.meta.dir = d; import(path.join(import.meta.dir, "a.js"));"#,
        Specifier::Pattern("", "a.js"),
    ),
];

const READ_ONLY_IMPORT_META_PATHS: &[SpecifierRow] = &[
    (
        "a.mjs",
        r#"const { dir, url } = import.meta; import(import.meta.dir + "/a.js");"#,
        Specifier::Constant("./a.js"),
    ),
    (
        "a.mjs",
        r#"f(import.meta.url, import.meta["path"], import.meta.env.A, import.meta.resolve("./b.js")); import(import.meta.dir + "/a.js");"#,
        Specifier::Constant("./a.js"),
    ),
    (
        "a.mjs",
        r#"import.meta.hot?.accept(); import(import.meta.dir + "/a.js");"#,
        Specifier::Constant("./a.js"),
    ),
];

const PATH_JOINS: &[SpecifierRow] = &[
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(d, "a.json"));"#,
        Specifier::Pattern("", "a.json"),
    ),
    (
        "a.cjs",
        r#"const { join } = require("node:path"); require(join(d, "a.json"));"#,
        Specifier::Pattern("", "a.json"),
    ),
    (
        "a.mjs",
        r#"import path from "node:path"; import(path.resolve(d, "a.js"));"#,
        Specifier::Pattern("", "a.js"),
    ),
    (
        "a.mjs",
        r#"import * as path from "path"; import(path.join(d, "a.js"));"#,
        Specifier::Pattern("", "a.js"),
    ),
    (
        "a.mjs",
        r#"import { join } from "path"; import(join(d, "sub/a.js"));"#,
        Specifier::Pattern("", "a.js"),
    ),
    (
        "a.mjs",
        r#"import { join } from "path"; import(join(d, `${n}.js`));"#,
        Specifier::Pattern("", ".js"),
    ),
    (
        "a.mjs",
        r#"import { join } from "path"; import(join(d, ".."));"#,
        Specifier::Unknown,
    ),
    (
        "a.mjs",
        r#"import { join } from "path"; import(join(d, "a.js/"));"#,
        Specifier::Unknown,
    ),
    (
        "a.mjs",
        r#"import { join } from "path"; import(join(d, n));"#,
        Specifier::Unknown,
    ),
    (
        "a.mjs",
        r#"import { basename } from "path"; import(basename(d, "a.js"));"#,
        Specifier::Unknown,
    ),
    (
        "a.mjs",
        r#"import { posix } from "path"; import(posix.join(d, "a.js"));"#,
        Specifier::Unknown,
    ),
    (
        "a.mjs",
        r#"import { join } from "./path"; import(join(d, "a.js"));"#,
        Specifier::Unknown,
    ),
    (
        "a.mjs",
        r#"import path from "path"; import(path?.join(d, "a.js"));"#,
        Specifier::Unknown,
    ),
    (
        "a.mjs",
        r#"import path from "path"; function g(path) { import(path.join(d, "a.js")); }"#,
        Specifier::Unknown,
    ),
    (
        "a.cjs",
        r#"let path = require("path"); path = o; require(path.join(d, "a.json"));"#,
        Specifier::Unknown,
    ),
    (
        "a.cjs",
        r#"require(path.join(d, "a.json"));"#,
        Specifier::Unknown,
    ),
    (
        "a.cjs",
        r#"require([d, "a.json"].join("/"));"#,
        Specifier::Unknown,
    ),
];

const DATA_LITERALS: &[(&str, &str, &str)] = &[
    ("a.mjs", r#"v([1, "a", null]);"#, r#"[1,"a",null]"#),
    ("a.mjs", r#"v({ a: 1, "b": [2] });"#, r#"{"a":1,"b":[2]}"#),
    ("a.mjs", r#"v({ ["k"]: 1 });"#, r#"{"k":1}"#),
    ("a.mjs", r#"v({ ["a" + "b"]: 1 });"#, r#"{"ab":1}"#),
    ("a.mjs", "v({ 1: 2 });", r#"{"1":2}"#),
    ("a.mjs", "v({ 1n: 2 });", r#"{"1":2}"#),
    (
        "a.mjs",
        "v({ [1 + 1]: 0, [null]: 1, [true]: 2, [void 0]: 3, [4n]: 4 });",
        r#"{"2":0,"null":1,"true":2,"undefined":3,"4":4}"#,
    ),
    ("a.mjs", "v([-1]);", "[-1]"),
    ("a.ts", "v([1] as const);", "[1]"),
    ("a.ts", "v([1] satisfies number[]);", "[1]"),
    ("a.mjs", "v([[1], { a: [] }]);", r#"[[1],{"a":[]}]"#),
    ("a.mjs", r#"v({ ["__proto__"]: 1 });"#, r#"{"__proto__":1}"#),
    ("a.mjs", "v([]);", "[]"),
    ("a.mjs", "v({});", "{}"),
    (
        "a.mjs",
        "v([1 + 1, `a${1}`, void 0, 1n]);",
        r#"[2,"a1",undefined,1n]"#,
    ),
];

const OTHER_LITERALS: &[LiteralRow] = &[
    ("a.mjs", "v([f()]);"),
    ("a.mjs", "v([, 1]);"),
    ("a.mjs", "v([...a]);"),
    ("a.mjs", "v({ __proto__: null });"),
    ("a.mjs", r#"v({ "__proto__": null });"#),
    ("a.mjs", "v({ get a() { return 1; } });"),
    ("a.mjs", "v({ m() {} });"),
    ("a.mjs", "v({ ...a });"),
    ("a.mjs", "v({ [k]: 1 });"),
    ("a.mjs", "v({ [f()]: 1 });"),
    ("a.mjs", "v([undefined]);"),
    ("a.mjs", "v([(f(), 1)]);"),
    ("a.mjs", "v([[f()]]);"),
    ("a.mjs", "v({ a: { b: x } });"),
];

const DEAD_ZONE_LITERALS: &[(&str, &str)] = &[
    ("f(); const X = 1; v([X]);", "[1]"),
    ("f(); const X = 1; v({ X });", r#"{"X":1}"#),
    ("f(); const X = 1; v({ a: [X + 1] });", r#"{"a":[2]}"#),
    (r#"f(); const K = "k"; v({ [K]: 1 });"#, r#"{"k":1}"#),
];

const REPEATED_KEYS: &[(&str, &str)] = &[
    ("v({ a: 1, b: 2, a: 3 });", r#"{"a":3,"b":2}"#),
    (r#"v({ a: 1, ["a"]: 2, "a": 3 });"#, r#"{"a":3}"#),
    ("v({ 1: 1, [1]: 2, [0 + 1]: 3 });", r#"{"1":3}"#),
    (
        "v({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, b: 10, a: 11 });",
        r#"{"a":11,"b":10,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9}"#,
    ),
];

fn folded(path: &str, text: &str, fold: Fold<'_>, test: impl for<'s> FnOnce(&Analyzed<'s>) + Send) {
    with_workspace(|w| {
        let inputs = w.fold_inputs(&fold);
        test(&w.analyze(&Source::new(path, text), &inputs));
    });
}

fn library(text: &str, test: impl for<'s> FnOnce(&Analyzed<'s>) + Send) {
    let source = Source {
        is_library: true,
        ..Source::new("a.mjs", text)
    };
    analyzed_source(&source, test);
}

fn calls_of(s: &Analyzed<'_>, name: &str) -> Vec<ExprId> {
    let atom = s.workspace.atom(name);
    find_exprs(&s.hir, |kind| {
        let ExprKind::Call(call) = *kind else {
            return false;
        };
        matches!(s.hir[s.hir[call].callee].kind, ExprKind::Ident(text) if text == atom)
    })
}

#[track_caller]
fn only_argument(s: &Analyzed<'_>, name: &str) -> ExprId {
    let calls = calls_of(s, name);
    let [call] = calls[..] else {
        panic!("calls of {name}: {calls:?}");
    };
    let ExprKind::Call(call) = s.hir[call].kind else {
        panic!("{:?} is no call", s.hir[call].kind);
    };
    let arguments: Vec<ExprId> = s.hir.ids(s.hir[call].args).collect();
    let [argument] = arguments[..] else {
        panic!("arguments of {name}: {arguments:?}");
    };
    argument
}

#[track_caller]
fn probe(s: &Analyzed<'_>) -> ExprId {
    only_argument(s, "v")
}

fn constant(s: &Analyzed<'_>, e: ExprId) -> FoldedValue {
    s.analysis.decisions.constant(&s.hir, e)
}

fn is_value(s: &Analyzed<'_>, found: Constant, expected: &Data<'_>) -> bool {
    found.to_data_value() == *s.workspace.data(expected)
}

#[track_caller]
fn assert_folded(s: &Analyzed<'_>, e: ExprId, expected: Expected, text: &str) {
    let found = constant(s, e);
    let is_expected = match (found, expected) {
        (FoldedValue::Unknown, Unknown) => true,
        (FoldedValue::Constant(found), Pure(expected))
        | (FoldedValue::ConstantOutsideDeadZone(found), OutsideDeadZone(expected)) => {
            is_value(s, found, &expected)
        }
        (
            FoldedValue::Unknown
            | FoldedValue::Constant(_)
            | FoldedValue::ConstantOutsideDeadZone(_),
            _,
        ) => false,
    };
    assert!(
        is_expected,
        "{text}: expected {expected:?}, found {found:?}"
    );
}

fn data_value<'s>(s: &Analyzed<'s>, e: ExprId) -> FoldedData<'s> {
    let w = &s.workspace;
    data_value_of(&s.hir, &s.analysis.decisions, e, &w.atoms, w.arena)
}

#[track_caller]
fn data_text(s: &Analyzed<'_>, e: ExprId, text: &str) -> String {
    match data_value(s, e) {
        FoldedData::Known(value) => s.workspace.describe_data(&value),
        FoldedData::Unknown => panic!("{text}: {e:?} has no value"),
    }
}

fn to_import_specifier(w: &Workspace<'_>, specifier: Specifier) -> ImportSpecifier {
    match specifier {
        Specifier::Unknown => ImportSpecifier::Unknown,
        Specifier::Constant(text) => ImportSpecifier::Constant(w.atom(text)),
        Specifier::Pattern(prefix, suffix) => ImportSpecifier::Pattern {
            prefix: w.atom(prefix),
            suffix: w.atom(suffix),
        },
        Specifier::OneOf(..) => panic!("{specifier:?} holds another"),
    }
}

#[track_caller]
fn last_site(s: &Analyzed<'_>, text: &str) -> ImportSite {
    match s.analysis.import_sites.last() {
        Some(site) => *site,
        None => panic!("{text}: no import site"),
    }
}

fn check_specifiers(rows: &[SpecifierRow]) {
    for &(path, text, expected) in rows {
        analyzed(path, text, |s| {
            let site = last_site(s, text);
            let (alternatives, folded) = match expected {
                Specifier::OneOf(alternatives, folded) => (alternatives, *folded),
                _ => (std::slice::from_ref(&expected), expected),
            };
            let alternatives: Vec<ImportSpecifier> = alternatives
                .iter()
                .map(|&it| to_import_specifier(&s.workspace, it))
                .collect();
            let expected = to_import_specifier(&s.workspace, folded);
            assert!(site.kind.call().is_some(), "{text}");
            assert_eq!(
                s.analysis.alternatives_of(&site.specifier),
                alternatives,
                "{text}"
            );
            assert_eq!(
                s.analysis.decisions.specifier(site.specifier_node),
                expected,
                "{text}"
            );
            assert!(
                !s.analysis.decisions.is_dead_expr(site.specifier_node),
                "{text}"
            );
            assert!(s.analysis.strings_over_limit.is_empty(), "{text}");
        });
    }
}

fn nested_arrays<'s>(w: &Workspace<'s>, depth: usize) -> (File<'s>, ExprId) {
    let mut file = FileBuilder {
        kind: FileKind::Tsx,
        is_js: true,
        ..FileBuilder::default()
    };
    let mut root = file.expr(ExprKind::Array(IdList::EMPTY), 0, 0);
    for _ in 0..depth {
        let items = file.list(&[root]);
        root = file.expr(ExprKind::Array(items), 0, 0);
    }
    let statement = file.stmt(StmtKind::Expr(root), 0);
    file.body = file.list(&[statement]);
    let (mut hir, _) = file.into_arena(w.arena, w.atoms.session());
    hir.finish_nodes();
    (hir, root)
}

fn array_depth(value: DataValue<'_>) -> usize {
    let (mut depth, mut value) = (0, value);
    while let DataValue::Array(&[inner]) = value {
        depth += 1;
        value = inner;
    }
    depth
}

#[test]
fn constants_are_published() {
    for &(path, text, expected) in PUBLISHED_CONSTANTS {
        analyzed(path, text, |s| {
            let e = probe(s);
            assert_folded(s, e, expected, text);
            assert_eq!(
                s.analysis.decisions.decision(e),
                Decision::Unknown,
                "{text}"
            );
        });
    }
    analyzed("a.mjs", "switch (x) { case 1 << 2: }", |s| {
        let tests = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Binary { .. }));
        assert_eq!(tests.len(), 1);
        assert_folded(s, tests[0], Pure(Number(4.0)), "case 1 << 2");
    });
}

#[test]
fn text_is_replaced_at_an_end_where_every_run_finds_the_method() {
    for &(path, text, expected) in REPLACED_AT_AN_END {
        folded(path, text, LOCKED_REPLACE, |s| {
            let e = probe(s);
            assert_folded(s, e, expected, text);
            assert_eq!(
                s.analysis.decisions.decision(e),
                Decision::Unknown,
                "{text}"
            );
        });
        let [replace, exec] = LOCKED_REPLACE.defines else {
            panic!("{:?}", LOCKED_REPLACE.defines);
        };
        for defines in [&[][..], &[*replace], &[*exec]] {
            let fold = Fold {
                defines,
                ..Fold::NONE
            };
            folded(path, text, fold, |s| {
                assert_folded(s, probe(s), Unknown, text);
            });
        }
    }
}

#[test]
fn dead_expression_has_no_constant() {
    analyzed("a.mjs", "if (false) v(1 + 1);", |s| {
        let sum = probe(s);
        assert!(s.analysis.decisions.is_dead_expr(sum));
        assert_folded(s, sum, Unknown, "1 + 1");
    });
    analyzed("a.mjs", "if (true) v(1 + 1);", |s| {
        assert_folded(s, probe(s), Pure(Number(2.0)), "1 + 1");
    });
    analyzed("a.mjs", "if (false) v(1);", |s| {
        let literal = probe(s);
        assert!(s.analysis.decisions.is_dead_expr(literal));
        assert_folded(s, literal, Pure(Number(1.0)), "1");
    });
}

#[test]
fn left_addend_has_no_constant() {
    analyzed("a.mjs", r#"v("a" + "b" + "c");"#, |s| {
        let sum = probe(s);
        let ExprKind::Binary { left, .. } = s.hir[sum].kind else {
            panic!("{:?} is no sum", s.hir[sum].kind);
        };
        assert_folded(s, sum, Pure(Text("abc")), "the sum");
        assert_folded(s, left, Unknown, "the left addend");
    });
}

#[test]
fn type_test_keeps_value_for_branches() {
    let text = "if (0 as number) a(); else b();";
    analyzed("a.ts", text, |s| {
        let [a] = calls_of(s, "a")[..] else {
            panic!("calls of a");
        };
        let [b] = calls_of(s, "b")[..] else {
            panic!("calls of b");
        };
        assert!(s.analysis.decisions.is_dead_expr(a), "{text}");
        assert!(!s.analysis.decisions.is_dead_expr(b), "{text}");
    });
}

#[test]
fn const_reads_check_the_dead_zone() {
    for &(path, text, expected) in CONST_READS {
        analyzed(path, text, |s| {
            let e = probe(s);
            assert_folded(s, e, expected, text);
            assert_eq!(
                s.analysis.decisions.decision(e),
                Decision::Unknown,
                "{text}"
            );
            assert!(!s.analysis.decisions.is_dead_expr(e), "{text}");
        });
    }
}

#[test]
fn reads_that_bun_run_replaces_check_nothing() {
    for &(path, text, expected) in REPLACED_READS {
        folded(path, text, Fold::MINIFIED, |s| {
            let e = probe(s);
            assert_folded(s, e, expected, text);
            assert!(
                s.analysis.decisions.is_constant_in_bun_run(&s.hir, e),
                "{text}"
            );
        });
    }
}

#[test]
fn constant_keeps_its_name_without_minify_syntax() {
    for &(path, text, _) in REPLACED_READS {
        analyzed(path, text, |s| {
            let e = probe(s);
            assert_eq!(
                s.analysis.decisions.decision(e),
                Decision::Unknown,
                "{text}"
            );
            assert!(
                !s.analysis.decisions.is_constant_in_bun_run(&s.hir, e),
                "{text}"
            );
        });
    }
}

const COMPUTED_WITHOUT_MINIFY_SYNTAX: &[(&str, &str, bool)] = &[
    ("a.mjs", "v(-1);", true),
    ("a.mjs", "v(+5);", true),
    ("a.mjs", "v(`c`);", true),
    ("a.mjs", "v(typeof 1);", true),
    ("a.mjs", r#"v(true ? "h" : "i");"#, true),
    ("a.mjs", r#"v("" || "j");"#, true),
    ("a.mjs", r#"v(null ?? "l");"#, true),
    ("a.mjs", r#"v(1 === 1 ? "q" : "r");"#, true),
    ("a.mjs", r#"v(1 < 2 ? "o" : "p");"#, true),
    ("a.mjs", "v(1 + 2);", false),
    ("a.mjs", "v(2 * 4);", false),
    ("a.mjs", "v(~1);", false),
    ("a.mjs", r#"v("a" + "b");"#, false),
    ("a.mjs", "v(`d${1}`);", false),
    ("a.mjs", r#"v((0, "m"));"#, false),
    ("a.mjs", r#"v("abc".length);"#, false),
    ("a.mjs", r#"v("xyz"[1]);"#, false),
    ("a.mjs", r#"v(["e", "f"][1]);"#, false),
    ("a.mjs", r#"v({ a: "g" }.a);"#, false),
];

#[test]
fn bun_build_computes_less_without_minify_syntax() {
    for &(path, text, is_computed) in COMPUTED_WITHOUT_MINIFY_SYNTAX {
        analyzed(path, text, |s| {
            let e = probe(s);
            assert!(matches!(constant(s, e), FoldedValue::Constant(_)), "{text}");
            assert_eq!(
                s.analysis.decisions.is_constant_in_bun_run(&s.hir, e),
                is_computed,
                "{text}"
            );
        });
        folded(path, text, Fold::MINIFIED, |s| {
            assert!(
                s.analysis
                    .decisions
                    .is_constant_in_bun_run(&s.hir, probe(s)),
                "{text}"
            );
        });
    }
}

const COMPUTED_BEHIND_IMPORT: &[&str] = &[
    r#"() => import("./b"); v(1 + 2);"#,
    r#"() => import("./b"); v(~1);"#,
    r#"() => import("./b"); v(`d${1}`);"#,
    r#"await import("./b"); v(1 + 2);"#,
    r#"import("./b").then(f); v(1 + 2);"#,
    r#"if (false) import("./b"); v(1 + 2);"#,
    r#"new A(import("./b")); v(1 + 2);"#,
    r#"f`${import("./b")}`; v(1 + 2);"#,
    r#"class A { b() { import("./b"); } } v(1 + 2);"#,
    r#"f(import("./b"), v(1 + 2));"#,
    r#"f(() => { import("./b"); v(1 + 2); });"#,
    r#"() => import("./b"); f(import("./b")); v(1 + 2);"#,
    r#"() => import("./b"); enum E { A = 1 } v(1 + 2);"#,
];

const NOT_COMPUTED_BESIDE_IMPORT: &[&str] = &[
    r#"v(1 + 2); () => import("./b");"#,
    r#"f(import("./b")); v(1 + 2);"#,
    r#"f?.(import("./b")); v(1 + 2);"#,
    r#"f(() => { import("./b"); }); v(1 + 2);"#,
    r#"f(g(import("./b")), v(1 + 2));"#,
    r#"enum E { A = (import("./b"), 1) } v(1 + 2);"#,
    r#"enum E { A = (() => { import("./b"); })() } v(1 + 2);"#,
];

#[test]
fn bun_build_computes_behind_import() {
    for (texts, is_computed) in [
        (COMPUTED_BEHIND_IMPORT, true),
        (NOT_COMPUTED_BESIDE_IMPORT, false),
    ] {
        for &text in texts {
            analyzed("a.ts", text, |s| {
                let decisions = &s.analysis.decisions;
                let is_constant = decisions.is_constant_in_bun_run(&s.hir, probe(s));
                assert_eq!(is_constant, is_computed, "{text}");
            });
        }
    }
}

const WRITTEN_WITHOUT_WHAT_NOBODY_TAKES: &[(&str, &str, bool, bool)] = &[
    ("a.mjs", r#"v([] ? "a" : "b");"#, true, true),
    (
        "a.mjs",
        r#"let x = f(); v([x, 1, [], {}, , typeof free] ? "a" : "b");"#,
        true,
        true,
    ),
    (
        "a.mjs",
        r#"let x = f(); v({ a: 1, x, m() {}, get g() { return 1; }, __proto__: null } ? "a" : "b");"#,
        true,
        true,
    ),
    ("a.mjs", r#"v((() => 1) ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(function* () {} ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(/x/ ? 1 : 2);"#, true, true),
    ("a.mjs", r#"v(typeof free ? "a" : "b");"#, true, true),
    (
        "a.mjs",
        r#"let x = f(); v(typeof x ? "a" : "b");"#,
        true,
        true,
    ),
    ("a.mjs", r#"v(typeof [] ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(typeof this ? "a" : "b");"#, true, true),
    (
        "a.mjs",
        r#"let x = f(); v(void x ? "a" : "b");"#,
        true,
        true,
    ),
    ("a.mjs", r#"v(![] ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(!typeof free ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(!![] ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v((() => 1) && "k");"#, true, true),
    ("a.mjs", r#"v(/x/ && "k");"#, true, true),
    ("a.mjs", r#"v(![] || "k");"#, true, true),
    ("a.mjs", r#"v(!([], 0) && "k");"#, true, true),
    ("a.mjs", r#"let x = f(); v(void x || "k");"#, true, true),
    ("a.mjs", r#"let x = f(); v(void x ?? "k");"#, true, true),
    ("a.mjs", r#"v(([] ? 1 : 0) ? "x" : "y");"#, true, true),
    ("a.mjs", r#"v(([] ? 1 : 0) && "k");"#, true, true),
    ("a.mjs", r#"v(([], 1) ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(([] || 0) ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(([] && 0) ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(([] && "k") ? "a" : "b");"#, true, true),
    (
        "a.mjs",
        r#"let x = f(); v((x || []) ? "a" : "b");"#,
        true,
        true,
    ),
    (
        "a.mjs",
        r#"let x = f(); v((x && void 0) ? "a" : "b");"#,
        true,
        true,
    ),
    ("a.ts", r#"v(([] as unknown) ? "a" : "b");"#, true, true),
    ("a.mjs", r#"v(([], "m"));"#, false, true),
    ("a.mjs", r#"v([...[1]] ? "a" : "b");"#, false, true),
    ("a.mjs", r#"v([] ? 1 + 1 : 0);"#, false, true),
    (
        "a.mjs",
        r#"v(typeof "abc".length ? "a" : "b");"#,
        false,
        true,
    ),
    ("a.mjs", r#"v([f()] ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v([free] ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v([...[]] ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v({ a: f() } ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v({ ["k"]: 1 } ? "a" : "b");"#, false, false),
    (
        "a.mjs",
        r#"let x = f(); v({ ...x } ? "a" : "b");"#,
        false,
        false,
    ),
    ("a.mjs", r#"v(class {} ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v(typeof f() ? "a" : "b");"#, false, false),
    (
        "a.mjs",
        r#"let x = f(); v(typeof x.y ? "a" : "b");"#,
        false,
        false,
    ),
    ("a.mjs", r#"v(void f() ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v(![f()] ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v([] && "k");"#, false, false),
    ("a.mjs", r#"v({} && "k");"#, false, false),
    ("a.mjs", r#"v(typeof free && "k");"#, false, false),
    ("a.mjs", r#"v(void f() || "k");"#, false, false),
    ("a.mjs", r#"v(void f() ?? "k");"#, false, false),
    ("a.mjs", r#"v([] || "k");"#, false, false),
    ("a.mjs", r#"v(([] && 0) || "k");"#, false, false),
    ("a.mjs", r#"v((f(), 1) ? "a" : "b");"#, false, false),
    ("a.mjs", r#"v((f() || []) ? "a" : "b");"#, false, false),
    (
        "a.mjs",
        r#"v(((f(), 1) ? "x" : "y") ? "a" : "b");"#,
        false,
        false,
    ),
    (
        "a.mjs",
        r#"import { x } from "./b.mjs"; v(typeof x ? "a" : "b");"#,
        false,
        false,
    ),
    (
        "a.mjs",
        r#"import { x } from "./b.mjs"; v([x] ? "a" : "b");"#,
        false,
        false,
    ),
];

#[test]
fn bun_build_writes_nothing_for_what_nobody_takes() {
    for &(path, text, is_written, is_written_under_minify_syntax) in
        WRITTEN_WITHOUT_WHAT_NOBODY_TAKES
    {
        let rows = [
            (Fold::NONE, is_written),
            (Fold::MINIFIED, is_written_under_minify_syntax),
        ];
        for (fold, is_expected) in rows {
            folded(path, text, fold, |s| {
                let decisions = &s.analysis.decisions;
                let is_found = decisions.is_string_or_number_in_bun_run(&s.hir, probe(s));
                assert_eq!(is_found, is_expected, "{text}");
            });
        }
    }
}

const MADE_OF_WHAT_MINIFY_SYNTAX_COMPUTES: &[LiteralRow] = &[
    ("a.mjs", r#"v(`na${"me"}`);"#),
    ("a.mjs", "v(`n${null}`);"),
    ("a.mjs", r#"v(`n${`a${"b"}`}`);"#),
    ("a.mjs", r#"v(`a${"b"}` + "c");"#),
    ("a.mjs", r#"v("a" + "b" + "c");"#),
    ("a.mjs", "v(-(1 + 2));"),
    ("a.mjs", "v(typeof (1 + 2));"),
    ("a.mjs", r#"v(1 + 1 > 1 ? "a" : "b");"#),
    ("a.mjs", "v(`n${\"ab\".length}`);"),
    ("a.ts", r#"v(("a" + "b") satisfies string);"#),
    ("a.mjs", "const X = 1 + 2; v(X);"),
    ("a.mjs", r#"const X = `na${"me"}`; v(X);"#),
    ("a.mjs", r#"const X = "x"; function g() { v(X + ""); }"#),
];

const LEFT_ALONE_BY_BUN_RUN: &[LiteralRow] = &[
    ("a.mjs", r#"f(); const X = "a"; v(X);"#),
    ("a.mjs", r#"f(); const X = "a"; v(`n${X}`);"#),
    ("a.mjs", r#"f(); const X = "a"; v(X + "b");"#),
    ("a.mjs", r#"const X = "a" + "b"; v(X);"#),
];

#[test]
fn bun_run_computes_the_same_whatever_the_build_minifies() {
    let computed = COMPUTED_WITHOUT_MINIFY_SYNTAX
        .iter()
        .map(|row| (row.0, row.1));
    let replaced = REPLACED_READS.iter().map(|row| (row.0, row.1));
    let made = MADE_OF_WHAT_MINIFY_SYNTAX_COMPUTES.iter().copied();
    for (path, text) in computed.chain(replaced).chain(made) {
        for fold in [Fold::NONE, Fold::MINIFIED] {
            folded(path, text, fold, |s| {
                let e = probe(s);
                assert!(!matches!(constant(s, e), FoldedValue::Unknown), "{text}");
                assert!(
                    s.analysis
                        .decisions
                        .is_constant_under_minify_syntax(&s.hir, e),
                    "{text}"
                );
            });
        }
    }
    for &(path, text) in LEFT_ALONE_BY_BUN_RUN {
        for fold in [Fold::NONE, Fold::MINIFIED] {
            folded(path, text, fold, |s| {
                let e = probe(s);
                assert!(!matches!(constant(s, e), FoldedValue::Unknown), "{text}");
                assert!(
                    !s.analysis
                        .decisions
                        .is_constant_under_minify_syntax(&s.hir, e),
                    "{text}"
                );
            });
        }
    }
}

const NO_NUMBERS: &[(&str, bool, bool)] = &[
    ("v(0 / 0);", true, true),
    ("v(-(0 / 0));", true, true),
    ("v(-(2 ** (0 / 0)));", true, true),
    ("v(-(1 / 0 - 1 / 0));", true, true),
    ("v((0 / 0) as number);", true, true),
    ("v(-NaN);", true, true),
    ("v(-(NaN + 1));", false, true),
    ("v(Infinity - Infinity);", false, true),
    ("const zero = 0; v(-(zero / zero));", false, true),
    ("const none = NaN; v(-none + 1);", false, true),
    ("let zero = 0; v(zero / zero);", false, false),
    ("let none = NaN; v(-none);", false, false),
    (r#"v("a" * 1);"#, false, false),
    (r#"v(-("a" * 1));"#, false, false),
    ("v(undefined + 1);", false, false),
    ("v(-(undefined + 1));", false, false),
];

const CONSTANT_GLOBALS: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["undefined"]),
            Defined::Value(Data::Undefined),
        ),
        (Path::Global(&["NaN"]), Defined::Value(Number(f64::NAN))),
        (
            Path::Global(&["Infinity"]),
            Defined::Value(Number(f64::INFINITY)),
        ),
    ],
    ..Fold::NONE
};

#[test]
fn no_number_that_plain_bun_computes_is_a_constant() {
    let minified = Fold {
        minifies_syntax: true,
        ..CONSTANT_GLOBALS
    };
    for &(text, is_constant, is_constant_minified) in NO_NUMBERS {
        for (fold, expected) in [
            (CONSTANT_GLOBALS, is_constant),
            (minified, is_constant_minified),
        ] {
            folded("a.ts", text, fold, |s| {
                let is_no_number = match constant(s, probe(s)) {
                    FoldedValue::Constant(Constant::Number(number))
                    | FoldedValue::ConstantOutsideDeadZone(Constant::Number(number)) => {
                        number.is_nan()
                    }
                    _ => false,
                };
                assert_eq!(is_no_number, expected, "{text}");
            });
        }
    }
}

const TARGET: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["process", "platform"]),
            Defined::Value(Text("linux")),
        ),
        (
            Path::Global(&["process", "env", "NODE_ENV"]),
            Defined::Value(Text("development")),
        ),
    ],
    ..Fold::NONE
};

const MEMBERS_TAKEN_BY_PATTERNS: &[&str] = &[
    "const { platform } = process; v(platform);",
    "const { platform: name } = process; v(name);",
    "const { platform } = process; function f() { v(platform); }",
    "const { NODE_ENV } = process.env; v(NODE_ENV);",
    "const { env: { NODE_ENV } } = process; v(NODE_ENV);",
];

#[test]
fn member_taken_by_pattern_is_no_define() {
    for &text in MEMBERS_TAKEN_BY_PATTERNS {
        folded("a.cjs", text, TARGET, |s| {
            assert_folded(s, probe(s), Unknown, text)
        });
    }
}

#[test]
fn const_read_excludes_arm() {
    let text = "const X = 1; if (X) a(); else b();";
    analyzed("a.mjs", text, |s| {
        let [a] = calls_of(s, "a")[..] else {
            panic!("calls of a");
        };
        let [b] = calls_of(s, "b")[..] else {
            panic!("calls of b");
        };
        assert!(!s.analysis.decisions.is_dead_expr(a), "{text}");
        assert!(s.analysis.decisions.is_dead_expr(b), "{text}");
        assert!(
            !s.analysis.decisions.is_dead_expr(s.ident("X", 0)),
            "{text}"
        );
    });
}

#[test]
fn library_decides_file_scope_const_reads() {
    let alone = READS_DECIDED_IN_A_LIBRARY_ALONE.iter();
    let alone = alone.map(|&(text, value)| (text, Some(value), Pure(value)));
    let minified = READS_DECIDED_UNDER_MINIFY_SYNTAX_ALONE.iter();
    let minified = minified.map(|&(text, value)| (text, None, OutsideDeadZone(value)));
    let rows = LIBRARY_READS.iter().copied().chain(alone).chain(minified);
    for (text, decided, expected) in rows {
        library(text, |s| {
            let read = probe(s);
            let decision = match decided {
                Some(value) => Decision::of_data(s.workspace.data(&value)),
                None => Decision::Unknown,
            };
            assert_eq!(s.analysis.decisions.decision(read), decision, "{text}");
            assert_folded(s, read, expected, text);
        });
    }
}

#[test]
fn program_file_decides_the_const_reads_that_bun_run_replaces() {
    let alone = READS_DECIDED_IN_A_LIBRARY_ALONE.iter();
    let alone = alone.map(|&(text, value)| (text, None, OutsideDeadZone(value)));
    let minified = READS_DECIDED_UNDER_MINIFY_SYNTAX_ALONE.iter();
    let minified = minified.map(|&(text, value)| (text, Some(value), Pure(value)));
    let rows = LIBRARY_READS.iter().copied().chain(alone).chain(minified);
    for (text, decided, expected) in rows {
        folded("a.mjs", text, Fold::MINIFIED, |s| {
            let read = probe(s);
            let decision = match decided {
                Some(value) => Decision::of_data(s.workspace.data(&value)),
                None => Decision::Unknown,
            };
            assert_eq!(s.analysis.decisions.decision(read), decision, "{text}");
            assert_folded(s, read, expected, text);
        });
    }
}

#[test]
fn library_const_read_is_data() {
    let text = "f(); const X = 1; v([X]);";
    library(text, |s| {
        assert!(s.analysis.decisions.is_data_literal(probe(s)), "{text}")
    });
    analyzed("a.mjs", text, |s| {
        assert!(!s.analysis.decisions.is_data_literal(probe(s)), "{text}");
    });
}

#[test]
fn specifier_patterns() {
    check_specifiers(SPECIFIERS);
}

#[test]
fn path_join_keeps_last_segment() {
    check_specifiers(PATH_JOINS);
}

#[test]
fn path_joined_to_own_directory_is_a_path_from_the_folder_of_the_file() {
    check_specifiers(PATHS_FROM_OWN_DIRECTORY);
}

const PATHS_MADE_BY_CALLS: &[(&str, &str, bool)] = &[
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "a.js"));"#,
        true,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.resolve(__dirname, "a.js"));"#,
        true,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "..", "a.js"));"#,
        true,
    ),
    (
        "a.cjs",
        r#"const { join } = require("node:path"); require(join(__dirname, "a.js"));"#,
        true,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); const file = path.join(__dirname, "a.js"); require(file);"#,
        true,
    ),
    (
        "a.mjs",
        r#"import path from "node:path"; import(path.join(import.meta.dir, "a.js"));"#,
        true,
    ),
    (
        "a.mjs",
        r#"import("data:text/javascript," + encodeURIComponent("export default 1;"));"#,
        true,
    ),
    (
        "a.mjs",
        r#"import("data:text/javascript;base64," + btoa("export default 1;"));"#,
        true,
    ),
    (
        "a.mjs",
        r#"import("data:text/javascript," + "export%20default%201;");"#,
        false,
    ),
    ("a.cjs", r#"require(__dirname + "/a.js");"#, false),
    ("a.cjs", r#"require(`${__dirname}/a.js`);"#, false),
    ("a.cjs", r#"require("./a" + ".js");"#, false),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname, "lib", name));"#,
        false,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); path.join(__dirname, "b.js"); require(__dirname + "/a.js");"#,
        false,
    ),
];

#[test]
fn constant_path_that_a_call_gave_is_marked() {
    for &(path, text, expected) in PATHS_MADE_BY_CALLS {
        analyzed(path, text, |s| {
            let node = last_site(s, text).specifier_node;
            assert_eq!(
                s.analysis.decisions.is_path_made_by_call(node),
                expected,
                "{text}"
            );
        });
    }
}

const NAMES_MADE_BY_CALLS: &[(&str, &str, Option<MadeByCall>)] = &[
    (
        "a.cjs",
        r#"const path = require("path"); require(path.resolve(name));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.resolve(name + ".cjs"));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"const path = require("node:path"); require(path.join(__dirname, name + ".cjs"));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"const { join } = require("node:path"); require(join(__dirname, folder, name));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(__dirname + "/lib", name));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(path.resolve(folder), name));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); const folder = path.resolve("lib"); require(`${folder}/${name}`);"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(process.cwd(), name));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.cjs",
        r#"require(process.cwd() + "/" + name);"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.mjs",
        r#"import { join } from "node:path"; import(join(import.meta.dirname, name + ".cjs"));"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.mjs",
        r#"import { dirname } from "node:path"; import { fileURLToPath } from "node:url"; import(dirname(fileURLToPath(import.meta.url)) + "/" + name);"#,
        Some(MadeByCall::WholePath),
    ),
    (
        "a.mjs",
        r#"import("kit-" + encodeURIComponent("a b") + name);"#,
        Some(MadeByCall::Part),
    ),
    ("a.cjs", r#"require("./" + name + ".cjs");"#, None),
    ("a.cjs", r#"require(__dirname + "/" + name);"#, None),
    ("a.cjs", r#"require(`${__dirname}/${name}.cjs`);"#, None),
    ("a.mjs", r#"import(import.meta.dir + "/" + name);"#, None),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(name, "a.cjs"));"#,
        None,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join("./", name));"#,
        None,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(name + path.resolve("a.cjs"));"#,
        None,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); require(`x${path.resolve(name)}`);"#,
        None,
    ),
    (
        "a.cjs",
        r#"const path = { join: (...parts) => parts.at(-1), resolve: part => part }; require(path.join(__dirname, name)); require(path.resolve(name));"#,
        None,
    ),
    (
        "a.cjs",
        r#"const path = require("path"); { const __dirname = ""; require(path.join(__dirname, name)); }"#,
        None,
    ),
    (
        "a.cjs",
        r#"const process = { cwd: () => "" }; require(process.cwd() + name);"#,
        None,
    ),
    (
        "a.mjs",
        r#"import { dirname } from "node:path"; import { fileURLToPath } from "node:url"; import(dirname(fileURLToPath(url)) + "/" + name);"#,
        None,
    ),
];

#[test]
fn name_that_begins_with_what_a_call_gave_is_marked() {
    for &(path, text, expected) in NAMES_MADE_BY_CALLS {
        analyzed(path, text, |s| {
            let node = last_site(s, text).specifier_node;
            assert_eq!(
                s.analysis.decisions.find_what_call_made(node),
                expected,
                "{text}"
            );
        });
    }
}

#[test]
fn modified_import_meta_member_is_not_own_directory() {
    check_specifiers(MODIFIED_IMPORT_META_PATHS);
    check_specifiers(READ_ONLY_IMPORT_META_PATHS);
}

#[test]
fn affix_over_limit_is_cut() {
    let text = r#"require(`1234${"5678"}${"9"}${x}`);"#;
    folded("a.cjs", text, SHORT_STRINGS, |s| {
        let site = last_site(s, text);
        let expected = to_import_specifier(&s.workspace, Specifier::Pattern("12345678", ""));
        assert_eq!(site.specifier, expected);
        assert_eq!(
            s.analysis.strings_over_limit.to_vec(),
            Vec::from_iter(site.kind.call())
        );
    });
    analyzed("a.cjs", text, |s| {
        let expected = to_import_specifier(&s.workspace, Specifier::Pattern("123456789", ""));
        assert_eq!(last_site(s, text).specifier, expected);
        assert!(s.analysis.strings_over_limit.is_empty());
    });
}

#[test]
fn data_literals() {
    for &(path, text, _) in DATA_LITERALS {
        analyzed(path, text, |s| {
            assert!(s.analysis.decisions.is_data_literal(probe(s)), "{text}");
        });
    }
    for &(path, text) in OTHER_LITERALS {
        analyzed(path, text, |s| {
            assert!(!s.analysis.decisions.is_data_literal(probe(s)), "{text}");
        });
    }
    for &(text, _) in DEAD_ZONE_LITERALS {
        analyzed("a.mjs", text, |s| {
            assert!(!s.analysis.decisions.is_data_literal(probe(s)), "{text}");
        });
    }
    folded("a.mjs", "v([undefined]);", UNDEFINED_DEFINE, |s| {
        assert!(s.analysis.decisions.is_data_literal(probe(s)));
    });
}

#[test]
fn type_test_around_literal_is_no_data() {
    analyzed("a.ts", "v([1] as number[]);", |s| {
        let cast = probe(s);
        let literal = s.hir.skip_type_assertions(cast);
        assert_ne!(cast, literal);
        assert!(!s.analysis.decisions.is_data_literal(cast));
        assert!(s.analysis.decisions.is_data_literal(literal));
    });
}

#[test]
fn other_part_costs_enclosing_literals_only() {
    analyzed("a.mjs", "v([[1], f(), { a: 2 }]);", |s| {
        let outer = probe(s);
        let ExprKind::Array(items) = s.hir[outer].kind else {
            panic!("{:?} is no array", s.hir[outer].kind);
        };
        let is_data: Vec<bool> = s
            .hir
            .ids(items)
            .map(|item| s.analysis.decisions.is_data_literal(item))
            .collect();
        assert_eq!(is_data, [true, false, true]);
        assert!(!s.analysis.decisions.is_data_literal(outer));
    });
}

#[test]
fn data_values() {
    for &(path, text, expected) in DATA_LITERALS {
        analyzed(path, text, |s| {
            assert_eq!(data_text(s, probe(s), text), expected, "{text}")
        });
    }
    for &(text, expected) in DEAD_ZONE_LITERALS.iter().chain(REPEATED_KEYS) {
        analyzed("a.mjs", text, |s| {
            assert_eq!(data_text(s, probe(s), text), expected, "{text}")
        });
    }
    for &(path, text) in OTHER_LITERALS {
        analyzed(path, text, |s| {
            assert_eq!(data_value(s, probe(s)), FoldedData::Unknown, "{text}");
        });
    }
    folded("a.mjs", "v([undefined]);", UNDEFINED_DEFINE, |s| {
        assert_eq!(data_text(s, probe(s), "[undefined]"), "[undefined]");
    });
    folded("a.mjs", "v([ALIAS]);", GLOBAL_PATH_DEFINE, |s| {
        assert_eq!(data_value(s, probe(s)), FoldedData::Unknown);
    });
    analyzed("a.ts", "v([1] as number[]);", |s| {
        assert_eq!(data_text(s, probe(s), "[1] as number[]"), "[1]");
    });
}

#[test]
fn macro_result_is_data_of_enclosing_argument() {
    let text = r#"import { m, n } from "./m" with { type: "macro" }; m([n(), 1]);"#;
    with_workspace(|w| {
        let source = Source::new("a.ts", text);
        let fold = w.fold_inputs(&Fold::NONE);
        let mut s = w.analyze(&source, &fold);
        let argument = only_argument(&s, "m");
        let [inner] = calls_of(&s, "n")[..] else {
            panic!("calls of n");
        };
        assert_eq!(data_value(&s, argument), FoldedData::Unknown);

        let result = w.host_data(&Data::Object(&[("k", Data::Null)]));
        let (bound, analysis) = w.analyze_tree(&mut s.hir, &source, &fold, &[(inner, result)]);
        (s.bound, s.analysis) = (bound, analysis);
        assert_eq!(data_text(&s, argument, text), r#"[{"k":null},1]"#);
        assert!(s.analysis.decisions.is_data_literal(argument));
    });
}

#[test]
fn deep_data_values() {
    with_workspace(|w| {
        let (mut hir, root) = nested_arrays(w, DEPTH);
        let found = data_value_of(&hir, &Decisions::default(), root, &w.atoms, w.arena);
        let FoldedData::Known(value) = found else {
            panic!("the nested arrays have no value");
        };
        assert_eq!(array_depth(value), DEPTH);

        let fold = w.fold_inputs(&Fold::NONE);
        let (bound, analysis) = w.analyze_tree(&mut hir, &Source::new("a.js", ""), &fold, &[]);
        if bound.ran_out_of_stack {
            return;
        }
        assert!(analysis.decisions.is_data_literal(root));
        let found = data_value_of(&hir, &analysis.decisions, root, &w.atoms, w.arena);
        let FoldedData::Known(value) = found else {
            panic!("the nested arrays have no value");
        };
        assert_eq!(array_depth(value), DEPTH);
    });
}
