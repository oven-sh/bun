// A build that has seen every store to `TypeError.extra` can answer `TypeError.extra` from what it saw. That holds only while it knows every
// other road to the same object too: the constructor of an error that the engine threw, the prototype of an instance that came back out of
// an event's detail, `Bun[name]` with a name that nobody spells, a descriptor's value, a subclass's parent, the name that a module has for it.
// Each scene has a holder with a name (a class, a prototype object, a method, a function or an object; of the language, of the host or of
// the program), changes a member of it by a second road, and reads the member by the holder's name in a function. Often the member was laid
// by name first, with a value of another kind. All scenes of a program take the same kind of road and hide values the same way, and there
// are few of them, because one road that makes a build give up on everything would cover for the others.
import type { Random } from "./random";

type Class = {
  name: string;
  /** An instance. */
  made: string;
  /** `structuredClone()` of an instance is an instance. */
  cloned?: boolean;
  /** The engine or the host throws an instance here. */
  thrownBy?: string;
  method?: string;
  /** A function that is a member of the class itself. */
  ownFunction?: string;
  /** A class directly below it. */
  heir?: string;
  species?: boolean;
  /** Nothing can be added to its prototype object in an executable. */
  closedPrototype?: boolean;
  /** In an executable its prototype object takes a new member only where the build sees the object and the name in the store. */
  guardedPrototype?: boolean;
  own?: boolean;
};

const classes: Class[] = [
  { name: "TypeError", made: `new TypeError("made")`, cloned: true, thrownBy: "null.x;" },
  { name: "TypeError", made: `new TypeError("made")`, cloned: true, thrownBy: "undefined.y;" },
  { name: "TypeError", made: `new TypeError("made")`, cloned: true, thrownBy: "(1)();" },
  { name: "RangeError", made: `new RangeError("made")`, cloned: true, thrownBy: "new Array(-1);" },
  { name: "RangeError", made: `new RangeError("made")`, cloned: true, thrownBy: `"a".repeat(-1);` },
  { name: "ReferenceError", made: `new ReferenceError("made")`, cloned: true, thrownBy: "missing;" },
  { name: "URIError", made: `new URIError("made")`, cloned: true, thrownBy: `decodeURIComponent("%");` },
  { name: "SyntaxError", made: `new SyntaxError("made")`, cloned: true, thrownBy: `JSON.parse("{");` },
  { name: "SyntaxError", made: `new SyntaxError("made")`, cloned: true, thrownBy: `new RegExp("(");` },
  { name: "DOMException", made: `new DOMException("made")`, thrownBy: `atob("*");` },
  { name: "DOMException", made: `new DOMException("made")`, thrownBy: "structuredClone(() => 1);" },
  { name: "Error", ownFunction: "captureStackTrace", made: `new Error("made")`, cloned: true, method: "toString", heir: "TypeError" },
  { name: "Map", ownFunction: "groupBy", made: "new Map()", cloned: true, method: "get", species: true },
  { name: "Set", made: "new Set()", cloned: true, method: "has", species: true },
  { name: "WeakMap", made: "new WeakMap()", method: "get" },
  { name: "Date", ownFunction: "now", made: "new Date(0)", cloned: true, method: "getTime" },
  { name: "RegExp", ownFunction: "escape", made: "/x/", cloned: true, method: "test", species: true, guardedPrototype: true },
  { name: "Promise", ownFunction: "resolve", made: "Promise.resolve(1)", method: "then", species: true, guardedPrototype: true },
  { name: "ArrayBuffer", ownFunction: "isView", made: "new ArrayBuffer(8)", cloned: true, method: "slice", species: true },
  { name: "Uint8Array", ownFunction: "from", made: "new Uint8Array(2)", cloned: true, heir: "Buffer" },
  { name: "Float64Array", made: "new Float64Array(2)", cloned: true },
  { name: "DataView", made: "new DataView(new ArrayBuffer(8))", cloned: true, method: "getInt8" },
  { name: "Array", ownFunction: "from", made: "[]", cloned: true, method: "push", species: true },
  { name: "Object", ownFunction: "keys", made: "{}", cloned: true, method: "hasOwnProperty", closedPrototype: true },
  { name: "Function", made: "function () {}", method: "call", guardedPrototype: true },
  { name: "Number", ownFunction: "isInteger", made: "1", method: "toFixed" },
  { name: "String", ownFunction: "fromCharCode", made: `"made"`, method: "at" },
  { name: "Boolean", made: "true", method: "valueOf" },
  { name: "BigInt", ownFunction: "asIntN", made: "1n", method: "valueOf" },
  { name: "Symbol", ownFunction: "keyFor", made: `Symbol.for("made")`, method: "valueOf" },
  { name: "URL", ownFunction: "canParse", made: `new URL("http://a.test/")`, method: "toJSON", guardedPrototype: true },
  { name: "URLSearchParams", made: `new URLSearchParams("a=1")`, method: "get", guardedPrototype: true },
  { name: "Headers", made: "new Headers()", method: "get", guardedPrototype: true },
  { name: "Request", made: `new Request("http://a.test/")`, method: "clone", guardedPrototype: true },
  { name: "Response", ownFunction: "json", made: `new Response("")`, method: "clone", guardedPrototype: true },
  { name: "Blob", made: `new Blob(["a"])`, method: "slice", heir: "File", guardedPrototype: true },
  { name: "File", made: `new File(["a"], "a.txt")` },
  { name: "FormData", made: "new FormData()", method: "get" },
  { name: "Event", made: `new Event("x")`, method: "preventDefault", heir: "CustomEvent" },
  { name: "CustomEvent", made: `new CustomEvent("x")` },
  { name: "EventTarget", made: "new EventTarget()", method: "dispatchEvent", heir: "AbortSignal" },
  { name: "AbortController", made: "new AbortController()", method: "abort" },
  { name: "AbortSignal", ownFunction: "abort", made: "new AbortController().signal", method: "throwIfAborted" },
  { name: "TextEncoder", made: "new TextEncoder()", method: "encode" },
  { name: "TextDecoder", made: "new TextDecoder()", method: "decode" },
  { name: "ReadableStream", made: "new ReadableStream()", method: "getReader" },
  { name: "WritableStream", made: "new WritableStream()", method: "getWriter" },
  { name: "TransformStream", made: "new TransformStream()" },
  { name: "SubtleCrypto", made: "crypto.subtle", method: "digest" },
  { name: "Crypto", made: "crypto", method: "getRandomValues" },
  { name: "Performance", made: "performance", method: "mark" },
  { name: "Buffer", ownFunction: "from", made: `Buffer.from("a")`, method: "readUInt8" },
  { name: "Bun.Glob", made: `new Bun.Glob("*")`, method: "match" },
  { name: "Bun.S3Client", made: "Bun.s3", method: "file" },
  { name: "Bun.Transpiler", made: "new Bun.Transpiler()", method: "scan" },
  { name: "Bun.CryptoHasher", made: `new Bun.CryptoHasher("sha1")`, method: "update" },
  { name: "Intl.NumberFormat", ownFunction: "supportedLocalesOf", made: `new Intl.NumberFormat("en")`, method: "resolvedOptions" },
  { name: "Intl.Collator", made: `new Intl.Collator("en")`, method: "resolvedOptions" },
  { name: "Counter", ownFunction: "of", made: "new Counter()", method: "tick", heir: "Heir", own: true },
  { name: "Counter", ownFunction: "of", made: "new Counter()", method: "tick", heir: "Heir", own: true },
  { name: "Counter", made: "new Heir()", method: "tick", heir: "Heir", own: true },
  { name: "Heir", made: "new Heir()", own: true },
  { name: "Old", made: "new Old()", method: "tick", own: true },
];

