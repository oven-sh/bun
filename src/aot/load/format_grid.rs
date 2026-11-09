use std::borrow::Cow;

use bun_alloc::Arena as AstArena;
use bun_ast::{ASTMemoryAllocator, ExportsKind, Loader, Log, Source};
use bun_js_parser::{Define, Parser, ParserOptions};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::import_sites::JsxMode;
use bun_sema::module_format::{DeclaredModuleType, ModuleFormat};
use bun_sema::session::{Arena, Session};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::fold_inputs::create_application_fold_inputs;
use crate::builtins::Platforms;

const PATH: &[u8] = b"/project/a.ts";

fn is_commonjs_to_bun_run(text: &str, define: &Define) -> Option<bool> {
    let arena = AstArena::new();
    let mut store = ASTMemoryAllocator::borrowing(&arena);
    let _scope = store.enter();
    let mut options = ParserOptions::init(Default::default(), Loader::Ts);
    options.tree_shaking = true;
    options.warn_about_unbundled_modules = false;
    options.features.top_level_await = true;
    options.features.no_macros = true;
    options.features.inlining = true;
    options.features.minify_syntax = true;
    options.features.trim_unused_imports = true;
    options.features.commonjs_at_runtime = true;
    options.features.lower_using = false;
    options.features.ascii_only = true;
    let source = Source::init_path_string(PATH, text.as_bytes());
    let mut log = Log::init();
    let parser = Parser::init(options, &mut log, &source, define, &arena).ok()?;
    match parser.parse().ok()? {
        bun_js_parser::Result::Ast(ast) if !log.has_errors() => {
            Some(ast.exports_kind == ExportsKind::Cjs)
        }
        _ => None,
    }
}

fn is_commonjs_to_build<'s>(
    text: &str,
    fold: &FoldInputs<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> bool {
    let parse_options = CompileParseOptions {
        path: PATH,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        ignores_pure_comments: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, text.as_bytes(), atoms);
    hir.text = Cow::Owned(text.as_bytes().to_vec());
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let file = FileInputs {
        declared_module_type: DeclaredModuleType::Unknown,
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
        own_name: b"",
    };
    let analysis = analyze_file(&mut hir, bind_options, fold, file, atoms, arena).1;
    analysis.module_format == ModuleFormat::CommonJs
}

const OPERANDS: &[(&str, &str)] = &[
    ("", "null"),
    ("", "undefined"),
    ("", "true"),
    ("", "false"),
    ("", "0"),
    ("", "(-0)"),
    ("", "1"),
    ("", "1.5"),
    ("", "NaN"),
    ("", "Infinity"),
    ("", "\"\""),
    ("", "\"a\""),
    ("", "\"1\""),
    ("", "(\"1\" + \"2\")"),
    ("", "`a`"),
    ("", "`${1}`"),
    ("", "0n"),
    ("", "1n"),
    ("", "/a/"),
    ("", "[]"),
    ("", "[1]"),
    ("", "({})"),
    ("", "({ a: 1 })"),
    ("", "(function () {})"),
    ("", "(() => 1)"),
    ("", "(class {})"),
    ("", "new Object()"),
    ("", "new Set()"),
    ("", "Math"),
    ("", "Math.PI"),
    ("", "globalThis"),
    ("", "unknown"),
    ("", "typeof unknown"),
    ("", "void 0"),
    ("", "import.meta.url"),
    ("", "import.meta.hot"),
    ("", "import.meta.main"),
    ("", "process.env.NODE_ENV"),
    ("enum Level { Low = 1 } ", "Level.Low"),
    ("enum Word { One = \"one\" } ", "Word.One"),
    ("const LIMIT = 1; ", "LIMIT"),
    ("const NAME = \"a\"; ", "NAME"),
    ("import { feature } from \"bun:bundle\"; ", "feature(\"X\")"),
    ("", "[() => 1][0]"),
    ("", "[function () {}][0]"),
    ("", "({ b: function named() {} }).b"),
    ("", "[/a/][0]"),
    ("", "[class {}][0]"),
    ("", "[typeof unknown][0]"),
    ("", "[[]][0]"),
    ("", "[...[1, 0]][1]"),
];

const UNARY: &[&str] = &["!", "-", "+", "~", "typeof ", "void ", "!!"];

#[rustfmt::skip]
const BINARY: &[&str] = &[
    "==", "!=", "===", "!==", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>", "&&", "||", "??", ",", "in", "instanceof",
];

