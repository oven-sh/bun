mod support;
use support::*;

const TABLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../test/aot/fold/constant-expressions.txt"
));
const MIN_TABLE_ROWS: usize = 300;
const DEEP_TREE_SIZE: usize = 100_000;

const MACRO: &str = "import { m } from \"./m\" with { type: \"macro\" };\n";
const FEATURE_IMPORT: &str = "import { feature } from \"bun:bundle\";\n";
const UNDEFINED: Decision<'static> = Decision::Constant(Constant::Undefined);

const NODE_ENV: Fold<'static> = Fold {
    defines: &[(
        Path::Global(&["process", "env", "NODE_ENV"]),
        Defined::Value(Data::String("production")),
    )],
    ..Fold::NONE
};
const FILE_NAMES: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["__filename"]),
            Defined::Value(Data::String("defined")),
        ),
        (
            Path::Global(&["__dirname"]),
            Defined::Value(Data::String("defined")),
        ),
        (
            Path::Global(&["require"]),
            Defined::Value(Data::String("defined")),
        ),
        (
            Path::Global(&["module"]),
            Defined::Value(Data::String("defined")),
        ),
        (
            Path::Global(&["exports"]),
            Defined::Value(Data::String("defined")),
        ),
    ],
    ..Fold::NONE
};
const DROPS: Fold<'static> = Fold {
    dropped_calls: &[
        Path::Global(&["console"]),
        Path::Global(&["assert"]),
        Path::Global(&["tools", "trace"]),
    ],
    ..Fold::NONE
};
const FLAG: Fold<'static> = Fold {
    defines: &[(
        Path::Global(&["FLAG"]),
        Defined::Value(Data::Boolean(false)),
    )],
    ..Fold::NONE
};
const GLOBAL_PATH: Fold<'static> = Fold {
    defines: &[(Path::Global(&["ALIAS"]), Defined::GlobalPath(&["a", "b"]))],
    ..Fold::NONE
};
const CONFIG: Fold<'static> = Fold {
    defines: &[(
        Path::Global(&["CONFIG"]),
        Defined::Value(Data::Object(&[("a", Data::Array(&[Data::Number(1.0)]))])),
    )],
    ..Fold::NONE
};
const IMPORT_META: Fold<'static> = Fold {
    defines: &[(
        Path::ImportMeta(&["env", "MODE"]),
        Defined::Value(Data::String("test")),
    )],
    ..Fold::NONE
};
const NESTED_PATHS: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["process", "env"]),
            Defined::Value(Data::Object(&[])),
        ),
        (
            Path::Global(&["process", "env", "NODE_ENV"]),
            Defined::Value(Data::String("production")),
        ),
    ],
    ..Fold::NONE
};
const FEATURES: Fold<'static> = Fold {
    features: &["ON"],
    ..Fold::NONE
};

