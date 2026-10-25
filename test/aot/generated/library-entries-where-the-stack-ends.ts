// Every entry of the library is called near the end of the stack: the exports of node: modules, the statics of global objects and the methods of many receivers, each with a few shapes of arguments.
// The list follows from the Bun that runs this file. One program holds up to 240 entries: it asks each entry twice at the top of the stack; then a recursion runs out of stack, and each of the first
// catches on the way up calls every entry again, each in a try of its own. There an entry throws a RangeError or answers what it answered at the top: anything else is printed as a line "WRONG ..".
const levels = 1500;
/** How long a program probes, about: the number of levels goes by what the two turns at the top cost. */
const seconds = Number(process.env.AOT_STACK_END_SECONDS ?? 2);

// What writes, waits, prints, leaves the process, opens anything or reaches for the network is left out by name.
const never =
  /^(_|constructor$|exit$|abort$|kill$|reallyExit$|chdir$|umask$|dlopen$|binding$|openStdin$|disconnect$|send$|loadEnvFile$|emitWarning$|removeAllListeners$|off$|removeListener$|set[A-Z]|setuid|setgid|seteuid|setegid|setgroups|initgroups|write|append|rm|unlink|mkdir|mkdtemp|rename|copyFile|cp$|cpSync$|link|symlink|truncate|ftruncate|chmod|chown|lchown|lchmod|fchmod|fchown|utimes|futimes|lutimes|open|createWriteStream|createReadStream|watch|unwatchFile|fsync|fdatasync|close|read$|readSync$|readv|takeCoverage|stopCoverage|register$|syncBuiltinESMExports|runMain|enableCompileCache|flushCompileCache|connect|listen|createConnection|createServer|createSecureContext|request$|get$|lookup|resolve[A-Z0-9]|reverse$|alert$|confirm$|prompt$|reportError$|fetch$|wait|pause$|sleep|spawn|exec|fork|log$|error$|warn$|info$|debug$|trace$|table$|dir$|dirxml$|group|count|time|assert$|print|question|generateKey|generatePrime|checkPrime|scrypt|pbkdf2|diffieHellman|createDiffieHellman|getDiffieHellman|createECDH|secureHeapUsed|monitorEventLoopDelay|eventLoopUtilization|gc$|shrink$|serve$|build$|plugin$|mmap$|udpSocket$|openInEditor$|which$|stdin|stdout|stderr)|[Ss]napshot|[Cc]oredump|[Rr]eport|Worker|Inspector|inspector/;
const isName = (key: string) => /^[A-Za-z$][\w$]*$/.test(key);
const groups = new Map<string, string[]>();
const add = (group: string, text: string) => (groups.get(group) ?? groups.set(group, []).get(group)!).push(text);

const moduleShapes = [``, `"a"`, `nothing`, `"a", nothing`, `{}`, `1, 2`];
const modules = ["assert", "assert/strict", "async_hooks", "buffer", "crypto", "diagnostics_channel", "events", "fs", "fs/promises", "module", "os", "path", "path/posix", "path/win32", "perf_hooks", "process", "punycode", "querystring", "readline", "readline/promises", "stream", "stream/promises", "stream/web", "stream/consumers", "string_decoder", "timers", "timers/promises", "tty", "url", "util", "util/types", "v8", "vm", "zlib", "http", "https", "net", "tls"]; // prettier-ignore
for (const name of modules) {
  let exported: Record<string, unknown>;
  try {
    exported = require("node:" + name);
  } catch {
    continue;
  }
  const from = `require("node:${name}")`;
  if (typeof exported === "function")
    for (const shape of moduleShapes) add("module-" + name.replace("/", "-"), `${from}(${shape})`);
  for (const key of Object.keys(exported)) {
    if (!isName(key) || never.test(key)) continue;
    let value: unknown;
    try {
      value = exported[key];
    } catch {
      continue;
    }
    if (typeof value === "function") {
      for (const shape of moduleShapes) add("module-" + name.replace("/", "-"), `${from}.${key}(${shape})`);
      if (/^[A-Z]/.test(key)) for (const shape of [``, `{}`, `"a"`, `nothing`]) add("module-" + name.replace("/", "-"), `new (${from}.${key})(${shape})`);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value) && !/^(promises|posix|win32|constants|types|webcrypto|subtle|env|stdin|stdout|stderr|config|versions|release|features|report|binding|mainModule|codes|globalAgent)$/.test(key))
      for (const inner of Object.keys(value)) if (isName(inner) && !never.test(inner) && typeof (value as Record<string, unknown>)[inner] === "function") for (const shape of [``, `"a"`, `nothing`]) add("module-" + name.replace("/", "-"), `${from}.${key}.${inner}(${shape})`); // prettier-ignore
  }
}