#[rustfmt::skip]
const EXPRESSIONS: &[&str] = &[
    "\"abc\".length", "\"abc\"?.length", "\"abc\"[0]", "\"abc\"?.[0]", "\"abc\"[\"length\"]", "\"abc\".at(0)", "\"abc\".charAt(0)", "\"abc\".charCodeAt(0)",
    "\"abc\".codePointAt(0)", "\"abc\".concat(\"d\")", "\"abc\".endsWith(\"c\")", "\"abc\".includes(\"b\")", "\"abc\".indexOf(\"b\")", "\"abc\".lastIndexOf(\"b\")",
    "\"abc\".localeCompare(\"b\")", "\"abc\".normalize()", "\"abc\".padEnd(4)", "\"abc\".padStart(4)", "\"abc\".repeat(2)", "\"abc\".replace(\"a\", \"b\")",
    "\"abc\".replaceAll(\"a\", \"b\")", "\"abc\".slice(1)", "\"abc\".split(\"b\")", "\"abc\".startsWith(\"a\")", "\"abc\".substring(1)", "\"abc\".substr(1)",
    "\"abc\".toLowerCase()", "\"abc\".toUpperCase()", "\"abc\".toString()", "\"abc\".trim()", "\"abc\".trimEnd()", "\"abc\".trimStart()", "\"abc\".valueOf()",
    "(1).toString()", "(1.5).toFixed(1)", "(1).valueOf()", "(255).toString(16)", "[1, 2].length", "[1, 2]?.length", "[1, 2][0]", "[1, 2].join()", "[1, 2].includes(1)",
    "[1, 2].indexOf(1)", "[1, 2].at(0)", "[1, 2].concat([3])", "[1, 2].slice(1)", "[].concat(1)", "({ a: 1 }).a", "({ a: 1 })?.a", "({ a: 1 })[\"a\"]", "({ a: 1 }).b",
    "Math.floor(1.5)", "Math.max(1, 2)", "Math.abs(-1)", "Number(\"1\")", "Number(1)", "String(1)", "String(\"a\")", "Boolean(0)", "Boolean(1)", "parseInt(\"1\")",
    "parseFloat(\"1.5\")", "isNaN(1)", "Number.isInteger(1)", "Object.keys({})", "Array.isArray([])", "JSON.stringify(1)", "Symbol.iterator", "BigInt(1)", "Symbol()",
    "Object(1)", "Array(1)", "new String(\"a\")", "new Number(1)", "new Boolean(false)", "typeof null", "typeof 1", "typeof \"a\"", "typeof (() => 1)", "typeof Math",
    "typeof require", "typeof module", "typeof exports", "typeof __filename", "typeof import.meta", "typeof process", "typeof Bun", "typeof window", "typeof document",
    "typeof globalThis", "process.platform", "process.arch", "process.browser", "process.versions.bun", "process.isBun", "Bun.version", "import.meta.env",
    "import.meta.dirname", "import.meta.path", "import.meta.require", "1 ? 2 : 0", "0 ? 2 : 0", "unknown ? 1 : 2", "unknown ? 0 : 0", "(unknown, 1)", "(1, unknown)",
    "[unknown]", "({ a: unknown })", "`${unknown}`", "`a${1}b`", "`${\"a\"}${\"b\"}`", "\"a\" + 1", "1 + \"a\"", "\"a\" + null", "\"a\" + undefined", "\"a\" + true",
    "\"a\" + 1n", "\"a\" + [] ", "\"\" + /a/", "\"a\" + {}", "1 + 1 + \"a\"", "\"a\" + 1 + 1", "\"a\" + \"b\" + \"c\"", "+\"1\"", "+(\"1\" + \"2\")", "-\"1\"", "~\"1\"",
    "+[]", "+{}", "+null", "+undefined", "+true", "+\"\"", "+\" 1 \"", "+\"0x10\"", "+\"1e3\"", "+1n", "new Object", "new Array", "new Set", "\"\" + \"a\".constructor",
    "\"\" + /a/.constructor", "\"a\".constructor + \"\"", "\"x\" + 1 + /a/", "1 + /a/", "1 + /a/ + \"x\"", "/a/ + /b/", "/a/g + \"x\"", "/a/ + \"x\" + /b/",
    "\"é\" + /a/", "\"\" + /é/", "\"abc\".charCodeAt(1)", "\"abc\".charCodeAt(3)", "\"abc\".charCodeAt(-1)", "\"abc\".charCodeAt(0.5)", "\"abc\".charCodeAt()",
    "\"abc\".charCodeAt(0, 1)", "\"abc\"?.charCodeAt(0)", "\"abc\".charCodeAt?.(0)", "\"abc\"[\"charCodeAt\"](0)", "(\"ab\" + \"c\").charCodeAt(0)",
    "(\"ab\" + \"c\").charCodeAt(2)", "\"\\0\".charCodeAt(0)", "\"é\".charCodeAt(0)", "\"aé\".charCodeAt(0)", "`abc`.charCodeAt(0)", "\"abc\".charCodeAt(\"0\")",
    "\"abc\".charCodeAt(-0)", "2 ** -1", "10 ** 30", "2 ** 0.5", "(-8) ** (1 / 3)", "1e-200 ** 2", "1e200 ** 2", "(-0) ** -1", "(-0) ** 3", "0 ** -1", "(-Infinity) ** 3",
    "(-Infinity) ** -3", "0.5 ** Infinity", "0.5 ** -Infinity", "2 ** -Infinity", "(-2) ** Infinity", "(-1) ** Infinity", "1 ** NaN", "NaN ** 0",
    "\"\" + typeof unknown + \"\"", "\"\" + `${unknown}`", "\"\" + (typeof unknown)", "\"\" + !unknown", "\"\" + String(unknown)", "\"a\" + typeof unknown",
    "import.meta.hot.data", "import.meta.hot.accept", "import.meta.hot?.accept", "import.meta?.hot", "import.meta[\"hot\"]", "typeof import.meta.hot",
    "import.meta.hot === undefined", "import.meta.hot == null", "import.meta.hot ?? 1", "import.meta.hot || 0", "import.meta.hot.decline", "import.meta.hot.dispose",
    "import.meta.hot.prune", "import.meta.hot.invalidate", "import.meta.hot.on", "import.meta.hot.off", "import.meta.hot.send", "import.meta.hot.accept()",
    "import.meta.hot.decline()", "import.meta.hot.dispose()", "import.meta.hot.prune()", "import.meta.hot.invalidate()", "import.meta.hot.on()", "import.meta.hot.off()",
    "import.meta.hot.send()", "import.meta.hot.accept(unknown)", "import.meta.hot.accept(() => {})", "import.meta.hot.data.x", "import.meta.hot.data === undefined",
    "typeof import.meta.hot.data", "typeof import.meta.hot.accept", "!import.meta.hot.accept", "import.meta.hot.accept ?? 1", "import.meta.hot.accept === undefined",
    "import.meta.hot.unknown", "import.meta.hot[\"accept\"]", "import.meta.hot[\"data\"]", "import.meta.hot?.accept()", "import.meta.hot.accept?.()",
    "import.meta.hot.on(\"x\", unknown)", "import.meta.hot[\"dispose\"]", "import.meta.hot[\"on\"]", "import.meta[\"hot\"]", "import.meta[\"hot\"].data",
    "import.meta[\"hot\"][\"data\"]", "import.meta.hot?.[\"data\"]", "import.meta.hot?.[\"accept\"]", "import.meta.hot[`data`]", "import.meta.hot[\"da\" + \"ta\"]",    "({ b: () => 1 }).b", "({ b: function () {} }).b", "({ b: class {} }).b", "({ b: class Named {} }).b", "({ b: /a/ }).b", "({ b: [] }).b", "({ b: {} }).b",
    "({ b: typeof unknown }).b", "({ b: new Object() }).b", "({ b: unknown }).b", "({ b: 1n }).b", "({ b: 0x1n }).b", "({ b: function named() {} })[\"b\"]",
    "({ \"b\": /a/ }).b", "({ b: async () => 1 }).b", "({ b: function* () {} }).b", "[class Named {}][0]", "[function named() {}][0]", "[new Object()][0]",
    "[void unknown][0]", "[!unknown][0]", "[unknown][0]", "[0x1n][0]", "[1n][0]", "[(0, () => 1)][0]", "[true ? () => 1 : 0][0]", "[null ?? (() => 1)][0]",
    "[0 || /a/][0]", "[unknown ? () => 1 : /a/][0]", "[`a${unknown}`][0]", "[[() => 1]][0][0]", "({ a: [() => 1] }).a[0]", "({ a: { b: function named() {} } }).a.b",
    "[{ b: /a/ }][0].b", "[[() => 1][0]][0]", "[[1]][0][0]", "({ a: { b: [/a/] } }).a.b[0]", "[[[]]][0][0]", "[{ b: {} }][0].b", "[1, () => 1][1]", "[() => 1, 1][0]",
    "[unknown, () => 1][1]", "[unknown(), () => 1][1]", "[1, class {}][0]", "[class {}, 0][1]", "[1 + 1, 0][1]", "[~1, 0][1]", "[typeof unknown, 0][1]", "[[1][0], 0][1]",
    "[/a/, 0][1]", "[() => 1, 0][1]", "[[], 0][1]", "[new Object(), 0][1]", "[module, 0][1]", "[() => 1]?.[0]", "({ b: /a/ })?.b", "[{ b: 0 }][0]?.b", "[[0]][0]?.[0]",
    "[{ b: function named() {} }][0]?.b", "({ a: { b: 0 } }).a?.b", "({ a: { b: 0 } })?.a.b", "[[() => 1]]?.[0][0]", "({ a: [0] })?.a[0]", "[,][0]", "[, 1][0]",
    "[, 1][1]", "[1, ,][1]", "({ k: 0 })[\"\" + \"k\"]", "({ \"a-b\": 0 })[\"a-\" + \"b\"]", "({ \"a-b\": 0 })[\"a-b\"]", "({ \"a-b\": () => 1 })[\"a-\" + \"b\"]",
    "({ \"a-b\": 0 })[[\"a-b\"][0]]", "[0][0 + 0]", "[0][[0][0]]", "[0][true ? 0 : 1]", "[1, 0][2 - 1]", "[0][-0]", "[0][\"0\"]", "({ 0: 1 })[0]", "({ b: 0 }).c",
    "[0][1]", "[0][0.5]", "({ \"é\": 0 }).é", "({ é: 0 })[\"é\"]", "({ é: 0 }).é", "({ \"é\": () => 1 }).é", "({ é: () => 1 }).é", "({ é: () => 1 })[\"é\"]",
    "[(unknown(), () => 1)][0]", "[unknown() || (() => 1)][0]", "[typeof unknown()][0]", "([(unknown(), () => 1)][0] && 1) === 1", "[unknown()][0]",
    "({ b: (unknown(), /a/) }).b", "[class { static a = unknown(); }][0]", "({ b() {} }).b", "({ b: unknown }).b()", "({ b: function named() {} }).b()",
    "({ b: () => 1, c: 1 }).b", "({ __proto__: () => 1 }).__proto__", "({ [\"b\"]: () => 1 }).b", "({ get b() { return 0; } }).b", "[...unknown][0]", "[...[() => 1]][0]",
    "[...[1], 0][1]", "[...[], () => 1][0]", "({ ...unknown }).b", "[() => 1][0]()", "[() => 1][0]`a`", "delete [() => 1][0]", "delete ({ b: () => 1 }).b", "[0][0]++",
    "([0][0] = 1)", "typeof [() => 1][0] === \"function\"", "typeof [function () {}][0] === \"function\"", "typeof ({ b: function named() {} }).b === \"function\"",
    "typeof [/a/][0] === \"object\"", "typeof [[]][0] === \"object\"", "typeof [class {}][0] === \"function\"", "typeof [0x1n][0] === \"bigint\"",
    "\"\" + [/a/][0] === \"b\"", "\"\" + [/a/][0]", "\"\" + [/a/][0].constructor", "\"\" + [\"a\"][0].constructor", "[0x1n][0] === 0x1n", "[0x1n][0] === 1n",
    "([function () {}][0] && 1) === 1", "([[]][0] && 1) === 1", "([0x0n || \"x\"][0] && 1) === 1", "[() => 1][0] && [/a/][0]", "(1, [() => 1][0])", "([() => 1][0], 1)",
    "[function () {}][0] == null", "[function () {}][0] === null", "({ b: function named() {} }).b !== undefined", "[function () {}][0].name",
    "[function () {}][0] instanceof Function", "\"\" + [typeof unknown][0]", "[typeof unknown][0] == 1", "[[]][0] ?? 1", "[() => 1][0] ?? 0", "[,][0] ?? 1",
    "[null][0] ?? 1", "[void 0][0] ?? 0", "(true ? [0] : 1)[0]", "(0, [0])[0]", "(null ?? [0])[0]", "(0 || { b: 0 }).b", "(1 && [0])[0]", "(true ? [() => 1] : 0)[0]",
    "(0, [() => 1])[0]", "(unknown(), [0])[0]", "(unknown ? [0] : [0])[0]", "new Array(1, 0)[1]", "new Object({ b: 0 }).b", "new Object([0])[0]",
    "new Array(1, () => 1)[1]", "typeof (true ? function () {} : 0) === \"function\"", "typeof (0, function () {}) === \"function\"",
    "typeof (0 || function () {}) === \"function\"", "typeof (null ?? /a/) === \"object\"", "typeof (1 && function () {}) === \"function\"",
    "typeof (function () {} || 0) === \"function\"", "typeof (function () {} ?? 0) === \"function\"", "\"\" + (true ? /a/ : 0) === \"b\"", "\"\" + (0, /a/) === \"b\"",
    "\"\" + (0 || /a/) === \"b\"", "\"\" + (null ?? /a/) === \"b\"", "\"\" + (1 && /a/) === \"b\"", "((true ? () => 1 : 0) && 1) === 1", "((0, () => 1) && 1) === 1",
    "((0 || (() => 1)) && 1) === 1", "((1 && (() => 1)) && 1) === 1", "((null ?? (() => 1)) && 1) === 1", "(((() => 1) || 0) && 1) === 1", "(true ? () => 1 : 0) ?? 0",
    "(true ? [] : 0) ?? 0", "(true ? class {} : 0) ?? 0", "(new Object() ?? 1) ?? 0", "(0, () => 1) ?? 0", "(0 || (() => 1)) ?? 0", "(1 && (() => 1)) ?? 0",
    "(null ?? (() => 1)) ?? 0", "((() => 1) || 1) ?? 0", "((() => 1) ?? 1) ?? 0", "([] ?? 1) ?? 0", "(/a/ || 1) ?? 0", "!(true ? () => 1 : 0)",
    "(unknown(), 1) ? () => 1 : 0", "typeof ((unknown(), 1) ? () => 1 : 0) === \"function\"", "new Object([{}][0])", "new Object((0, {}))", "new Array([[]][0])",
    "new Array([typeof unknown][0])", "new Object(true ? {} : 0)", "new Array((0, typeof unknown))", "new Array(true ? typeof unknown : 0)",
];