const MATCHED_DEFINES: &[(&str, &str)] = &[
    ("a.mjs", "process.env.NODE_ENV;"),
    ("a.mjs", r#"process["env"]["NODE_ENV"];"#),
    ("a.mjs", "process.env[`NODE_ENV`];"),
    ("a.mjs", "(process.env).NODE_ENV;"),
    ("a.ts", "declare const process: any; process.env.NODE_ENV;"),
    ("a.ts", "(process.env as any).NODE_ENV;"),
    ("a.ts", "process.env!.NODE_ENV;"),
    ("a.cjs", "function f() { eval(s); process.env.NODE_ENV; }"),
    ("a.mjs", "delete process.env.NODE_ENV;"),
];

const UNMATCHED_DEFINES: &[(&str, &str)] = &[
    ("a.ts", "(process.env.NODE_ENV as any) = 1;"),
    ("a.mjs", "function f(process) { process.env.NODE_ENV; }"),
    ("a.mjs", "const process = {}; process.env.NODE_ENV;"),
    ("a.cjs", "with (o) { process.env.NODE_ENV; }"),
    (
        "a.cjs",
        "with (o) { (function () { eval(s); process.env.NODE_ENV; }); }",
    ),
    ("a.mjs", "process?.env.NODE_ENV;"),
    ("a.mjs", "process.env?.NODE_ENV;"),
    ("a.mjs", "process.env.NODE_ENV = 1;"),
    ("a.mjs", "process.env.NODE_ENV += 1;"),
    ("a.mjs", "process.env.NODE_ENV++;"),
    ("a.mjs", "[process.env.NODE_ENV] = a;"),
    ("a.mjs", "for (process.env.NODE_ENV in o);"),
    ("a.mjs", "x.process.env.NODE_ENV;"),
    ("a.mjs", "process.env[k];"),
    ("a.mjs", "process.env.OTHER;"),
    ("a.mjs", "process.env.NODE_ENV.length;"),
];

const DROPPED_CALLS: &[(&str, &str)] = &[
    ("a.mjs", "console.log(f());"),
    ("a.mjs", "console.error.call(console, f());"),
    ("a.mjs", "console?.warn(f());"),
    ("a.mjs", r#"console["log"](f());"#),
    ("a.mjs", "assert(f());"),
    ("a.mjs", "assert.equal(f());"),
    ("a.mjs", "tools.trace(f());"),
    ("a.mjs", "tools.trace.deep(f());"),
    ("a.mjs", "tools.trace?.deep(f());"),
    ("a.ts", "(console as any).info(f());"),
    ("a.cjs", "function g() { eval(s); console.log(f()); }"),
];

const RETAINED_CALLS: &[(&str, &str)] = &[
    ("a.mjs", "tools.keep(f());"),
    ("a.mjs", "tools?.trace(f());"),
    ("a.mjs", "tools?.trace.deep(f());"),
    ("a.mjs", "function g(console) { console.log(f()); }"),
    ("a.mjs", "const console = x; console.log(f());"),
    ("a.mjs", "const alias = console; alias.log(f());"),
    ("a.mjs", "new console.Console(f());"),
    ("a.cjs", "with (o) { console.log(f()); }"),
];

type DeadCalls = (
    &'static str,
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
);

const DEAD_BRANCHES: &[DeadCalls] = &[
    ("a.mjs", "if (false) a(); else b();", &["a"], &["b"]),
    ("a.mjs", "if (1) a(); else b();", &["b"], &["a"]),
    ("a.mjs", "true ? a() : b();", &["b"], &["a"]),
    ("a.mjs", "false && a();", &["a"], &[]),
    ("a.mjs", "true || a();", &["a"], &[]),
    ("a.mjs", "0 ?? a();", &["a"], &[]),
    ("a.mjs", "null ?? a();", &[], &["a"]),
    ("a.mjs", "true && a();", &[], &["a"]),
    ("a.mjs", "if (x) a(); else b();", &[], &["a", "b"]),
];

const LOOPS_THAT_NEVER_RUN: &[DeadCalls] = &[
    ("a.mjs", "while (false) a();", &["a"], &[]),
    ("a.mjs", "while ((f(), 0)) a();", &["a"], &["f"]),
    ("a.mjs", "for (b(); false; c()) a();", &["a", "c"], &["b"]),
    ("a.mjs", "for (; true; c()) a();", &[], &["a", "c"]),
    ("a.mjs", "for (;;) a();", &[], &["a"]),
    ("a.mjs", "do a(); while (false);", &[], &["a"]),
    ("a.mjs", "while (x) a();", &[], &["a"]),
];

const SWITCH_CLAUSES: &[DeadCalls] = &[
    (
        "a.mjs",
        "switch (1) { case 0: a(); break; case 1: b(); break; default: c(); }",
        &["a", "c"],
        &["b"],
    ),
    (
        "a.mjs",
        "switch (1) { case 0: a(); case 1: b(); case 2: c(); break; case 3: d(); }",
        &["a", "d"],
        &["b", "c"],
    ),
    (
        "a.mjs",
        "switch (2) { case 0: a(); break; default: b(); break; case 1: c(); }",
        &["a", "c"],
        &["b"],
    ),
    (
        "a.mjs",
        "switch (2) { case 0: a(); default: b(); case 1: c(); }",
        &["a"],
        &["b", "c"],
    ),
    (
        "a.mjs",
        "switch (1) { case x: a(); break; case 1: b(); break; case y: c(); break; default: d(); }",
        &["c", "d"],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "switch (1) { case 0: a(); break; case x: b(); break; default: c(); }",
        &["a"],
        &["b", "c"],
    ),
    (
        "a.mjs",
        r#"switch ("1") { case 1: a(); break; case "1": b(); }"#,
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        "const K = 1; switch (K) { case 0: a(); break; case 1: b(); }",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        "switch (1) { case 0: function g() { a(); } case 1: g(); }",
        &[],
        &["a", "g"],
    ),
    (
        "a.mjs",
        "switch (x) { case 0: a(); break; default: b(); }",
        &[],
        &["a", "b"],
    ),
];

const CONDITIONS_OF_UNKNOWN_VALUES: &[DeadCalls] = &[
    ("a.mjs", "x && false && a();", &["a"], &[]),
    ("a.mjs", "x || true || a();", &["a"], &[]),
    ("a.mjs", "x && false ? a() : b();", &["a"], &["b"]),
    ("a.mjs", "if (x || 1) a(); else b();", &["b"], &["a"]),
    ("a.mjs", "if (!(x && 0)) a(); else b();", &["b"], &["a"]),
    ("a.mjs", "if ((f(), x && null)) a();", &["a"], &["f"]),
    ("a.mjs", "while (x && false) a();", &["a"], &[]),
    (
        "a.mjs",
        "function g() { if (x || 1) return; a(); }",
        &["a"],
        &[],
    ),
    ("a.mjs", "({ k: f() }) ? a() : b();", &["b"], &["f", "a"]),
    ("a.mjs", "[] || a();", &["a"], &[]),
    ("a.mjs", "(() => 1) ?? a();", &["a"], &[]),
    ("a.mjs", "/r/ && a();", &[], &["a"]),
    (
        "a.mjs",
        "const O = { k: 1 }; O ? a() : b();",
        &["b"],
        &["a"],
    ),
    (
        "a.mjs",
        "const O = true ? { k: 1 } : undefined; if (O) a(); else b();",
        &["b"],
        &["a"],
    ),
    ("a.ts", "if ({} as any) a(); else b();", &["b"], &["a"]),
    ("a.mjs", "x && true && a();", &[], &["a"]),
    ("a.mjs", "x || false || a();", &[], &["a"]),
    ("a.mjs", "(x ?? false) ? a() : b();", &[], &["a", "b"]),
    (
        "a.mjs",
        "let O = { k: 1 }; O = x; O ? a() : b();",
        &[],
        &["a", "b"],
    ),
];

const SHORT_CIRCUITED_CHAINS: &[&str] = &[
    "null?.a;",
    "null?.a.b;",
    "null?.[k].b;",
    "null?.a();",
    "null?.();",
    "null?.a?.b;",
    "(void 0)?.a.b;",
    "const N = null; N?.a.b;",
];

const EVALUATED_CHAINS: &[&str] = &["x?.a.b;", "0?.a;", "(null?.a).b;", "null.a;"];

const AFTER_EXITS: &[DeadCalls] = &[
    ("a.mjs", "function f() { return; a(); }", &["a"], &[]),
    (
        "a.mjs",
        "function f() { b(); throw 1; a(); }",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        "function f() { if (true) { return b(); } a(); }",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        "function f() { if (false) c(); else return b(); a(); }",
        &["a", "c"],
        &["b"],
    ),
    (
        "a.mjs",
        "function f() { if (x) return b(); else throw c(); a(); }",
        &["a"],
        &["b", "c"],
    ),
    (
        "a.mjs",
        "function f() { if (x) return; else if (y) return; else { return; } a(); }",
        &["a"],
        &[],
    ),
    (
        "a.mjs",
        "function f() { { { return; } b(); } a(); }",
        &["a", "b"],
        &[],
    ),
    ("a.mjs", "const f = () => { return; a(); };", &["a"], &[]),
    (
        "a.mjs",
        "for (;;) { if (true) break; a(); } b();",
        &["a"],
        &["b"],
    ),
    ("a.mjs", "for (;;) { continue; a(); }", &["a"], &[]),
    ("a.mjs", "l: { break l; a(); } b();", &["a"], &["b"]),
    (
        "a.mjs",
        "switch (x) { case 1: break; a(); case 2: b(); }",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        "function f() { return; var v = a(); let w = b(); class C { static s = c(); } }",
        &["a", "b", "c"],
        &[],
    ),
    (
        "a.mjs",
        "function f() { return g(); function g() { a(); } }",
        &[],
        &["a", "g"],
    ),
    (
        "a.cjs",
        "function f() { return g(); l: function g() { a(); } }",
        &[],
        &["a", "g"],
    ),
    (
        "a.mjs",
        "function f() { return; { function g() { a(); } } }",
        &["a"],
        &[],
    ),
    ("a.mjs", "function f() { if (x) return; a(); }", &[], &["a"]),
    (
        "a.mjs",
        "function f() { if (false) return; a(); }",
        &[],
        &["a"],
    ),
    (
        "a.mjs",
        "function f() { if (true) b(); a(); }",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "function f() { if (x) return; else b(); a(); }",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "function f() { while (x) { return; } a(); }",
        &[],
        &["a"],
    ),
    (
        "a.mjs",
        "function f() { try { return; } finally { b(); } a(); }",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "function f() { l: { if (x) break l; return; } a(); }",
        &[],
        &["a"],
    ),
    (
        "a.mjs",
        "function f() { switch (x) { default: return; } a(); }",
        &[],
        &["a"],
    ),
    ("a.mjs", "throw 1; a();", &[], &["a"]),
    ("a.cjs", "return; a();", &[], &["a"]),
];

const CONSTANT_TESTS: &[DeadCalls] = &[
    ("a.mjs", "const A = false; if (A) a();", &["a"], &[]),
    ("a.mjs", "if (B) a(); const B = false;", &[], &["a"]),
    ("a.mjs", "let C = false; if (C) a();", &["a"], &[]),
    ("a.mjs", "let C = false; C = x; if (C) a();", &[], &["a"]),
    ("a.mjs", "var C = false; if (C) a();", &["a"], &[]),
    ("a.mjs", "var C = false; C = x; if (C) a();", &[], &["a"]),
    ("a.mjs", "{ var C = false; } if (C) a();", &[], &["a"]),
    (
        "a.mjs",
        "var C = false; function f() { if (C) a(); } f();",
        &["a"],
        &[],
    ),
    (
        "a.mjs",
        "f(); var C = false; function f() { if (C) a(); }",
        &[],
        &["a"],
    ),
    (
        "a.mjs",
        "const E = false; E = true; if (E) a();",
        &["a"],
        &[],
    ),
    (
        "a.mjs",
        "const G = false; function g() { if (G) a(); }",
        &["a"],
        &[],
    ),
    (
        "a.mjs",
        "const { H } = { H: false }; if (H) a();",
        &[],
        &["a"],
    ),
    (
        "a.cjs",
        "const I = false; with (o) { if (I) a(); }",
        &[],
        &["a"],
    ),
    ("a.ts", "declare const F: false; if (F) a();", &[], &["a"]),
    (
        "a.ts",
        "namespace N { export const A = false; if (A) a(); }",
        &[],
        &["a"],
    ),
];

const EFFECTS: &[DeadCalls] = &[
    ("a.mjs", "if (void f()) a(); else b();", &["a"], &["f", "b"]),
    ("a.mjs", "if ((f(), false)) a();", &["a"], &["f"]),
];

const TYPEOF_REQUIRE: &[DeadCalls] = &[
    (
        "a.cjs",
        r#"if (typeof require === "function") a(); else b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.cjs",
        r#"function g(require) { if (typeof require === "function") a(); else b(); }"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"eval(s); typeof require === "function" ? a() : b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.cjs",
        r#"with (o) typeof require === "function" ? a() : b();"#,
        &[],
        &["a", "b"],
    ),
];

const LOADER_VALUES: &[DeadCalls] = &[
    (
        "a.js",
        r#"if (typeof module === "object") a(); else b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.js",
        r#"if (typeof exports === "object") a(); else b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.js",
        r#"typeof exports === "object" && typeof module !== "undefined" ? a() : b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.cjs",
        r#"typeof __filename === "string" ? a() : b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.mjs",
        r#"typeof __dirname === "string" ? a() : b(); export {};"#,
        &["b"],
        &["a"],
    ),
    (
        "a.js",
        r#"typeof this === "object" ? a() : b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.js",
        r#"(() => typeof this === "object" ? a() : b())();"#,
        &["b"],
        &["a"],
    ),
    ("a.cjs", "if (module) a(); else b();", &["b"], &["a"]),
    ("a.cjs", "if (!module) a(); else b();", &["a"], &["b"]),
    ("a.cjs", "exports || a();", &["a"], &[]),
    ("a.cjs", "exports ?? a();", &["a"], &[]),
    ("a.cjs", "module && a();", &[], &["a"]),
    ("a.cjs", "module == null ? a() : b();", &["a"], &["b"]),
    ("a.cjs", "exports !== void 0 ? a() : b();", &["b"], &["a"]),
    ("a.cjs", "this || a();", &["a"], &[]),
    ("a.ts", "f(module! ? a() : b());", &["b"], &["a"]),
];

const UNDECIDED_LOADER_VALUES: &[DeadCalls] = &[
    (
        "a.cjs",
        "exports !== undefined ? a() : b();",
        &[],
        &["a", "b"],
    ),
    (
        "a.js",
        r#"typeof module === "object" ? a() : b(); export {};"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.js",
        r#"typeof exports === "object" ? a() : b(); await 0;"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.js",
        r#"typeof this === "object" ? a() : b(); export {};"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.js",
        r#"typeof this === "object" ? a() : b(); import.meta;"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"function g() { typeof this === "object" ? a() : b(); }"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"class C { p = typeof this === "object" ? a() : b(); }"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.ts",
        r#"namespace N { typeof this === "object" ? a() : b(); }"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"module = 1; typeof module === "object" ? a() : b();"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"[exports] = x; typeof exports === "object" ? a() : b();"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"eval(s); typeof module === "object" ? a() : b();"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"arguments[2] = 1; typeof module === "object" ? a() : b();"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"with (o) typeof module === "object" ? a() : b();"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"function g(module) { typeof module === "object" ? a() : b(); }"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"var exports = x; typeof exports === "object" ? a() : b();"#,
        &[],
        &["a", "b"],
    ),
    ("a.cjs", "module.exports ? a() : b();", &[], &["a", "b"]),
];

const RUNTIME_VALUES: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["Holder"]),
            Defined::RuntimeValue(RuntimeValueKind::Function),
        ),
        (
            Path::Global(&["Holder", "method"]),
            Defined::RuntimeValue(RuntimeValueKind::Function),
        ),
        (
            Path::Global(&["Holder", "key"]),
            Defined::RuntimeValue(RuntimeValueKind::Symbol),
        ),
        (
            Path::Global(&["Space"]),
            Defined::RuntimeValue(RuntimeValueKind::Object),
        ),
    ],
    ..Fold::NONE
};