const staticShapes = [``, `[1, 2, 3]`, `nothing`, `{ a: 1 }`, `[1, 2, 3], one`, `"a"`, `{ a: 1 }, "a"`, `1, 2`];
const holders = ["Object", "Array", "Promise", "Reflect", "JSON", "Math", "String", "Number", "BigInt", "Symbol", "Date", "ArrayBuffer", "Proxy", "Iterator", "Map", "Error", "RegExp", "Uint8Array", "Float64Array", "Atomics", "Intl", "URL", "Response", "AbortSignal", "Buffer", "performance", "crypto", "crypto.subtle", "Intl.NumberFormat", "Intl.DateTimeFormat", "Intl.Collator", "Intl.Locale", "Function", "WeakRef", "globalThis"]; // prettier-ignore
for (const holder of holders) {
  const value = holder.split(".").reduce((at: any, part) => at?.[part], globalThis as any);
  if (value === undefined || value === null) continue;
  const names = new Set<string>();
  for (let at = value; at && at !== Object.prototype && at !== Function.prototype; at = Object.getPrototypeOf(at))
    for (const key of Object.getOwnPropertyNames(at)) names.add(key);
  for (const key of names) {
    if (!isName(key) || never.test(key) || /^(caller|callee|arguments|prototype|name|length|eval|Function|Bun|process|require|module|exports|globalThis|self|navigator|console|Loader|WebSocket|EventSource|BroadcastChannel|MessageChannel|MessagePort|ShadowRealm|WebAssembly|HTMLRewriter|postMessage|onmessage|onerror|addEventListener|removeEventListener|dispatchEvent)$/.test(key)) continue; // prettier-ignore
    let member: unknown;
    try {
      member = value[key];
    } catch {
      continue;
    }
    if (typeof member !== "function") continue;
    const text = holder === "globalThis" ? key : `${holder}.${key}`;
    for (const shape of staticShapes) add("static-" + holder.replace(".", "-"), `${text}(${shape})`);
    if (holder === "globalThis" && /^[A-Z]/.test(key))
      for (const shape of [``, `{}`, `"a"`, `nothing`, `8`, `[1, 2]`]) add("new-of-globals", `new ${key}(${shape})`);
  }
}