/** Instances that no `new` of the program made: the engine or the host hands them out. By the name of the class. */
const handedOut: Record<string, string[]> = {
  "Array": [
    `/a/.exec("a")`,
    `"a".match(/a/g)`,
    `[..."a".matchAll(/a/g)][0]`,
    `"a,b".split(",")`,
    `Object.keys({ k: 1 })`,
    `Object.entries({ k: 1 })[0]`,
    `((...rest) => rest)(1)`,
    "(strings => strings)`x`",
    `[1].map(v => v)`,
    `[1].slice()`,
    `Array.from("a")`,
    `[...[1]]`,
    `new Map([[1, 2]]).entries().next().value`,
    `JSON.parse("[1]")`,
    `Reflect.ownKeys({ k: 1 })`,
    `new Intl.NumberFormat("en").formatToParts(1)`,
    `Object.groupBy([1], () => "k").k`,
    `await Promise.all([1])`,
  ],
  "Object": [
    `[1][Symbol.iterator]().next()`,
    `(function* () {})().next()`,
    `Object.getOwnPropertyDescriptor({ k: 1 }, "k")`,
    `JSON.parse("{}")`,
    `(function () { return arguments; })()`,
    `Object.fromEntries([])`,
    `{ ...{} }`,
    `new Intl.NumberFormat("en").resolvedOptions()`,
    `(await Promise.allSettled([1]))[0]`,
    `Promise.withResolvers()`,
    `process.memoryUsage()`,
  ],
  "Promise": [`[(async () => {})()][0]`, `[Promise.resolve().then(() => {})][0]`, `[new Response("").text()][0]`, `[(async function* () {})().next()][0]`, `[import("node:path")][0]`],
  "Function": [
    `(() => {}).bind(null)`,
    `class {}`,
    `Object.getOwnPropertyDescriptor(Map.prototype, "size").get`,
    `Promise.withResolvers().resolve`,
    `Proxy.revocable({}, {}).revoke`,
    `new Proxy(function () {}, {})`,
  ],
  "RegExp": [`/x/`, `RegExp("x")`],
  "TypeError": [`await (async () => { null.x; })().catch(e => e)`, `(() => { try { [].reduce(() => 0); } catch (e) { return e; } })()`, `(() => { try { Symbol() + ""; } catch (e) { return e; } })()`],
  "RangeError": [`(() => { try { BigInt(1.5); } catch (e) { return e; } })()`, `(() => { try { (1).toFixed(101); } catch (e) { return e; } })()`],
  "SyntaxError": [`await new Response("{").json().catch(e => e)`, `(() => { try { BigInt("x"); } catch (e) { return e; } })()`],
  "DOMException": [`AbortSignal.abort().reason`, `await crypto.subtle.digest("nope", new Uint8Array(1)).catch(e => e)`],
  "String": [`String(1)`, `(1).toString()`, "`t${1}`", `typeof 1`],
  "Number": [`"a".length`, `+"1"`, `Math.max(1, 2)`],
  "Boolean": [`!0`, `Array.isArray(1)`],
  "Symbol": [`Symbol.iterator`, `Object.getOwnPropertySymbols({ [Symbol.iterator]: 1 })[0]`],
  "BigInt": [`BigInt(1)`, `process.hrtime.bigint()`],
  "Map": [`Map.groupBy([1], () => 1)`, `structuredClone(new Map())`],
  "Set": [`new Set([1]).union(new Set())`, `structuredClone(new Set())`],
  "ArrayBuffer": [`new Uint8Array(2).buffer`, `new ArrayBuffer(8).slice(0)`, `await new Blob(["a"]).arrayBuffer()`, `new TextEncoder().encode("a").buffer`],
  "Uint8Array": [`new TextEncoder().encode("a")`, `await new Blob(["a"]).bytes()`, `new Uint8Array(2).subarray(0)`, `Uint8Array.from([1])`, `Bun.gzipSync("a")`],
  "Buffer": [`Buffer.alloc(1).subarray(0)`, `Buffer.concat([])`],
  "Blob": [`new Blob(["a"]).slice(0)`, `await new Response("a").blob()`],
  "Headers": [`new Response("").headers`, `new Request("http://a.test/").headers`],
  "URLSearchParams": [`new URL("http://a.test/?a=1").searchParams`],
  "AbortSignal": [`AbortSignal.abort()`, `new Request("http://a.test/").signal`, `AbortSignal.any([])`],
  "ReadableStream": [`new Response("a").body`, `new Blob(["a"]).stream()`, `new TransformStream().readable`, `new ReadableStream().tee()[0]`],
  "WritableStream": [`new TransformStream().writable`],
  "Response": [`Response.json({})`, `new Response("").clone()`, `Response.error()`],
  "Request": [`new Request("http://a.test/").clone()`],
  "Event": [`(() => { let got; const all = new AbortController(); all.signal.addEventListener("abort", event => { got = event; }); all.abort(); return got; })()`],
  "Counter": [`Counter.of()`, `Reflect.construct(Counter, [])`, `Object.create(Counter.prototype)`],
};