const TESTS_OF_RUNTIME_VALUES: &[DeadCalls] = &[
    (
        "a.mjs",
        "if (!Holder.method) a(); else b();",
        &["a"],
        &["b"],
    ),
    ("a.mjs", "if (Holder.method) a(); else b();", &["b"], &["a"]),
    (
        "a.mjs",
        r#"if (!Holder["method"]) a(); else b();"#,
        &["a"],
        &["b"],
    ),
    (
        "a.ts",
        "if (!(Holder as any).method) a(); else b();",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        r#"if (typeof Holder.method !== "function") a(); else b();"#,
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        r#"typeof Space === "object" ? a() : b();"#,
        &["b"],
        &["a"],
    ),
    (
        "a.mjs",
        r#"typeof Holder === "function" && typeof Holder.key === "symbol" ? a() : b();"#,
        &["b"],
        &["a"],
    ),
    ("a.mjs", "const m = Holder.method || a();", &["a"], &[]),
    ("a.mjs", "const m = Holder.method ?? a();", &["a"], &[]),
    ("a.mjs", "const m = Holder.method && a();", &[], &["a"]),
    (
        "a.mjs",
        "Holder.method = Holder.method || a();",
        &["a"],
        &[],
    ),
    (
        "a.mjs",
        "if (Holder.method == null) a(); else b();",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        "if (void 0 !== Holder.method) a(); else b();",
        &["b"],
        &["a"],
    ),
    (
        "a.mjs",
        "const m = Holder.method; if (!m) a(); else b();",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        "if (!Holder?.method) a(); else b();",
        &["a"],
        &["b"],
    ),
    (
        "a.mjs",
        r#"if ("method" in Holder) a(); else b();"#,
        &["b"],
        &["a"],
    ),
];

const UNDECIDED_TESTS_OF_RUNTIME_VALUES: &[DeadCalls] = &[
    (
        "a.mjs",
        "if (!Holder.other) a(); else b();",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "if (!Holder.method.length) a(); else b();",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        r#"if ("other" in Holder) a(); else b();"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        r#"if ("method" in mine.Holder) a(); else b();"#,
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "if (!mine.Holder.method) a(); else b();",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "if (Holder.method == 0) a(); else b();",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "if (Holder.method === Holder.method) a(); else b();",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "function f(Holder) { if (!Holder.method) a(); else b(); }",
        &[],
        &["a", "b"],
    ),
    (
        "a.mjs",
        "let Holder = g(); if (!Holder.method) a(); else b();",
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        "with (o) { if (!Holder.method) a(); else b(); }",
        &[],
        &["a", "b"],
    ),
    (
        "a.cjs",
        "function f() { eval(s); if (!Holder.method) a(); else b(); }",
        &[],
        &["a", "b"],
    ),
];

const UNMATCHED_IMPORT_META_MAIN: &[&str] = &[
    "import.meta?.main;",
    "import.meta.main = 1;",
    "import.meta.other;",
];