const methodShapes = [``, `one`, `"a"`, `1`, `[1, 2]`, `one, 0`, `nothing, nothing`, `{}`];
const receivers: Record<string, string> = {
  "array": `[3, 1, 2]`, "array-of-floats": `[1.5, 2.5]`, "array-with-a-hole": `[1, , 3]`, "array-of-objects": `[{ a: 1 }, { a: 2 }]`, "string": `"abcabc"`, "string-of-two-bytes": `"aé😀"`, "number": `(1.5)`, "bigint": `(5n)`, "symbol": `Symbol("s")`, "boolean": `true`,
  "object": `({ a: 1 })`, "function": `(function (a, b) { return a; })`, "arrow": `(a => a)`, "bound": `one.bind(null, 1)`, "class": `(class A { static s() {} })`, "map": `new Map([[1, 2]])`, "set": `new Set([1, 2])`, "weak-map": `new WeakMap()`, "weak-set": `new WeakSet()`, "weak-ref": `new WeakRef({})`,
  "date": `new Date(0)`, "pattern": `/a(b)?/g`, "sticky-pattern": `/a/y`, "promise": `Promise.resolve(1)`, "rejected": `Promise.reject(1)`, "bytes": `new Uint8Array(4)`, "floats": `new Float64Array(4)`, "big-ints": `new BigInt64Array(2)`, "array-buffer": `new ArrayBuffer(8)`, "resizable": `new ArrayBuffer(8, { maxByteLength: 16 })`, "data-view": `new DataView(new ArrayBuffer(8))`,
  "array-iterator": `[1, 2].values()`, "map-iterator": `new Map([[1, 2]]).entries()`, "string-iterator": `"ab"[Symbol.iterator]()`, "pattern-iterator": `"aa".matchAll(/a/g)`, "helper": `[1, 2].values().map(one)`, "generator": `(function* () { yield 1; yield 2; })()`, "async-generator": `(async function* () { yield 1; })()`, "error": `new Error("e")`, "aggregate-error": `new AggregateError([1], "e")`, "arguments": `(function () { return arguments; })(1, 2)`, "proxy": `new Proxy([1, 2], {})`,
  "buffer": `Buffer.from("abcd")`, "url": `new URL("http://a.example/b?c=d")`, "search": `new URLSearchParams("a=b&c=d")`, "headers": `new Headers({ a: "b" })`, "form": `new FormData()`, "blob": `new Blob(["ab"])`, "file": `new File(["ab"], "f")`, "response": `new Response("x")`, "request": `new Request("http://a.example/", { method: "POST", body: "x" })`,
  "readable-web": `new ReadableStream({ pull(c) { c.enqueue(1); c.close(); } })`, "writable-web": `new WritableStream()`, "transform-web": `new TransformStream()`, "reader": `new ReadableStream().getReader()`, "encoder": `new TextEncoder()`, "decoder": `new TextDecoder()`, "controller": `new AbortController()`, "signal": `new AbortController().signal`, "target": `new EventTarget()`, "event": `new Event("x")`, "exception": `new DOMException("m", "n")`,
  "number-format": `new Intl.NumberFormat("en")`, "date-format": `new Intl.DateTimeFormat("en", { timeZone: "UTC" })`, "collator": `new Intl.Collator("en")`, "plural": `new Intl.PluralRules("en")`, "list-format": `new Intl.ListFormat("en")`, "relative": `new Intl.RelativeTimeFormat("en")`, "segmenter": `new Intl.Segmenter("en")`, "locale": `new Intl.Locale("en-US")`, "display-names": `new Intl.DisplayNames("en", { type: "region" })`,
  "emitter": `new (require("node:events"))()`, "readable": `new (require("node:stream").Readable)({ read() {} })`, "writable": `new (require("node:stream").Writable)({ write(c, e, done) { done(); } })`, "duplex": `new (require("node:stream").Duplex)({ read() {}, write(c, e, done) { done(); } })`, "transform": `new (require("node:stream").Transform)({ transform(c, e, done) { done(null, c); } })`, "pass-through": `new (require("node:stream").PassThrough)()`,
  "hash": `require("node:crypto").createHash("sha1")`, "hmac": `require("node:crypto").createHmac("sha1", "k")`, "string-decoder": `new (require("node:string_decoder").StringDecoder)("utf8")`, "storage": `new (require("node:async_hooks").AsyncLocalStorage)()`, "resource": `new (require("node:async_hooks").AsyncResource)("r")`, "gzip": `require("node:zlib").createGzip()`, "agent": `new (require("node:http").Agent)()`, "channel": `require("node:diagnostics_channel").channel("c")`, "mime": `new (require("node:util").MIMEType)("text/plain")`, "timeout": `setTimeout(nothing, 100000).unref()`, "immediate": `setImmediate(nothing).unref()`, "histogram": `require("node:perf_hooks").createHistogram()`, "script": `new (require("node:vm").Script)("1")`, "stats": `require("node:fs").statSync(".")`,
}; // prettier-ignore
function nothing() {}
function one(a: unknown) {
  return a;
}
(void nothing, one);
for (const [name, text] of Object.entries(receivers)) {
  let value: any;
  try {
    value = (0, eval)(`(function (nothing, one, require) { return ${text}; })`)(nothing, one, require);
    if (value instanceof Promise) value.catch(nothing);
  } catch {
    continue;
  }
  const names = new Set<string>(),
    reads = new Set<string>();
  const isPlain = name === "object";
  for (let at = Object(value); at && (isPlain || at !== Object.prototype); at = Object.getPrototypeOf(at))
    for (const key of Object.getOwnPropertyNames(at)) {
      if (
        !isName(key) ||
        /^(caller|callee|arguments)$/.test(key) ||
        (never.test(key) &&
          !/^(write|end|close|read|get|set[A-Z]|log|count|time|pause|append|open|link|assert|error|wait|reverse|resolve)/.test(
            key,
          )) ||
        /^(constructor|connect|listen|_.*)$/.test(key)
      )
        continue;
      const own = Object.getOwnPropertyDescriptor(at, key)!;
      if ("value" in own ? typeof own.value === "function" : false) names.add(key);
      else if (own.get) reads.add(key);
    }
  // What compiled code hands to the engine's own functions.
  for (const form of [
    "Object.keys(X).length",
    "Object.values(X).length",
    "Object.entries(X).length",
    "Object.getOwnPropertyNames(X).length",
    "Object.getOwnPropertySymbols(X).length",
    "Reflect.ownKeys(X).length",
    "Object.keys(Object.getOwnPropertyDescriptors(X)).length",
    'typeof Object.getOwnPropertyDescriptor(X, "length")',
    'typeof Object.getOwnPropertyDescriptor(X, "a")',
    "typeof Object.getOwnPropertyDescriptor(X, 0)",
    "typeof Object.getOwnPropertyDescriptor(X, Symbol.iterator)",
    'typeof Reflect.getOwnPropertyDescriptor(X, "length")',
    "typeof Object.getPrototypeOf(X)",
    "Object.isFrozen(X)",
    "Object.isSealed(X)",
    "Object.isExtensible(X)",
    'Object.hasOwn(X, "a")',
    'Object.hasOwn(X, "length")',
    "Object.hasOwn(X, 0)",
    'Reflect.has(X, "a")',
    'typeof Reflect.get(X, "length")',
    "Object.keys(Object.assign({}, X)).length",
    "Object.keys({ ...X }).length",
    "Object.keys(Object.fromEntries(Object.entries(X))).length",
    "Object.keys(Object.defineProperties({}, Object.getOwnPropertyDescriptors(X))).length",
    "Object.defineProperties(target, Object.getOwnPropertyDescriptors(X)) === target",
    "Object.keys(Object.create(Object.getPrototypeOf(X), Object.getOwnPropertyDescriptors(X))).length",
    "Object.setPrototypeOf({}, Object.getPrototypeOf(X)) !== null",
    "Object.entries(X).map(one).length",
    "Object.keys(X).join()",
    "Object.values(X).map(String).length",
    "new Map(Object.entries(X)).size",
    "(() => { let n = 0; for (const key in X) n++; return n; })()",
    "(() => { const { a, ...rest } = X; return Object.keys(rest).length; })()",
    "typeof JSON.stringify(X)",
    "Object.prototype.toString.call(X)",
    'Object.prototype.hasOwnProperty.call(X, "a")',
    'Object.prototype.propertyIsEnumerable.call(X, "a")',
    "typeof Object(X)",
    "Array.from(Object.keys(X), one).length",
    "Object.freeze(X) !== null",
    "Object.seal(X) !== null",
    "Object.preventExtensions(X) !== null",
  ])
    add("statics-on-" + name, form.replaceAll("X", text));
  if (/^(bytes|floats|big-ints|buffer)$/.test(name)) for (const form of ["X.subarray(-4).length", "X.subarray(1, -1).length", "X.subarray(2).subarray(-1).length", "X.subarray(\"1\").length", "X.subarray({ valueOf: () => 1 }).length", "new TextEncoder().encodeInto(\"héllo\", new Uint8Array(8).subarray(-4)).written", "new TextEncoder().encodeInto(\"héllo\", new Uint8Array(8).subarray(2)).read", "new TextEncoder().encodeInto(\"a\", new Uint8Array(X.buffer).subarray(-2)).written", "X.slice(-2).length", "X.subarray(-2).fill(1).length", "X.subarray(-2).set([1]) === undefined", "new X.constructor(X.buffer, 0, 1).length"]) add("views-of-" + name, form.replaceAll("X", text)); // prettier-ignore
  for (const key of names) for (const shape of methodShapes) add("methods-of-" + name, `${text}.${key}(${shape})`);
  for (const key of reads) add("methods-of-" + name, `${text}.${key}`);
}