const others = [
  "Bun.gzipSync",
  "Bun.stdout",
  "Bun.hash",
  "Bun.semver",
  "Bun.inspect",
  "Bun.deepEquals",
  "Bun.password",
  "Bun.TOML",
  "Bun.escapeHTML",
  "Bun.file",
  "Bun.s3",
  "Bun",
  "Math",
  "Math.max",
  "JSON",
  "JSON.parse",
  "Reflect",
  "Reflect.get",
  "Atomics",
  "Intl",
  "Object.keys",
  "Array.from",
  "Promise.resolve",
  "console",
  "console.log",
  "process",
  "process.hrtime",
  "process.nextTick",
  "process.memoryUsage",
  "structuredClone",
  "queueMicrotask",
  "setTimeout",
  "fetch",
  "atob",
  "crypto",
  "crypto.subtle",
  "performance",
  "navigator",
];
const ownOthers = ["registry", "registry.alpha", "registry.alpha", "registry.beta", "helper", "helper", "registry.alpha.inner", "origin", "origin", "origin", "child", "child", "child"];

/** One function or object under two names that a program can spell. */
const twoNames: [string, string][] = [
  ["Array.prototype.values", "Array.prototype[Symbol.iterator]"],
  ["Set.prototype.values", "Set.prototype.keys"],
  ["Set.prototype.values", "Set.prototype[Symbol.iterator]"],
  ["Map.prototype.entries", "Map.prototype[Symbol.iterator]"],
  ["String.prototype.trimStart", "String.prototype.trimLeft"],
  ["String.prototype.trimEnd", "String.prototype.trimRight"],
  ["Date.prototype.toUTCString", "Date.prototype.toGMTString"],
  ["parseFloat", "Number.parseFloat"],
  ["parseInt", "Number.parseInt"],
  ["Headers.prototype.entries", "Headers.prototype[Symbol.iterator]"],
  ["URLSearchParams.prototype.entries", "URLSearchParams.prototype[Symbol.iterator]"],
  ["FormData.prototype.entries", "FormData.prototype[Symbol.iterator]"],
  ["Buffer.prototype.readUInt8", "Buffer.prototype.readUint8"],
  ["Buffer.prototype.writeUInt8", "Buffer.prototype.writeUint8"],
  ["Buffer.prototype.readUInt32LE", "Buffer.prototype.readUint32LE"],
  ["Uint8Array.prototype.values", "Float64Array.prototype.values"],
  ["Uint8Array.prototype.values", "Uint8Array.prototype[Symbol.iterator]"],
  ["Array.prototype.toString", "Uint8Array.prototype.toString"],
  ["Error.prototype.toString", "TypeError.prototype.toString"],
  ["EventTarget.prototype.addEventListener", "AbortSignal.prototype.addEventListener"],
  ["Event.prototype.preventDefault", "CustomEvent.prototype.preventDefault"],
  ["Blob.prototype.slice", "File.prototype.slice"],
  ["globalThis", "self"],
  ["globalThis", "global"],
];
const namesOfObjectPrototype = ["constructor", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"];
// TypeScript's library does not declare toGMTString: it is a road and no holder.
const spelledWithDots = (name: string) => !name.includes("[") && !name.endsWith(".toGMTString");

type Holder = Partial<Class> & { path: string[]; is: "class" | "prototype" | "method" | "own function" | "other" };

const holders: Holder[] = [
  ...classes.flatMap((it): Holder[] => {
    const path = it.name.split(".");
    return [
      { ...it, path, is: "class" },
      { ...it, path, is: "class" },
      ...(it.closedPrototype ? [] : [{ ...it, path: [...path, "prototype"], is: "prototype" } as const]),
      ...(it.method ? [{ ...it, path: [...path, "prototype", it.method], is: "method" } as const] : []),
      ...(it.ownFunction ? [{ ...it, path: [...path, it.ownFunction], is: "own function" } as const] : []),
    ];
  }),
  ...others.map((name): Holder => ({ path: name.split("."), is: "other" })),
  ...[...new Set(twoNames.flat().filter(spelledWithDots))].map((name): Holder => ({ path: name.split("."), is: "other" })),
  ...[...ownOthers, ...ownOthers].map((name): Holder => ({ path: name.split("."), is: "other", own: true })),
];

const ownHolders = holders.filter(holder => holder.own);

const kinds = {
  "list": { values: ["[1, 2]", "[7]", "[]"], type: "number[]" },
  "object": { values: ["{ length: 3 }", "{ length: 3, more: 1 }"], type: "{ length: number; more?: number }" },
  "function": { values: [`function () { return "mine"; }`, `() => "default"`, `() => "other"`], type: "(() => string)" },
  "whole": { values: ["0", "41", "-1"], type: "number" },
  "fraction": { values: ["1.5", "-0", "NaN"], type: "number" },
  "text": { values: [`"text"`, `""`], type: "string" },
  "flag": { values: ["true", "false"], type: "boolean" },
  "null": { values: ["null"], type: "null" },
  "undefined": { values: ["undefined"], type: "undefined" },
  "big": { values: ["10n"], type: "bigint" },
  "map": { values: ["new Map([[1, 2]])"], type: "Map<number, number>" },
  "bytes": { values: ["new Uint8Array(3)"], type: "Uint8Array" },
} as const;
type Kind = keyof typeof kinds;
const kindsByWeight: [number, Kind][] = [
  [5, "list"],
  [5, "object"],
  [5, "function"],
  [5, "whole"],
  [2, "fraction"],
  [4, "text"],
  [2, "flag"],
  [2, "null"],
  [2, "undefined"],
  [1, "big"],
  [1, "map"],
  [1, "bytes"],
];

const quoted = (text: string) => JSON.stringify(text);

/** What has a name among the globals and another as a member of a module: one object in plain Bun. */
const otherNames: [string, string, string][] = [
  ["URL", "node:url", "URL"],
  ["URLSearchParams", "node:url", "URLSearchParams"],
  ["Buffer", "node:buffer", "Buffer"],
  ["Blob", "node:buffer", "Blob"],
  ["File", "node:buffer", "File"],
  ["atob", "node:buffer", "atob"],
  ["process", "node:process", "default"],
  ["process.hrtime", "node:process", "hrtime"],
  ["process.nextTick", "node:process", "nextTick"],
  ["process.memoryUsage", "node:process", "memoryUsage"],
  ["performance", "node:perf_hooks", "performance"],
  ["Performance", "node:perf_hooks", "Performance"],
  ["crypto", "node:crypto", "webcrypto"],
  ["crypto.subtle", "node:crypto", "subtle"],
  ["TextDecoder", "node:util", "TextDecoder"],
  ["TextEncoder", "node:util", "TextEncoder"],
  ["setTimeout", "node:timers", "setTimeout"],
  ["ReadableStream", "node:stream/web", "ReadableStream"],
  ["WritableStream", "node:stream/web", "WritableStream"],
  ["TransformStream", "node:stream/web", "TransformStream"],
  ["console", "node:console", "default"],
  ["console.log", "node:console", "log"],
  ["Bun", "bun", "default"],
  ["Bun.gzipSync", "bun", "gzipSync"],
  ["Bun.Glob", "bun", "Glob"],
  ["Bun.file", "bun", "file"],
  ["Bun.hash", "bun", "hash"],
  ["Bun.semver", "bun", "semver"],
  ["Bun.inspect", "bun", "inspect"],
  ["Bun.password", "bun", "password"],
  ["Bun.TOML", "bun", "TOML"],
  ["Bun.s3", "bun", "s3"],
  ["Bun.S3Client", "bun", "S3Client"],
  ["Bun.Transpiler", "bun", "Transpiler"],
  ["Bun.CryptoHasher", "bun", "CryptoHasher"],
  ["Bun.deepEquals", "bun", "deepEquals"],
  ["Bun.escapeHTML", "bun", "escapeHTML"],
  ["Bun.stdout", "bun", "stdout"],
];

const roads = [
  "names walked from the top",
  "names walked from the top",
  "one name made at run time",
  "one name made at run time",
  "the keys of what holds it",
  "a descriptor's value",
  "Reflect.get",
  "a caught error",
  "a caught error",
  "a caught error",
  "an instance",
  "a hidden instance",
  "a hidden instance",
  "a hidden instance",
  "a clone",
  "a clone",
  "the holder, hidden",
  "species",
  "what a subclass inherits from",
  "this of a call",
  "another name out of a module",
  "another name out of a module",
  "another name out of a module",
  "an instance that is handed out",
  "an instance that is handed out",
  "an instance that is handed out",
  "the name itself",
] as const;

/** What a family that draws from this one holds fast. */
export type Focus = { road?: (typeof roads)[number]; copies?: boolean; namesOfObjectPrototype?: boolean };

export function generate(random: Random, typed: boolean): string {
  return generateWith(random, typed, {});
}

export function generateWith(random: Random, typed: boolean, focus: Focus): string {
  const any = (expression: string) => (typed ? `(${expression} as any)` : expression);
  const as = (type: string) => (typed ? `: ${type}` : "");
  // By its own name a holder is reached only where the write itself is the second road: a copy.
  const copies = focus.copies ?? random.chance(0.12);
  let road = focus.road ?? random.pick(roads);
  if (focus.copies && !focus.road && random.chance(0.5)) road = "the name itself";
  while (road === "the name itself" && !copies) road = random.pick(roads);

  const hides: { waits?: boolean; of: (value: string) => string }[] = [
    { of: value => `new CustomEvent("x", { detail: ${value} }).detail` },
    { of: value => `new CustomEvent("x", { detail: ${value} }).detail` },
    { of: value => `new Error("x", { cause: ${value} }).cause` },
    { of: value => `new AggregateError([${value}]).errors[0]` },
    { of: value => `AbortSignal.abort(${value}).reason` },
    { of: value => `new Map([["k", ${value}]]).get("k")` },
    { of: value => `new Set([${value}]).values().next().value` },
    { of: value => `[${value}].at(-1)` },
    { of: value => `[${value}][JSON.parse("0")]` },
    { of: value => `[[${value}]].flat()[0]` },
    { of: value => `[${value}].find(() => true)` },
    { of: value => `[${value}, ${value}].sort(() => 0)[0]` },
    { of: value => `Array.from({ length: 1 }, () => ${value})[0]` },
    { of: value => `Object.fromEntries([["k", ${value}]]).k` },
    { of: value => `Object.values({ k: ${value} })[0]` },
    { of: value => `JSON.parse("0", () => ${value})` },
    { of: value => `(function* () { yield ${value}; })().next().value` },
    { of: value => `${any(`new Proxy({}, { get: () => ${value} })`)}.k` },
    { of: value => `${any(`Object.defineProperty({}, "k", { get: () => ${value} })`)}.k` },
    { of: value => `Reflect.apply((v${as("any")}) => v, null, [${value}])` },
    { of: value => `((v${as("any")}) => v).bind(null, ${value})()` },
    { of: value => `((...all${as("any[]")}) => all[0])(${value})` },
    { of: value => `(function (${typed ? "..._: any[]" : ""}) { return arguments[0]; })(${value})` },
    { of: value => `Bun.peek(Promise.resolve([${value}]))[0]` },
    { of: value => `[${value}][Symbol.iterator]().next().value` },
    { of: value => `${any(`[${value}].entries().next().value`)}[1]` },
    { of: value => `${any(`new Map([[1, ${value}]]).entries().next().value`)}[1]` },
    { of: value => `Object.entries({ k: ${value} })[0][1]` },
    { of: value => `((strings${as("any")}, v${as("any")}) => v)\`x\${${value}}\`` },
    { of: value => `(() => { for (const v of [${value}]) return v; })()` },
    { of: value => `(([v]${as("any[]")}) => v)([${value}])` },
    { of: value => `(({ k }${as("any")}) => k)({ k: ${value} })` },
    { of: value => `new MessageEvent("x", { data: ${value} }).data` },
    { of: value => `new ErrorEvent("x", { error: ${value} }).error` },
    { waits: true, of: value => `${any(`(await Promise.allSettled([[${value}]]))[0]`)}.value[0]` },
    {
      of: value =>
        `(() => { let heard${as("any")}; const target = new EventTarget(); target.addEventListener("x", (event${as("any")}) => { heard = event.detail; }); target.dispatchEvent(new CustomEvent("x", { detail: ${value} })); return heard; })()`,
    },
    { waits: true, of: value => `(await Promise.resolve([${value}]).then(v => v))[0]` },
    { waits: true, of: value => `(await Promise.reject([${value}]).catch(v => v))[0]` },
    { waits: true, of: value => `(await new Promise${typed ? "<any>" : ""}(done => setTimeout(done, 0, [${value}])))[0]` },
    { waits: true, of: value => `(await new Promise${typed ? "<any>" : ""}(done => process.nextTick(done, [${value}])))[0]` },
    { waits: true, of: value => `(await new Promise${typed ? "<any>" : ""}(done => queueMicrotask(() => done([${value}]))))[0]` },
  ];
  const hide = random.pick(hides);
  const hidden = (value: string) => any(hide.of(value));
  const writer = (value: string) => (random.chance(0.5) ? hidden(value) : any(`JSON.parse("0", () => ${value})`));

  const atRunTime = (text: string) => {
    const cut = random.between(1, Math.max(1, text.length - 1));
    return random.pick([
      `JSON.parse(${quoted(quoted(text))})`,
      `JSON.parse(${quoted(quoted(text))})`,
      `[${quoted(text.slice(0, cut))}, ${quoted(text.slice(cut))}].join("")`,
      `${quoted([...text].reverse().join(""))}.split("").reverse().join("")`,
      `String(new URLSearchParams(${quoted("k=" + text)}).get("k"))`,
      `new TextDecoder().decode(new Uint8Array([${[...text].map(unit => unit.charCodeAt(0)).join(", ")}]))`,
    ]);
  };

  const direct = (holder: Holder) => holder.path.join(".");
  const madeOf = (holder: Holder) => (typed ? holder.made!.replace("new Old()", "new (Old as any)()") : holder.made!);
  const above = (holder: Holder) => (holder.path.length > 1 ? holder.path.slice(0, -1).join(".") : holder.own ? "root" : "globalThis");
  const last = (holder: Holder) => holder.path[holder.path.length - 1];

  /** From an instance, or from what has the method, to the holder. */
  const fromInstance = (holder: Holder, instance: string): string => {
    const toClass = () =>
      random.pick([
        `${instance}.constructor`,
        `${instance}.constructor`,
        `Object.getPrototypeOf(${instance}).constructor`,
        `${instance}.__proto__.constructor`,
        `${instance}.constructor.prototype.constructor`,
      ]);
    const toPrototype = () =>
      random.pick([
        `Object.getPrototypeOf(${instance})`,
        `Object.getPrototypeOf(${instance})`,
        `${instance}.__proto__`,
        `${any(`Reflect.getPrototypeOf(Object(${instance}))`)}`,
        `${instance}.constructor.prototype`,
        `${instance}.constructor.prototype`,
        `Object.getPrototypeOf(${instance}).constructor.prototype`,
      ]);
    return holder.is === "class"
      ? toClass()
      : holder.is === "prototype"
        ? toPrototype()
        : holder.is === "own function"
          ? `${toClass()}.${holder.ownFunction}`
          : random.chance(0.6)
            ? `${instance}.${holder.method}`
            : `${toPrototype()}.${holder.method}`;
  };
  /** `new Heir()` is an instance of Counter, and its constructor and prototype are Heir's. */
  const leadsBack = (holder: Holder) => holder.made !== undefined && holder.is !== "other" && !(holder.name === "Counter" && holder.made === "new Heir()" && holder.is !== "method");

  /** The lines that reach the holder by the program's road and use it there, or nothing where the road does not lead to this holder. */
  const reach = (holder: Holder, scene: number, use: (at: string) => string[]): string[] | undefined => {
    const bound = (expression: string) =>
      random.chance(0.4) || expression.includes("await ") ? [`const at${scene}${as("any")} = ${expression};`, ...use(`at${scene}`)] : use(any(expression));
    switch (road) {
      case "names walked from the top":
        return [
          `let at${scene}${as("any")} = ${holder.own ? "root" : "globalThis"};`,
          `for (const name of JSON.parse(${quoted(JSON.stringify(holder.path))})) at${scene} = at${scene}[name];`,
          ...use(`at${scene}`),
        ];
      case "one name made at run time":
        return random.chance(0.5)
          ? [`const name${scene} = ${atRunTime(last(holder))};`, ...bound(`${any(above(holder))}[name${scene}]`)]
          : bound(`${any(above(holder))}[${atRunTime(last(holder))}]`);
      case "the keys of what holds it": {
        const keys = random.pick(["Object.keys", "Object.getOwnPropertyNames", "Object.getOwnPropertyNames", "Reflect.ownKeys"]);
        const name = last(holder);
        const test = random.pick([`name === ${quoted(name)}`, `String(name).startsWith(${quoted(name)}) && String(name).length === ${name.length}`]);
        return [`for (const name of ${keys}(${above(holder)})) if (${test}) {`, ...use(`${any(above(holder))}[name]`).map(line => "  " + line), "}"];
      }
      case "a descriptor's value":
        return bound(`${any(`Object.getOwnPropertyDescriptor(${above(holder)}, ${quoted(last(holder))})`)}.value`);
      case "Reflect.get":
        return bound(`Reflect.get(${above(holder)}, ${random.chance(0.5) ? quoted(last(holder)) : atRunTime(last(holder))})`);
      case "a caught error":
        if (!holder.thrownBy || holder.is === "method" || holder.is === "own function") return undefined;
        return [
          `try { ${typed ? holder.thrownBy.replace(/^(null|undefined|\(1\))/, "($1 as any)") : holder.thrownBy} } catch (e${as("any")}) {`,
          ...use(any(fromInstance(holder, "e"))).map(line => "  " + line),
          "}",
        ];
      case "an instance":
        return leadsBack(holder) ? bound(fromInstance(holder, any(`(${madeOf(holder)})`))) : undefined;
      case "a hidden instance":
        return leadsBack(holder) ? bound(fromInstance(holder, hidden(madeOf(holder)))) : undefined;
      case "a clone":
        return leadsBack(holder) && holder.cloned ? bound(fromInstance(holder, any(`structuredClone({ a: ${madeOf(holder)} }).a`))) : undefined;
      case "the holder, hidden":
        return bound(hidden(direct(holder)));
      case "species":
        return holder.is === "class" && holder.species ? bound(`${any(direct(holder))}[Symbol.species]`) : undefined;
      case "what a subclass inherits from": {
        if (holder.is !== "class" && holder.is !== "prototype") return undefined;
        const declares = !holder.heir || random.chance(0.5);
        const heir = declares ? `Mine${scene}` : holder.heir!;
        const below = holder.is === "class" ? heir : `${heir}.prototype`;
        return [
          ...(declares ? [`class Mine${scene} extends ${any(holder.name!)} {}`] : []),
          ...bound(random.pick([`Object.getPrototypeOf(${below})`, `Object.getPrototypeOf(${below})`, `${any(below)}.__proto__`])),
        ];
      }
      case "another name out of a module": {
        otherNamesTaken.delete(scene);
        const whole = direct(holder);
        const spelled = twoNames.flatMap(([one, other]) => (one === whole ? [other] : other === whole ? [one] : []));
        if (spelled.length) return bound(random.pick(spelled).replace("Date.prototype.toGMTString", `${any("Date.prototype")}.toGMTString`));
        const [found] = otherNames.filter(([name]) => whole === name || whole.startsWith(name + ".")).sort((a, b) => b[0].length - a[0].length);
        if (!found) return undefined;
        const [name, module, member] = found;
        const other = `other${scene}`;
        const isWhole = member === "default";
        otherNamesTaken.set(
          scene,
          random.pick([
            isWhole ? `import ${other} from ${quoted(module)};` : `import { ${member} as ${other} } from ${quoted(module)};`,
            isWhole ? `import ${other} from ${quoted(module)};` : `import { ${member} as ${other} } from ${quoted(module)};`,
            `import * as lib${scene} from ${quoted(module)};\nconst ${other}${as("any")} = ${any(`lib${scene}`)}.${member};`,
            `const ${other}${as("any")} = require(${quoted(module)})${isWhole ? "" : "." + member};`,
            ...(module === "bun" ? [] : [`const ${other}${as("any")} = ${any("process")}.getBuiltinModule(${quoted(module)})${isWhole ? "" : "." + member};`]),
            `const ${other}${as("any")} = ${any(`await import(${quoted(module)})`)}.${member};`,
          ]),
        );
        return use(any(`${any(other)}${whole.slice(name.length)}`));
      }
      case "an instance that is handed out": {
        const given = handedOut[holder.name ?? ""];
        if (!given || holder.is === "other") return undefined;
        const instance = random.pick(given);
        return bound(fromInstance(holder, any(`(${typed ? instance.replace(/\((e|event|v|strings|\.\.\.rest)\) =>|\b(e|event|v|strings) =>/g, found => (found.startsWith("(") ? found.replace(")", ": any)") : `(${found.slice(0, -3)}: any) =>`)).replace("let got;", "let got: any;").replace("null.x", "(null as any).x").replace(`Symbol() + ""`, `(Symbol() as any) + ""`).replace("[].reduce(", "([] as any[]).reduce(").replace(`"size").get`, `"size")!.get`) : instance})`)));
      }
      case "the name itself":
        return use(any(direct(holder)));
      case "this of a call": {
        const self = `function (${typed ? "this: any" : ""}) { return this; }`;
        return bound(
          random.pick([`(${self}).call(${direct(holder)})`, `(${self}).apply(${direct(holder)})`, `(${self}).bind(${direct(holder)})()`, `Reflect.apply(${self}, ${direct(holder)}, [])`]),
        );
      }
    }
  };

  const statics: Record<string, string[]> = { Counter: [], Heir: [] };
  const methods: Record<string, string[]> = { "Counter.prototype": [], "Heir.prototype": [] };
  const members: Record<string, string[]> = { "registry": [], "registry.alpha": [], "registry.beta": [], "registry.alpha.inner": [], "origin": [], "child": [] };
  const body: string[] = [];
  const keys: string[] = [];
  const namesTaken = new Set<string>();
  const otherNamesTaken = new Map<number, string>();
  let usesOwn = false;
  let usesMissing = false;

  const scenes = random.weighted([
    [4, 1],
    [3, 2],
    [2, 3],
    [1, 4],
  ]);
  for (let scene = 1; scene <= scenes; scene++) {
    let member = random.pick(["extra", "list", "pick", "value", "seen", "kept"]) + scene;
    let holder: Holder | undefined;
    const ofTheProgram = focus.namesOfObjectPrototype || random.chance(0.3);
    for (let attempt = 0; attempt < 60 && !holder; attempt++) {
      const drawn = random.pick(ofTheProgram && attempt < 20 ? ownHolders : holders);
      if (reach(drawn, scene, () => []) && !(drawn.is === "prototype" && drawn.guardedPrototype && random.chance(0.7))) holder = drawn;
    }
    if (!holder) {
      otherNamesTaken.delete(scene);
      continue;
    }
    // A name that every object finds above itself anyway. A built-in object refuses it in an executable, as it refuses to have a member replaced.
    if ((focus.namesOfObjectPrototype || random.chance(0.06)) && holder.own) {
      const free = namesOfObjectPrototype.filter(name => !namesTaken.has(direct(holder!) + " " + name));
      if (free.length) namesTaken.add(direct(holder) + " " + (member = random.pick(free)));
    }
    const secondKind = random.weighted(kindsByWeight);
    const second = random.pick(kinds[secondKind].values);
    // A method that stands in the body of a class is a function laid by name.
    const firstKind = holder.own && holder.is === "prototype" && random.chance(0.5) ? "function" : random.chance(0.6) ? random.weighted(kindsByWeight) : undefined;
    const first = firstKind && random.pick(kinds[firstKind].values);
    // A store that such an object refuses has to say so: the forms that only answer false are left out, and so are symbols, which the build refuses.
    const isGuarded = holder.is === "prototype" && holder.guardedPrototype === true;
    // In an executable nothing can stand at an index of a built-in prototype object, but for those of the errors.
    const takesNoIndex = holder.is === "prototype" && !holder.own && !/Error$/.test(holder.name ?? "");
    // The member goes by a name, by a symbol that the host could know too, by a symbol of the program's own, or by an index.
    const keyed = random.weighted([
      [16, "a name"],
      [isGuarded ? 0 : 3, "a registered symbol"],
      [isGuarded ? 0 : 2, "a symbol of its own"],
      [isGuarded || takesNoIndex ? 0 : 3, "an index"],
    ] as const);
    const name = keyed === "a name" ? quoted(member) : keyed === "a registered symbol" ? `Symbol.for(${quoted(member)})` : keyed === "an index" ? String(scene) : `key${scene}`;
    if (keyed === "a symbol of its own") keys.push(`const key${scene} = Symbol(${quoted(member)});`);
    const of = (base: string) => (keyed === "a name" ? `${base}.${member}` : `${base}[${name}]`);
    const inLiteral = keyed === "a name" ? member : `[${name}]`;
    const nameAtRunTime = () =>
      keyed === "a name"
        ? atRunTime(member)
        : keyed === "a registered symbol"
          ? `Symbol.for(${atRunTime(member)})`
          : keyed === "an index"
            ? random.pick([`JSON.parse("${scene}")`, `"${scene}"`, `Number("${scene}")`, `[${scene}].length * ${scene}`])
            : `[key${scene}][JSON.parse("0")]`;

    const write = (at: string): string[] => {
      const forms: [number, string[]][] = [
        [8, [`${of(at)} = ${second};`]],
        [2, [`${at}[${name}] = ${second};`]],
        [2, [`${at}[${nameAtRunTime()}] = ${second};`]],
        [2, [`Object.defineProperty(${at}, ${name}, { value: ${second}, writable: true, enumerable: true, configurable: true });`]],
        [2, [`Object.defineProperty(${at}, ${name}, { get() { return ${second}; }, configurable: true });`]],
        [1, [`Object.defineProperties(${at}, { ${inLiteral}: { value: ${second}, writable: true, configurable: true } });`]],
        [isGuarded ? 0 : 1, [`Reflect.defineProperty(${at}, ${name}, { value: ${second}, writable: true, configurable: true });`]],
        [isGuarded ? 0 : 2, [`Reflect.set(${at}, ${name}, ${second});`]],
        [2, [`Object.assign(${at}, { ${inLiteral}: ${second} });`]],
        [1, [`({ k: ${of(at)} } = { k: ${second} });`]],
        [1, [`[${of(at)}] = [${second}];`]],
        [1, [`for (${of(at)} of [${second}]);`]],
        [2, [`put${scene}(${at}, ${second});`]],
        // A function plus one is the function's text, which an executable spells in its own way.
        [firstKind === "function" ? 0 : 2, [`${of(at)} = (${of(at)} ?? 0) + 1;`]],
        [1, [`${of(at)} ??= ${second};`]],
        // The function that writes is as hidden as what it writes to.
        [isGuarded ? 0 : 2, [`${writer("Reflect.set")}(${at}, ${name}, ${second});`]],
        [2, [`${writer("Object.assign")}(${at}, { ${inLiteral}: ${second} });`]],
        [2, [`${writer("Object.defineProperty")}(${at}, ${name}, { value: ${second}, writable: true, configurable: true });`]],
        [1, [`${writer("Object.defineProperty")}(${at}, ${name}, { get() { return ${second}; }, configurable: true });`]],
      ];
      if (first !== undefined)
        forms.push(
          [3, [`delete ${of(at)};`]],
          [isGuarded ? 0 : 1, [`Reflect.deleteProperty(${at}, ${name});`]],
          [firstKind === "whole" || firstKind === "fraction" ? 4 : 0, [`${of(at)}++;`]],
          [firstKind === "whole" || firstKind === "text" ? 2 : 0, [`${of(at)} += 1;`]],
          [firstKind === "list" ? 4 : 0, [`${of(at)}.push(9);`]],
          [firstKind === "list" ? 2 : 0, [`${of(at)}.length = 0;`]],
          [firstKind === "object" ? 3 : 0, [`${of(at)}.length = "long";`]],
        );
      // The member comes over from another object: neither its name nor its value stands in the statement that writes it.
      const source = `make${scene}()`;
      const byCopy: [number, string[]][] = [
        [6, [`Object.assign(${at}, ${source});`]],
        [2, [`Object.assign(${at}, { ...${source} });`]],
        [3, [`Object.defineProperties(${at}, Object.getOwnPropertyDescriptors(${source}));`]],
        [keyed === "a name" || keyed === "an index" ? 3 : 0, [`const from${scene}${as("any")} = ${source};`, `for (const key in from${scene}) ${at}[key] = from${scene}[key];`]],
        [keyed === "a name" || keyed === "an index" ? 2 : 0, [`for (const [key, value] of Object.entries(${source})) ${at}[key] = value;`]],
        [2, [`const from${scene}${as("any")} = ${source};`, `Reflect.ownKeys(from${scene}).forEach(key => { ${at}[key] = from${scene}[key]; });`]],
        [isGuarded || keyed !== "a name" ? 0 : 1, [`Object.entries(${source}).forEach(([key, value]) => Reflect.set(${at}, key, value));`]],
      ];
      return random.weighted((copies ? byCopy : forms).filter(([weight]) => weight > 0));
    };

    const change = reach(holder, scene, write)!;
    usesOwn ||= holder.own === true;
    usesMissing ||= change.some(line => line.includes("missing;"));

    // A member of what the program declares can stand in the declaration, with a type that has room for both values.
    // In the body of a class `constructor` is no name for a field or a method.
    const fitsTheDeclaration = member !== "constructor" || (holder.is === "other" && direct(holder) !== "origin");
    const declaredIn = holder.own && keyed === "a name" && fitsTheDeclaration && first !== undefined && random.chance(0.6) ? (holder.is === "class" ? statics[direct(holder)] : holder.is === "other" ? members[direct(holder)] : holder.is === "prototype" && firstKind === "function" ? methods[direct(holder)] : undefined) : undefined;
    const type = firstKind && [...new Set([kinds[firstKind].type, kinds[secondKind].type, "number"])].join(" | ");
    if (declaredIn)
      declaredIn.push(
        holder.is === "prototype" ? `${member}() { return "declared"; }` : holder.is === "class" ? `static ${member}${as(type!)} = ${first};` : direct(holder) === "origin" ? `${member}${as(type!)} = ${first};` : direct(holder) === "child" ? `${member}: { value: ${first}, writable: true, enumerable: true, configurable: true },` : `${member}: ${typed ? `(${first}) as ${type}` : first},`,
      );
    const named = any(direct(holder));
    const plainlyNamed = declaredIn ? direct(holder) : named;

    const lay = first === undefined || declaredIn ? [] : [`${of(named)} = ${first};`];
    // A read that fits the kind which the build saw under the name says most.
    const believed = firstKind ?? secondKind;
    const hasLength = believed === "list" || believed === "object" || believed === "text" || believed === "bytes";
    const expressions: [number, string][] = [
      [8, `${of(plainlyNamed)}`],
      [hasLength ? 12 : 1, `${of(named)}.length`],
      [believed === "function" ? 8 : 1, `${of(named)}()`],
      [believed === "function" ? 4 : 1, `${of(named)}.call(null)`],
      [2, `typeof ${of(plainlyNamed)}`],
      [2, `${name} in ${plainlyNamed}`],
      [2, `Object.hasOwn(${plainlyNamed}, ${name})`],
      [2, `${of(plainlyNamed)} ?? "absent"`],
      // A function added to a number gives the function's text, which `bun run` prints as its transpiler wrote it: there the sum's kind is read.
      [believed === "whole" || believed === "fraction" ? 6 : believed === "function" ? 0 : 1, secondKind === "function" ? `typeof (${of(named)} + 1)` : `${of(named)} + 1`],
      [1, `${named}[${name}]`],
      [1, keyed === "a name" ? `${named}?.${member}` : `${named}?.[${name}]`],
      [1, `Reflect.ownKeys(${plainlyNamed}).includes(${keyed === "an index" ? quoted(name) : name})`],
      [1, `Object.getOwnPropertyDescriptor(${plainlyNamed}, ${name})?.value`],
      [1, `(({ ${inLiteral}: got }${as("any")}) => got)(${plainlyNamed})`],
      [1, `${of(plainlyNamed)} === undefined`],
      [1, `Array.isArray(${of(plainlyNamed)})`],
      [holder.is === "prototype" ? 6 : 0, of(any(`(${holder.made && madeOf(holder)})`))],
      [holder.is === "class" && holder.heir ? 4 : 0, of(any(holder.heir!))],
    ];
    const asked: string[] = [];
    const readers: string[] = [];
    const count = random.between(1, 3);
    for (let reader = 0; reader < count; reader++) {
      const expression = random.weighted(expressions.filter(([weight]) => weight > 0));
      const name = `read${scene}${"abc"[reader]}`;
      const [declaration, call] = random.weighted<[string, string]>([
        [8, [`function ${name}() { return ${expression}; }`, `${name}()`]],
        [2, [`const ${name} = () => ${expression};`, `${name}()`]],
        [2, [`class ${name} { held = ${expression}; }`, `new ${name}().held`]],
        [1, [`class ${name} { static get held() { return ${expression}; } }`, `${name}.held`]],
        [1, [`function ${name}(got = ${expression}) { return got; }`, `${name}()`]],
        [1, [`function* ${name}() { yield ${expression}; }`, `${name}().next().value`]],
        [2, [`function ${name}() { let got; for (let i = 0; i < 3; i++) got = ${expression}; return got; }`, `${name}()`]],
        [1, ["", expression]],
      ]);
      if (declaration) readers.push(declaration);
      asked.push(call);
    }
    const ask = (label: string) => `console.log("s${scene} ${label}", [${asked.map(call => `told(() => ${call})`).join(", ")}].join(" | "));`;

    if (change.some(line => line.includes(`make${scene}()`))) readers.push(`function make${scene}()${as("any")} { return { ${inLiteral}: ${second} }; }`);
    if (change.some(line => line.includes(`put${scene}(`))) readers.push(`function put${scene}(where${as("any")}, what${as("any")}) { ${of("where")} = what; }`);
    const times = random.weighted([
      [6, 1],
      [1, 2],
      [1, 3],
    ]);
    const inFunction = random.chance(0.45);
    const waits = change.some(line => line.includes("await "));
    const wait = waits ? "await " : "";
    const guarded = (lines: string[]) => ["try {", ...lines.map(line => "  " + line), `} catch (e) { console.log("s${scene} refused", told(() => { throw e; })); }`];
    const changes = inFunction
      ? [`${waits ? "async " : ""}function change${scene}() {`, ...change.map(line => "  " + line), "}", ...guarded(Array.from({ length: times }, () => `${wait}change${scene}();`))]
      : guarded(change);

    const layFirst = random.chance(0.8);
    body.push(
      ...(layFirst ? lay : []),
      ...random.shuffled(readers),
      ...(layFirst ? [] : lay),
      ...(random.chance(0.3) ? [ask("before")] : []),
      ...changes,
      ask("after"),
    );
  }

  const declarations = usesOwn
    ? [
        `class Counter { ${["static made = 0;", ...statics.Counter].join(" ")} static of() { return new Counter(); } tick() { return 1; } ${methods["Counter.prototype"].join(" ")} }`,
        `class Heir extends Counter { ${[...statics.Heir, ...methods["Heir.prototype"]].join(" ")} }`,
        `function Old(${typed ? "this: any" : ""}) { this.made = 1; }`,
        `Old.prototype.tick = function () { return 2; };`,
        `const registry = { ${members.registry.join(" ")} alpha: { on: false, ${members["registry.alpha"].join(" ")} inner: { deep: 1, ${members["registry.alpha.inner"].join(" ")} } }, beta: { on: true, ${members["registry.beta"].join(" ")} } };`,
        `function helper() { return "helped"; }`,
        `class Spot { on = false; ${members.origin.join(" ")} }`,
        `const origin = new Spot();`,
        `const child${as("any")} = Object.create(${random.pick(["registry.alpha", "Counter.prototype", "Object.prototype", "null", "origin"])}, { ${members.child.join(" ")} });`,
        `const root${as("any")} = { Counter, Heir, Old, registry, helper, origin, child };`,
      ]
    : [];
  return [
    ...(typed && usesMissing ? ["declare const missing: any;"] : []),
    ...(typed && [...otherNamesTaken.values()].some(line => line.includes("= require(")) ? ["declare const require: any;"] : []),
    `function show(v${as("any")})${as("string")} {`,
    `  if (typeof v === "function") return "function " + told(() => v.call(null));`,
    `  if (typeof v === "object" && v !== null) return Object.prototype.toString.call(v).slice(8, -1) + " " + JSON.stringify(v);`,
    `  return typeof v + " " + (Object.is(v, -0) ? "-0" : String(v));`,
    `}`,
    `function told(f${as("() => any")})${as("string")} {`,
    `  try { return show(f()); } catch (e) { const said = String(e); return /read-?only/.test(said) ? said : said.split(":")[0]; }`,
    `}`,
    ...[...otherNamesTaken.values()].sort((a, b) => Number(b.startsWith("import")) - Number(a.startsWith("import"))),
    ...keys,
    ...declarations,
    ...body,
  ].join("\n");
}