const FEATURE_TESTS: &[(&str, bool, &[&str], &[&str])] = &[
    (r#"if (feature("ON")) a(); else b();"#, true, &["b"], &["a"]),
    (r#"feature("OFF") ? a() : b();"#, false, &["a"], &["b"]),
    (
        r#"if (feature("ON"!)) a(); else b();"#,
        true,
        &["b"],
        &["a"],
    ),
    (
        r#"if ({ k: feature("ON") }) a(); else b();"#,
        true,
        &["b"],
        &["a"],
    ),
    (
        r#"if ({ [feature("ON")]: null }) a(); else b();"#,
        true,
        &["b"],
        &["a"],
    ),
    (
        r#"if (x ? feature("ON") : null) a(); else b();"#,
        true,
        &[],
        &["a", "b"],
    ),
    (
        r#"if ((() => feature("ON"))()) a(); else b();"#,
        true,
        &[],
        &["a", "b"],
    ),
    (
        r#"(() => { const v = feature("ON"); return v; })() ? a() : b();"#,
        true,
        &[],
        &["a", "b"],
    ),
    (
        r#"(() => { return feature("ON"); })() ? a() : b();"#,
        true,
        &[],
        &["a", "b"],
    ),
];

const RENAMED_FEATURE_IMPORTS: &[&str] = &[
    "import { feature as flag } from \"bun:bundle\";\n",
    concat!(
        "import type { Registry } from \"bun:bundle\";\n",
        "import { type feature, feature as flag, type Registry as Renamed } from \"bun:bundle\";\n"
    ),
    concat!(
        "declare module \"m\" { import { feature, Registry } from \"bun:bundle\"; }\n",
        "import { feature as flag } from \"bun:bundle\";\n"
    ),
];

const UNRESOLVED_FEATURE_CALLS: &[&str] = &[
    concat!(
        "import { feature } from \"bun:bundle\";\n",
        r#"function g(feature) { if (feature("ON")) a(); else b(); }"#
    ),
    r#"if (feature("ON")) a(); else b();"#,
    concat!(
        "import { feature } from \"./mine\";\n",
        r#"if (feature("ON")) a(); else b();"#
    ),
];

#[derive(Copy, Clone)]
enum ErrorNode {
    Call,
    Argument,
}

const FEATURE_ERRORS: &[(&str, FoldErrorKind, ErrorNode)] = &[
    (
        "if (feature()) a();",
        FoldErrorKind::FeatureArgumentCount,
        ErrorNode::Call,
    ),
    (
        r#"if (feature("A", "B")) a();"#,
        FoldErrorKind::FeatureArgumentCount,
        ErrorNode::Call,
    ),
    (
        "if (feature(1)) a();",
        FoldErrorKind::FeatureArgumentNotString,
        ErrorNode::Argument,
    ),
    (
        "if (feature(name)) a();",
        FoldErrorKind::FeatureArgumentNotString,
        ErrorNode::Argument,
    ),
    (
        "if (feature(1!)) a();",
        FoldErrorKind::FeatureArgumentNotString,
        ErrorNode::Argument,
    ),
    (
        r#"if (feature("é")) a();"#,
        FoldErrorKind::FeatureFlagNotAscii,
        ErrorNode::Argument,
    ),
    (
        r#"const v = feature("ON");"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"while (feature("ON")) {}"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"g(feature("ON"));"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"g({ k: feature("ON") });"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"if (x) (() => feature("ON"))();"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"x ? 0 : feature("ON");"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"x ? feature("ON") : 0;"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"if (x) feature("ON");"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
    (
        r#"(() => feature("ON"))();"#,
        FoldErrorKind::FeatureOutsideCondition,
        ErrorNode::Call,
    ),
];

const NO_FEATURE_ERROR: &[&str] = &[
    "if (false) { const v = feature(1, 2); }",
    r#"if (g({ k: feature("ON"), [h(feature("ON"))]: 1, [h(feature("ON"))]() {} })) a();"#,
    r#"if (g(class extends h(feature("ON")) { [h(feature("ON"))]() {} })) a();"#,
    r#"if (((p = feature("ON")) => feature("ON"))()) a();"#,
    r#"if ((() => { const v = feature("ON"); return v; })()) a();"#,
    r#"if (g(class { k = feature("ON"); })) a();"#,
    r#"if ((({ p = feature("ON"), [h(feature("ON"))]: q }, [r = feature("ON")]) => p)(o, l)) a();"#,
    r#"if ((() => { const { p = feature("ON") } = o; return p; })()) a();"#,
    r#"if ((() => { switch (x) { case feature("ON"): } })()) a();"#,
    r#"if ((() => { if (x) return feature("ON"); return x ? 0 : feature("ON"); })()) a();"#,
    r#"if ((() => { enum E { A = +feature("ON") } return E.A; })()) a();"#,
    r#"if (g(@h(feature("ON")) class {})) a();"#,
    r#"if (g(class { @h(feature("ON")) k() {} })) a();"#,
    r#"if (g(class { k(@h(feature("ON")) p) {} })) a();"#,
];

const MACRO_CALL: &str = r#"const r = m(1 + 2, "a" + "b", [1, { k: null }], x);"#;

const UNKNOWN_MACRO_ARGUMENTS: &[&str] = &[
    "m([f()]);",
    "m({ ...o });",
    "m([...a]);",
    "m({ [k]: 1 });",
    "m({ get k() { return 1; } });",
    "m([1, , 2]);",
    "m((f(), 1));",
    "m(void f());",
    "m({ __proto__: null });",
];

const MACRO_OBJECTS: &[(&str, &str)] = &[
    ("m({ a: 1, b: 2, a: 3 });", r#"{"a":3,"b":2}"#),
    (r#"m({ ["__proto__"]: 1 });"#, r#"{"__proto__":1}"#),
    (
        "const A = 1; function g() { return A; } m({ a: A });",
        r#"{"a":1}"#,
    ),
];

const NOT_PENDING_MACROS: &[&str] = &[
    concat!(
        "import { m } from \"./m\" with { type: \"macro\" };\n",
        "if (false) m();"
    ),
    r#"import { m } from "./m"; m();"#,
];

struct Row {
    line: usize,
    kind: &'static str,
    value: &'static str,
    expression: &'static str,
}

fn table_text(bytes: &'static [u8]) -> &'static str {
    std::str::from_utf8(bytes).unwrap()
}

fn table_rows() -> Vec<Row> {
    let mut rows = Vec::new();
    for (index, line) in bun_core::strings::split(TABLE.as_bytes(), b"\n").enumerate() {
        if line.is_empty() || line.starts_with(b"#") {
            continue;
        }
        let mut columns = bun_core::strings::split(line, b"\t");
        let (Some(kind), Some(value), Some(expression), None) = (
            columns.next(),
            columns.next(),
            columns.next(),
            columns.next(),
        ) else {
            panic!("line {} does not have three columns", index + 1);
        };
        rows.push(Row {
            line: index + 1,
            kind: table_text(kind),
            value: table_text(value),
            expression: table_text(expression),
        });
    }
    rows
}

fn is_number(found: FoldedValue, value: &str) -> bool {
    let FoldedValue::Constant(Constant::Number(number)) = found else {
        return false;
    };
    let expected = value.parse::<f64>().unwrap();
    number.to_bits() == expected.to_bits() || (number.is_nan() && expected.is_nan())
}

fn is_row_value(s: &Analyzed<'_>, row: &Row, found: FoldedValue) -> bool {
    match row.kind {
        "unknown" => found == FoldedValue::Unknown,
        "undefined" => found == FoldedValue::Constant(Constant::Undefined),
        "null" => found == FoldedValue::Constant(Constant::Null),
        "boolean" => found == FoldedValue::Constant(Constant::Boolean(row.value == "true")),
        "number" => is_number(found, row.value),
        "string" => matches!(found, FoldedValue::Constant(Constant::String(text))
            if s.workspace.text(text) == row.value),
        "bigint" => matches!(found, FoldedValue::Constant(Constant::BigInt(digits))
            if s.workspace.text(digits) == row.value),
        kind => panic!("line {}: kind {kind}", row.line),
    }
}

fn folded(path: &str, text: &str, fold: Fold<'_>, test: impl for<'s> FnOnce(&Analyzed<'s>) + Send) {
    with_workspace(|w| {
        let inputs = w.fold_inputs(&fold);
        test(&w.analyze(&Source::new(path, text), &inputs));
    });
}

fn decision<'s>(s: &Analyzed<'s>, e: ExprId) -> Decision<'s> {
    s.analysis.decisions.decision(e)
}

fn constant(s: &Analyzed<'_>, e: ExprId) -> FoldedValue {
    s.analysis.decisions.constant(&s.hir, e)
}

fn data_value<'s>(s: &Analyzed<'s>, e: ExprId) -> FoldedData<'s> {
    let w = &s.workspace;
    data_value_of(&s.hir, &s.analysis.decisions, e, &w.atoms, w.arena)
}

fn string<'s>(s: &Analyzed<'s>, text: &str) -> Decision<'s> {
    Decision::Constant(Constant::String(s.workspace.atom(text)))
}

fn boolean(b: bool) -> Decision<'static> {
    Decision::Constant(Constant::Boolean(b))
}