// Calls that come back into the program through the engine.
const helpers = `
function wide(a, b, c, d, e, f, g, h, i, j, k, l, m, n) {
  return a + b + c + d + e + f + g + h + i + j + k + l + m + n;
}
function rest(...all) {
  return all.length;
}
function sumOf(...all) {
  let sum = 0;
  for (const each of all) sum += each;
  return sum;
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  get sum() {
    return this.x + this.y;
  }
  *[Symbol.iterator]() {
    yield this.x;
    yield this.y;
  }
  toString() {
    return this.x + "," + this.y;
  }
  valueOf() {
    return this.x;
  }
  static of(x, y) {
    return new Point(x, y);
  }
}
class Point3 extends Point {
  constructor(...all) {
    super(...all);
    this.z = 3;
  }
}
class Derived extends Point {}
class List extends Array {}
class Bytes extends Uint8Array {}
class Pattern extends RegExp {}
class Table extends Map {}
class Bag extends Set {}
class Later extends Promise {}
class Oops extends Error {}
function Old(v) {
  this.v = v;
}
function* counts(to) {
  for (let at = 0; at < to; at++) yield at;
}
function* both() {
  const got = yield 1;
  yield* counts(2);
  return got;
}
async function later(v) {
  return v;
}
const list14 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const list200 = Array.from({ length: 200 }, (_, at) => at);
const custom = {
  [Symbol.iterator]() {
    let at = 0;
    return { next: () => (at < 3 ? { done: false, value: at++ } : { done: true, value: undefined }), return: () => ({ done: true, value: undefined }) };
  },
};
const arrayLike = { length: 3, 0: "a", 1: "b", 2: "c" };
const spreadable = { length: 2, 0: 1, 1: 2, [Symbol.isConcatSpreadable]: true };
const stands = { [Symbol.replace]: (text, by) => text + by, [Symbol.match]: text => [text], [Symbol.search]: () => 1, [Symbol.split]: text => [text], [Symbol.matchAll]: text => [[text]] };
const boundWide = wide.bind(null, 1, 2, 3);
const boundPoint = Point.bind(null, 1);
const boundRest = rest.bind(null, 1);
const proxiedList = new Proxy([1, 2, 3], {});
const proxiedFunction = new Proxy(one, {});
const proxiedClass = new Proxy(Point, {});
const withAccessor = Object.defineProperty([1, 2, 3], 1, { get: () => 5, configurable: true, enumerable: true });
const frozen = Object.freeze([3, 1, 2]);
const holes = [1, , 3];
const point = new Point(1, 2);
const pick = at => [wide, one, rest, Math.max, boundWide, proxiedFunction, Point, Point3, boundPoint, proxiedClass, Old, Array, Map][Number(String(at))];
`;
const forms: Record<string, string[]> = {
  iteration: [
    "[...custom].length",
    "[...point].join()",
    "[...counts(3)].join()",
    "[...new Map([[1, 2]])].length",
    "[...new Set([1, 2])].join()",
    '[..."a😀"].length',
    "[...new Uint8Array(3)].length",
    "[...proxiedList].join()",
    "[...(function () { return arguments; })(1, 2)].join()",
    "[...new Table([[1, 2]])].length",
    "[...new List(1, 2, 3)].join()",
    "[...holes].length",
    "[...withAccessor].join()",
    "(() => { let n = 0; for (const each of custom) n += each; return n; })()",
    "(() => { let n = 0; for (const each of custom) { n += each; break; } return n; })()",
    "(() => { let n = 0; for (const each of point) n += each; return n; })()",
    "(() => { let n = 0; for (const [k, v] of new Map([[1, 2]])) n += k + v; return n; })()",
    "(() => { let n = 0; for (const each of proxiedList) n += each; return n; })()",
    "(() => { let n = 0; for (const each of counts(4)) { if (each > 1) break; n++; } return n; })()",
    "(() => { const [a, b] = custom; return a + b; })()",
    "(() => { const [a, ...others] = custom; return a + others.length; })()",
    "(() => { const [a, b] = point; return a + b; })()",
    "(() => { const [a = 5, , c] = holes; return a + c; })()",
    "(() => { const [[a], [b]] = new Map([[1, 2], [3, 4]]); return a + b; })()",
    "(([a, b]) => a + b)(custom)",
    "new Map(new Table([[1, 2]])).size",
    "new Set(custom).size",
    "new Set(point).size",
    "Array.from(custom).length",
    "Array.from(custom, one).length",
    "Array.from(point).join()",
    "Array.from(arrayLike).join()",
    "new Uint8Array(custom).length",
    'Object.fromEntries(new Map([["a", 1]])).a',
    "Math.max(...custom)",
    "sumOf(...point)",
    "rest(...custom, ...point)",
    "new Point(...point).sum",
    "[...both()].join()",
    "Array.from(new Map([[1, 2]]).keys()).join()",
    "[...[1, 2].entries()].length",
    '[..."ab".matchAll(/./g)].length',
    "Iterator.from(custom).toArray().length",
    "Iterator.from(custom).map(one).toArray().join()",
    "[1, 2, 3].values().filter(one).take(2).toArray().join()",
  ],
  calls: [
    "wide(...list14)",
    "pick(0)(...list14)",
    "pick(0).apply(null, list14)",
    "pick(0).call(null, ...list14)",
    "Reflect.apply(pick(0), null, list14)",
    "wide.apply(null, list14)",
    "wide.call(null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)",
    "Reflect.apply(wide, null, list14)",
    "String(pick(0)(1))",
    "String(pick(0)())",
    "pick(1)(1, 2, 3, 4, 5, 6, 7, 8, 9)",
    "pick(2)(...list200)",
    "rest(...list200)",
    "rest.apply(null, list200)",
    "rest.apply(null, arrayLike)",
    "rest.apply(null, proxiedList)",
    "Reflect.apply(rest, null, arrayLike)",
    "pick(3)(...list14)",
    "pick(3).apply(null, list200)",
    "Math.max.apply(null, list200)",
    "Math.max.call(null, 1, 2, 3)",
    "pick(4)(4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)",
    "boundWide(...list14.slice(3))",
    "boundWide.apply(null, list14.slice(3))",
    "boundRest(...list200)",
    "pick(5)(7)",
    "proxiedFunction(...[7])",
    "proxiedFunction.apply(null, [7])",
    "Reflect.apply(proxiedFunction, null, [7])",
    "one.bind(null).bind(null)(3)",
    "Function.prototype.call.call(one, null, 4)",
    "Function.prototype.apply.call(one, null, [4])",
    "Function.prototype.call.apply(one, [null, 4])",
    "Function.prototype.bind.call(one, null, 4)()",
    "[one][0](5)",
    "({ m: one }).m(5)",
    "({ m: rest }).m(...list14)",
    "point.toString.call(new Point(3, 4))",
    "Point.of(...[1, 2]).sum",
    "Point.of.apply(Point, [1, 2]).sum",
    "(a => a)(...[6])",
    "(function () { return rest(...arguments); })(1, 2, 3)",
    "(function () { return rest.apply(null, arguments); })(1, 2, 3)",
    "(function () { return sumOf.apply(this, arguments); })(1, 2, 3)",
    "typeof later(...[1]).then(nothing)",
    "counts(...[2]).next().value",
    "String.fromCharCode(...list14).length",
    "[].push(...list200)",
    "[].concat(...[[1], [2]]).length",
    "Array.of(...list14).length",
    "Array.prototype.slice.call(arrayLike, 1).join()",
    "Array.prototype.slice.apply(list14, [1, 3]).join()",
    "Object.prototype.toString.apply(list14)",
    'parseInt.call(null, "12")',
    "JSON.stringify.apply(null, [{ a: 1 }])",
  ],
  construct: [
    "new Point(1, 2).sum",
    "new (pick(6))(1, 2).sum",
    "new (pick(6))(...[1, 2]).sum",
    "new (pick(7))(1, 2).z",
    "new (pick(7))(...[1, 2]).sum",
    "new Point3(1, 2).sum",
    "new Derived(1, 2).sum",
    "new Derived(...[1, 2]).sum",
    "new (pick(8))(2).sum",
    "new boundPoint(2).sum",
    "new boundPoint(...[2]).sum",
    "new (pick(9))(1, 2).sum",
    "new proxiedClass(...[1, 2]).sum",
    "new (pick(10))(3).v",
    "new Old(...[3]).v",
    "new (pick(11))(1, 2, 3).length",
    "new Array(...list14).length",
    "new (pick(12))([[1, 2]]).size",
    "Reflect.construct(Point, [1, 2]).sum",
    "Reflect.construct(Point, [1, 2], Point3) instanceof Point3",
    "Reflect.construct(Point3, [1, 2]).z",
    "Reflect.construct(boundPoint, [2]).sum",
    "Reflect.construct(boundPoint, [2], Derived) instanceof Derived",
    "Reflect.construct(proxiedClass, [1, 2]).sum",
    "Reflect.construct(Old, [3]).v",
    "Reflect.construct(Array, [3]).length",
    "Reflect.construct(Map, [[[1, 2]]]).size",
    "Reflect.construct(Date, [0]).getTime()",
    "Reflect.construct(Point, arrayLike).x",
    "Reflect.construct(function () { return new.target === undefined; }, []) !== null",
    "new List(1, 2, 3).length",
    "new List(...list14).map(one).length",
    "new List(1, 2, 3).map(one) instanceof List",
    "new List(1, 2, 3).filter(one).length",
    "new List(1, 2, 3).slice(1) instanceof List",
    "new List(1, 2).concat([3]).length",
    "List.from([1, 2]).length",
    "List.of(1, 2) instanceof List",
    "new Bytes(4).length",
    "new Bytes([1, 2]).map(one) instanceof Bytes",
    "new Bytes(4).subarray(1) instanceof Bytes",
    "new Bytes(4).slice(1).length",
    "Bytes.from([1, 2]).length",
    'new Pattern("a", "g").test("a")',
    '"aa".replace(new Pattern("a", "g"), "b")',
    "new Table([[1, 2]]).get(1)",
    "new Bag([1, 1]).size",
    'new Oops("m").message',
    'new Oops("m") instanceof Error',
    "typeof new Later(resolve => resolve(1)).then(nothing)",
    "Later.resolve(1) instanceof Later",
    "typeof Later.all([1]).then(nothing)",
    "new (class extends Point { constructor() { super(1, 2); } })().sum",
    "new (class extends Old {})(3).v",
    "new (class extends Array { constructor() { super(3); } })().length",
    "new (class extends boundPoint {})(2).sum",
    "new (class { static make() { return new this(); } }).constructor.make() !== null",
    "new (class { x = one(1); #y = 2; get y() { return this.#y; } })().y",
    "new Date(2000, 1, 2, 3, 4, 5, 6).getFullYear()",
    "new Proxy(Point, { construct: (t, a) => new t(a[0], a[1]) })(1, 2) === undefined",
  ],
  strings: [
    '"abc".replace(/b/, "x")',
    '"abc".replace(/b/g, one)',
    '"abcb".replaceAll(/b/g, "x")',
    '"abcb".replaceAll("b", one)',
    '"abc".replace("b", () => "y")',
    '"abc".replace(stands, "z")',
    '"abc".replaceAll(stands, "z")',
    '"abc".match(/b/)[0]',
    '"abcb".match(/b/g).length',
    '"abc".match(stands)[0]',
    '[..."abcb".matchAll(/b/g)].length',
    '[..."abc".matchAll(stands)].length',
    '"abc".search(/c/)',
    '"abc".search(stands)',
    '"a,b".split(/,/).length',
    '"a,b".split(",").length',
    '"a,b".split(stands).length',
    '"a,b,c".split(/,/, 2).length',
    '"abc".replace(new Pattern("b"), "x")',
    '"abc".match(new Pattern("b"))[0]',
    '"a,b".split(new Pattern(",")).length',
    '"abc".replace(/(?<n>b)/, "[$<n>]")',
    '"abc".replace(/(b)/, (all, first, at) => first + at)',
    '"abc".replace(/b/y, "x")',
    '"aaa".replace(/a/gy, "b")',
    '/b/[Symbol.replace]("abc", "x")',
    '/b/g[Symbol.match]("abcb").length',
    '/,/[Symbol.split]("a,b").length',
    'RegExp.prototype[Symbol.replace].call({ exec: () => null, flags: "" }, "abc", "x")',
    'RegExp.prototype.test.call({ exec: () => ["a"] }, "a")',
    '"abc".replace({ toString: () => "b" }, "x")',
    '"abc".replace("b", { toString: () => "x" })',
    '"abc".includes({ toString: () => "b" })',
    '"abc".indexOf({ toString: () => "b" })',
    '"abc".concat(point, 1)',
    '"abc".padEnd(5, { toString: () => "x" })',
    '"a".localeCompare({ toString: () => "b" })',
    '`${point}|${[1, 2]}|${{ toString: () => "t" }}`',
    '"" + point',
    'point + ""',
    "String(point)",
    '[point, point].join("|")',
    "String([1, [2, [3]]])",
    '"abc".at({ valueOf: () => 1 })',
    '"abc".slice({ valueOf: () => 1 })',
    '"abc".charCodeAt({ valueOf: () => 1 })',
    '"abc".repeat({ valueOf: () => 2 })',
    "String.raw({ raw: arrayLike }, 1, 2)",
    "String.raw`a${1}b`",
    "((parts, v) => parts.length + v)`a${1}b`",
  ],
  arrays: [
    "Array.prototype.map.call(arrayLike, one).join()",
    "Array.prototype.filter.call(arrayLike, one).length",
    "Array.prototype.forEach.call(arrayLike, nothing) === undefined",
    "Array.prototype.reduce.call(arrayLike, (a, b) => a + b)",
    "Array.prototype.join.call(arrayLike)",
    'Array.prototype.indexOf.call(arrayLike, "b")',
    'Array.prototype.includes.call(arrayLike, "b")',
    "Array.prototype.some.call(arrayLike, one)",
    "Array.prototype.every.call(arrayLike, one)",
    "Array.prototype.find.call(arrayLike, one)",
    "Array.prototype.concat.call(arrayLike, [1]).length",
    "Array.prototype.flat.call(arrayLike).length",
    "Array.prototype.at.call(arrayLike, -1)",
    "Array.prototype.toSorted.call(arrayLike).join()",
    'Array.prototype.with.call(arrayLike, 0, "z").join()',
    "Array.prototype.push.call({ length: 0 }, 1, 2)",
    "Array.prototype.pop.call({ length: 1, 0: 5 })",
    "Array.prototype.reverse.call({ length: 2, 0: 1, 1: 2 })[0]",
    "Array.prototype.sort.call({ length: 2, 0: 2, 1: 1 })[0]",
    "Array.prototype.splice.call({ length: 2, 0: 1, 1: 2 }, 0, 1).length",
    "Array.prototype.fill.call({ length: 2 }, 7)[1]",
    'Array.prototype.map.call("abc", one).join()',
    "Array.prototype.map.call(new Uint8Array(2), one).length",
    "proxiedList.map(one).join()",
    "proxiedList.filter(one).length",
    "proxiedList.join()",
    "proxiedList.indexOf(2)",
    "proxiedList.includes(2)",
    "proxiedList.slice(1).join()",
    "proxiedList.concat([4]).length",
    "proxiedList.reduce((a, b) => a + b)",
    "proxiedList.flat().length",
    "proxiedList.at(-1)",
    "proxiedList.toSorted().join()",
    "[...proxiedList.keys()].length",
    "Array.isArray(proxiedList)",
    "JSON.stringify(proxiedList)",
    "withAccessor.map(one).join()",
    "withAccessor.join()",
    "withAccessor.indexOf(5)",
    "withAccessor.includes(5)",
    "withAccessor.slice().join()",
    "withAccessor.concat([4]).join()",
    "withAccessor.reduce((a, b) => a + b)",
    "withAccessor.toSorted().join()",
    "withAccessor.at(1)",
    "withAccessor.find(each => each === 5)",
    "JSON.stringify(withAccessor)",
    "withAccessor.flat().join()",
    "[...withAccessor.entries()].length",
    "holes.map(one).length",
    "holes.join()",
    "holes.indexOf(undefined)",
    "holes.includes(undefined)",
    "holes.flat().length",
    "holes.reduce((a, b) => a + b)",
    "holes.toSorted().length",
    "holes.filter(() => true).length",
    "Object.keys(holes).length",
    "holes.findLast(() => true)",
    "holes.concat(holes).length",
    "JSON.stringify(holes)",
    "frozen.toSorted().join()",
    "frozen.map(one).join()",
    "frozen.slice().sort().join()",
    "frozen.concat(spreadable).length",
    "[].concat(spreadable, [3]).length",
    "[0].concat(arrayLike).length",
    "[[1, [2]], [3]].flat(Infinity).join()",
    "[1, 2].flatMap(each => [each, [each]]).length",
    "[3, 1, 2].sort((a, b) => a - b).join()",
    "[3, 1, 2].sort().join()",
    "[point, new Point(0, 1)].sort().length",
    "[3, 1, 2].toSorted((a, b) => b - a).join()",
    "[1, 2, 3].toSpliced(1, 1, 9).join()",
    "[1, 2, 3].copyWithin(0, 1).join()",
    "[1, 2, 3].lastIndexOf(3)",
    "[1, 2, 3].findLastIndex(one)",
    "[1, 2, 3].reduceRight((a, b) => a + b)",
    "[1, 2, 3].entries().next().value.join()",
    '[{ toString: () => "t" }, null, undefined, 1].join()',
    "[1, 2, 3].toLocaleString()",
    'Object.groupBy([1, 2, 3], each => (each % 2 ? "odd" : "even")).odd.length',
    "Map.groupBy([1, 2, 3], each => each % 2).size",
    "Array.from({ length: 3 }, (_, at) => at * 2).join()",
    "Array.from(new Set([1, 2]), one).join()",
    "new Uint8Array([3, 1, 2]).sort().join()",
    "new Uint8Array([3, 1, 2]).sort((a, b) => b - a).join()",
    "new Uint8Array([1, 2]).map(one).join()",
    "new Uint8Array([1, 2]).filter(one).length",
    "new Uint8Array([1, 2]).reduce((a, b) => a + b)",
    "new Uint8Array([1, 2]).find(one)",
    "new Uint8Array([1, 2]).toSorted().join()",
    "new Uint8Array([1, 2]).with(0, 5).join()",
    "new Float64Array([1.5, 2.5]).map(one).join()",
    "Uint8Array.from(custom).length",
    "Uint8Array.from(arrayLike, () => 1).join()",
    "Uint8Array.of(1, 2).length",
    "new Uint8Array(arrayLike).length",
    "new Uint8Array(new Uint8Array(4).buffer, 1, 2).length",
    "(() => { const b = new Uint8Array(4); b.set(arrayLike.length ? [1, 2] : [], 1); return b.join(); })()",
    "(() => { const b = new Uint8Array(4); b.set(new Bytes([7]), 2); return b.join(); })()",
  ],
  generators: [
    "counts(3).next().value",
    "(() => { const g = both(); g.next(); return g.next(5).value; })()",
    "(() => { const g = both(); g.next(); g.next(5); g.next(); return g.next().value; })()",
    "(() => { const g = counts(3); g.next(); return g.return(9).value; })()",
    '(() => { const g = counts(3); g.next(); try { g.throw(new Oops("o")); } catch (error) { return error.message; } })()',
    "(() => { const g = (function* () { try { yield 1; } finally { yield 2; } })(); g.next(); return g.return(9).value; })()",
    "(() => { const g = (function* () { try { yield 1; } catch (error) { yield error; } })(); g.next(); return g.throw(7).value; })()",
    "(() => { const g = (function* () { yield* custom; })(); return g.next().value + g.next().value; })()",
    "(() => { const g = (function* () { yield* [1, 2]; })(); g.next(); return g.return(4).value; })()",
    "(() => { const g = (function* () { return yield* both(); })(); g.next(); return g.next(3).value; })()",
    '[...(function* () { yield* "ab"; })()].join()',
    "Array.from(counts(3), one).join()",
    "counts(3)[Symbol.iterator]().next().value",
    "Object.prototype.toString.call(counts(1))",
    "typeof (async function* () { yield 1; })().next().then(nothing)",
    "typeof (async function* () { yield* counts(2); })().next().then(nothing)",
    "typeof (async () => { for await (const each of counts(2)) nothing(each); })().then(nothing)",
    "typeof (async () => { await later(1); return 2; })().then(nothing)",
    "typeof (async () => { await { then: resolve => resolve(1) }; })().then(nothing)",
    "typeof Array.fromAsync(counts(2)).then(nothing)",
  ],
  conversions: [
    "+point",
    "point * 2",
    "point + 1",
    "point > 0",
    "point == 1",
    "`${point}`",
    "Number(point)",
    "BigInt({ valueOf: () => 5n }) === 5n",
    "Number({ [Symbol.toPrimitive]: () => 4 })",
    "String({ [Symbol.toPrimitive]: hint => hint })",
    "`${{ [Symbol.toPrimitive]: hint => hint }}`",
    '+{ [Symbol.toPrimitive]: hint => (hint === "number" ? 1 : 2) }',
    '({ [Symbol.toPrimitive]: hint => hint }) + ""',
    '[1, 2, 3][{ toString: () => "1" }]',
    '({ a: 1 })[{ toString: () => "a" }]',
    '({ [point]: 1 })["1,2"]',
    '({ [{ toString: () => "k" }]: 2 }).k',
    '({ toString: () => "a" }) in { a: 1 }',
    "new Date({ valueOf: () => 0 }).getTime()",
    "new Date(0) - 0",
    'new Date(0) + "" !== ""',
    "Math.max(point, { valueOf: () => 3 })",
    "Math.abs({ valueOf: () => -3 })",
    'parseInt({ toString: () => "12" })',
    "isNaN({ valueOf: () => NaN })",
    '[point] == "1,2"',
    'Symbol.for({ toString: () => "s" }).description',
    "({}) instanceof ({ [Symbol.hasInstance]: () => true })",
    "point instanceof Point",
    "point instanceof boundPoint",
    "point instanceof proxiedClass",
    "Object(1n) + 1n === 2n",
    "JSON.stringify({ toJSON: () => 1 })",
    "JSON.stringify({ a: point, b: { toJSON: key => key } })",
    'JSON.stringify({ a: 1, b: 2 }, (key, value) => (key === "a" ? undefined : value))',
    'JSON.stringify({ a: 1, b: 2 }, ["a"])',
    "JSON.stringify([new Date(0)])",
    'JSON.parse("[1,{\\"a\\":2}]", (key, value) => (typeof value === "number" ? value + 1 : value))[0]',
    "structuredClone({ a: [1, new Map([[1, 2]])] }).a.length",
    "Object.assign({}, { get a() { return 1; } }).a",
    "({ ...{ get a() { return 1; } } }).a",
    "Object.entries({ get a() { return 1; } })[0][1]",
    "Object.values(new Proxy({ a: 1 }, {}))[0]",
    'Object.keys(new Proxy({ a: 1 }, { ownKeys: () => ["a"], getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) })).length',
    "new Proxy({}, { get: (t, name) => String(name) }).x",
    'new Proxy({}, { has: () => true }).x === undefined && "x" in new Proxy({}, { has: () => true })',
    "(() => { const p = new Proxy({}, { set: () => true }); p.x = 1; return p.x === undefined; })()",
    "delete new Proxy({ a: 1 }, { deleteProperty: () => true }).a",
    "Object.getPrototypeOf(new Proxy({}, { getPrototypeOf: () => Point.prototype })) === Point.prototype",
    "Reflect.ownKeys(new Proxy({ a: 1 }, {})).length",
  ],
  promises: [
    "typeof Promise.all([1, later(2)]).then(nothing)",
    "typeof Promise.all(custom).then(nothing)",
    "typeof Promise.allSettled([later(1)]).then(nothing)",
    "typeof Promise.any([later(1)]).then(nothing)",
    "typeof Promise.race([later(1)]).then(nothing)",
    "typeof Promise.resolve({ then: resolve => resolve(1) }).then(nothing)",
    "typeof Promise.reject(1).catch(nothing)",
    "typeof Promise.resolve(1).finally(nothing)",
    "typeof Promise.try(one, 1).then(nothing)",
    "typeof Promise.withResolvers().resolve",
    "(() => { const { promise, resolve } = Promise.withResolvers(); resolve(1); return promise instanceof Promise; })()",
    "typeof new Promise((resolve, reject) => reject(1)).catch(nothing)",
    "typeof new Promise(() => { throw 1; }).catch(nothing)",
    "typeof Promise.prototype.then.call(later(1), nothing)",
    "typeof Later.resolve(1).then(nothing)",
    "Later.resolve(1).then(nothing) instanceof Later",
    "typeof Promise.all.call(Later, [1]).then(nothing)",
    "typeof later(1).then(one).then(one).then(nothing)",
    "(queueMicrotask(nothing), 1)",
    "(process.nextTick(nothing), 1)",
    "(process.nextTick(one, 1, 2, 3), 1)",
    "(clearTimeout(setTimeout(nothing, 1000)), 1)",
    "(clearImmediate(setImmediate(nothing)), 1)",
    "(clearInterval(setInterval(nothing, 1000)), 1)",
  ],
};
for (const [name, list] of Object.entries(forms)) for (const text of list) add("forms-" + name, text);
const programOf = (calls: string[]) => `function nothing() {}
function one(a) {
  return a;
}
process.on("unhandledRejection", nothing);
process.noDeprecation = true;
function target() {}
${helpers}const calls = [
${calls.map(text => `  () => ${text},`).join("\n")}
];
const names = ${JSON.stringify(calls)};
let probes = 0;
let most = 0;
const expected = [];
const wrong = [];
function textOf(value) {
  const kind = typeof value;
  if (kind === "symbol") return "symbol";
  if (kind === "function") return "function";
  if (kind !== "object" || value === null) return kind + " " + String(value).slice(0, 60);
  return Object.prototype.toString.call(value);
}
function answer(at) {
  const made = calls[at]();
  let text = textOf(made);
  if (typeof made === "function") text += " > " + textOf(made(nothing));
  else if (made !== null && typeof made === "object") {
    if (typeof made.then === "function") made.then(nothing, nothing);
    else if (typeof made.next === "function") text += " > " + textOf(made.next());
  }
  return text;
}
function learn() {
  for (let at = 0; at < calls.length; at++) {
    const two = [];
    for (let turn = 0; turn < 2; turn++)
      try {
        two.push(answer(at));
      } catch (error) {
        two.push("throws " + (error instanceof Error ? error.name : typeof error));
      }
    expected.push(two[0] === two[1] ? two[0] : null);
    wrong.push("");
  }
}
function probeAll() {
  for (let at = 0; at < calls.length; at++) {
    if (expected[at] === null) {
      try {
        answer(at);
      } catch {}
      continue;
    }
    let got;
    try {
      got = answer(at);
    } catch (error) {
      if (error instanceof RangeError || (error !== null && typeof error === "object" && error.name === "RangeError")) continue; // the second: a RangeError of another realm
      try {
        got = "throws " + (error instanceof Error ? error.name : typeof error);
      } catch {
        continue;
      }
    }
    if (got !== expected[at] && wrong[at] === "") wrong[at] = got;
  }
}
function climb(steps) {
  const result = steps > 0 ? climb(steps - 1) : probeAll();
  return result;
}
function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes < most) climb(probes++ % 5);
    throw error;
  }
}
const began = performance.now();
learn();
most = Math.max(60, Math.min(${levels}, Math.floor(${seconds * 2000} / (performance.now() - began + 1))));
try {
  down(0);
} catch (error) {
  console.log(error instanceof RangeError);
}
await new Promise(resolve => setTimeout(resolve, 20));
for (let at = 0; at < calls.length; at++) if (wrong[at] !== "") console.log("WRONG " + at + ": at the top " + expected[at] + " | at the end " + wrong[at] + " | " + names[at]);
console.log("end", calls.length);
process.exit(0);
`;
export const programs: { name: string; text: string }[] = [];
for (const [group, calls] of groups)
  for (let at = 0, part = 0; at < calls.length; at += 240, part++)
    programs.push({
      name: `${group}${calls.length > 240 ? ` part ${part}` : ""}`,
      text: programOf(calls.slice(at, at + 240)),
    });