#[rustfmt::skip]
const CONSTRUCTORS: &[&str] = &[
    "WeakSet", "WeakMap", "Date", "Set", "Map", "Headers", "Response", "TextEncoder", "TextDecoder", "Error", "TypeError", "AggregateError", "Array", "Object",
    "Function", "RegExp", "Promise", "Unknown",
];

#[rustfmt::skip]
const ARGUMENTS: &[&str] = &[
    "", "null", "undefined", "void 0", "[]", "[1]", "[[1, 2]]", "[{}]", "{}", "{ a: 1 }", "0", "1", "\"a\"", "true", "1n", "unknown", "typeof unknown", "!unknown",
    "`a${unknown}`", "-unknown", "1, 2", "1, ...unknown", "...unknown", "null, 1",
];

#[rustfmt::skip]
const EVIDENCE: &[&str] = &[
    "exports.a = 1;", "module;", "exports;", "typeof module;", "typeof exports;", "require(\"./x\");", "require;", "typeof require;", "require.main;",
    "require.resolve(\"./x\");", "require.cache;", "__filename;", "__dirname;", "console.log(__filename);", "console.log(module);", "console.log(exports);",
    "console.log(require);", "console.log(this);", "this.a = 1;", "return;", "import.meta.url;", "console.log(import.meta.url);", "console.log(import.meta);", "await 0;",
    "import(\"./x\");", "module.exports;", "module.id;", "delete module.exports;", "module = 1;", "exports = 1;", "require = 1;", "var module;", "var exports = 1;",
    "let a = module;", "function module() {}", "arguments;", "console.log(arguments);", "eval(\"module\");", "with (unknown) module;", "new.target;",
];