#[track_caller]
fn last_expr(s: &Analyzed<'_>, test: impl Fn(&ExprKind) -> bool) -> ExprId {
    let found = find_exprs(&s.hir, test);
    *found.last().expect("the expression is in the file")
}

#[track_caller]
fn last_member(s: &Analyzed<'_>) -> ExprId {
    last_expr(s, |kind| {
        matches!(kind, ExprKind::Dot { .. } | ExprKind::Index { .. })
    })
}

#[track_caller]
fn last_call(s: &Analyzed<'_>) -> ExprId {
    last_expr(s, |kind| matches!(kind, ExprKind::Call(_)))
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
fn call_of(s: &Analyzed<'_>, name: &str) -> ExprId {
    let calls = calls_of(s, name);
    let [call] = calls[..] else {
        panic!("calls of {name}: {calls:?}");
    };
    call
}

fn statements_of_expr(s: &Analyzed<'_>, e: ExprId) -> Vec<StmtId> {
    find_stmts(
        &s.hir,
        |kind| matches!(*kind, StmtKind::Expr(expr) if expr == e),
    )
}

#[track_caller]
fn statement_of(s: &Analyzed<'_>, name: &str) -> StmtId {
    let statements = statements_of_expr(s, call_of(s, name));
    let [statement] = statements[..] else {
        panic!("statements of {name}: {statements:?}");
    };
    statement
}

fn kinds(s: &Analyzed<'_>) -> Vec<FoldErrorKind> {
    s.analysis.errors.iter().map(|error| error.kind).collect()
}

#[track_caller]
fn arguments(s: &Analyzed<'_>, call: ExprId) -> Vec<ExprId> {
    match s.hir[call].kind {
        ExprKind::Call(call) => s.hir.ids(s.hir[call].args).collect(),
        ExprKind::ImportCall { args } => s.hir.ids(args).collect(),
        kind => panic!("{kind:?} has no arguments"),
    }
}

#[track_caller]
fn only_argument(s: &Analyzed<'_>, call: ExprId) -> ExprId {
    let found = arguments(s, call);
    let [argument] = found[..] else {
        panic!("arguments: {found:?}");
    };
    argument
}

#[track_caller]
fn member_object(s: &Analyzed<'_>, member: ExprId) -> ExprId {
    let ExprKind::Dot { obj, .. } = s.hir[member].kind else {
        panic!("{:?} is not a Dot", s.hir[member].kind);
    };
    obj
}

#[track_caller]
fn data_text(s: &Analyzed<'_>, found: Decision<'_>) -> String {
    let Decision::Data(value) = found else {
        panic!("{found:?} is not data");
    };
    s.workspace.describe_data(value)
}

#[track_caller]
fn argument_text(s: &Analyzed<'_>, argument: ExprId) -> String {
    assert_eq!(decision(s, argument), Decision::Unknown, "{argument:?}");
    match data_value(s, argument) {
        FoldedData::Known(value) => s.workspace.describe_data(&value),
        FoldedData::Unknown => panic!("{argument:?} has no value"),
    }
}

#[track_caller]
fn is_dead(s: &Analyzed<'_>, name: &str) -> bool {
    let decisions = &s.analysis.decisions;
    let call = call_of(s, name);
    let is_call_dead = decisions.is_dead_expr(call);
    for statement in statements_of_expr(s, call) {
        assert_eq!(decisions.is_dead_stmt(statement), is_call_dead, "{name}");
    }
    is_call_dead
}

#[track_caller]
fn assert_dead_calls(s: &Analyzed<'_>, text: &str, dead: &[&str], alive: &[&str]) {
    for name in dead {
        assert!(is_dead(s, name), "{name} is alive: {text}");
    }
    for name in alive {
        assert!(!is_dead(s, name), "{name} is dead: {text}");
    }
}

fn assert_nothing_dead(s: &Analyzed<'_>, text: &str) {
    for e in find_exprs(&s.hir, |_| true) {
        assert!(!s.analysis.decisions.is_dead_expr(e), "{e:?}: {text}");
    }
    for statement in find_stmts(&s.hir, |_| true) {
        let is_statement_dead = s.analysis.decisions.is_dead_stmt(statement);
        assert!(!is_statement_dead, "{statement:?}: {text}");
    }
}

fn branch_operands(hir: &File<'_>) -> Vec<ExprId> {
    let exprs = hir.exprs.iter().filter_map(|expr| match expr.kind {
        ExprKind::Cond { test, .. } => Some(test),
        ExprKind::Binary { left, .. } => Some(left),
        _ => None,
    });
    let stmts = hir.stmts.iter().filter_map(|stmt| match stmt.kind {
        StmtKind::If { test, .. } => Some(test),
        _ => None,
    });
    exprs.chain(stmts).collect()
}

fn check_dead_calls(rows: &[DeadCalls]) {
    for &(path, text, dead, alive) in rows {
        analyzed(path, text, |s| assert_dead_calls(s, text, dead, alive));
    }
}

#[track_caller]
fn method(s: &Analyzed<'_>, name: &str) -> FnId {
    let atom = s.workspace.atom(name);
    let found = s
        .hir
        .members
        .iter()
        .find(|member| matches!(member.key, PropKey::Name(key) if key == atom));
    match found {
        Some(member) => member.func,
        None => panic!("no method {name}"),
    }
}

#[track_caller]
fn check_import_meta_main(text: &str, main: Option<bool>, expected: Decision<'static>) {
    with_workspace(|w| {
        let source = Source {
            import_meta_main: main,
            ..Source::new("a.mjs", text)
        };
        let s = w.analyze(&source, &w.fold_inputs(&Fold::NONE));
        assert_eq!(decision(&s, last_member(&s)), expected, "{text}: {main:?}");
    });
}

fn doubled_strings_text(doubling_count: usize) -> String {
    let mut text = [MACRO, "const s0 = \"xxxxxxxxxxxxxxxx\";\n"].concat();
    for index in 1..=doubling_count {
        let previous = index - 1;
        text.push_str(&format!("const s{index} = s{previous} + s{previous};\n"));
    }
    text.push_str(&format!("m(s{doubling_count});\n"));
    text
}

#[test]
fn constant_expressions() {
    let rows = table_rows();
    assert!(rows.len() > MIN_TABLE_ROWS, "{} rows", rows.len());
    let mut text = MACRO.to_owned();
    for row in &rows {
        text.push_str("m(");
        text.push_str(row.expression);
        text.push_str(");\n");
    }
    analyzed("a.mjs", &text, |s| {
        let calls = calls_of(s, "m");
        assert_eq!(calls.len(), rows.len());
        assert_eq!(s.analysis.pending_macro_calls, calls);
        let mut wrong = Vec::new();
        for (row, &call) in rows.iter().zip(&calls) {
            let argument = only_argument(s, call);
            let found = constant(s, argument);
            assert_eq!(
                decision(s, argument),
                Decision::Unknown,
                "{}",
                row.expression
            );
            if !is_row_value(s, row, found) {
                wrong.push(format!("{}: {}: {found:?}", row.line, row.expression));
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    });
}

#[test]
fn defines_match_free_paths() {
    for &(path, text) in MATCHED_DEFINES {
        folded(path, text, NODE_ENV, |s| {
            let expected = string(s, "production");
            assert_eq!(decision(s, last_member(s)), expected, "{path}: {text}");
        });
    }
    for &(path, text) in UNMATCHED_DEFINES {
        folded(path, text, NODE_ENV, |s| {
            let found = decision(s, last_member(s));
            assert_eq!(found, Decision::Unknown, "{path}: {text}");
        });
    }
}

#[test]
fn defines_replace_names_no_file_declares() {
    for name in ["__filename", "__dirname", "require"] {
        let text = format!("{name};");
        folded("a.ts", &text, FILE_NAMES, |s| {
            let expected = string(s, "defined");
            assert_eq!(decision(s, s.ident(name, 0)), expected, "{name}");
        });
    }
    for name in ["module", "exports"] {
        let text = format!("{name};");
        folded("a.cjs", &text, FILE_NAMES, |s| {
            assert_eq!(decision(s, s.ident(name, 0)), Decision::Unknown, "{name}");
        });
    }
}

#[test]
fn define_marks_operands_dead() {
    folded("a.mjs", "process.env.NODE_ENV;", NODE_ENV, |s| {
        let decisions = &s.analysis.decisions;
        let decided = last_member(s);
        assert!(!decisions.is_dead_expr(decided));
        assert!(decisions.is_dead_expr(member_object(s, decided)));
        assert!(decisions.is_dead_expr(s.ident("process", 0)));
    });
}

#[test]
fn define_under_longer_access() {
    folded("a.mjs", "process.env.NODE_ENV.length;", NODE_ENV, |s| {
        let inner = member_object(s, last_member(s));
        assert_eq!(decision(s, inner), string(s, "production"));
    });
}

#[test]
fn kinds_of_define_values() {
    folded("a.mjs", "FLAG;", FLAG, |s| {
        assert_eq!(decision(s, s.ident("FLAG", 0)), boolean(false));
    });
    folded("a.mjs", "({ FLAG });", FLAG, |s| {
        assert_eq!(decision(s, s.ident("FLAG", 0)), boolean(false));
    });
    for text in ["delete FLAG;", "FLAG = 1;"] {
        folded("a.cjs", text, FLAG, |s| {
            assert_eq!(decision(s, s.ident("FLAG", 0)), Decision::Unknown, "{text}");
        });
    }
    for text in ["ALIAS;", "ALIAS = 1;", "ALIAS++;", "[ALIAS] = a;"] {
        folded("a.mjs", text, GLOBAL_PATH, |s| {
            let found = decision(s, s.ident("ALIAS", 0));
            let Decision::GlobalPath(names) = found else {
                panic!("{text}: {found:?}");
            };
            assert_eq!(
                names,
                [s.workspace.atom("a"), s.workspace.atom("b")],
                "{text}"
            );
        });
    }
    folded("a.mjs", "CONFIG.a;", CONFIG, |s| {
        let found = decision(s, s.ident("CONFIG", 0));
        assert_eq!(data_text(s, found), r#"{"a":[1]}"#);
        assert_eq!(decision(s, last_member(s)), Decision::Unknown);
    });
    folded("a.mjs", "import.meta.env.MODE;", IMPORT_META, |s| {
        assert_eq!(decision(s, last_member(s)), string(s, "test"));
    });
}

#[test]
fn longest_path_wins() {
    folded("a.mjs", "process.env.NODE_ENV;", NESTED_PATHS, |s| {
        assert_eq!(decision(s, last_member(s)), string(s, "production"));
    });
    folded("a.mjs", "process.env.OTHER;", NESTED_PATHS, |s| {
        let outer = last_member(s);
        assert_eq!(decision(s, outer), Decision::Unknown);
        let inner = decision(s, member_object(s, outer));
        assert_eq!(data_text(s, inner), "{}");
    });
}

#[test]
fn values_flow() {
    let node_env = r#"if (process.env.NODE_ENV === "production") a(); else b();"#;
    let flag = r#"if (typeof FLAG === "boolean") a(); else b();"#;
    for (text, fold) in [(node_env, NODE_ENV), (flag, FLAG)] {
        folded("a.mjs", text, fold, |s| {
            let decisions = &s.analysis.decisions;
            assert!(decisions.is_dead_stmt(statement_of(s, "b")), "{text}");
            assert!(!decisions.is_dead_stmt(statement_of(s, "a")), "{text}");
        });
    }
}

#[test]
fn dropped_calls() {
    for &(path, text) in DROPPED_CALLS {
        folded(path, text, DROPS, |s| {
            assert_eq!(decision(s, last_call(s)), UNDEFINED, "{path}: {text}");
            assert!(is_dead(s, "f"), "{path}: {text}");
        });
    }
    for &(path, text) in RETAINED_CALLS {
        folded(path, text, DROPS, |s| {
            let found = decision(s, last_call(s));
            assert_eq!(found, Decision::Unknown, "{path}: {text}");
            assert!(!is_dead(s, "f"), "{path}: {text}");
        });
    }
}

#[test]
fn dropped_path_outside_call() {
    let text = "typeof console.log;";
    folded("a.mjs", text, DROPS, |s| {
        for e in find_exprs(&s.hir, |_| true) {
            assert_eq!(decision(s, e), Decision::Unknown, "{e:?}");
        }
        assert_nothing_dead(s, text);
    });
}

#[test]
fn code_after_statement_that_always_leaves_its_list() {
    check_dead_calls(AFTER_EXITS);
}

#[test]
fn loops_that_never_run() {
    check_dead_calls(LOOPS_THAT_NEVER_RUN);
}

#[test]
fn switch_clauses_that_are_never_entered() {
    check_dead_calls(SWITCH_CLAUSES);
}

#[test]
fn conditions_of_unknown_values() {
    check_dead_calls(CONDITIONS_OF_UNKNOWN_VALUES);
}

#[track_caller]
fn last_statement_expression(s: &Analyzed<'_>) -> ExprId {
    let statements = find_stmts(&s.hir, |kind| matches!(kind, StmtKind::Expr(_)));
    match statements.last().map(|&statement| s.hir[statement].kind) {
        Some(StmtKind::Expr(e)) => e,
        found => panic!("{found:?} is not an expression statement"),
    }
}

#[test]
fn optional_chains_on_null_and_undefined() {
    for text in SHORT_CIRCUITED_CHAINS {
        analyzed("a.mjs", text, |s| {
            let chain = last_statement_expression(s);
            assert!(
                s.analysis.decisions.is_short_circuited_link(chain),
                "{text}"
            );
            let found = constant(s, chain);
            let is_undefined = found == FoldedValue::Constant(Constant::Undefined)
                || found == FoldedValue::ConstantOutsideDeadZone(Constant::Undefined);
            assert!(is_undefined, "{text}: {found:?}");
            assert_nothing_dead(s, text);
        });
    }
    for text in EVALUATED_CHAINS {
        analyzed("a.mjs", text, |s| {
            let chain = last_statement_expression(s);
            assert!(
                !s.analysis.decisions.is_short_circuited_link(chain),
                "{text}"
            );
            assert_eq!(constant(s, chain), FoldedValue::Unknown, "{text}");
        });
    }
}

#[test]
fn dead_code() {
    check_dead_calls(DEAD_BRANCHES);
    for &(path, text, _, _) in DEAD_BRANCHES {
        analyzed(path, text, |s| {
            for operand in branch_operands(&s.hir) {
                let is_operand_dead = s.analysis.decisions.is_dead_expr(operand);
                assert!(!is_operand_dead, "{operand:?}: {text}");
            }
        });
    }
}

#[test]
fn everything_below_is_marked() {
    let text = "if (false) { function g() { h(); } class K { m() { i(); } } var v; } v;";
    analyzed("a.mjs", text, |s| {
        let decisions = &s.analysis.decisions;
        let branches = find_stmts(&s.hir, |kind| matches!(kind, StmtKind::If { .. }));
        let StmtKind::If { yes, .. } = s.hir[branches[0]].kind else {
            panic!("{branches:?}");
        };
        assert!(decisions.is_dead_stmt(yes));
        assert!(decisions.is_dead_function(s.function("g")));
        assert!(decisions.is_dead_function(method(s, "m")));
        assert_dead_calls(s, text, &["h", "i"], &[]);
        assert!(matches!(s.binding("v", 0), Binding::Symbol(_)));
    });
}

#[test]
fn constants() {
    check_dead_calls(CONSTANT_TESTS);
    analyzed("a.mjs", "const A = false; if (A) a();", |s| {
        let read = s.ident("A", 0);
        let expected = FoldedValue::ConstantOutsideDeadZone(Constant::Boolean(false));
        assert_eq!(decision(s, read), Decision::Unknown);
        assert_eq!(constant(s, read), expected);
        assert!(!s.analysis.decisions.is_dead_expr(read));
    });
}

#[test]
fn effects_stay() {
    check_dead_calls(EFFECTS);
}

#[test]
fn typeof_require() {
    check_dead_calls(TYPEOF_REQUIRE);
}

#[test]
fn tests_of_loader_values() {
    check_dead_calls(LOADER_VALUES);
    check_dead_calls(UNDECIDED_LOADER_VALUES);
    analyzed("a.js", "typeof module; !exports; module;", |s| {
        let type_test = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Unary { .. }));
        let object = Constant::String(s.workspace.atom("object"));
        assert_eq!(constant(s, type_test[0]), FoldedValue::Constant(object));
        assert_eq!(
            constant(s, type_test[1]),
            FoldedValue::Constant(Constant::Boolean(false))
        );
        assert_eq!(s.analysis.module_format, ModuleFormat::CommonJs);
        for name in find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Ident(_))) {
            assert!(!s.analysis.decisions.is_dead_expr(name));
            assert!(s.analysis.decisions.is_truthy_without_effects(name));
            assert_eq!(constant(s, name), FoldedValue::Unknown);
        }
    });
}

