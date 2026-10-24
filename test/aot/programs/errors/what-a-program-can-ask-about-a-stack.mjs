// What a program can ask about a stack: error.stack, Error.captureStackTrace, Error.stackTraceLimit, Error.prepareStackTrace and every method of a call site, async frames.
import { EventEmitter } from "node:events";
const opaque = value => [value, 0][Number(process.argv.length > 100)];
// A frame of one of Bun's own modules has a line of Bun's source file in an executable, and of the module as it is built into Bun elsewhere.
const shorten = text => String(text).replace(/\((?:node:|bun:|internal[:\/])[^()]*\)/g, "(a module of Bun)").replace(/(?:file:\/\/)?(?:[A-Z]:)?[\\\/][^\s():]*[\\\/]/g, "");
function framesOf(stack, count = 6) {
  const frames = [];
  for (const text of String(stack).split("\n").slice(1)) frames.push(shorten(text.trim()));
  return frames.slice(0, count).join(" | ");
}
const say = (label, ...values) => console.log(label + ":", ...values);

// Frames of every kind of function.
function plainFunction() { let error; error = new Error("plain"); return error; }
const arrowFunction = () => { let error; error = new Error("arrow"); return error; };
const namedExpression = function inner() { let error; error = new Error("expression"); return error; };
const object = {
  method() { let error; error = new Error("method"); return error; },
  get getter() { let error; error = new Error("getter"); return error; },
  set setter(value) { value.error = new Error("setter"); },
  ["computed" + opaque("Key")]() { let error; error = new Error("computed"); return error; },
  [Symbol.for("symbolic")]() { let error; error = new Error("symbol"); return error; },
  property: function () { let error; error = new Error("property"); return error; },
  arrow: () => { let error; error = new Error("arrow property"); return error; },
  async asyncMethod() { let error; error = new Error("async method"); return error; },
  *generatorMethod() { let error; error = new Error("generator method"); yield error; },
  nested: { deeper: { method() { let error; error = new Error("nested method"); return error; } } },
};
class Base {
  constructor(kind) { if (kind === "base") this.error = new Error("base constructor"); }
  method() { let error; error = new Error("class method"); return error; }
  static method() { let error; error = new Error("static method"); return error; }
  get getter() { let error; error = new Error("class getter"); return error; }
  static get getter() { let error; error = new Error("static getter"); return error; }
  #hidden() { let error; error = new Error("private method"); return error; }
  callHidden() { let error; error = this.#hidden(); return error; }
  static #hiddenStatic() { let error; error = new Error("private static method"); return error; }
  static callHiddenStatic() { let error; error = Base.#hiddenStatic(); return error; }
  field = opaque(true) ? new Error("field") : null;
  static field = new Error("static field");
  static { Base.block = new Error("static block"); }
  arrowField = () => { let error; error = new Error("arrow field"); return error; };
}
class Derived extends Base {
  constructor(kind) { super(kind); if (kind === "derived") this.error = new Error("derived constructor"); }
  method() { let error; error = super.method(); return error; }
}
const anonymousClass = class { constructor() { this.error = new Error("anonymous class"); } };
say("function", framesOf(plainFunction().stack, 2));
say("arrow", framesOf(arrowFunction().stack, 2));
say("expression", framesOf(namedExpression().stack, 2));
say("method", framesOf(object.method().stack, 2));
say("getter", framesOf(object.getter.stack, 2));
{ const box = {}; object.setter = box; say("setter", framesOf(box.error.stack, 2)); }
say("computed", framesOf(object.computedKey().stack, 2));
say("symbol", framesOf(object[Symbol.for("symbolic")]().stack, 2));
say("property", framesOf(object.property().stack, 2));
say("arrow property", framesOf(object.arrow().stack, 2));
say("generator method", framesOf(object.generatorMethod().next().value.stack, 3));
say("nested method", framesOf(object.nested.deeper.method().stack, 2));
say("base constructor", framesOf(new Base("base").error.stack, 2));
say("derived constructor", framesOf(new Derived("derived").error.stack, 2));
say("base through derived", framesOf(new Derived("base").error.stack, 3));
say("class method", framesOf(new Base().method().stack, 2));
say("super method", framesOf(new Derived().method().stack, 3));
say("static method", framesOf(Base.method().stack, 2));
say("inherited static method", framesOf(Derived.method().stack, 2));
say("class getter", framesOf(new Base().getter.stack, 2));
say("static getter", framesOf(Base.getter.stack, 2));
say("private method", framesOf(new Base().callHidden().stack, 3));
say("private static method", framesOf(Base.callHiddenStatic().stack, 3));
say("field", framesOf(new Base().field.stack, 3));
say("field through derived", framesOf(new Derived().field.stack, 4));
say("static field", framesOf(Base.field.stack, 3));
say("static block", framesOf(Base.block.stack, 3));
say("arrow field", framesOf(new Base().arrowField().stack, 2));
say("anonymous class", framesOf(new anonymousClass().error.stack, 2));
say("bound", framesOf(plainFunction.bind(null)().stack, 3));
say("call", framesOf(plainFunction.call(null).stack, 3));
say("apply", framesOf(plainFunction.apply(null, []).stack, 3));
say("Reflect.apply", framesOf(Reflect.apply(plainFunction, null, []).stack, 3));
say("immediately called", framesOf((function () { let error; error = new Error("called at once"); return error; })().stack, 2));
say("default parameter", framesOf(((error = new Error("default")) => error)().stack, 2));
say("template tag", framesOf(((strings) => { let error; error = new Error(strings[0]); return error; })`tag`.stack, 2));
say("renamed", framesOf((() => { function before() { let error; error = new Error("renamed"); return error; } Object.defineProperty(before, "name", { value: "after" }); let error; error = before(); return error; })().stack, 2));
say("displayName", framesOf((() => { function written() { let error; error = new Error("displayName"); return error; } written.displayName = "shown"; let error; error = written(); return error; })().stack, 2));

// Through built-ins.
const through = {
  map: run => [1].map(run)[0],
  forEach: run => { let result; [1].forEach(() => { result = run(); }); return result; },
  filter: run => { let result; [1].filter(() => { result = run(); return true; }); return result; },
  reduce: run => [1].reduce(() => run(), 0),
  find: run => { let result; [1].find(() => { result = run(); return true; }); return result; },
  some: run => { let result; [1].some(() => { result = run(); return true; }); return result; },
  sort: run => { let result; [2, 1].sort(() => { result = run(); return 0; }); return result; },
  "Array.from": run => Array.from([1], run)[0],
  replace: run => { let result; "a".replace("a", () => { result = run(); return ""; }); return result; },
  "JSON.parse": run => { let result; JSON.parse("1", () => { result = run(); }); return result; },
  "JSON.stringify": run => { let result; JSON.stringify({ toJSON() { result = run(); } }); return result; },
  "Map.forEach": run => { let result; new Map([[1, 1]]).forEach(() => { result = run(); }); return result; },
  "Set.forEach": run => { let result; new Set([1]).forEach(() => { result = run(); }); return result; },
  "typed array map": run => { let result; new Uint8Array(1).map(() => { result = run(); return 0; }); return result; },
  "Object.defineProperty getter": run => Object.defineProperty({}, "a", { get: run }).a,
  "Proxy get": run => new Proxy({}, { get: () => run() }).a,
  "Proxy apply": run => new Proxy(() => {}, { apply: () => run() })(),
  valueOf: run => { let result; +{ valueOf() { result = run(); return 1; } }; return result; },
  toPrimitive: run => { let result; +{ [Symbol.toPrimitive]() { result = run(); return 1; } }; return result; },
  iterator: run => { let result; for (const x of { [Symbol.iterator]() { result = run(); return [][Symbol.iterator](); } }); return result; },
  next: run => { let result; for (const x of { [Symbol.iterator]() { return { next() { result = run(); return { done: true }; } }; } }); return result; },
  spread: run => { let result; [...{ *[Symbol.iterator]() { result = run(); } }]; return result; },
  "new Promise": run => { let result; new Promise(() => { result = run(); }); return result; },
  hasInstance: run => { let result; ({}) instanceof { [Symbol.hasInstance]() { result = run(); return true; } }; return result; },
  "structuredClone getter": run => { let result; structuredClone({ get a() { result = run(); return 1; } }); return result; },
  "Object.assign getter": run => { let result; Object.assign({}, { get a() { result = run(); return 1; } }); return result; },
  "Object.entries getter": run => { let result; Object.entries({ get a() { result = run(); return 1; } }); return result; },
  "indirect eval": run => { globalThis.runFromText = run; const result = (0, eval)("const result = runFromText(); result"); delete globalThis.runFromText; return result; },
};
for (const [name, call] of Object.entries(through)) say("through " + name, framesOf(call(function leaf() { let error; error = new Error("leaf"); return error; }).stack, 5));

// Error.captureStackTrace.
function capture(target, above) { Error.captureStackTrace(target, above); return target; }
function outerCapture(target, above) { let result; result = capture(target, above); return result; }
say("capture object", framesOf(outerCapture({}).stack, 3));
say("capture above capture", framesOf(outerCapture({}, capture).stack, 3));
say("capture above outer", framesOf(outerCapture({}, outerCapture).stack, 3));
say("capture above a function that is not there", JSON.stringify(outerCapture({}, plainFunction).stack));
say("capture head of an object", JSON.stringify(String(outerCapture({ name: "Named", message: "text" }).stack).split("\n")[0]));
say("capture head of an error", JSON.stringify(String(outerCapture(new RangeError("text")).stack).split("\n")[0]));
say("capture descriptor", JSON.stringify({ ...Object.getOwnPropertyDescriptor(outerCapture({}), "stack"), value: undefined }));
say("capture twice", framesOf(capture(outerCapture({})).stack, 2));
say("capture on a function", framesOf(outerCapture(function target() {}).stack, 2));
say("capture on an array", framesOf(outerCapture([]).stack, 2));
for (const target of [undefined, null, 5, "text"]) { try { capture(target); say("capture on " + target, "nothing thrown"); } catch (error) { say("capture on " + target, error.name, error.message); } }
try { say("capture on frozen", framesOf(capture(Object.freeze({})).stack, 1)); } catch (error) { say("capture on frozen", error.name, error.message); }
class Custom extends Error { constructor(message) { super(message); this.name = "Custom"; Error.captureStackTrace(this, Custom); } }
function makeCustom() { let error; error = new Custom("made"); return error; }
say("capture in a subclass", JSON.stringify(String(makeCustom().stack).split("\n")[0]), framesOf(makeCustom().stack, 2));

// Error.stackTraceLimit.
function deep(depth) { let error; if (depth === 0) error = new Error("deep"); else error = deep(depth - 1); return error; }
const usualLimit = Error.stackTraceLimit;
say("usual limit", usualLimit, String(deep(30).stack).split("\n").length);
for (const limit of [0, 1, 2, 5, 100, Infinity, -1, 2.5, NaN, "3", undefined, null]) {
  Error.stackTraceLimit = limit;
  const error = deep(30);
  say("limit " + String(limit), typeof error.stack, String(error.stack).split("\n").length);
}
delete Error.stackTraceLimit;
say("limit deleted", typeof deep(3).stack, String(deep(3).stack).split("\n").length);
Error.stackTraceLimit = usualLimit;

// Error.prepareStackTrace and the call sites.
const methods = ["getTypeName", "getFunctionName", "getMethodName", "getFileName", "getLineNumber", "getColumnNumber", "getEnclosingLineNumber", "getEnclosingColumnNumber", "getEvalOrigin", "getScriptNameOrSourceURL", "getPosition", "getPromiseIndex", "getScriptHash", "isToplevel", "isEval", "isNative", "isConstructor", "isAsync", "isPromiseAll", "toString"];
function sitesOf(make, count = 3) {
  const usual = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => sites;
  try { return make().stack.slice(0, count); } finally { Error.prepareStackTrace = usual; }
}
function describeSite(site) {
  return methods.map(name => { try { return typeof site[name] === "function" ? name + "=" + shorten(site[name]()) : name + " is missing"; } catch (error) { return name + " threw " + error.message; } }).join(" ");
}
const sited = {
  function: () => plainFunction(),
  method: () => object.method(),
  "class method": () => new Base().method(),
  "static method": () => Base.method(),
  getter: () => object.getter,
  arrow: () => arrowFunction(),
  "through map": () => [1].map(() => { let error; error = new Error("in map"); return error; })[0],
  "null prototype receiver": () => { const bare = Object.create(null); bare.method = object.method; let error; error = bare.method(); return error; },
  "number receiver": () => { let error; error = object.method.call(5); return error; },
};
for (const [name, make] of Object.entries(sited)) for (const [index, site] of sitesOf(make, 2).entries()) say("site of " + name + " " + index, describeSite(site));
say("site getThis", sitesOf(() => object.method(), 1).map(site => String(site.getThis())).join());
say("site getFunction", sitesOf(() => object.method(), 1).map(site => typeof site.getFunction()).join());
say("site prototype", sitesOf(() => plainFunction(), 1).map(site => Object.prototype.toString.call(site) + " " + site.constructor.name + " " + Object.getOwnPropertyNames(Object.getPrototypeOf(site)).sort().join()).join());
{
  const calls = [];
  Error.prepareStackTrace = (error, sites) => { calls.push(error.message + " " + Array.isArray(sites) + " " + sites.length); return "prepared " + error.message; };
  const error = deep(2);
  say("prepare is lazy or eager", calls.length);
  say("prepared", error.stack, error.stack, calls.join(" | "));
  const captured = outerCapture({ message: "captured" });
  say("prepared capture", captured.stack, calls.length);
  Error.prepareStackTrace = () => { throw new RangeError("thrown while preparing"); };
  try { say("prepare throws", String(deep(1).stack)); } catch (thrown) { say("prepare throws", thrown.name, thrown.message); }
  Error.prepareStackTrace = () => 5;
  say("prepare answers a number", deep(1).stack);
  Error.prepareStackTrace = () => undefined;
  say("prepare answers undefined", deep(1).stack);
  Error.prepareStackTrace = 5;
  say("prepare is a number", typeof deep(1).stack);
  Error.prepareStackTrace = undefined;
  say("prepare is undefined", typeof deep(1).stack);
  Error.prepareStackTrace = (error, sites) => sites.map(site => site.getFunctionName()).join(",");
  try { null.x; } catch (thrown) { say("prepared for an error of the engine", thrown.stack); }
  try { JSON.parse("{"); } catch (thrown) { say("prepared for an error of a built-in", thrown.stack); }
  Error.prepareStackTrace = undefined;
}

// The property itself.
{
  const error = deep(1);
  say("own names", Object.getOwnPropertyNames(error).sort().join());
  say("descriptor", JSON.stringify({ ...Object.getOwnPropertyDescriptor(error, "stack"), value: undefined }));
  say("keys", JSON.stringify(Object.keys(error)), JSON.stringify(error));
  error.stack = "stored";
  say("stored", error.stack);
  say("deleted", delete error.stack, error.stack, "stack" in error);
  const changed = new Error("before");
  changed.message = "after"; changed.name = "Renamed";
  say("head after a change", String(changed.stack).split("\n")[0], "|", String(changed));
  const empty = new Error();
  say("head without a message", JSON.stringify(String(empty.stack).split("\n")[0]));
  const lines = new Error("first\nsecond");
  say("head with two lines", JSON.stringify(String(lines.stack).split("\n").slice(0, 2)));
  const frozen = Object.freeze(new Error("frozen"));
  say("frozen", typeof frozen.stack, framesOf(frozen.stack, 1));
  say("line column sourceURL", typeof error.line, typeof error.column, shorten(error.sourceURL));
  const withoutNew = Error("without new");
  say("without new", framesOf(withoutNew.stack, 1));
  say("cause", framesOf(new Error("outer", { cause: deep(0) }).cause.stack, 2));
  say("aggregate", framesOf(new AggregateError([deep(0)], "many").errors[0].stack, 2));
  say("thrown elsewhere", (() => { const made = deep(0); try { throw made; } catch (caught) { return framesOf(caught.stack, 2); } })());
  say("no error thrown", (() => { try { throw { stack: "own" }; } catch (caught) { return caught.stack; } })());
  say("create", typeof Object.create(error).stack, typeof Object.create(Error.prototype).stack);
  say("structuredClone", framesOf(structuredClone(deep(0)).stack, 2));
}

// Async frames.
const tick = () => new Promise(resolve => setImmediate(resolve));
async function asyncLeaf(kind) {
  if (kind === "before") throw new Error("before an await");
  await null;
  if (kind === "after") throw new Error("after an await");
  await tick();
  throw new Error("after a turn of the loop");
}
async function asyncMiddle(kind) { let result; result = await asyncLeaf(kind); return result; }
async function asyncOuter(kind) { try { return await asyncMiddle(kind); } finally { opaque(0); } }
const asyncArrow = async function asyncArrow(kind) { let result; result = await asyncOuter(kind); return result; };
class AsyncClass { async method(kind) { let result; result = await asyncArrow(kind); return result; } static async make(kind) { let result; result = await new AsyncClass().method(kind); return result; } }
async function* asyncGenerator(kind) { yield await AsyncClass.make(kind); }
async function overGenerator(kind) { for await (const value of asyncGenerator(kind)) return value; }
async function returnsWithoutAwait(kind) { return asyncLeaf(kind); }
async function viaThen(kind) { const result = await Promise.resolve().then(function thenCallback() { return asyncLeaf(kind); }); return result; }
async function viaAll(kind) { let result; result = await Promise.all([asyncLeaf(kind)]); return result; }
async function viaAllSettled(kind) { const [result] = await Promise.allSettled([asyncLeaf(kind)]); throw result.reason; }
async function viaAny(kind) { try { return await Promise.any([asyncLeaf(kind)]); } catch (error) { throw error.errors[0]; } }
async function viaRace(kind) { let result; result = await Promise.race([asyncLeaf(kind)]); return result; }
async function viaThenable(kind) { const result = await { then(resolve, reject) { asyncLeaf(kind).then(resolve, reject); } }; return result; }
async function viaTimer() { await new Promise((resolve, reject) => setTimeout(function timerCallback() { reject(new Error("in a timer")); }, 1)); }
async function viaMicrotask() { await new Promise((resolve, reject) => queueMicrotask(function microtaskCallback() { reject(new Error("in a microtask")); })); }
async function viaNextTick() { await new Promise((resolve, reject) => process.nextTick(function tickCallback() { reject(new Error("in a tick")); })); }
async function viaEmitter() { const emitter = new EventEmitter(); await new Promise((resolve, reject) => { emitter.on("go", function listener() { reject(new Error("in a listener")); }); emitter.emit("go"); }); }
async function rethrown(kind) { try { await asyncLeaf(kind); } catch (error) { throw error; } }
async function wrapped(kind) { try { await asyncLeaf(kind); } catch (error) { throw new Error("wrapped", { cause: error }); } }
async function main() {
  for (const kind of ["before", "after", "later"]) {
    for (const run of [asyncLeaf, asyncMiddle, asyncOuter, asyncArrow, AsyncClass.make, overGenerator, returnsWithoutAwait, viaThen, viaAll, viaAllSettled, viaAny, viaRace, viaThenable, rethrown, wrapped]) {
      try { await run(kind); say("async " + run.name + " " + kind, "nothing thrown"); } catch (error) { say("async " + run.name + " " + kind, error.message, "||", framesOf(error.stack, 9)); }
    }
  }
  for (const run of [viaTimer, viaMicrotask, viaNextTick, viaEmitter]) {
    try { await run(); say("async " + run.name, "nothing thrown"); } catch (error) { say("async " + run.name, error.message, "||", framesOf(error.stack, 6)); }
  }
  const sites = await (async () => { const usual = Error.prepareStackTrace; Error.prepareStackTrace = (error, sites) => sites.filter(site => String(site.getFileName()).endsWith(".mjs")).map(site => (site.isAsync() ? "async " : "") + site.getFunctionName() + ":" + site.getLineNumber()).join(" | "); try { await asyncOuter("after"); } catch (error) { return error.stack; } finally { Error.prepareStackTrace = usual; } })();
  say("async call sites", sites);
  for (let round = 0; round < 3; round++) { try { await asyncOuter("after"); } catch (error) { say("async round " + round, framesOf(error.stack, 4)); } }
}
await main();
