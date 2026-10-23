// Built-in modules read tables by keys that the compiler does not see: an emitter's listeners by the name of the event, the styles of
// util.inspect by the kind of a value. Each program here puts another table there, or comes near it, and so reaches a function or a
// method that it does not name. It must say what plain Bun says, whole and with the parts of the runtime left out that it does not use.
// The one exception is text that is run as code: where the compiler can't follow the call to Function, the executable refuses the text
// with an EvalError that the program can catch.
import { describePrograms, type Program } from "./programs-by-use";

const events = `import { EventEmitter } from "node:events";`;
const attempt = (expression: string) =>
  `try { console.log(${expression}); } catch (error) { console.log(error.name); }`;
const refused = "EvalError\n";
const programs: Record<string, Program> = {
  "an emitter as it is meant": {
    source: `${events} const emitter = new EventEmitter(); emitter.on("constructor", value => console.log("heard", value)); console.log(emitter.emit("constructor", 1), emitter.emit("toString"), emitter.listenerCount("__proto__"));`,
  },
  "Function through listeners() of an object literal with _events": {
    source: `${events} const found = EventEmitter.prototype.listeners.call({ _events: function () {} }, "constructor")[0]; console.log(found.name, found("return 6 * 7")());`,
    runsTextAsCode: true,
  },
  "Function through rawListeners() after a store to _events": {
    source: `${events} const emitter = new EventEmitter(); emitter._events = () => {}; console.log(emitter.rawListeners("constructor")[0]("return 6 * 7")());`,
    runsTextAsCode: true,
  },
  "Function through a class field _events": {
    source: `${events} class Odd extends EventEmitter { _events = function () {}; } console.log(new Odd().rawListeners("constructor")[0]("return 6 * 7")());`,
    runsTextAsCode: true,
  },
  "Function through a key that is put together": {
    source: `${events} const emitter = new EventEmitter(); emitter[["_ev", "ents"].join("")] = function () {}; console.log(emitter.rawListeners("constructor")[0]("return 6 * 7")());`,
    runsTextAsCode: true,
  },
  "Function through Object.defineProperty": {
    source: `${events} const emitter = Object.defineProperty(new EventEmitter(), "_events", { value: function () {} }); console.log(emitter.rawListeners("constructor")[0]("return 6 * 7")());`,
    runsTextAsCode: true,
  },
  "Function through a Proxy as the receiver": {
    source: `${events} const anything = new Proxy({}, { get: () => function () {} }); ${attempt(`EventEmitter.prototype.rawListeners.call(anything, "constructor")[0]("return 6 * 7")()`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "Function through an export named _events": {
    source: `${events} import * as space from "./space.mjs"; console.log(EventEmitter.prototype.rawListeners.call(space, "constructor")[0]("return 6 * 7")());`,
    files: { "space.mjs": `export function _events() {}` },
    runsTextAsCode: true,
  },
  "Function through a reviver": {
    source: `${events} const made = JSON.parse('{"_events":1}', (key, value) => (key === "_events" ? function () {} : value)); ${attempt(`EventEmitter.prototype.rawListeners.call(made, "constructor")[0]("return 6 * 7")()`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "Function through the module's own table, found by Object.values and given a prototype": {
    source: `${events} const emitter = new EventEmitter(); for (const value of Object.values(emitter)) if (value && typeof value === "object") Object.setPrototypeOf(value, function () {}); console.log(emitter.rawListeners("constructor")[0]("return 6 * 7")());`,
    runsTextAsCode: true,
  },
  "Function through the setter of __proto__": {
    source: `${events} const emitter = new EventEmitter(); const { set } = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__"); for (const value of Object.values(emitter)) if (value && typeof value === "object") set.call(value, function () {}); ${attempt(`emitter.rawListeners("constructor")[0]("return 6 * 7")()`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "Function through the constructor of _defaultAgent": {
    source: `import http from "node:http"; try { http.request({ agent: false, _defaultAgent: function () {} }); } catch (error) { console.log(error.name); }`,
    runsTextAsCode: true,
  },
  "Function through the keys of what assert.throws expects, seen by Error.prepareStackTrace": {
    source: `import assert from "node:assert"; let found; Error.prepareStackTrace = error => { found ??= Object.values(error.actual ?? {})[0]; return ""; }; try { assert.throws(() => { throw Object.create(function () {}); }, { constructor: 1 }); } catch {} ${attempt(`typeof found === "function" ? found("return 6 * 7")() : "not found"`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "Function through options.stylize": {
    source: `import util from "node:util"; util.inspect.styles = function () {}; ${attempt(`typeof util.inspect({ [util.inspect.custom](depth, options) { return options.stylize("return 6 * 7", "constructor"); } }, { colors: true })`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "Function through stylize taken by its position": {
    source: `import util from "node:util"; ${attempt(`typeof util.inspect({ [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { inspect.styles = function () {}; return Object.values(options)[0]("return 6 * 7", "constructor"); } }, { colors: true })`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "Function through styles that are the prototype of functions": {
    source: `import util from "node:util"; util.inspect.styles = Reflect.getPrototypeOf(function () {}); ${attempt(`typeof util.inspect({ [util.inspect.custom](depth, options) { return options.stylize("return 6 * 7", "constructor"); } }, { colors: true })`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "a function of Math through styles, by an inspector that node:querystring installs": {
    source: `import querystring from "node:querystring"; const name = ["sum", "Precise"].join(""); const own = function (depth, options, inspect) { inspect.styles = Math; return String(options.stylize([1, 2], name)); }; console.log(Bun.inspect(querystring.decode("a=b", null, null, { decodeURIComponent: text => (text === "a" ? Bun.inspect.custom : own) }), { colors: true }));`,
  },
  "a function of Math through styles, by an inspector under a symbol that Symbol without its name registered": {
    source: `const key = Object(Symbol.iterator).constructor.for(["nodejs.util.inspect", "custom"].join(".")); const name = ["sum", "Precise"].join(""); console.log({ [key](depth, options, inspect) { inspect.styles = Math; return inspect({ [key](depth, options) { return String(options.stylize([1, 2], name)); } }, { colors: true }); } });`,
  },
  "a function of Math through styles, by an inspector under a symbol that an import of a WebAssembly module asked the registry for":
    {
      source: `const S = Object(Symbol.iterator).constructor; const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 111, 1, 111, 2, 9, 1, 1, 115, 3, 102, 111, 114, 0, 0, 7, 7, 1, 3, 114, 117, 110, 0, 0]); const key = new WebAssembly.Instance(new WebAssembly.Module(bytes), { s: S }).exports.run(["nodejs.util.inspect", "custom"].join(".")); const name = ["sum", "Precise"].join(""); console.log({ [key](depth, options, inspect) { inspect.styles = Math; return inspect({ [key](depth, options) { return String(options.stylize([1, 2], name)); } }, { colors: true }); } });`,
    },
  "styles as they are meant": {
    source: `import util from "node:util"; util.inspect.styles.number = "red"; util.inspect.styles.string = text => "<" + text + ">"; console.log(JSON.stringify(util.inspect([1, "a", /b/, null], { colors: true }))); util.inspect.styles = { number: "green" }; console.log(JSON.stringify(util.inspect([1, "a"], { colors: true })));`,
  },
  "Function through Object, which util.debuglog hands out": {
    source: `import util from "node:util"; const found = util.debuglog({ toUpperCase: () => "constructor" }); console.log(found === Object ? found.getOwnPropertyDescriptor(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")() : "nothing is inherited");`,
    runsTextAsCode: true,
  },
  "Function through Object, which debuglog taken by its position hands out": {
    source: `import util from "node:util"; const taken = Object.values(util).find(value => typeof value === "function" && value.name.startsWith("debugl")); const found = taken({ toUpperCase: () => "constructor" }); console.log(found === Object ? found.getOwnPropertyDescriptor(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")() : "nothing is inherited");`,
    runsTextAsCode: true,
  },
  "Function through Object, which the listeners of a stream hand out": {
    source: `const found = process.stdout.listeners("constructor")[0]; ${attempt(`found ? Reflect.get(found, "getOwnPropertyDescriptor")(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")() : "nothing is inherited"`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "Function through Object, which the depth of colors hands out": {
    source: `import tty from "node:tty"; const found = tty.WriteStream.prototype.getColorDepth.call({}, { TERM: "constructor" }); console.log(found === Object ? found.getOwnPropertyDescriptor(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")() : "nothing is inherited");`,
    runsTextAsCode: true,
  },
  "Function through the methods of an agent taken by their positions": {
    source: `import https from "node:https"; let found; for (const taken of Object.values(https.Agent.prototype)) { try { found ??= taken.call({ _sessionCache: { map: function () {} } }, "constructor"); } catch {} } console.log(typeof found === "function" ? found("return 6 * 7")() : "nothing is inherited");`,
    runsTextAsCode: true,
  },
  "Function through the cache of a real agent": {
    source: `import https from "node:https"; const agent = new https.Agent(); console.log(typeof agent._getSession("constructor")); agent._sessionCache.map = function () {}; const found = agent._getSession("constructor"); ${attempt(`found ? found("return 6 * 7")() : "nothing is inherited"`)}`,
    runsTextAsCode: true,
  },
  "Function through a cache that is the prototype of functions": {
    source: `import https from "node:https"; const agent = new https.Agent(); agent._sessionCache.map = Reflect.getPrototypeOf(function () {}); ${attempt(`agent._getSession("constructor")("return 6 * 7")()`)}`,
    runsTextAsCode: true,
  },
  "the sessions of an agent as they are meant": {
    source: `import https from "node:https"; const agent = new https.Agent({ maxCachedSessions: 2 }); agent._cacheSession("a:1", "one"); agent._cacheSession("constructor", "two"); agent._cacheSession("b:2", "three"); console.log(agent._getSession("a:1"), agent._getSession("constructor"), agent._getSession("b:2"), agent._getSession("valueOf")); agent._evictSession("b:2"); console.log(agent._getSession("b:2"), agent._sessionCache.list);`,
  },
  "Function through the listener of removeListener": {
    source: `import { Readable } from "node:stream"; let found; const stream = new Readable(); stream.on("removeListener", (type, listener) => { found = listener; }); stream.removeAllListeners("constructor"); ${attempt(`found ? Reflect.get(found, "getOwnPropertyDescriptor")(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")() : "nothing is inherited"`)}`,
    runsTextAsCode: true,
    aheadOfTime: refused,
  },
  "what a stream answers under the names of Object.prototype": {
    source: `import { Readable } from "node:stream"; const stream = new Readable(); console.log(stream.listeners("constructor").length, stream.rawListeners("valueOf").length, stream.listenerCount("toString"), stream.emit("hasOwnProperty")); stream.on("constructor", () => console.log("heard")); console.log(stream.listeners("constructor").length, stream.emit("constructor"));`,
  },
  "a date's method through _events": {
    source: `${events} const method = EventEmitter.prototype.rawListeners.call({ _events: new Date(0) }, "toLocaleDateString")[0]; console.log(method.call(new Date(0), "en-US", { timeZone: "UTC" }));`,
  },
  "a number's method through a class field": {
    source: `${events} class Odd extends EventEmitter { _events = 12345.678; } console.log(new Odd().rawListeners("toLocaleString")[0].call(12345.678, "de-DE"));`,
  },
  "a number's method through what JSON.parse made": {
    source: `${events} console.log(EventEmitter.prototype.rawListeners.call(JSON.parse('{"_events":5}'), "toLocaleString")[0].call(12345.678, "de-DE"));`,
  },
  "a string's method through the environment": {
    source: `${events} process.env._events = "a"; console.log(EventEmitter.prototype.rawListeners.call(process.env, "localeCompare")[0].call("a", "b", "de"));`,
  },
  "emit calls what it finds": {
    source: `${events} try { console.log(EventEmitter.prototype.emit.call({ _events: new Date(0) }, "toLocaleString")); } catch (error) { console.log(error.name); }`,
  },
  "util.debuglog of what says its own upper case": {
    source: `import util from "node:util"; const found = util.debuglog({ toUpperCase: () => "__lookupGetter__" }); console.log(util.debuglog({ toUpperCase: () => "constructor" }) === Object, found === Object.prototype.__lookupGetter__ ? found.call(new Map([[1, 2]]), "size").call(new Map([[1, 2]])) : "nothing is inherited");`,
  },
  "util._extend runs a getter": {
    source: `import util from "node:util"; const copy = util._extend({}, { get late() { return "the getter ran"; }, plain: 1 }); console.log(copy.late, copy.plain);`,
  },
  "util.inspect with getters": {
    source: `import util from "node:util"; console.log(util.inspect(Object.defineProperty({}, "own", { enumerable: true, get() { return (1234.5).toLocaleString("de-DE"); } }), { getters: true }));`,
  },
  "util.inspect with getters out of data": {
    source: `import util from "node:util"; console.log(util.inspect(Object.defineProperty({}, "own", { enumerable: true, get() { return "ran"; } }), JSON.parse('{"getters":true}')));`,
  },
  "an agent whose names are the program's": {
    source: `import http from "node:http"; const agent = new http.Agent(); agent.getName = () => "toLocaleString"; agent.freeSockets = new Date(0); try { agent.addRequest({ onSocket() {}, once() {}, on() {}, emit() {} }, { host: "localhost", port: 1 }); console.log("no throw"); } catch (error) { console.log(error.name); }`,
  },
  "Readable.prototype.wrap binds the methods of what it wraps": {
    source: `import { Readable } from "node:stream"; const old = { on() { return this; }, pause() {}, resume() {}, shout() { return "bound " + (this === old); } }; console.log(new Readable().wrap(old).shout());`,
  },
  "headers named like members of Object.prototype": {
    source: `import http from "node:http"; const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 }); response.setHeader("constructor", "a"); response.setHeader("__proto__", "b"); console.log(response.getHeader("constructor"), response.getHeader("__proto__"), response.getHeader("toString"), response.hasHeader("valueOf"), Object.keys(response.getHeaders()).join());`,
  },
};

describePrograms("tables of built-in modules that a program comes at sideways", programs);