#[test]
fn tests_of_runtime_values() {
    for rows in [TESTS_OF_RUNTIME_VALUES, UNDECIDED_TESTS_OF_RUNTIME_VALUES] {
        for &(path, text, dead, alive) in rows {
            folded(path, text, RUNTIME_VALUES, |s| {
                assert_dead_calls(s, text, dead, alive)
            });
        }
    }
    folded(
        "a.mjs",
        "typeof Holder.method; Holder.method;",
        RUNTIME_VALUES,
        |s| {
            let type_test = last_expr(s, |kind| matches!(kind, ExprKind::Unary { .. }));
            let function = Constant::String(s.workspace.atom("function"));
            assert_eq!(constant(s, type_test), FoldedValue::Constant(function));
            assert_eq!(decision(s, last_member(s)), Decision::Unknown);
            assert_eq!(constant(s, last_member(s)), FoldedValue::Unknown);
        },
    );
}

#[test]
fn import_meta_main() {
    let text = "import.meta.main;";
    check_import_meta_main(text, Some(true), boolean(true));
    check_import_meta_main(text, Some(false), boolean(false));
    check_import_meta_main(text, None, Decision::Unknown);
    for text in UNMATCHED_IMPORT_META_MAIN {
        check_import_meta_main(text, Some(true), Decision::Unknown);
    }
}