#[rustfmt::skip]
const PLACES: &[(&str, &str)] = &[
    ("", ""), ("if (false) { ", " }"), ("if (true) {} else { ", " }"), ("if (0 + 0) { ", " }"), ("if (unknown) { ", " }"), ("false && (() => { ", " })();"),
    ("function unused() { ", " }"), ("(() => { ", " });"), ("unknown(() => { ", " });"), ("while (false) { ", " }"), ("for (;;) { break; ", " }"),
    ("try {} catch { ", " }"), ("label: { break label; ", " }"), ("switch (1) { case 2: ", " }"), ("class Unused { m() { ", " } }"), ("class Unused { static { ", " } }"),
    ("export {}; ", ""), ("import \"./y\"; ", ""), ("import.meta.url; ", ""), ("console.log(import.meta.url); ", ""), ("\"use strict\"; ", ""), ("await 0; ", ""),
    ("export default 1; if (false) { ", " }"),
];

#[rustfmt::skip]
const CONDITIONS: &[&str] = &[
    "if (false) module.exports = 1;", "if (0 + 0) module.exports = 1;", "const OFF = false; if (OFF) module.exports = 1;",
    "const OFF = false; unknown(); if (OFF) module.exports = 1;", "let OFF = false; if (OFF) module.exports = 1;", "var OFF = false; if (OFF) module.exports = 1;",
    "const OFF = 0 + 0; if (OFF) module.exports = 1;", "const A = 1, OFF = false; if (OFF) module.exports = 1;",
    "const OFF = false; const ON = !OFF; if (ON) {} else module.exports = 1;", "enum Level { Low = 0 } if (Level.Low) module.exports = 1;",
    "const enum Level { Low = 0 } if (Level.Low) module.exports = 1;", "if (\"abc\".charCodeAt(0)) {} else module.exports = 1;",
    "if (new Object()) {} else module.exports = 1;", "if (import.meta.hot) module.exports = 1;", "if (typeof unknown) {} else module.exports = 1;",
    "if (void unknown) module.exports = 1;", "if (1.5 ** 1.5) {} else module.exports = 1;", "if (\"\" + /a/) {} else module.exports = 1;",
    "false && (module.exports = 1);", "true || (module.exports = 1);", "null ?? 1 ?? (module.exports = 1);", "false ? (module.exports = 1) : 0;", "Math, module;",
    "new Set([module]);", "{ const unused = 1; typeof module; }", "typeof module;", "return; module.exports = 1;", "throw 1; module.exports = 1;",
    "if (true) return; module.exports = 1;", "if (unknown) return; else return; module.exports = 1;", "for (;;) {} module.exports = 1;",
    "while (true) {} module.exports = 1;", "do { break; } while (module);", "switch (1) { case 1: break; default: module.exports = 1; }",
    "switch (1) { case 2: module.exports = 1; }", "try { throw 1; module.exports = 1; } catch {}",
];

