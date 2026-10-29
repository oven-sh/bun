// Alone: what it prints depends on what else the executable holds: a member of a built-in object that another program calls cannot be written
const f = function () {};
const d = { value: f, configurable: true, writable: true };
// prettier-ignore
const cases = [
  [() => globalThis, () => { Intl = f; }, "Intl = f;"],
  [() => globalThis, () => { globalThis.Intl = f; }, "globalThis.Intl = f;"],
  [() => globalThis, () => { WebAssembly = f; }, "WebAssembly = f;"],
  [() => globalThis, () => { globalThis.WebAssembly = f; }, "globalThis.WebAssembly = f;"],
  [() => globalThis, () => { globalThis.Temporal = f; }, "globalThis.Temporal = f;"],
  [() => globalThis, () => { Iterator = f; }, "Iterator = f;"],
  [() => globalThis, () => { globalThis.Iterator = f; }, "globalThis.Iterator = f;"],
  [() => globalThis, () => { globalThis.eval = f; }, "globalThis.eval = f;"],
  [() => globalThis, () => { parseInt = f; }, "parseInt = f;"],
  [() => globalThis, () => { globalThis.parseInt = f; }, "globalThis.parseInt = f;"],
  [() => globalThis, () => { Promise = f; }, "Promise = f;"],
  [() => globalThis, () => { Object.assign(globalThis, { Date: f }); }, "Object.assign(globalThis, { Date: f });"],
  [() => globalThis, () => { globalThis.Promise = Map; }, "globalThis.Promise = Map;"],
  [() => Array.prototype, () => { Array.prototype.zzz = f; }, "Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { Array.prototype["zzz"] = f; }, "Array.prototype[\"zzz\"] = f;"],
  [() => Array.prototype, () => { Array.prototype.prototype = f; }, "Array.prototype.prototype = f;"],
  [() => Array.prototype, () => { Array.prototype.BYTES_PER_ELEMENT = 1; }, "Array.prototype.BYTES_PER_ELEMENT = 1;"],
  [() => Array.prototype, () => { Object.defineProperty(Array.prototype, "zzz", d); }, "Object.defineProperty(Array.prototype, \"zzz\", d);"],
  [() => Array.prototype, () => { Object.defineProperties(Array.prototype, { zzz: d }); }, "Object.defineProperties(Array.prototype, { zzz: d });"],
  [() => Array.prototype, () => { Object.assign(Array.prototype, { zzz: f }); }, "Object.assign(Array.prototype, { zzz: f });"],
  [() => Array.prototype, () => { return Reflect.set(Array.prototype, "zzz", f); }, "Reflect.set(Array.prototype, \"zzz\", f);"],
  [() => Array.prototype, () => { return Reflect.defineProperty(Array.prototype, "zzz", d); }, "Reflect.defineProperty(Array.prototype, \"zzz\", d);"],
  [() => String.prototype, () => { String.prototype.zzz = f; }, "String.prototype.zzz = f;"],
  [() => Iterator.prototype, () => { Iterator.prototype.zzz = f; }, "Iterator.prototype.zzz = f;"],
  [() => Uint8Array.prototype, () => { Uint8Array.prototype.zzz = f; }, "Uint8Array.prototype.zzz = f;"],
  [() => Intl.Collator.prototype, () => { Intl.Collator.prototype.zzz = f; }, "Intl.Collator.prototype.zzz = f;"],
  [() => Intl.DateTimeFormat.prototype, () => { Object.defineProperty(Intl.DateTimeFormat.prototype, "zzz", d); }, "Object.defineProperty(Intl.DateTimeFormat.prototype, \"zzz\", d);"],
  [() => WebAssembly.Module.prototype, () => { WebAssembly.Module.prototype.zzz = f; }, "WebAssembly.Module.prototype.zzz = f;"],
  [() => Temporal.PlainDate.prototype, () => { Temporal.PlainDate.prototype.zzz = f; }, "Temporal.PlainDate.prototype.zzz = f;"],
  [() => Uint8Array.prototype, () => { Uint8Array.prototype.toBase64 = f; }, "Uint8Array.prototype.toBase64 = f;"],
  [() => Intl.NumberFormat.prototype, () => { Intl.NumberFormat.prototype.formatToParts = f; }, "Intl.NumberFormat.prototype.formatToParts = f;"],
  [() => WebAssembly.Memory.prototype, () => { WebAssembly.Memory.prototype.grow = f; }, "WebAssembly.Memory.prototype.grow = f;"],
  [() => Temporal.Duration.prototype, () => { Temporal.Duration.prototype.add = f; }, "Temporal.Duration.prototype.add = f;"],
  [() => Math, () => { Math.random = f; }, "Math.random = f;"],
  [() => JSON, () => { JSON.parse = f; }, "JSON.parse = f;"],
  [() => Date, () => { Date.now = f; }, "Date.now = f;"],
  [() => Intl, () => { Intl.Collator = f; }, "Intl.Collator = f;"],
  [() => Intl, () => { delete Intl.Collator; }, "delete Intl.Collator;"],
  [() => Intl, () => { Intl.getCanonicalLocales = f; }, "Intl.getCanonicalLocales = f;"],
  [() => Intl.Collator, () => { Intl.Collator.supportedLocalesOf = f; }, "Intl.Collator.supportedLocalesOf = f;"],
  [() => WebAssembly, () => { WebAssembly.compile = f; }, "WebAssembly.compile = f;"],
  [() => WebAssembly, () => { WebAssembly.Module = f; }, "WebAssembly.Module = f;"],
  [() => Temporal, () => { Temporal.Now = f; }, "Temporal.Now = f;"],
  [() => Temporal.Now, () => { Temporal.Now.instant = f; }, "Temporal.Now.instant = f;"],
  [() => Error, () => { Error.captureStackTrace = f; }, "Error.captureStackTrace = f;"],
  [() => Uint8Array, () => { Uint8Array.fromBase64 = f; }, "Uint8Array.fromBase64 = f;"],
  [() => Intl, () => { Intl.toString = f; }, "Intl.toString = f;"],
  [() => TypeError, () => { TypeError.captureStackTrace = f; }, "TypeError.captureStackTrace = f;"],
  [() => AggregateError, () => { AggregateError.isError = f; }, "AggregateError.isError = f;"],
  [() => eval, () => { eval.toString = f; }, "eval.toString = f;"],
  [() => Array.prototype, () => { if (!Array.prototype.zzz) Array.prototype.zzz = f; }, "if (!Array.prototype.zzz) Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { if (typeof Array.prototype.zzz !== "function") Array.prototype.zzz = f; }, "if (typeof Array.prototype.zzz !== \"function\") Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { if (!("zzz" in Array.prototype)) Array.prototype.zzz = f; }, "if (!(\"zzz\" in Array.prototype)) Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { Array.prototype.zzz || (Array.prototype.zzz = f); }, "Array.prototype.zzz || (Array.prototype.zzz = f);"],
  [() => Array.prototype, () => { Array.prototype.zzz ||= f; }, "Array.prototype.zzz ||= f;"],
  [() => Array.prototype, () => { Array.prototype.zzz ??= f; }, "Array.prototype.zzz ??= f;"],
  [() => Array.prototype, () => { if (!Array.prototype.flat || !Array.prototype.zzz) Array.prototype.zzz = f; }, "if (!Array.prototype.flat || !Array.prototype.zzz) Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { if (typeof Math === "object") Array.prototype.zzz = f; }, "if (typeof Math === \"object\") Array.prototype.zzz = f;"],
  [() => Temporal, () => { if (typeof Temporal.Now !== "function") Temporal.Now = f; }, "if (typeof Temporal.Now !== \"function\") Temporal.Now = f;"],
  [() => Array.prototype, () => { { const P = Array.prototype; P.zzz = f; } }, "{ const P = Array.prototype; P.zzz = f; }"],
  [() => Array.prototype, () => { { const P = Array.prototype; Object.defineProperty(P, "zzz", d); } }, "{ const P = Array.prototype; Object.defineProperty(P, \"zzz\", d); }"],
  [() => Array.prototype, () => { globalThis.Array.prototype.zzz = f; }, "globalThis.Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { Array.prototype.zzz++; }, "Array.prototype.zzz++;"],
  [() => Array.prototype, () => { label: { Array.prototype.zzz = f; } }, "label: { Array.prototype.zzz = f; }"],
  [() => Array.prototype, () => { Array.prototype.zzz = f; if (f.length) throw f; }, "Array.prototype.zzz = f; if (f.length) throw f;"],
  [() => Array.prototype, () => { Array.prototype.zzz = f; if (f.length) return; }, "Array.prototype.zzz = f; if (f.length) return;"],
  [() => Array.prototype, () => { function g() { if (f.length) throw f; return 1; } Array.prototype.zzz = f; }, "function g() { if (f.length) throw f; return 1; } Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { const g = () => { throw f; }; Array.prototype.zzz = f; }, "const g = () => { throw f; }; Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { throw (Array.prototype.zzz = f); }, "throw (Array.prototype.zzz = f);"],
  [() => Array.prototype, () => { if (f.length) throw f; Array.prototype.zzz = f; }, "if (f.length) throw f; Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { if (f.length) return; Array.prototype.zzz = f; }, "if (f.length) return; Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { shim: { if (f.length) break shim; Array.prototype.zzz = f; } }, "shim: { if (f.length) break shim; Array.prototype.zzz = f; }"],
  [() => Array.prototype, () => { for (const x of [f]) { if (x.length) continue; } Array.prototype.zzz = f; }, "for (const x of [f]) { if (x.length) continue; } Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { { if (f.length) throw f; } Array.prototype.zzz = f; }, "{ if (f.length) throw f; } Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { if (f.length) throw f; { Array.prototype.zzz = f; } }, "if (f.length) throw f; { Array.prototype.zzz = f; }"],
  [() => Array.prototype, () => { switch (f.length) { case 1: throw f; } Array.prototype.zzz = f; }, "switch (f.length) { case 1: throw f; } Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { try { Array.prototype.zzz = f; } finally {} }, "try { Array.prototype.zzz = f; } finally {}"],
  [() => Array.prototype, () => { for (const x of [f]) Array.prototype.zzz = x; }, "for (const x of [f]) Array.prototype.zzz = x;"],
  [() => Array.prototype, () => { (() => { Array.prototype.zzz = f; })(); }, "(() => { Array.prototype.zzz = f; })();"],
  [() => Array.prototype, () => { class A { static x = (Array.prototype.zzz = f); } }, "class A { static x = (Array.prototype.zzz = f); }"],
  [() => Array.prototype, () => { [Array.prototype.zzz] = [f]; }, "[Array.prototype.zzz] = [f];"],
  [() => Array.prototype, () => { ({ a: Array.prototype.zzz } = { a: f }); }, "({ a: Array.prototype.zzz } = { a: f });"],
  [() => Array.prototype, () => { for (Array.prototype.zzz of [f]); }, "for (Array.prototype.zzz of [f]);"],
  [() => Array.prototype, () => { for (Array.prototype.zzz in { a: 1 }); }, "for (Array.prototype.zzz in { a: 1 });"],
  [() => Array.prototype, () => { Array.prototype[Symbol.for("zzz")] = f; }, "Array.prototype[Symbol.for(\"zzz\")] = f;"],
  [() => Array.prototype, () => { { const k = "zzz"; Array.prototype[k] = f; } }, "{ const k = \"zzz\"; Array.prototype[k] = f; }"],
  [() => Error.prototype, () => { Error.prototype.zzz = f; }, "Error.prototype.zzz = f;"],
  [() => Error.prototype, () => { Error.prototype.name = "x"; }, "Error.prototype.name = \"x\";"],
  [() => Error.prototype, () => { Error.prototype.message = "x"; }, "Error.prototype.message = \"x\";"],
  [() => TypeError.prototype, () => { TypeError.prototype.toString = f; }, "TypeError.prototype.toString = f;"],
  [() => Error.prototype, () => { if (!Error.prototype.message) Error.prototype.message = "x"; }, "if (!Error.prototype.message) Error.prototype.message = \"x\";"],
  [() => Error.prototype, () => { Error.prototype.message ||= "x"; }, "Error.prototype.message ||= \"x\";"],
  [() => Error.prototype, () => { Error.prototype.name &&= "x"; }, "Error.prototype.name &&= \"x\";"],
  [() => Error.prototype, () => { if (typeof Error.prototype.name !== "function") Error.prototype.name = "x"; }, "if (typeof Error.prototype.name !== \"function\") Error.prototype.name = \"x\";"],
  [() => globalThis, () => { globalThis.NaN = 1; }, "globalThis.NaN = 1;"],
  [() => globalThis, () => { globalThis.Infinity = 1; }, "globalThis.Infinity = 1;"],
  [() => globalThis, () => { console = f; }, "console = f;"],
  [() => globalThis, () => { globalThis.console = f; }, "globalThis.console = f;"],
  [() => globalThis, () => { globalThis.Buffer = f; }, "globalThis.Buffer = f;"],
  [() => globalThis, () => { globalThis.setTimeout = f; }, "globalThis.setTimeout = f;"],
  [() => globalThis, () => { globalThis.URL = f; }, "globalThis.URL = f;"],
  [() => globalThis, () => { globalThis.fetch = f; }, "globalThis.fetch = f;"],
  [() => globalThis, () => { globalThis.structuredClone = f; }, "globalThis.structuredClone = f;"],
  [() => globalThis, () => { globalThis.zzz = f; }, "globalThis.zzz = f;"],
  [() => globalThis, () => { Object.defineProperty(globalThis, "zzz", d); }, "Object.defineProperty(globalThis, \"zzz\", d);"],
  [() => globalThis, () => { delete globalThis.zzz; }, "delete globalThis.zzz;"],
  [() => globalThis, () => { Object.assign(globalThis, { zzz: f }); }, "Object.assign(globalThis, { zzz: f });"],
  [() => globalThis, () => { Object.setPrototypeOf(globalThis, {}); }, "Object.setPrototypeOf(globalThis, {});"],
  [() => globalThis, () => { Promise = Promise; }, "Promise = Promise;"],
  [() => globalThis, () => { globalThis.Promise = Promise; }, "globalThis.Promise = Promise;"],
  [() => Array.prototype, () => { delete Array.prototype.zzz; }, "delete Array.prototype.zzz;"],
  [() => Array.prototype, () => { return Reflect.deleteProperty(Array.prototype, "zzz"); }, "Reflect.deleteProperty(Array.prototype, \"zzz\");"],
  [() => Array.prototype, () => { delete Array.prototype.hasOwnProperty; }, "delete Array.prototype.hasOwnProperty;"],
  [() => Array.prototype, () => { Object.defineProperty(Array.prototype, "length", d); }, "Object.defineProperty(Array.prototype, \"length\", d);"],
  [() => Array.prototype, () => { delete Array.prototype.length; }, "delete Array.prototype.length;"],
  [() => Uint8Array.prototype, () => { return Reflect.set(Uint8Array.prototype, "byteLength", f); }, "Reflect.set(Uint8Array.prototype, \"byteLength\", f);"],
  [() => WebAssembly.Global.prototype, () => { WebAssembly.Global.prototype.value = f; }, "WebAssembly.Global.prototype.value = f;"],
  [() => WebAssembly.Global.prototype, () => { return Reflect.set(WebAssembly.Global.prototype, "value", f); }, "Reflect.set(WebAssembly.Global.prototype, \"value\", f);"],
  [() => Intl.Collator.prototype, () => { Intl.Collator.prototype.compare = f; }, "Intl.Collator.prototype.compare = f;"],
  [() => Array, () => { Array.zzz = f; }, "Array.zzz = f;"],
  [() => Array, () => { Array.push = f; }, "Array.push = f;"],
  [() => Array, () => { Array.map = f; }, "Array.map = f;"],
  [() => Array, () => { Object.defineProperty(Array, "push", d); }, "Object.defineProperty(Array, \"push\", d);"],
  [() => Array, () => { Object.assign(Array, { zzz: f }); }, "Object.assign(Array, { zzz: f });"],
  [() => Array, () => { delete Array.push; }, "delete Array.push;"],
  [() => Math, () => { Math.zzz = f; }, "Math.zzz = f;"],
  [() => Math, () => { Math.clamp = f; }, "Math.clamp = f;"],
  [() => Math, () => { Math.zzz += 1; }, "Math.zzz += 1;"],
  [() => Math, () => { globalThis.Math.zzz = f; }, "globalThis.Math.zzz = f;"],
  [() => JSON, () => { JSON.zzz = f; }, "JSON.zzz = f;"],
  [() => Date, () => { Date.getTime = f; }, "Date.getTime = f;"],
  [() => String, () => { String.trim = f; }, "String.trim = f;"],
  [() => Object, () => { Object.zzz = f; }, "Object.zzz = f;"],
  [() => Promise, () => { Promise.then = f; }, "Promise.then = f;"],
  [() => Intl, () => { Intl.zzz = f; }, "Intl.zzz = f;"],
  [() => Intl.Collator, () => { Intl.Collator.zzz = f; }, "Intl.Collator.zzz = f;"],
  [() => WebAssembly, () => { WebAssembly.zzz = f; }, "WebAssembly.zzz = f;"],
  [() => Proxy, () => { Proxy.zzz = f; }, "Proxy.zzz = f;"],
  [() => Reflect, () => { return Reflect.zzz = f; }, "Reflect.zzz = f;"],
  [() => parseInt, () => { parseInt.zzz = f; }, "parseInt.zzz = f;"],
  [() => parseInt, () => { Object.defineProperty(parseInt, "name", d); }, "Object.defineProperty(parseInt, \"name\", d);"],
  [() => Error, () => { Error.stackTraceLimit = 5; }, "Error.stackTraceLimit = 5;"],
  [() => Error, () => { Error.prepareStackTrace = f; }, "Error.prepareStackTrace = f;"],
  [() => Error, () => { delete Error.stackTraceLimit; }, "delete Error.stackTraceLimit;"],
  [() => TypeError, () => { TypeError.stackTraceLimit = 5; }, "TypeError.stackTraceLimit = 5;"],
  [() => Array.prototype, () => { Object.setPrototypeOf(Array.prototype, Object.prototype); }, "Object.setPrototypeOf(Array.prototype, Object.prototype);"],
  [() => Array, () => { Object.setPrototypeOf(Array, Function.prototype); }, "Object.setPrototypeOf(Array, Function.prototype);"],
  [() => Object.prototype, () => { Object.setPrototypeOf(Object.prototype, {}); }, "Object.setPrototypeOf(Object.prototype, {});"],
  [() => Math, () => { Math.max = Math.max; }, "Math.max = Math.max;"],
  [() => Math, () => { return Reflect.set(Math, "max", Math.max); }, "Reflect.set(Math, \"max\", Math.max);"],
  [() => Intl, () => { Intl.Collator = Intl.Collator; }, "Intl.Collator = Intl.Collator;"],
  [() => Number, () => { Number.parseFloat = parseFloat; }, "Number.parseFloat = parseFloat;"],
  [() => String.prototype, () => { String.prototype.trimLeft = String.prototype.trimStart; }, "String.prototype.trimLeft = String.prototype.trimStart;"],
  [() => Array.prototype, () => { Array.prototype[Symbol.iterator] = Array.prototype.values; }, "Array.prototype[Symbol.iterator] = Array.prototype.values;"],
  [() => Array.prototype, () => { if (!Array.prototype.flat) Array.prototype.flat = f; }, "if (!Array.prototype.flat) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (!Array.prototype.flat) { Object.defineProperty(Array.prototype, "flat", d); } }, "if (!Array.prototype.flat) { Object.defineProperty(Array.prototype, \"flat\", d); }"],
  [() => Array.prototype, () => { if (typeof Array.prototype.flat !== "function") Array.prototype.flat = f; }, "if (typeof Array.prototype.flat !== \"function\") Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (typeof Array.prototype.flat === "undefined") Array.prototype.flat = f; }, "if (typeof Array.prototype.flat === \"undefined\") Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (Array.prototype.flat === undefined) Array.prototype.flat = f; }, "if (Array.prototype.flat === undefined) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (Array.prototype.flat == null) Array.prototype.flat = f; }, "if (Array.prototype.flat == null) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (!("flat" in Array.prototype)) Array.prototype.flat = f; }, "if (!(\"flat\" in Array.prototype)) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (!Object.hasOwn(Array.prototype, "flat")) Array.prototype.flat = f; }, "if (!Object.hasOwn(Array.prototype, \"flat\")) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (!Array.prototype.hasOwnProperty("flat")) Array.prototype.flat = f; }, "if (!Array.prototype.hasOwnProperty(\"flat\")) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (!Object.prototype.hasOwnProperty.call(Array.prototype, "flat")) Array.prototype.flat = f; }, "if (!Object.prototype.hasOwnProperty.call(Array.prototype, \"flat\")) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (!Reflect.has(Array.prototype, "flat")) Array.prototype.flat = f; }, "if (!Reflect.has(Array.prototype, \"flat\")) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (Array.prototype.flat) {} else Array.prototype.flat = f; }, "if (Array.prototype.flat) {} else Array.prototype.flat = f;"],
  [() => Array.prototype, () => { Array.prototype.flat || (Array.prototype.flat = f); }, "Array.prototype.flat || (Array.prototype.flat = f);"],
  [() => Array.prototype, () => { Array.prototype.flat ?? (Array.prototype.flat = f); }, "Array.prototype.flat ?? (Array.prototype.flat = f);"],
  [() => Array.prototype, () => { !Array.prototype.flat && (Array.prototype.flat = f); }, "!Array.prototype.flat && (Array.prototype.flat = f);"],
  [() => Array.prototype, () => { Array.prototype.flat ||= f; }, "Array.prototype.flat ||= f;"],
  [() => Array.prototype, () => { Array.prototype.flat ??= f; }, "Array.prototype.flat ??= f;"],
  [() => Array.prototype, () => { Array.prototype.zzz &&= f; }, "Array.prototype.zzz &&= f;"],
  [() => Array.prototype, () => { Array.prototype.hasOwnProperty ||= f; }, "Array.prototype.hasOwnProperty ||= f;"],
  [() => Array.prototype, () => { Array.prototype.flat = Array.prototype.flat || f; }, "Array.prototype.flat = Array.prototype.flat || f;"],
  [() => Array.prototype, () => { Array.prototype.flat = Array.prototype.flat; }, "Array.prototype.flat = Array.prototype.flat;"],
  [() => Array.prototype, () => { Array.prototype.flat ? 0 : (Array.prototype.flat = f); }, "Array.prototype.flat ? 0 : (Array.prototype.flat = f);"],
  [() => Array.prototype, () => { if (!Array.prototype.flat || !Array.prototype.flatMap) Array.prototype.flat = f; }, "if (!Array.prototype.flat || !Array.prototype.flatMap) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { if (!Array.prototype[Symbol.iterator]) Array.prototype[Symbol.iterator] = f; }, "if (!Array.prototype[Symbol.iterator]) Array.prototype[Symbol.iterator] = f;"],
  [() => Array.prototype, () => { if (typeof Bun === "undefined") Array.prototype.zzz = f; }, "if (typeof Bun === \"undefined\") Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { if (typeof Math === "function") Array.prototype.zzz = f; }, "if (typeof Math === \"function\") Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { { const P = Array.prototype; if (!P.flat) P.flat = f; } }, "{ const P = Array.prototype; if (!P.flat) P.flat = f; }"],
  [() => Array.prototype, () => { if (Array.prototype.flat) return; Array.prototype.zzz = f; }, "if (Array.prototype.flat) return; Array.prototype.zzz = f;"],
  [() => Array.prototype, () => { shim: { if (Array.prototype.flat) break shim; Array.prototype.zzz = f; } }, "shim: { if (Array.prototype.flat) break shim; Array.prototype.zzz = f; }"],
  [() => Object, () => { if (!Object.hasOwn) Object.hasOwn = f; }, "if (!Object.hasOwn) Object.hasOwn = f;"],
  [() => Object, () => { if (typeof Object.assign !== "function") Object.defineProperty(Object, "assign", d); }, "if (typeof Object.assign !== \"function\") Object.defineProperty(Object, \"assign\", d);"],
  [() => Object, () => { Object.hasOwn ||= f; }, "Object.hasOwn ||= f;"],
  [() => Number, () => { Number.isNaN = Number.isNaN || f; }, "Number.isNaN = Number.isNaN || f;"],
  [() => Number, () => { if (!Number.MAX_SAFE_INTEGER) Number.MAX_SAFE_INTEGER = 9007199254740991; }, "if (!Number.MAX_SAFE_INTEGER) Number.MAX_SAFE_INTEGER = 9007199254740991;"],
  [() => Symbol, () => { if (!Symbol.asyncIterator) Symbol.asyncIterator = Symbol("x"); }, "if (!Symbol.asyncIterator) Symbol.asyncIterator = Symbol(\"x\");"],
  [() => globalThis, () => { if (typeof Promise === "undefined") globalThis.Promise = f; }, "if (typeof Promise === \"undefined\") globalThis.Promise = f;"],
  [() => globalThis, () => { if (typeof Promise !== "function") Promise = f; }, "if (typeof Promise !== \"function\") Promise = f;"],
  [() => globalThis, () => { if (!globalThis.Proxy) globalThis.Proxy = f; }, "if (!globalThis.Proxy) globalThis.Proxy = f;"],
  [() => globalThis, () => { if (typeof Proxy === "undefined") globalThis.Proxy = f; }, "if (typeof Proxy === \"undefined\") globalThis.Proxy = f;"],
  [() => globalThis, () => { if (typeof Intl === "undefined") globalThis.Intl = f; }, "if (typeof Intl === \"undefined\") globalThis.Intl = f;"],
  [() => globalThis, () => { if (typeof Intl !== "object") globalThis.Intl = f; }, "if (typeof Intl !== \"object\") globalThis.Intl = f;"],
  [() => globalThis, () => { if (typeof WebAssembly === "undefined") globalThis.WebAssembly = f; }, "if (typeof WebAssembly === \"undefined\") globalThis.WebAssembly = f;"],
  [() => globalThis, () => { if (!globalThis.Iterator) globalThis.Iterator = f; }, "if (!globalThis.Iterator) globalThis.Iterator = f;"],
  [() => globalThis, () => { if (typeof zzz === "undefined") globalThis.zzz = f; }, "if (typeof zzz === \"undefined\") globalThis.zzz = f;"],
  [() => globalThis, () => { globalThis.Promise ||= f; }, "globalThis.Promise ||= f;"],
  [() => globalThis, () => { globalThis.Promise = globalThis.Promise || f; }, "globalThis.Promise = globalThis.Promise || f;"],
  [() => Intl, () => { if (!Intl.Collator) Intl.Collator = f; }, "if (!Intl.Collator) Intl.Collator = f;"],
  [() => Intl, () => { if (typeof Intl.Segmenter === "undefined") Intl.Segmenter = f; }, "if (typeof Intl.Segmenter === \"undefined\") Intl.Segmenter = f;"],
  [() => Intl.NumberFormat.prototype, () => { if (!Intl.NumberFormat.prototype.formatToParts) Intl.NumberFormat.prototype.formatToParts = f; }, "if (!Intl.NumberFormat.prototype.formatToParts) Intl.NumberFormat.prototype.formatToParts = f;"],
  [() => Error.prototype, () => { Error.prototype.message ??= "x"; }, "Error.prototype.message ??= \"x\";"],
  [() => Error.prototype, () => { Error.prototype.message &&= "x"; }, "Error.prototype.message &&= \"x\";"],
  [() => Error.prototype, () => { Error.prototype.name ||= "x"; }, "Error.prototype.name ||= \"x\";"],
  [() => Error.prototype, () => { if (typeof Error.prototype.name !== "string") Error.prototype.name = "x"; }, "if (typeof Error.prototype.name !== \"string\") Error.prototype.name = \"x\";"],
  [() => Temporal, () => { if (typeof Temporal.Now !== "object") Temporal.Now = f; }, "if (typeof Temporal.Now !== \"object\") Temporal.Now = f;"],
  [() => Array, () => { if (!Array.zzz) Array.zzz = f; }, "if (!Array.zzz) Array.zzz = f;"],
  [() => Date.prototype, () => { Date.prototype.toString = f; }, "Date.prototype.toString = f;"],
  [() => Date.prototype, () => { Date.prototype.toLocaleDateString = f; }, "Date.prototype.toLocaleDateString = f;"],
  [() => Date.prototype, () => { Date.prototype.zzz = f; }, "Date.prototype.zzz = f;"],
  [() => Date.prototype, () => { Date.prototype.next = f; }, "Date.prototype.next = f;"],
  [() => WeakRef.prototype, () => { WeakRef.prototype.deref = f; }, "WeakRef.prototype.deref = f;"],
  [() => globalThis, () => { globalThis.undefined = 1; }, "globalThis.undefined = 1;"],
  [() => Map.prototype, () => { Map.prototype.size = 1; }, "Map.prototype.size = 1;"],
  [() => Map.prototype, () => { Map.prototype[Symbol.toStringTag] = "x"; }, "Map.prototype[Symbol.toStringTag] = \"x\";"],
  [() => Array, () => { delete Array.prototype; }, "delete Array.prototype;"],
  [() => Array, () => { Array[Symbol.species] = f; }, "Array[Symbol.species] = f;"],
  [() => Math, () => { delete Math.PI; }, "delete Math.PI;"],
  [() => Math, () => { Math.PI++; }, "Math.PI++;"],
  [() => Uint8Array.prototype, () => { Uint8Array.prototype.buffer = f; }, "Uint8Array.prototype.buffer = f;"],
  [() => Float64Array.prototype, () => { Float64Array.prototype[Symbol.toStringTag] = f; }, "Float64Array.prototype[Symbol.toStringTag] = f;"],
  [() => Uint8Array.prototype, () => { Uint8Array.prototype.BYTES_PER_ELEMENT = 2; }, "Uint8Array.prototype.BYTES_PER_ELEMENT = 2;"],
  [() => RegExp.prototype, () => { RegExp.prototype.flags = "g"; }, "RegExp.prototype.flags = \"g\";"],
  [() => Symbol.prototype, () => { Symbol.prototype.description = "x"; }, "Symbol.prototype.description = \"x\";"],
  [() => Array, () => { Array.prototype = {}; }, "Array.prototype = {};"],
  [() => Array, () => { Array.name = "x"; }, "Array.name = \"x\";"],
  [() => Array, () => { Array.length = 3; }, "Array.length = 3;"],
  [() => Math, () => { Math.PI = 3; }, "Math.PI = 3;"],
  [() => Number, () => { Number.MAX_SAFE_INTEGER = 1; }, "Number.MAX_SAFE_INTEGER = 1;"],
  [() => Symbol, () => { Symbol.iterator = f; }, "Symbol.iterator = f;"],
  [() => Uint8Array, () => { Uint8Array.BYTES_PER_ELEMENT = 2; }, "Uint8Array.BYTES_PER_ELEMENT = 2;"],
  [() => Date.prototype, () => { Date.prototype[Symbol.toPrimitive] = f; }, "Date.prototype[Symbol.toPrimitive] = f;"],
  [() => Function.prototype, () => { Function.prototype.arguments = f; }, "Function.prototype.arguments = f;"],
  [() => Function.prototype, () => { Function.prototype.caller = f; }, "Function.prototype.caller = f;"],
  [() => Iterator.prototype, () => { Iterator.prototype.constructor = f; }, "Iterator.prototype.constructor = f;"],
  [() => Iterator.prototype, () => { Iterator.prototype[Symbol.toStringTag] = f; }, "Iterator.prototype[Symbol.toStringTag] = f;"],
  [() => Math, () => { Object.freeze(Math); }, "Object.freeze(Math);"],
  [() => Array, () => { Object.seal(Array); }, "Object.seal(Array);"],
  [() => Object.prototype, () => { Object.freeze(Object.prototype); }, "Object.freeze(Object.prototype);"],
];
const { defineProperty, getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf, is } = Object;
const { ownKeys } = Reflect;
const text = String,
  log = console.log.bind(console);
function look(o) {
  const keys = ownKeys(o),
    found = [];
  for (let i = 0; i < keys.length; i++) found[i] = [keys[i], getOwnPropertyDescriptor(o, keys[i])];
  return { found, parent: getPrototypeOf(o) };
}
function isSame(a, b) {
  return is(a.value, b.value) && a.get === b.get && a.set === b.set;
}
function at(seen, key) {
  for (let i = 0; i < seen.found.length; i++) if (seen.found[i][0] === key) return seen.found[i][1];
}
function changes(before, after) {
  let said = "";
  for (let i = 0; i < after.found.length; i++) {
    const was = at(before, after.found[i][0]);
    if (!was) said += " +" + text(after.found[i][0]);
    else if (!isSame(was, after.found[i][1])) said += " ~" + text(after.found[i][0]);
  }
  for (let i = 0; i < before.found.length; i++)
    if (!at(after, before.found[i][0])) said += " -" + text(before.found[i][0]);
  return before.parent === after.parent ? said : said + " prototype";
}
function restore(o, before) {
  const after = look(o);
  try {
    if (after.parent !== before.parent) setPrototypeOf(o, before.parent);
  } catch {}
  for (let i = 0; i < after.found.length; i++)
    if (!at(before, after.found[i][0])) {
      try {
        delete o[after.found[i][0]];
      } catch {}
    }
  for (let i = 0; i < before.found.length; i++) {
    try {
      defineProperty(o, before.found[i][0], before.found[i][1]);
    } catch {}
  }
}
for (let i = 0; i < cases.length; i++) {
  const o = cases[i][0](),
    before = look(o);
  let said;
  try {
    said = cases[i][1]() === false ? "false" : "ran";
  } catch (e) {
    said = "throws " + (e && e.name);
  }
  said += changes(before, look(o));
  restore(o, before);
  log(cases[i][2] + ": " + said);
}