#[test]
fn feature_calls() {
    for &(test, value, dead, alive) in FEATURE_TESTS {
        let text = [FEATURE_IMPORT, test].concat();
        folded("a.ts", &text, FEATURES, |s| {
            assert_eq!(decision(s, call_of(s, "feature")), boolean(value), "{test}");
            assert_dead_calls(s, test, dead, alive);
            assert!(kinds(s).is_empty(), "{test}");
        });
    }
    let both = r#"if (!feature("OFF") && feature("ON")) a(); else b();"#;
    folded("a.ts", &[FEATURE_IMPORT, both].concat(), FEATURES, |s| {
        assert_dead_calls(s, both, &["b"], &["a"]);
    });
    for &import in RENAMED_FEATURE_IMPORTS {
        let text = [import, r#"if (flag("ON")) a(); else b();"#].concat();
        folded("a.ts", &text, FEATURES, |s| {
            assert_dead_calls(s, &text, &["b"], &["a"]);
            assert!(kinds(s).is_empty(), "{text}");
        });
    }
}

#[test]
fn unresolved_feature_calls() {
    for &text in UNRESOLVED_FEATURE_CALLS {
        folded("a.ts", text, FEATURES, |s| {
            let found = decision(s, call_of(s, "feature"));
            assert_eq!(found, Decision::Unknown, "{text}");
            assert_nothing_dead(s, text);
            assert!(kinds(s).is_empty(), "{text}");
        });
    }
}

#[test]
fn feature_errors() {
    for &(test, kind, node) in FEATURE_ERRORS {
        let text = [FEATURE_IMPORT, test].concat();
        folded("a.ts", &text, FEATURES, |s| {
            let call = call_of(s, "feature");
            let expected = match node {
                ErrorNode::Call => call,
                ErrorNode::Argument => only_argument(s, call),
            };
            assert_eq!(kinds(s), [kind], "{test}");
            assert_eq!(
                s.analysis.errors[0].node,
                NodeData::Expr(expected),
                "{test}"
            );
            assert_eq!(decision(s, call), boolean(false), "{test}");
        });
    }
    let accented = Fold {
        features: &["é"],
        ..Fold::NONE
    };
    let text = [FEATURE_IMPORT, r#"if (feature("é")) a();"#].concat();
    folded("a.ts", &text, accented, |s| {
        assert_eq!(decision(s, call_of(s, "feature")), boolean(false));
    });
}

#[test]
fn feature_import_errors() {
    let twice = r#"import { feature, feature as again } from "bun:bundle";"#;
    folded("a.ts", twice, FEATURES, |s| {
        assert_eq!(kinds(s), [FoldErrorKind::FeatureImportedTwice]);
        let expected = NodeData::ImportSpec(ImportSpecId(1));
        assert_eq!(s.analysis.errors[0].node, expected);
    });
    let several = concat!(
        "import { feature, feature as again, nope } from \"bun:bundle\";\n",
        r#"if (feature("ON")) a(); else b();"#
    );
    folded("a.ts", several, FEATURES, |s| {
        let nope = FoldErrorKind::UnknownBundleExport(s.workspace.atom("nope"));
        assert_eq!(kinds(s), [FoldErrorKind::FeatureImportedTwice, nope]);
        let nodes = s.analysis.errors.iter().map(|error| error.node);
        let expected = [1, 2].map(|it| NodeData::ImportSpec(ImportSpecId(it)));
        assert!(nodes.eq(expected));
        assert_dead_calls(s, several, &["b"], &["a"]);
    });
    folded(
        "a.ts",
        r#"import { nope } from "bun:bundle";"#,
        FEATURES,
        |s| {
            let expected = FoldErrorKind::UnknownBundleExport(s.workspace.atom("nope"));
            assert_eq!(kinds(s), [expected]);
            let expected = NodeData::ImportSpec(ImportSpecId(0));
            assert_eq!(s.analysis.errors[0].node, expected);
        },
    );
}

#[test]
fn feature_without_errors() {
    for &test in NO_FEATURE_ERROR {
        folded("a.ts", &[FEATURE_IMPORT, test].concat(), FEATURES, |s| {
            assert!(kinds(s).is_empty(), "{test}");
        });
    }
}

#[test]
fn macro_calls() {
    analyzed("a.ts", &[MACRO, MACRO_CALL].concat(), |s| {
        let call = call_of(s, "m");
        assert_eq!(s.analysis.pending_macro_calls, [call]);
        let found = arguments(s, call);
        assert_eq!(argument_text(s, found[0]), "3");
        assert_eq!(argument_text(s, found[1]), r#""ab""#);
        assert_eq!(argument_text(s, found[2]), r#"[1,{"k":null}]"#);
        assert_eq!(decision(s, found[3]), Decision::Unknown);
        assert_eq!(data_value(s, found[3]), FoldedData::Unknown);
        assert_nothing_dead(s, MACRO_CALL);
    });
    for &(text, expected) in MACRO_OBJECTS {
        analyzed("a.ts", &[MACRO, text].concat(), |s| {
            let argument = only_argument(s, call_of(s, "m"));
            assert_eq!(argument_text(s, argument), expected, "{text}");
        });
    }
}

#[test]
fn macro_arguments_without_value() {
    for &argument in UNKNOWN_MACRO_ARGUMENTS {
        analyzed("a.ts", &[MACRO, argument].concat(), |s| {
            let found = only_argument(s, call_of(s, "m"));
            assert_eq!(decision(s, found), Decision::Unknown, "{argument}");
            assert_eq!(data_value(s, found), FoldedData::Unknown, "{argument}");
            assert_nothing_dead(s, argument);
        });
    }
}

#[test]
fn macro_results() {
    with_workspace(|w| {
        let text = [MACRO, MACRO_CALL].concat();
        let source = Source::new("a.ts", &text);
        let fold = w.fold_inputs(&Fold::NONE);
        let mut s = w.analyze(&source, &fold);
        let call = call_of(&s, "m");
        let call_arguments = arguments(&s, call);

        let object = w.host_data(&Data::Object(&[("n", Data::Number(1.0))]));
        let (_, analysis) = w.analyze_tree(&mut s.hir, &source, &fold, &[(call, object)]);
        assert!(analysis.pending_macro_calls.is_empty());
        assert_eq!(
            data_text(&s, analysis.decisions.decision(call)),
            r#"{"n":1}"#
        );
        for argument in call_arguments {
            assert!(analysis.decisions.is_dead_expr(argument), "{argument:?}");
        }

        let primitive = w.host_data(&Data::String("s"));
        let (_, analysis) = w.analyze_tree(&mut s.hir, &source, &fold, &[(call, primitive)]);
        let expected = Decision::Constant(Constant::String(w.atom("s")));
        assert_eq!(analysis.decisions.decision(call), expected);
    });
}

#[test]
fn macro_calls_not_pending() {
    for &text in NOT_PENDING_MACROS {
        analyzed("a.ts", text, |s| {
            assert!(s.analysis.pending_macro_calls.is_empty(), "{text}");
        });
    }
}

#[test]
fn folded_string_limit() {
    analyzed("a.mjs", &doubled_strings_text(12), |s| {
        let found = constant(s, only_argument(s, call_of(s, "m")));
        let FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) = found else {
            panic!("{found:?}");
        };
        assert_eq!(s.workspace.text(text).len(), 1 << 16);
        assert!(s.analysis.strings_over_limit.is_empty());
    });
    analyzed("a.mjs", &doubled_strings_text(13), |s| {
        let too_long = constant(s, only_argument(s, call_of(s, "m")));
        assert_eq!(too_long, FoldedValue::Unknown);
        let longest_sum = last_expr(s, |kind| matches!(kind, ExprKind::Binary { .. }));
        assert_eq!(s.analysis.strings_over_limit, [longest_sum]);
    });
}

#[test]
fn addition_chain_interns_result_only() {
    let text = [MACRO, r#"m("p" + "q" + 1 + "r");"#].concat();
    analyzed("a.mjs", &text, |s| {
        let found = constant(s, only_argument(s, call_of(s, "m")));
        let expected = Constant::String(s.workspace.atom("pq1r"));
        assert_eq!(found, FoldedValue::Constant(expected));
        for partial_sum in ["pq", "pq1"] {
            let interned = s.workspace.atoms.lookup(partial_sum.as_bytes());
            assert_eq!(interned, None, "{partial_sum}");
        }
    });
}

#[test]
fn deep_trees() {
    let sum = [MACRO, "m(1", &"+1".repeat(DEEP_TREE_SIZE), ");"].concat();
    analyzed("a.mjs", &sum, |s| {
        if s.hir.ran_out_of_stack || s.bound.ran_out_of_stack {
            return;
        }
        let expected = FoldedValue::Constant(Constant::Number(DEEP_TREE_SIZE as f64 + 1.0));
        assert_eq!(constant(s, only_argument(s, call_of(s, "m"))), expected);
    });
    let blocks = ["{".repeat(DEEP_TREE_SIZE), "}".repeat(DEEP_TREE_SIZE)].concat();
    analyzed("a.mjs", &blocks, |_| {});
}