#[rustfmt::skip]
const BODIES: &[(&str, &str)] = &[
    ("function used() { ", " } used();"), ("function unused() { ", " }"), ("unknown(() => { ", " });"), ("unknown(function () { ", " });"),
    ("unknown(async () => { ", " });"), ("unknown(function* () { ", " });"), ("class Used { m() { ", " } } unknown(Used);"), ("class Used { static { ", " } }"),
    ("class Used { constructor() { ", " } } new Used();"), ("unknown({ m() { ", " } });"), ("unknown({ get a() { ", " } });"), ("{ ", " }"), ("if (unknown) { ", " }"),
    ("for (const a of unknown) { ", " }"), ("while (unknown) { ", " }"), ("try { ", " } catch {}"), ("try {} finally { ", " }"), ("label: { ", " }"),
    ("switch (unknown) { case 1: { ", " } }"), ("namespace N { ", " }"), ("function outer() { function inner() { ", " } inner(); } outer();"),
    ("function outer() { { ", " } } outer();"),
];

#[rustfmt::skip]
const STATEMENTS: &[&str] = &[
    "(module);", "module, 1;", "1, module;", "Math, module;", "unknown, module;", "import.meta.url, module;", "import.meta, module;", "[module];", "[1, module];",
    "({ a: module });", "({ module });", "({ [module]: 1 });", "void module;", "!module;", "!!module;", "-module;", "+module;", "~module;", "module + 1;",
    "module === 1;", "module == 1;", "module !== module;", "module < 1;", "module in {};", "module instanceof Object;", "`${module}`;", "`a`, module;", "module?.x;",
    "module.x;", "module[\"x\"];", "module?.[\"x\"];", "delete module.x;", "1 ? module : 0;", "0 ? module : 0;", "unknown ? module : 0;", "module ? 1 : 2;",
    "module && 1;", "module || 1;", "module ?? 1;", "true || module;", "false && module;", "null ?? module;", "1 ?? module;", "true && module;", "false || module;",
    "unknown && module;", "{ module; }", "{ const unused = 1; typeof module; }", "{ let unused = 1; typeof module; }", "{ const unused = module; }",
    "{ let unused = module; }", "{ var unused = module; }", "var unused = module;", "let unused = module;", "const unused = module;",
    "function unused() { return module; }", "(function () { module; });", "(() => module);", "(class { m() { module; } });", "(class { static a = module; });",
    "(class { a = module; });", "(class { [module]() {} });", "(class extends module {});", "label: module;", "if (module) {}", "if (module) {} else {}", "if (module);",
    "if (typeof module) {}", "if (unknown) module;", "if (unknown) {} else module;", "if (true) {} else module;", "if (false) module;", "if (false) { module; } else {}",
    "while (false) module;", "for (; false; ) module;", "for (; false; module) {}", "for (module; false; ) {}", "do {} while (false && module);",
    "for (const a of []) module;", "for (const a in {}) module;", "switch (1) { case module: }", "switch (module) {}", "try {} finally { module; }",
    "try { module; } catch {}", "function f() { return; module; }", "function f() { throw 1; module; }", "function f() { if (true) return; module; }",
    "new Set([module]);", "new Set(module);", "new Map([[1, module]]);", "new WeakSet([module]);", "new WeakMap([[module, 1]]);", "new Object(module);",
    "new Array(module);", "new Date(module);", "new Error(module);", "new RegExp(module);", "new String(module);", "new Number(module);", "new Boolean(module);",
    "new Promise(module);", "new Unknown(module);", "Object(module);", "Boolean(module);", "String(module);", "Number(module);", "Symbol(module);", "Array(module);",
    "BigInt(module);", "Array.isArray(module);", "Object.keys(module);", "Object.is(module, 1);", "Math.abs(module);", "JSON.stringify(module);", "isNaN(module);",
    "unknown(module);", "/* @__PURE__ */ unknown(module);", "/* @__PURE__ */ new Unknown(module);", "(() => {})(module);", "(function () {})(module);",
    "module satisfies unknown;", "module as unknown;", "module!;", "<unknown>module;", "enum Unused { A = module as any }", "namespace Unused { module; }",
    "namespace Unused { export const a = module; }", "declare const unused: typeof module;", "type Unused = typeof module;", "let unused: typeof module;",
    "function unused(a = module) {}", "function unused({ a = module }) {}", "const { a = module } = {};", "const [a = module] = [];", "let a; a = module;",
    "let a; a ||= module;", "let a; [a = module] = [];", "this;", "typeof this;", "Math.PI, module;", "Math.floor, module;", "Math.unknown, module;",
    "Object.keys, module;", "JSON.parse, module;", "JSON, module;", "Object, module;", "globalThis, module;", "process, module;", "Bun, module;", "console, module;",
    "console.log, module;", "undefined, module;", "NaN, module;", "Symbol.iterator, module;", "Math[\"PI\"], module;", "Math?.PI, module;",
    "const Math = 1; Math, module;", "function f(Math) { Math, module; }", "import.meta.dirname, module;", "import.meta.unknown, module;",
    "import.meta.url.length, module;", "import.meta?.url, module;", "import.meta[\"url\"], module;", "import.meta.hot, module;", "import.meta.main, module;",
    "import.meta.env.X, module;", "{ const unused = 1; module; }", "{ const unused = \"a\"; typeof module; }", "{ const unused = 1, other = 2; typeof module; }",
    "{ const unused = 1; const other = unused; typeof module; }", "{ const unused = 1; unused; typeof module; }", "{ const unused = 1; (() => unused); typeof module; }",
    "{ const unused = unknown; typeof module; }", "{ const unused = 1n; typeof module; }", "{ const unused = \"a\" + \"b\"; typeof module; }",
    "{ const unused = [1]; typeof module; }", "{ const { unused } = {}; typeof module; }", "{ typeof module; const unused = 1; }",
    "{ let first = 1; const unused = 1; typeof module; }", "{ var unused = 1; typeof module; }", "{ { const unused = 1; } typeof module; }",
    "if (unknown) { const unused = 1; typeof module; }", "if (true) { const unused = 1; typeof module; }", "{ const unused = 1; eval(\"unused\"); typeof module; }",
    "{ using unused = null; typeof module; }", "{ const unused = void 0; typeof module; }", "{ const unused = null; typeof module; }",
    "{ const unused = -1; typeof module; }", "{ const unused = !0; typeof module; }", "{ const unused = 1 + 1; typeof module; }",
    "{ const unused = `a`; typeof module; }", "{ enum Unused { A } typeof module; }", "{ function unused() {} typeof module; }", "{ class Unused {} typeof module; }",
    "import { feature } from \"bun:bundle\"; if (feature(\"X\")) { require(\"./extra.cjs\"); }",
    "import { feature } from \"bun:bundle\"; const OFF = false; if (OFF) require(\"./extra.cjs\");",
    "import { feature } from \"bun:bundle\"; feature(\"X\") && require(\"./extra.cjs\");",
    "import { feature } from \"bun:bundle\"; feature(\"X\") ? require(\"./extra.cjs\") : 0;",
    "import { feature } from \"bun:bundle\"; if (!feature(\"X\")) {} else module.exports = 1;",
    "import { feature as flag } from \"bun:bundle\"; if (flag(\"X\")) module.exports = 1;", "import { feature } from \"bun:bundle\"; typeof feature; module.exports = 1;",
    "import { feature } from \"bun:bundle\"; module.exports = 1;", "import { feature } from \"bun:bundle\"; import \"./other\"; if (feature(\"X\")) module.exports = 1;",
    "import { feature } from \"bun:bundle\"; export const a = feature(\"X\") ? 1 : 2;", "import.meta.hot.accept(module);", "import.meta.hot.dispose(() => module);",
    "import.meta.hot.accept(() => { module.exports = 1; });", "import.meta.hot.data, module;", "import.meta.hot.accept, module;", "import.meta.hot.accept(), module;",
    "import.meta.hot.data.x = module;", "import.meta.hot.unknown(module);", "if (import.meta.hot) import.meta.hot.accept(module);",
    "import.meta.hot && import.meta.hot.accept(module);", "import.meta.hot?.accept(module);", "for (var module of []) {}", "for (var exports in {}) {}",
    "for (var module = 1; false; ) {}", "for (var module; false; ) {}", "{ var { module } = {}; }", "{ var [exports] = []; }", "{ var { a: { module } } = { a: {} }; }",
    "{ var require; }", "{ var require = 1; }", "{ var __filename; }", "{ var module, other; }", "{ var other, exports; }", "{ let module; }", "{ const exports = 1; }",
    "{ function module() {} }", "{ class module {} }", "function f() { { var module; } }", "(() => { { var exports = 1; } });", "namespace N { { var module = 1; } }",
    "{ declare var module: any; }", "declare var module: any;", "var module; { var module; }", "{ { var module; } }", "if (false) { { var module; } }",
    "try { var module; } catch {}", "try {} finally { var exports; }", "do { var module; } while (false);", "if (unknown) var module;", "label: var exports;",
    "export {}; { var module; }", "import \"./y\"; { var module; }", "while (unknown) var module;", "do var module; while (unknown);", "label: var module;",
    "with (unknown) var module;", "for (;;) var module;", "for (const a of unknown) var module;", "for (const a in unknown) var module;",
    "if (unknown) {} else var module;", "if (unknown) if (unknown) var module;", "if (unknown) label: var module;", "{ var module; } var module;",
    "{ var module; } { var module; }", "function module() {} { var module; }", "{ var module; } function module() {}", "if (false) var module; { var module; }",
    "{ var module; } if (unknown) var module;", "if (unknown) { var module; } else { var module; }", "{ var [module] = []; }", "{ var { module } = {}; }",
    "{ var { a: module } = {}; }", "{ var { a: [module] } = { a: [] }; }", "{ var [...module] = []; }", "{ var { ...module } = {}; }", "{ var other, module; }",
    "switch (unknown) { default: var module; }", "try {} finally { var module; }", "{ var exports; } var module;", "var exports; { var module; }", "{ let module; }",
    "{ const module = 1; }", "{ function module() {} }", "{ class module {} }", "{ var module; module; }", "var module; { var module; module; }",
    "var module; { module; }", "{ var module = 1; }", "var module = 1; { var module = 2; }", "{ var require; }", "{ var __filename; }",
    "if (false) { var module; } { var module; }", "{ var module; } if (false) { var module; }", "class module {} ", "let module; { var other; }",
    "import.meta.hot[\"accept\"]();", "import.meta.hot[\"accept\"](() => module);", "import.meta.hot[\"dispose\"](module);", "import.meta[\"hot\"].accept(() => module);",
    "import.meta[\"hot\"][\"accept\"](() => module);", "import.meta.hot?.[\"accept\"](() => module);", "import.meta.hot[\"unknown\"], module;",
    "{ { var module; } var module; }", "{ var module; { var module; } }", "if (false) { var module; } { var module; module; }", "if (false) { var module; } module;",
    "if (false) { var module; } { module; }", "{ var module; } module;", "{ var module; } { module; }", "{ var module; } { var module; module; }",
    "if (false) { var module; } else { var module; }", "var module; { var module; (() => module)(); }",
    "var module; { var module; function f() { return module; } f(); }", "var module; { var module; } module;", "var module; { { module; } var module; }",
    "var module; for (var module = 1; module; ) break;", "for (var module = 1; module; ) break;", "if (false) { var module; } for (var module = 1; module; ) break;",
    "var module; label: var module;", "label: var module = module;", "var module; switch (unknown) { case 1: var module; case 2: module; }",
    "switch (unknown) { case 1: var module; case 2: module; }", "if (false) { var module; } switch (unknown) { case 1: var module; case 2: module; }",
    "var module; try { var module; module; } catch {}", "var module; try {} catch { var module; module; }", "var module; with (unknown) { var module; module; }",
    "var exports; { var exports; exports; }", "if (false) { var exports; } { var exports; }", "if (false) { var exports; } { var module; }",
    "function module() {} { var module; module; }", "function module() {} module;", "{ var module; } function module() {} module;",
    "var module; { var module; } { module; }", "var module; if (unknown) { var module; module; } else { module; }", "{ var module; typeof module; }",
    "var module; { var module; typeof module; }", "var module; { var module; module = 1; }", "{ var module; module = 1; }",
    "if (false) { var module; } { var module; module = 1; }", "function f(Object) { if (new Object()) {} else module.exports = 1; } f(unknown);",
    "const Set = unknown; new Set(), module;", "class Array {} new Array(1, 2), module;", "let Math = unknown; Math.PI, module;",    "[function () {}][0], module;", "[[function () {}][0], module];", "[/a/][0], module;", "[class {}][0], module;", "[[]][0], module;",
    "({ b: function named() {} }).b, module;", "[typeof unknown][0], module;", "[unknown][0], module;", "var x; [x][0], module;", "var x; ({ a: x }).a, module;",
    "var x; typeof [x][0], module;", "var x; [x][0] === 1, module;", "var x; void [x][0], module;", "var x; ![x][0], module;", "var x; [[x][0]], module;",
    "var x; [x][0] ? module : 0;", "var x; [x, 1][0], module;", "[import.meta][0], module;", "var x; [{ a: x }.a][0], module;", "[1][0], module;",
    "[module, () => 1][1];", "[module, 1 + 1];", "[[1][0], module];", "[exports, 0][1], 1;", "[this, 0][1];", "typeof [qq][0], module;", "[Math][0].PI, module;",
    "[Math.PI][0], module;", "\"\" + [typeof unknown][0], module;", "[typeof unknown][0] == 1, module;", "new Set([[1]][0]), module;", "new Set((0, [1])), module;",
    "new Set(true ? [1] : 0), module;", "(true ? () => 1 : 0), module;", "(0 || (() => 1)), module;", "(null ?? /a/), module;", "(0, () => 1), module;",
    "var x; if ([1, [x][0]][0]) {} else module.exports = 1;", "var x; if ([[x][0], () => 1][1]) {} else module.exports = 1;",
    "var x; if (![x, () => 1][1]) module.exports = 1;", "let i = 0; if ([[0]][i][0]) module.exports = 1;", "let i = 0; if ([{ b: 0 }][i].b) module.exports = 1;",
    "let i = 0; if ([0][i]) module.exports = 1;", "let i = 0; if ({ a: [0] }.a[i]) module.exports = 1;", "const i = 0; if ([() => 1][i]) {} else module.exports = 1;",
    "const K = \"a-b\"; if ({ \"a-b\": 0 }[K]) module.exports = 1;", "const f = [() => 1][0]; if (f) {} else module.exports = 1;",
    "function g() {} if (([(g(), () => 1)][0] && 1) === 1) {} else module.exports = 1;", "var v = { a: function named() {} }.a ?? module.exports;",
    "var v = [() => 1][0] ?? module.exports;", "var v = [[]][0] ?? module.exports;", "var v = { a: {} }.a ?? module.exports;", "var v = [class {}][0] ?? module.exports;",
    "var v = [typeof unknown][0] ?? module.exports;", "var v = [0x1n][0] ?? module.exports;", "var v = [() => 1][0] || module.exports;",
    "var v = [() => 1][0] && module.exports;", "var v = [class {}][0] || module.exports;", "[function () {}][0] || (module.exports = 1);",
    "[class {}][0] || (module.exports = 1);", "[[]][0] || (module.exports = 1);", "[function () {}][0] ? 1 : (module.exports = 1);",
    "[class {}][0] ? 1 : (module.exports = 1);", "[typeof unknown][0] || (module.exports = 1);", "[new Object()][0] || (module.exports = 1);",
    "var v = (true ? () => 1 : 0) ?? module.exports;", "var v = (new Object() ?? 1) ?? module.exports;", "var v = (true ? [] : 0) ?? module.exports;",
    "var v = (true ? class {} : 0) ?? module.exports;", "var b; var v = ((b || \"x\") ?? 0) ? 0 : module.exports;",
    "switch ([() => 1][0]) { case 1: module.exports = 1; }", "while (![() => 1][0]) module.exports = 1;", "for (; ![/a/][0]; ) module.exports = 1;",
    "do {} while (![() => 1][0] && module);",
];

