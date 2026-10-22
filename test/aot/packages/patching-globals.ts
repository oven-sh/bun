// What older and defensive packages do to the global objects when they are loaded: polyfills, feature tests, settings on Error, console and process, four ways to reach the global object. The last lines of regenerator-runtime are copied as they are published.
import { inBothModes, type Case } from "./run-packages";

const differs =
  "Under --aot the members that the built-in objects of the language have cannot be replaced, and nothing can be added to Function.prototype: the store throws a TypeError, in sloppy code too, or is a build error where it is certain to run.";

export const cases: Case[] = [
  ...inBothModes("self-assign-static", "pf_self_assign_static", {
    "index.js": `Number.isInteger = Number.isInteger || function (v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; };
Object.assign = Object.assign || function () {};
Array.isArray = Array.isArray || function () {};
exports.ok = Number.isInteger(5);
`,
  }, { required: true }),
  ...inBothModes("self-assign-proto", "pf_self_assign_proto", {
    "index.js": `Array.prototype.includes = Array.prototype.includes || function () {};
String.prototype.trim = String.prototype.trim || function () {};
Promise.prototype.finally = Promise.prototype.finally || function () {};
exports.ok = [1].includes(1);
`,
  }, { required: true }),
  ...inBothModes("guarded-if", "pf_guarded_if", {
    "index.js": `if (!Array.prototype.flat) { Array.prototype.flat = function () { return "polyfilled"; }; }
if (typeof Object.fromEntries !== "function") Object.fromEntries = function () {};
if (!("at" in Array.prototype)) Object.defineProperty(Array.prototype, "at", { value() {} });
exports.ok = [[1]].flat();
`,
  }, { required: true }),
  ...inBothModes("logical-assign", "pf_logical_assign", {
    "index.js": `Array.prototype.at ||= function () {};
Symbol.dispose ??= Symbol("Symbol.dispose");
Symbol.asyncDispose ??= Symbol("Symbol.asyncDispose");
Promise.withResolvers ??= function () {};
exports.ok = typeof Symbol.dispose;
`,
  }, { required: true }),
  ...inBothModes("define-same", "pf_define_same", {
    "index.js": `Object.defineProperty(Array.prototype, "includes", { value: Array.prototype.includes, writable: true, configurable: true, enumerable: false });
exports.ok = [1].includes(1);
`,
  }, { required: true }),
  ...inBothModes("global-self-assign", "pf_global_self_assign", {
    "index.js": `globalThis.fetch = globalThis.fetch || function () {};
globalThis.Promise = globalThis.Promise || function () {};
globalThis.URL = globalThis.URL || require("node:url").URL;
globalThis.TextEncoder = globalThis.TextEncoder || require("node:util").TextEncoder;
exports.ok = typeof fetch;
`,
  }, { required: true }),
  ...inBothModes("global-var-self", "pf_global_var_self", {
    "index.js": `var Promise = globalThis.Promise;
var Symbol = globalThis.Symbol;
var Map = typeof globalThis.Map === "function" ? globalThis.Map : function () {};
exports.ok = [typeof Promise, typeof Symbol, new Map([[1, 2]]).get(1)];
`,
  }, { required: true }),
  ...inBothModes("new-global", "pf_new_global", {
    "index.js": `globalThis.__MY_LIB__ = { v: 1 };
global.__OTHER__ = 2;
exports.ok = [globalThis.__MY_LIB__.v, __OTHER__, typeof __MY_LIB__];
`,
  }, { required: true }),
  ...inBothModes("new-static-on-builtin", "pf_new_static_on_builtin", {
    "index.js": `let r; try { Object.myHelper = function () { return "mine"; }; r = Object.myHelper(); } catch (e) { r = e.name; }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("new-proto-method", "pf_new_proto_method", {
    "index.js": `let r; try { String.prototype.shout = function () { return this.toUpperCase() + "!"; }; r = "a".shout(); } catch (e) { r = e.name; }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("new-proto-define", "pf_new_proto_define", {
    "index.js": `let r; try { Object.defineProperty(Array.prototype, "last", { get() { return this[this.length - 1]; }, configurable: true }); r = [1, 2].last; } catch (e) { r = e.name; }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("error-settings", "pf_error_settings", {
    "index.js": `Error.stackTraceLimit = 50;
const was = Error.stackTraceLimit;
Error.stackTraceLimit = Infinity;
exports.ok = [was, Error.stackTraceLimit, typeof Error.captureStackTrace];
`,
  }, { required: true }),
  ...inBothModes("prepare-stack", "pf_prepare_stack", {
    "index.js": `const old = Error.prepareStackTrace;
Error.prepareStackTrace = function (e, sites) { return sites; };
const sites = new Error("x").stack;
Error.prepareStackTrace = old;
exports.ok = [Array.isArray(sites), sites.length > 0, typeof sites[0].getFileName, typeof sites[0].getLineNumber()];
`,
  }, { required: true }),
  ...inBothModes("capture", "pf_capture", {
    "index.js": `function MyErr(m) { Error.captureStackTrace(this, MyErr); this.message = m; }
MyErr.prototype = Object.create(Error.prototype, { constructor: { value: MyErr }, name: { value: "MyErr" } });
const e = new MyErr("m");
exports.ok = [e instanceof Error, e.name, typeof e.stack, String(e), e.stack.split("\\n")[0]];
`,
  }, { required: true }),
  ...inBothModes("console-patch", "pf_console_patch", {
    "index.js": `const seen = [];
const old = console.log;
console.log = function (...a) { seen.push(a.join(" ")); };
console.log("captured", 1);
console.log = old;
const oldWarn = console.warn; console.warn = () => {}; console.warn("silenced"); console.warn = oldWarn;
exports.ok = seen;
`,
  }, { required: true }),
  ...inBothModes("stdout-patch", "pf_stdout_patch", {
    "index.js": `const seen = [];
const old = process.stdout.write;
process.stdout.write = function (s) { seen.push(String(s)); return true; };
process.stdout.write("direct\\n");
console.log("through console");
process.stdout.write = old;
exports.ok = seen;
`,
  }, { required: true }),
  ...inBothModes("process-patch", "pf_process_patch", {
    "index.js": `process.env.MY_FLAG = "1";
process.title = "mine";
const oldExit = process.exit; process.exit = function () { return "no exit"; }; const r = process.exit(3); process.exit = oldExit;
process.myOwn = 5;
const oe = process.emitWarning; process.emitWarning = () => {}; process.emitWarning("x"); process.emitWarning = oe;
exports.ok = [process.env.MY_FLAG, r, process.myOwn];
`,
  }, { required: true }),
  ...inBothModes("date-math-patch", "pf_date_math_patch", {
    "index.js": `let r = []; try { const old = Date.now; Date.now = () => 42; r.push(Date.now()); Date.now = old; } catch (e) { r.push(e.name); }
try { const old = Math.random; Math.random = () => 0.5; r.push(Math.random()); Math.random = old; } catch (e) { r.push(e.name); }
try { const old = JSON.parse; JSON.parse = () => "patched"; r.push(JSON.parse("1")); JSON.parse = old; } catch (e) { r.push(e.name); }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("timers-patch", "pf_timers_patch", {
    "index.js": `let r = []; try { const old = globalThis.setTimeout; globalThis.setTimeout = function fake() { return "fake"; }; r.push(setTimeout(() => {}, 0)); globalThis.setTimeout = old; r.push(typeof setTimeout); } catch (e) { r.push(e.name); }
try { const old = globalThis.fetch; globalThis.fetch = async () => "mock"; r.push(typeof fetch); globalThis.fetch = old; } catch (e) { r.push(e.name); }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("replace-promise", "pf_replace_promise", {
    "index.js": `let r; try { const Old = globalThis.Promise; globalThis.Promise = class Mine extends Old {}; r = Promise.name; globalThis.Promise = Old; } catch (e) { r = e.name; }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("global-four-roads", "pf_global_four_roads", {
    "index.js": `const a = Function("return this")();
const b = (0, eval)("this");
const c = (function () { return typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this; })();
const d = new Function("return typeof globalThis")();
exports.ok = [a === globalThis, b === globalThis, c === globalThis, d, typeof window, typeof self, typeof global];
`,
  }, { required: true }),
  ...inBothModes("sloppy-this", "pf_sloppy_this", {
    "index.js": `var root = this;
var inFn = (function () { return this; })();
var viaCall = (function () { return this; }).call(undefined);
exports.ok = [root === exports, root === module.exports, typeof inFn, typeof viaCall];
`,
  }, { required: true }),
  ...inBothModes("implicit-global", "pf_implicit_global", {
    "index.js": `let r; try { leaked = 5; r = typeof leaked + ":" + globalThis.leaked; } catch (e) { r = e.name; }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("arguments-alias", "pf_arguments_alias", {
    "index.js": `function f(a) { arguments[0] = "changed"; return a; }
function g(a) { a = "changed"; return arguments[0]; }
function h() { try { return typeof arguments.callee; } catch (e) { return e.name; } }
exports.ok = [f("orig"), g("orig"), h()];
`,
  }, { required: true }),
  ...inBothModes("hidden-require", "pf_hidden_require", {
    "index.js": `const r1 = eval("require");
const r2 = module.require ? module.require.bind(module) : null;
const r3 = typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : require;
const name = "node:" + "path";
exports.ok = [typeof r1, typeof r1("node:path").join, r2 && typeof r2("node:os").cpus, typeof r3(name).join, typeof require.call(null, "node:fs").readFileSync];
`,
  }, { required: true }),
  ...inBothModes("typeof-checks", "pf_typeof_checks", {
    "index.js": `exports.ok = [typeof require, typeof module, typeof exports, typeof define, typeof window, typeof document, typeof process, typeof Bun, typeof Deno, typeof importScripts, typeof navigator, typeof __webpack_require__, typeof require.resolve, typeof require.cache, typeof require.main, typeof module.exports, typeof module.id];
`,
  }, { required: true }),
  ...inBothModes("is-node", "pf_is_node", {
    "index.js": `exports.ok = [Object.prototype.toString.call(typeof process !== "undefined" ? process : 0), typeof process.versions.node, typeof process.versions.bun, process.release && process.release.name, typeof process.browser, !!(process.versions && process.versions.node), typeof process.argv[1], typeof process.execPath, process.argv.length];
`,
  }, { required: true }),
  ...inBothModes("native-code-test", "pf_native_code_test", {
    "index.js": `const isNative = (f) => /\\[native code\\]/.test(Function.prototype.toString.call(f));
function mine() { return 1; }
class K { m() {} }
exports.ok = [isNative(Map), isNative(Array.prototype.push), isNative(mine), isNative(K), isNative(mine.bind(null)), isNative(Reflect.construct), /^class /.test(String(K)), /^function mine/.test(String(mine)), String(mine).includes("return 1")];
`,
  }, { required: true }),
  ...inBothModes("function-names", "pf_fn_names", {
    "index.js": `const a = function () {}; const b = () => {}; function c(x, y) {} class D { static s() {} m(p) {} get g() { return 1; } } const o = { k() {}, ["x" + 1]: function () {}, async *gen() {} }; exports.named = function () {}; exports.arrow = () => {};
exports.ok = [a.name, b.name, c.name, c.length, D.name, D.s.name, new D().m.name, new D().m.length, Object.getOwnPropertyDescriptor(D.prototype, "g").get.name, o.k.name, o.x1.name, o.gen.name, exports.named.name, exports.arrow.name, (function () {}).name, c.bind(null).name, (class {}).name, new Function("a", "b", "return a").length];
`,
  }, { required: true }),
  ...inBothModes("object-proto-tricks", "pf_object_proto_tricks", {
    "index.js": `const o = {}; o.__proto__ = { inherited: 1 };
const p = { __proto__: null, a: 1 };
const q = Object.create(null); q.x = 1;
function F() {} F.prototype = { constructor: F, m() { return "m"; } };
const d = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");
exports.ok = [o.inherited, Object.getPrototypeOf(p), "toString" in q, new F().m(), typeof d.get, {}.constructor === Object, [].constructor === Array, Object.prototype.toString.call(null), Object.prototype.toString.call([]), Object.prototype.hasOwnProperty.call(o, "inherited")];
`,
  }, { required: true }),
  ...inBothModes("freeze-builtins-self", "pf_freeze_builtins_self", {
    "index.js": `let r = []; for (const f of [() => Object.freeze(Object.prototype), () => Object.freeze(Array.prototype), () => Object.freeze(Function.prototype), () => Object.preventExtensions(globalThis.JSON)]) { try { f(); r.push("ok"); } catch (e) { r.push(e.name); } }
exports.ok = r;
`,
  }, { required: true }),
  ...inBothModes("regenerator-global", "pf_regenerator_global", {
    "index.js": `var runtime = { mark: 1 };
try { regeneratorRuntime = runtime; } catch (accidentalStrictMode) { if (typeof globalThis === "object") { globalThis.regeneratorRuntime = runtime; } else { Function("r", "regeneratorRuntime = r")(runtime); } }
exports.ok = [typeof regeneratorRuntime, globalThis.regeneratorRuntime === runtime];
`,
  }, { required: true }),
  ...inBothModes("raw-tag", "pf_raw_tag", {
    "index.js": `var symToStringTag = Symbol.toStringTag, nativeObjectToString = Object.prototype.toString;
function getRawTag(value) { var isOwn = Object.prototype.hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag]; try { value[symToStringTag] = undefined; var unmasked = true; } catch (e) {} var result = nativeObjectToString.call(value); if (unmasked) { if (isOwn) { value[symToStringTag] = tag; } else { delete value[symToStringTag]; } } return result; }
class K { get [Symbol.toStringTag]() { return "Kay"; } }
exports.ok = [getRawTag(Promise.resolve()), getRawTag(new Map()), getRawTag(Math), getRawTag(JSON), getRawTag(function* () {}), getRawTag(new K()), getRawTag(Symbol.prototype), nativeObjectToString.call(Math), nativeObjectToString.call(Promise.resolve())];
`,
  }, { required: true }),
  ...inBothModes("guarded-by-try", "pf_guarded_by_try", {
    "index.js": `var r = [];
try { Object.defineProperty(Array.prototype, "mine", { value: 1, configurable: true }); r.push("defined"); } catch (e) { r.push("fell back"); }
try { Function.prototype.mine = 1; r.push(typeof (function () {}).mine); } catch (e) { r.push("fell back"); }
exports.ok = r;
`,
  }, { differs, required: true }),
  ...inBothModes("descriptors-of-builtins", "pf_descriptors_of_builtins", {
    "index.js": `const d = (o, k) => { const x = Object.getOwnPropertyDescriptor(o, k); return x ? [x.writable, x.enumerable, x.configurable].join() : "none"; };
exports.ok = [d(Array.prototype, "push"), d(Object, "assign"), d(globalThis, "Array"), d(globalThis, "undefined"), d(Math, "PI"), d(Math, "max"), d(JSON, "parse"), d(Promise.prototype, "then"), d(Function.prototype, "call"), d(Symbol, "iterator"), d(globalThis, "globalThis"), d(globalThis, "console"), d(globalThis, "process"), d(Error, "stackTraceLimit"), Object.isExtensible(Array.prototype), Object.isExtensible(Object), Object.isExtensible(globalThis), Object.isFrozen(Array.prototype), Object.isSealed(Math)];
`,
  }, { required: true }),
];