fn write_cells() -> Vec<String> {
    let mut cells: Vec<String> = STATEMENTS.iter().map(|&it| it.to_owned()).collect();
    for constructor in CONSTRUCTORS {
        let unused = |arguments: &&str| format!("new {constructor}({arguments}), module;");
        cells.extend(ARGUMENTS.iter().map(unused));
    }
    for (places, texts) in [(PLACES, EVIDENCE), (BODIES, CONDITIONS)] {
        for (before, behind) in places {
            cells.extend(texts.iter().map(|text| format!("{before}{text}{behind}")));
        }
    }
    let mut push = |prelude: &str, expression: &str| {
        cells.push(format!("{prelude}if ({expression}) module.exports = 1;"));
        cells.push(format!(
            "{prelude}if ({expression}) {{}} else module.exports = 1;"
        ));
    };
    for expression in EXPRESSIONS {
        push("", expression);
    }
    for constructor in CONSTRUCTORS {
        for arguments in ARGUMENTS {
            push("", &format!("new {constructor}({arguments})"));
        }
    }
    for &(prelude, operand) in OPERANDS {
        push(prelude, operand);
        for operator in UNARY {
            push(prelude, &format!("{operator}{operand}"));
        }
        for &(prelude_of_right, right) in OPERANDS {
            let prelude = match prelude == prelude_of_right {
                true => prelude.to_owned(),
                false => format!("{prelude}{prelude_of_right}"),
            };
            for operator in BINARY {
                push(&prelude, &format!("{operand} {operator} {right}"));
            }
        }
    }
    cells
}

fn find_partings(cells: &[String]) -> (usize, Vec<String>) {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let define = Define::with_pure_globals(false, true);
    let builds = [
        ("in place", true, false),
        ("executable", false, false),
        ("--minify-syntax", false, true),
    ];
    let builds = builds.map(|(name, runs_in_place, minifies_syntax)| {
        let provided = FoldOptions {
            minifies_syntax,
            ..FoldOptions::default()
        };
        let platform = Platforms::LINUX;
        let fold =
            create_application_fold_inputs(&provided, arena, &atoms, platform, runs_in_place);
        (name, fold)
    });
    let (mut refused, mut partings) = (0, Vec::new());
    for text in cells {
        let Some(is_commonjs) = is_commonjs_to_bun_run(text, &define) else {
            refused += 1;
            continue;
        };
        for (name, fold) in &builds {
            if is_commonjs_to_build(text, fold, &atoms, arena) != is_commonjs {
                let format = if is_commonjs {
                    "CommonJS"
                } else {
                    "an ES module"
                };
                partings.push(format!(
                    "{format} to bun run, not to the build ({name}): {text}"
                ));
            }
        }
    }
    (refused, partings)
}

#[test]
fn format_is_what_bun_run_takes_the_file_for() {
    let cells = write_cells();
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get());
    let found: Vec<(usize, Vec<String>)> = std::thread::scope(|scope| {
        let shares = cells.chunks(cells.len().div_ceil(threads));
        let running: Vec<_> = shares
            .map(|share| scope.spawn(|| find_partings(share)))
            .collect();
        let found = running
            .into_iter()
            .map(|it| it.join().expect("no cell panics"));
        found.collect()
    });
    let refused: usize = found.iter().map(|it| it.0).sum();
    assert!(
        refused * 100 < cells.len(),
        "bun run refuses {refused} of {} cells",
        cells.len()
    );
    let partings: Vec<String> = found.into_iter().flat_map(|it| it.1).collect();
    assert!(
        partings.is_empty(),
        "{} of {} cells:\n{}",
        partings.len(),
        cells.len(),
        partings.join("\n")
    );
}
