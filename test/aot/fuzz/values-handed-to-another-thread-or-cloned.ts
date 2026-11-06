// Small programs in which one value is handed over on a road that copies or moves it, and is read at the far end (`corners`: the value and the road).
//
//   the value  (`things`) what the language has (numbers, texts, big integers, boxed values, dates, regular expressions, errors, buffers and views, maps, sets, lists, objects of every make), what cannot be copied
//              (functions, symbols, weak collections, promises, proxies, iterators), what the web has (blobs, files, ports, streams, keys, exceptions, modules of WebAssembly, requests ..), what node has (file handles,
//              key objects, certificates, block lists, socket addresses, histograms, stats, emitters) and what Bun has (files, hashers, globs, cookies ..)
//   the road   (`roads`) `workerData`, a message to or from a worker of node:worker_threads or of the web, there and back, a channel in one thread, `receiveMessageOnPort`, a port that is handed to a worker or that a
//              worker hands out, between two workers, a worker inside a worker, a file that is its own worker, a broadcast, `structuredClone`, environment data, the serializers of node:v8 and bun:jsc, a value that
//              a worker throws; with a list of what is moved wherever the value and the road have one
//   held       bare, or inside a literal, a list, a map or a set, alone, twice or beside other members
//   read       by a function in a file of its own, in JavaScript or in TypeScript, under the type that the sender has for the value or under the type of another value; ahead of it the function is handed nothing, or
//              a value that its own thread made
//   the files  ES modules or CommonJS; the worker is named by a URL, by a relative text, by a path, or is embedded as a file
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

type Thing = {
  /** Statements of an async function that end by returning the value. */
  make: string;
  /** What TypeScript is told that it is. */
  type: string;
  /** What is asked of `it` at the far end. */
  uses: string[];
  /** What the maker and the reader import: "open node:fs/promises". */
  takes?: string[];
  reads?: string[];
  /** Declarations that `type` names. */
  declares?: string;
  /** What stands in the list of what is moved. */
  list?: string;
  /** What is asked of the sender's own value right behind the send, and at the very end. */
  behind?: string[];
  last?: string[];
  /** The maker writes into a folder that the program makes and removes. */
  folder?: true;
  /** What the sender does with its own value in the end, however the send went. The reader then asks everything, and no reader of another value is handed it. */
  closes?: string;
  /** Printing all of it would print what differs from run to run. */
  isQuiet?: true;
  /** It cannot be copied, so it meets fewer roads. */
  isRefused?: true;
  /** Another value much like it meets every road, so it meets fewer. */
  isKin?: true;
};

const value = (text: string, type: string, uses: string[], more: Partial<Thing> = {}): Thing => ({
  make: `return ${text};`,
  type,
  uses,
  ...more,
});
const refused = (text: string, type = "object", uses: string[] = [], more: Partial<Thing> = {}): Thing => ({
  make: text.includes("return ") ? text : `return ${text};`,
  type,
  uses,
  isRefused: true,
  ...more,
});
const number = ["it + 1", "it * 0.5", "1 / it", "it | 0", "Object.is(it, -0)", "it === it", "[10, 20, 30][it]"];
const text = [
  "it.length",
  'it + "!"',
  "it.charCodeAt(0)",
  "it.toUpperCase().length",
  'it === "text"',
  "Object.hasOwn({ text: 1 }, it)",
  'new Map([["text", 1]]).get(it)',
  "it.isWellFormed()",
  "encodeURIComponent(it).length",
];
const big = ["it + 1n", "it * it", "BigInt.asUintN(64, it)", "it.toString(16)", "it > 0n"];
const error = [
  "it.name",
  "it.message",
  "it instanceof Error",
  "it instanceof TypeError",
  "typeof it.stack",
  'it.stack?.split("\\n")[0]',
  "show(it.cause)",
  "Object.keys(it).join()",
  "String(it)",
];
const buffer = [
  "it.byteLength",
  "new Uint8Array(it).join()",
  "it instanceof ArrayBuffer",
  "it.resizable",
  "it.maxByteLength",
  "it.detached",
  "it.slice(1).byteLength",
];
const view = (kind: string, elements: string, more: Partial<Thing> = {}): Thing =>
  value(
    `new ${kind}(${elements})`,
    kind,
    [
      "it.length",
      "it.join()",
      "it.byteOffset",
      "it.buffer.byteLength",
      `it instanceof ${kind}`,
      "it[1]",
      "it.at(-1)",
      "it.constructor.name",
      "it.subarray(1).length",
    ],
    { list: "it.buffer", behind: ["it.length", "it.byteLength"], ...more },
  );
const list = ["it.length", "Array.isArray(it)", "Object.keys(it).join()", "it.constructor.name"];
const point =
  "class Point {\n  #secret = 3;\n  x;\n  y;\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n  norm() {\n    return Math.hypot(this.x, this.y);\n  }\n  get sum() {\n    return this.x + this.y;\n  }\n  secret() {\n    return this.#secret;\n  }\n}\n";
const written =
  'const path = join(process.env.HANDED_FOLDER, "text.txt");\nwriteFileSync(path, "first\\nsecond\\n");\n';
const onDisk = ["join node:path", "writeFileSync node:fs"];
const certificate =
  "-----BEGIN CERTIFICATE-----\\nMIIBNTCB6KADAgECAgEHMAUGAytlcDAZMRcwFQYDVQQDDA5oYW5kZWQuZXhhbXBs\\nZTAgFw0yNjEwMjcwMzAxMTFaGA8yMTI2MTAwMzAzMDExMVowGTEXMBUGA1UEAwwO\\naGFuZGVkLmV4YW1wbGUwKjAFBgMrZXADIQDCif6vDV0iJCFUrBis8hSLA1i3r1zb\\nyBDouxcHepmLTKNTMFEwHQYDVR0OBBYEFO4p/78mGiIuDOMHckkYUhhxb0e4MB8G\\nA1UdIwQYMBaAFO4p/78mGiIuDOMHckkYUhhxb0e4MA8GA1UdEwEB/wQFMAMBAf8w\\nBQYDK2VwA0EAzbpu5FCcCtJdANlNP/Vy7ILCLXCFsaeU291ijM/gIFo3zAobrESh\\n3vBTkiqZRjWGRoU37HgJH4vMVjLkdwM2DA==\\n-----END CERTIFICATE-----\\n";
const publicKey =
  "-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEAwon+rw1dIiQhVKwYrPIUiwNYt69c28gQ6LsXB3qZi0w=\\n-----END PUBLIC KEY-----\\n";
const adds =
  "new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11])";

export const things: Record<string, Thing> = {
  "undefined": value("undefined", "undefined", ["it === undefined"]),
  "null": value("null", "null", ["it === null"]),
  "a boolean": value("true", "boolean", ["!it", "it ? 1 : 2", "it === true"]),
  "an integer": value("2", "number", number),
  "a fraction": value("0.5", "number", number),
  "minus zero": value("-0", "number", number),
  "what is not a number": value("NaN", "number", number),
  "an integer past 32 bits": value("2 ** 40 + 1", "number", number),
  "infinity": value("-Infinity", "number", number),
  "a big integer": value("12345678901234567890n", "bigint", big),
  "a small negative big integer": value("-5n", "bigint", big),
  "the big integer zero": value("0n", "bigint", big),
  "a text": value('"text"', "string", text),
  "an empty text": value('""', "string", text),
  "a text of wide characters": value('"\\u20ac\\ud83d\\ude00"', "string", text),
  "a text that is put together": value('"te".repeat(1) + ["x", "t"].join("")', "string", text),
  "half a pair of surrogates": value('"a\\ud800"', "string", text),
  "a long text": value('"long ".repeat(20000)', "string", text, { isQuiet: true }),
  "a boxed number": value("new Number(5)", "Number", ["it.valueOf() + 1", "it instanceof Number", "typeof it"]),
  "a boxed text": value('new String("boxed")', "String", [
    "it.length",
    "it.valueOf()",
    "it instanceof String",
    "it[1]",
  ]),
  "a boxed boolean": value("new Boolean(false)", "Boolean", ["it.valueOf()", "it ? 1 : 2", "it instanceof Boolean"]),
  "a boxed big integer": value("Object(5n)", "BigInt", ["it.valueOf() + 1n", "typeof it", "it instanceof BigInt"]),
  "a date": value("new Date(86400000)", "Date", [
    "it.getTime()",
    "it.toISOString()",
    "it instanceof Date",
    "it.getUTCDay()",
    "it.valueOf() + 1",
  ]),
  "a date that is none": value("new Date(NaN)", "Date", ["it.getTime()", "it.toISOString()", "it instanceof Date"]),
  "a regular expression": {
    make: 'const it = /a(b)?/gi;\nit.test("xab");\nreturn it;',
    type: "RegExp",
    uses: [
      "it.source",
      "it.flags",
      "it.lastIndex",
      'it.test("xab")',
      'it.exec("ab ab")?.index',
      '"ab ab".replace(it, "-")',
      "it instanceof RegExp",
    ],
    behind: ["it.lastIndex"],
  },
  "a regular expression with names and sets": value("/(?<year>\\d{4})[\\p{L}--[a-f]]/dv", "RegExp", [
    "it.flags",
    'it.exec("2026z")?.groups?.year',
    'it.exec("2026z")?.indices?.[1]?.join()',
    'it.test("2026a")',
  ]),
  "an error": value('new Error("went wrong")', "Error", error),
  "a type error": value('new TypeError("of another kind")', "TypeError", error),
  "a range error": value('new RangeError("too far")', "RangeError", [...error, "it instanceof RangeError"]),
  "a syntax error": value('new SyntaxError("not so")', "SyntaxError", [...error, "it instanceof SyntaxError"]),
  "an error with a cause": value('new Error("outer", { cause: new TypeError("inner") })', "Error", [
    ...error,
    "it.cause instanceof TypeError",
  ]),
  "an error with members of its own": value(
    'Object.assign(new Error("with more"), { code: "E_MORE", detail: { at: 3 } })',
    "Error & { code: string; detail: { at: number } }",
    [...error, "it.code", "it.detail.at + 1"],
  ),
  "several errors in one": value(
    'new AggregateError([new Error("one"), new RangeError("two")], "both")',
    "AggregateError",
    [...error, "it.errors?.length", "it instanceof AggregateError"],
  ),
  "an error of a class of the program": {
    make: 'class Refusal extends Error {\n  code = 7;\n  get name() {\n    return "Refusal";\n  }\n  again() {\n    return this.code + 1;\n  }\n}\nreturn new Refusal("not this");',
    type: "Refusal",
    declares: "interface Refusal extends Error {\n  code: number;\n  again(): number;\n}\n",
    uses: [...error, "it.code", "it.again()", "it.constructor.name"],
  },
  "an error under another name": {
    make: 'const it = new Error("renamed");\nit.name = "Mine";\nit.stack = "written by hand";\nreturn it;',
    type: "Error",
    uses: error,
  },
  "an error whose message is a getter": {
    make: 'let asked = 0;\nconst it = new Error("first");\nObject.defineProperty(it, "message", { get: () => "asked " + ++asked, enumerable: true, configurable: true });\nreturn it;',
    type: "Error",
    uses: error,
    last: ["it.message"],
  },
  "an exception of the web": value('new DOMException("gone", "AbortError")', "DOMException", [
    "it.name",
    "it.message",
    "it.code",
    "it instanceof DOMException",
    "it instanceof Error",
    "it.constructor.name",
  ]),
  "a buffer": value("new Uint8Array([1, 2, 3, 4]).buffer", "ArrayBuffer", buffer, {
    list: "it",
    behind: ["it.byteLength", "it.detached"],
  }),
  "an empty buffer": value("new ArrayBuffer(0)", "ArrayBuffer", buffer, { list: "it", behind: ["it.detached"] }),
  "a buffer that can grow": {
    make: "const it = new ArrayBuffer(4, { maxByteLength: 16 });\nnew Uint8Array(it).set([9, 8, 7, 6]);\nreturn it;",
    type: "ArrayBuffer",
    uses: [...buffer, "(it.resize(8), it.byteLength)"],
    list: "it",
    behind: ["it.byteLength", "it.detached"],
  },
  "a buffer that was moved away": refused(
    "const it = new ArrayBuffer(4);\nit.transfer();\nreturn it;",
    "ArrayBuffer",
    buffer,
    { list: "it" },
  ),
  "a large buffer": value(
    "new Uint8Array(3000000).fill(5).buffer",
    "ArrayBuffer",
    ["it.byteLength", "new Uint8Array(it)[2999999]"],
    {
      list: "it",
      behind: ["it.byteLength"],
      isQuiet: true,
    },
  ),
  "a shared buffer": {
    make: "const it = new SharedArrayBuffer(8);\nnew Int32Array(it)[1] = 3;\nreturn it;",
    type: "SharedArrayBuffer",
    uses: [
      "it.byteLength",
      "it instanceof SharedArrayBuffer",
      "Atomics.add(new Int32Array(it), 0, 5)",
      "new Int32Array(it).join()",
      "it.growable",
    ],
    last: ["new Int32Array(it).join()"],
  },
  "a shared buffer that can grow": {
    make: "return new SharedArrayBuffer(4, { maxByteLength: 16 });",
    type: "SharedArrayBuffer",
    uses: ["it.byteLength", "it.growable", "it.maxByteLength", "(it.grow(8), it.byteLength)"],
    last: ["it.byteLength"],
  },
  "bytes": view("Uint8Array", "[1, 2, 250]"),
  "clamped bytes": view("Uint8ClampedArray", "[1, 300, -5]"),
  "signed bytes": view("Int8Array", "[1, -2, 127]"),
  "integers of 16 bits": view("Int16Array", "[1, -2, 32767]"),
  "unsigned integers of 16 bits": view("Uint16Array", "[1, 2, 65535]"),
  "integers of 32 bits": view("Int32Array", "[1, -2, 2147483647]"),
  "unsigned integers of 32 bits": view("Uint32Array", "[1, 2, 4294967295]"),
  "fractions of 16 bits": view("Float16Array", "[0.5, -0, 65504]"),
  "fractions of 32 bits": view("Float32Array", "[0.5, -0, NaN]"),
  "fractions of 64 bits": view("Float64Array", "[0.5, -0, 1e300]"),
  "big integers of 64 bits": view("BigInt64Array", "[1n, -2n, 9223372036854775807n]"),
  "unsigned big integers of 64 bits": view("BigUint64Array", "[1n, 2n, 18446744073709551615n]"),
  "a view of the middle of a buffer": view("Uint8Array", "new Uint8Array([1, 2, 3, 4, 5, 6]).buffer, 2, 3"),
  "a view that follows its buffer": view("Uint8Array", "new ArrayBuffer(4, { maxByteLength: 8 })", {
    type: "Uint8Array<ArrayBuffer>",
    uses: ["it.length", "it.buffer.resizable", "(it.buffer.resize(6), it.length)", "it.join()"],
  }),
  "a view of a shared buffer": view("Int32Array", "new SharedArrayBuffer(8)", {
    uses: ["it.length", "it.buffer instanceof SharedArrayBuffer", "Atomics.add(it, 1, 4)", "it.join()"],
    list: undefined,
    behind: undefined,
    last: ["it.join()"],
  }),
  "a view with a member of its own": value(
    'Object.assign(new Uint8Array([1, 2]), { label: "mine" })',
    "Uint8Array & { label?: string }",
    ["it.label", "it.join()", "Object.keys(it).join()"],
  ),
  "two views of one buffer": {
    make: "const bytes = new Uint8Array([1, 0, 2, 0]);\nreturn { bytes, pairs: new Uint16Array(bytes.buffer) };",
    type: "{ bytes: Uint8Array; pairs: Uint16Array }",
    uses: ["it.bytes.buffer === it.pairs.buffer", "(it.bytes[0] = 9, it.pairs[0])", "it.pairs.join()"],
    list: "it.bytes.buffer",
    behind: ["it.bytes.length", "it.pairs.length"],
  },
  "a view of any kind of number": value("new DataView(new Uint8Array([1, 2, 3, 4]).buffer, 1, 2)", "DataView", [
    "it.byteLength",
    "it.byteOffset",
    "it.getInt16(0)",
    "it instanceof DataView",
    "it.buffer.byteLength",
  ]),
  "a buffer of node out of a text": value('Buffer.from("text")', "Uint8Array", [
    "it.length",
    "it.join()",
    "it.constructor.name",
    "String(it)",
    "it.byteOffset % 8",
    "Buffer.isBuffer(it)",
  ]),
  "a buffer of node of its own": value(
    "Buffer.alloc(4, 1)",
    "Uint8Array",
    ["it.length", "it.join()", "it.constructor.name", "String(it).length"],
    {
      list: "it.buffer",
      behind: ["it.length"],
    },
  ),
  "a buffer that is marked as not to be moved": {
    make: "const it = new ArrayBuffer(4);\nmarkAsUntransferable(it);\nreturn it;",
    takes: ["markAsUntransferable node:worker_threads"],
    type: "ArrayBuffer",
    uses: buffer,
    list: "it",
    behind: ["it.byteLength"],
  },
  "an object that is marked as not to be copied": {
    make: "const it = { a: 1 };\nmarkAsUncloneable(it);\nreturn it;",
    takes: ["markAsUncloneable node:worker_threads"],
    type: "{ a: number }",
    uses: ["it.a"],
  },
  "a map": value('new Map([["a", 1], ["b", 2]])', "Map<string, number>", [
    "it.size",
    'it.get("a")',
    "[...it.keys()].join()",
    "it instanceof Map",
    'it.has("c")',
    'it.set("c", 3).size',
  ]),
  "a set": value('new Set([1, "two", 1.5])', "Set<number | string>", [
    "it.size",
    "it.has(1.5)",
    "[...it].join()",
    "it instanceof Set",
    "it.add(4).size",
  ]),
  "a map that holds itself under an object": {
    make: 'const it = new Map();\nconst key = { name: "key" };\nit.set(key, it);\nit.set("key", key);\nreturn it;',
    type: "Map<unknown, unknown>",
    uses: ["it.size", 'it.get(it.get("key")) === it', "[...it.keys()].length"],
  },
  "a map with a member of its own": value(
    'Object.assign(new Map([[1, 2]]), { label: "mine" })',
    "Map<number, number> & { label?: string }",
    ["it.label", "it.get(1)", "Object.keys(it).join()"],
  ),
  "an instance of a class below Map": {
    make: 'class Counts extends Map {\n  bump(key) {\n    this.set(key, (this.get(key) ?? 0) + 1);\n    return this.get(key);\n  }\n}\nconst it = new Counts();\nit.bump("a");\nreturn it;',
    type: "Counts",
    declares: "interface Counts extends Map<string, number> {\n  bump(key: string): number;\n}\n",
    uses: ['it.get("a")', 'it.bump("a")', "it.constructor.name", "it instanceof Map"],
  },
  "a list of integers": value("[1, 2, 3]", "number[]", [
    ...list,
    "it[1] + 1",
    "it.map(each => each * 2).join()",
    "it.indexOf(3)",
    "it.push(4)",
    "it.reduce((sum, each) => sum + each, 0)",
  ]),
  "a list of fractions": value("[0.5, 1.5, -0]", "number[]", [
    ...list,
    "it[0] + it[1]",
    "Object.is(it[2], -0)",
    "it.push(1)",
  ]),
  "a list of everything": value('[1, "two", null, undefined, 3n, [4], { five: 5 }, true]', "unknown[]", [
    ...list,
    "typeof it[3]",
    "3 in it",
  ]),
  "a list with holes": value("[1, , 3]", "(number | undefined)[]", [
    ...list,
    "1 in it",
    "it.flat().length",
    "it.findLast(each => !each)",
  ]),
  "a list that is nearly empty": {
    make: "const it = [];\nit[50000] = 1;\nreturn it;",
    type: "number[]",
    uses: ["it.length", "Object.keys(it).join()", "it[50000]", "0 in it"],
    isQuiet: true,
  },
  "an empty list": value("[]", "number[]", [...list, "it.push(1)", "it[0]"]),
  "a list with a member of its own": value(
    'Object.assign([1, 2], { label: "mine" })',
    "number[] & { label?: string }",
    [...list, "it.label"],
  ),
  "a thousand objects of one make": value(
    'Array.from({ length: 1000 }, (_, at) => ({ at, name: "n" + at, half: at / 2 }))',
    "{ at: number; name: string; half: number }[]",
    [
      "it.length",
      "it.reduce((sum, each) => sum + each.at + each.half, 0)",
      "it[999].name",
      "Object.keys(it[500]).join()",
      "it.filter(each => each.name.length === 3).length",
    ],
    { isQuiet: true },
  ),
  "a frozen list": value("Object.freeze([1, 2])", "number[]", [...list, "Object.isFrozen(it)", "it.push(3)"]),
  "an instance of a class below Array": {
    make: "class Stack extends Array {\n  top() {\n    return this[this.length - 1];\n  }\n}\nreturn Stack.from([1, 2]);",
    type: "Stack",
    declares: "interface Stack extends Array<number> {\n  top(): number;\n}\n",
    uses: [...list, "it.top()"],
  },
  "the arguments of a call": value("(function () {\n  return arguments;\n})(1, 2)", "ArrayLike<number>", [
    "it.length",
    "it[0]",
    "Array.isArray(it)",
    "Array.from(it).join()",
  ]),
  "a literal": value('{ a: 1, b: "two", c: 0.5 }', "{ a: number; b: string; c: number }", [
    "it.a + 1",
    "it.b.length",
    "it.c * 2",
    "Object.keys(it).join()",
    "({ ...it }).b",
    '"a" in it',
    "(it.a = 0.25, it.a)",
  ]),
  "literals inside each other": value(
    "{ inner: { deep: { value: 7 } }, list: [{ a: 1 }, { a: 2 }] }",
    "{ inner: { deep: { value: number } }; list: { a: number }[] }",
    ["it.inner.deep.value + 1", "it.list[1].a", "it.list.map(each => each.a).join()"],
  ),
  "an object without a prototype": value("Object.assign(Object.create(null), { a: 1 })", "{ a: number }", [
    "it.a",
    "Object.getPrototypeOf(it) === null",
    '"toString" in it',
  ]),
  "an object with a getter": {
    make: "let asked = 0;\nreturn {\n  get a() {\n    return ++asked;\n  },\n  b: 2,\n};",
    type: "{ readonly a: number; b: number }",
    uses: ["it.a", "it.a + it.b", 'typeof Object.getOwnPropertyDescriptor(it, "a")?.get'],
    last: ["it.a"],
  },
  "an object with a getter that throws": refused(
    'return {\n  a: 1,\n  get b() {\n    throw new RangeError("not to be read");\n  },\n};',
    "{ a: number; readonly b: number }",
    ["it.a", "it.b"],
  ),
  "an object with symbols and hidden members": value(
    'Object.defineProperty({ a: 1, [Symbol("s")]: 2, [Symbol.toStringTag]: "Tagged" }, "hidden", { value: 4 })',
    "{ a: number; hidden?: number }",
    ["it.a", "it.hidden", "Reflect.ownKeys(it).length"],
  ),
  "an object that holds itself": {
    make: 'const it = { name: "ring" };\nit.self = it;\nreturn it;',
    type: "Ring",
    declares: "interface Ring {\n  name: string;\n  self: Ring;\n}\n",
    uses: ["it.self === it", "it.self.self.name"],
  },
  "one object at three places": {
    make: "const one = { n: 1 };\nreturn { first: one, second: one, list: [one] };",
    type: "{ first: { n: number }; second: { n: number }; list: { n: number }[] }",
    uses: ["it.first === it.second", "it.list[0] === it.first", "(it.first.n = 5, it.second.n)"],
    last: ["it.second.n"],
  },
  "an instance of a class": {
    make: point + "return new Point(3, 4);",
    type: "Point",
    declares:
      "interface Point {\n  x: number;\n  y: number;\n  norm(): number;\n  readonly sum: number;\n  secret(): number;\n}\n",
    uses: ["it.x + it.y", "it.norm()", "it.sum", "it.secret()", "it.constructor.name", "Object.keys(it).join()"],
  },
  "an instance of a class below a class": {
    make: "class Base {\n  a = 1;\n  first() {\n    return this.a;\n  }\n}\nclass Heir extends Base {\n  b = 0.5;\n  both() {\n    return this.a + this.b;\n  }\n}\nreturn new Heir();",
    type: "Heir",
    declares: "interface Heir {\n  a: number;\n  b: number;\n  first(): number;\n  both(): number;\n}\n",
    uses: ["it.a + it.b", "it.first()", "it.both()", "Object.keys(it).join()"],
  },
  "an heir of an object": value(
    "Object.assign(Object.create({ below: 1 }), { own: 2 })",
    "{ below?: number; own: number }",
    ["it.own", "it.below", '"below" in it'],
  ),
  "a frozen object": value(
    "Object.freeze({ a: 1, inner: Object.freeze({ b: 2 }) })",
    "{ a: number; inner: { b: number } }",
    ["Object.isFrozen(it)", "(it.a = 5, it.a)", "Object.isFrozen(it.inner)"],
  ),
  "an object with keys that are numbers": value(
    '{ b: 1, 2: "two", a: 3, 1: "one", [-1]: "minus" }',
    "Record<string, number | string>",
    ["Object.keys(it).join()", "it[1]", "it[2]", 'it["-1"]'],
  ),
  "an object with a member of its own named __proto__": value(
    `JSON.parse('{"__proto__": {"odd": 1}, "a": 1}')`,
    "{ a: number; odd?: number }",
    ["Object.keys(it).join()", "it.odd", "Object.getPrototypeOf(it) === Object.prototype"],
  ),
  "an object with two hundred keys": value(
    'Object.fromEntries(Array.from({ length: 200 }, (_, at) => ["k" + at, at]))',
    "Record<string, number>",
    ["Object.keys(it).length", "it.k199", "it.k0 + it.k100"],
    { isQuiet: true },
  ),
  "an object that lost a key": {
    make: "const it = { a: 1, b: 2, c: 3 };\ndelete it.b;\nreturn it;",
    type: "{ a: number; b?: number; c: number }",
    uses: ["Object.keys(it).join()", "it.b", "it.a + it.c"],
  },
  "a function": refused("function named() {\n  return 1;\n}", "() => number", ["it()", "it.name"]),
  "a literal that holds an arrow": refused("{ a: 1, run: () => 1 }", "{ a: number; run(): number }", [
    "it.a",
    "it.run()",
  ]),
  "a class": refused("class Named {}", "new () => object", ["new it()", "it.name"]),
  "a bound function": refused("Math.max.bind(null, 1)", "(...given: number[]) => number", ["it(2)"]),
  "a function of the language": refused("Math.max", "(...given: number[]) => number", ["it(1, 2)"]),
  "a symbol": refused('Symbol("mine")', "symbol", ["it.description"]),
  "a symbol that everybody can ask for": refused('Symbol.for("shared")', "symbol", [
    "it.description",
    "Symbol.keyFor(it)",
  ]),
  "a symbol of the language": refused("Symbol.iterator", "symbol", ["it === Symbol.iterator"]),
  "a boxed symbol": refused('Object(Symbol("boxed"))', "Symbol", ["it.description"]),
  "a weak map": refused("new WeakMap()", "WeakMap<object, number>", ["it.has({})"]),
  "a weak set": refused("new WeakSet()", "WeakSet<object>", ["it.has({})"]),
  "a weak reference": refused("new WeakRef({ a: 1 })", "WeakRef<{ a: number }>", ["it.deref()?.a"]),
  "a registry of what is collected": refused("new FinalizationRegistry(() => {})"),
  "a promise inside a literal": refused("{ promise: Promise.resolve(1) }", "{ promise: Promise<number> }", [
    "await it.promise",
  ]),
  "a proxy": refused("new Proxy({ a: 1 }, {})", "{ a: number }", ["it.a"]),
  "a proxy that counts": {
    make: 'const asked = [];\nconst it = new Proxy(\n  { a: 1 },\n  {\n    get(target, key, receiver) {\n      asked.push(String(key));\n      return key === "asked" ? asked.join() : Reflect.get(target, key, receiver);\n    },\n    ownKeys(target) {\n      asked.push("keys");\n      return Reflect.ownKeys(target);\n    },\n  },\n);\nreturn it;',
    type: "{ a: number; asked?: string }",
    uses: ["it.a", "it.asked"],
    last: ["it.asked"],
    isRefused: true,
    isQuiet: true,
  },
  "a proxy of a list": refused("new Proxy([1, 2], {})", "number[]", ["it.length", "Array.isArray(it)"]),
  "a generator that has begun": refused(
    "function* counts() {\n  yield 1;\n  yield 2;\n}\nconst it = counts();\nit.next();\nreturn it;",
    "Generator<number>",
    ["it.next().value"],
  ),
  "the iterator of a list": refused("[1, 2][Symbol.iterator]()", "Iterator<number>", ["it.next().value"]),
  "the iterator of a map": refused("new Map([[1, 2]]).entries()", "Iterator<[number, number]>", ["it.next().done"]),
  "an iterator helper": refused("[1, 2].values().map(each => each + 1)", "Iterator<number>", ["it.next().value"]),
  "the namespace of a built-in module": refused('await import("node:path")', "{ sep: string }", ["it.sep.length"], {
    isQuiet: true,
  }),
  "the global object": refused("globalThis", "object", [], { isQuiet: true }),
  "Math": refused("Math", "Math", ["it.PI", "it.max(1, 2)"]),
  "JSON": refused("JSON", "JSON", ["it.stringify(1)"]),
  "a formatter of numbers": refused('new Intl.NumberFormat("en")', "Intl.NumberFormat", ["it.format(1.5)"]),
  "a stack of what is to be disposed of": refused("new DisposableStack()", "DisposableStack", ["it.disposed"]),
  "a blob": value('new Blob(["blob ", "text"], { type: "text/plain" })', "Blob", [
    "it.size",
    "it.type",
    "await it.text()",
    "it instanceof Blob",
    "it.slice(1, 3).size",
    "(await it.arrayBuffer()).byteLength",
    "it.constructor.name",
  ]),
  "an empty blob": value("new Blob([])", "Blob", ["it.size", "it.type", "await it.text()", "it instanceof Blob"]),
  "a blob out of blobs and bytes": value('new Blob([new Blob(["in"]), new Uint8Array([110, 101, 114]), "!"])', "Blob", [
    "it.size",
    "await it.text()",
    "await it.slice(2).text()",
  ]),
  "a file": value('new File(["file text"], "name.txt", { type: "text/plain", lastModified: 86400000 })', "File", [
    "it.size",
    "it.name",
    "it.lastModified",
    "it.type",
    "await it.text()",
    "it instanceof File",
    "it instanceof Blob",
    "it.constructor.name",
  ]),
  "a file on disk": {
    make: written + "return Bun.file(path);",
    takes: onDisk,
    folder: true,
    type: "OnDisk",
    declares: "interface OnDisk extends Blob {\n  name?: string;\n  exists(): Promise<boolean>;\n}\n",
    uses: [
      "it.size",
      "await it.text()",
      "it.constructor.name",
      "it.type",
      "await it.exists()",
      "it.name?.slice(-8)",
      "it instanceof Blob",
    ],
    isQuiet: true,
  },
  "a part of a file on disk": {
    make: written + "return Bun.file(path).slice(6, 12);",
    takes: onDisk,
    folder: true,
    type: "Blob",
    uses: ["it.size", "await it.text()", "it.constructor.name"],
    isQuiet: true,
  },
  "a file that is not there": value(
    'Bun.file("nowhere/at/all.txt")',
    "Blob",
    ["it.size", "await it.text()", "it.type"],
    {
      isQuiet: true,
    },
  ),
  "a port": {
    make: 'const { port1, port2 } = new MessageChannel();\nport1.postMessage("through the port");\nreturn port2;',
    type: "MessagePort",
    uses: [
      "it.constructor.name",
      "it instanceof MessagePort",
      "await new Promise(resolve => {\n      it.onmessage = event => {\n        it.close();\n        resolve(event.data);\n      };\n    })",
    ],
    list: "it",
    isQuiet: true,
  },
  "a stream to read from": {
    make: 'return new ReadableStream({\n  start(controller) {\n    controller.enqueue("chunk");\n    controller.close();\n  },\n});',
    type: "ReadableStream<string>",
    uses: ["it.constructor.name", "it.locked", "(await it.getReader().read()).value"],
    list: "it",
    behind: ["it.locked"],
    isRefused: true,
    isQuiet: true,
  },
  "a stream to write to": refused("new WritableStream({})", "WritableStream<string>", ["it.locked"], {
    list: "it",
    isQuiet: true,
  }),
  "a stream that changes what passes": refused(
    "new TransformStream()",
    "TransformStream<string, string>",
    ["it.readable.locked"],
    {
      list: "it",
      isQuiet: true,
    },
  ),
  "a key that signs": {
    make: 'return await crypto.subtle.importKey("raw", new Uint8Array(32).fill(7), { name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);',
    type: "CryptoKey",
    uses: [
      "it.type",
      "it.extractable",
      "it.algorithm.name",
      "it.usages.join()",
      'new Uint8Array(await crypto.subtle.sign("HMAC", it, new Uint8Array(4))).slice(0, 4).join()',
      "it.constructor.name",
      "it instanceof CryptoKey",
    ],
  },
  "a key that does not leave": {
    make: 'return await crypto.subtle.importKey("raw", new Uint8Array(16).fill(3), "AES-GCM", false, ["encrypt"]);',
    type: "CryptoKey",
    uses: [
      "it.extractable",
      "it.algorithm.name",
      'await crypto.subtle.exportKey("raw", it)',
      '(await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, it, new Uint8Array(2))).byteLength',
    ],
  },
  "a module of WebAssembly": value(`new WebAssembly.Module(${adds})`, "WebAssembly.Module", [
    "it instanceof WebAssembly.Module",
    "WebAssembly.Module.exports(it).map(each => each.name).join()",
    "call(new WebAssembly.Instance(it).exports.add, 2, 3)",
  ]),
  "shared memory of WebAssembly": value(
    "new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })",
    "WebAssembly.Memory",
    ["it.buffer.byteLength", "it.buffer instanceof SharedArrayBuffer", "(new Uint8Array(it.buffer)[0] = 9)"],
    { last: ["new Uint8Array(it.buffer)[0]"], isQuiet: true },
  ),
  "memory of WebAssembly": refused(
    "new WebAssembly.Memory({ initial: 1 })",
    "WebAssembly.Memory",
    ["it.buffer.byteLength"],
    {
      isQuiet: true,
    },
  ),
  "an address of the web": refused('new URL("https://example.com/a?b=1")', "URL", [
    "it.href",
    'it.searchParams?.get("b")',
  ]),
  "the parameters of an address": refused('new URLSearchParams("a=1")', "URLSearchParams", ['it.get("a")']),
  "headers": refused('new Headers({ a: "1" })', "Headers", ['it.get("a")']),
  "a request": refused('new Request("https://example.com/")', "Request", ["it.method"], { isQuiet: true }),
  "a response": refused('new Response("body")', "Response", ["it.status", "await it.text()"], { isQuiet: true }),
  "the fields of a form": refused("new FormData()", "FormData", ['it.has("a")']),
  "a signal that is aborted": refused("AbortSignal.abort()", "AbortSignal", ["it.aborted"], { isQuiet: true }),
  "a controller of a signal": refused("new AbortController()", "AbortController", ["it.signal?.aborted"], {
    isQuiet: true,
  }),
  "an event": refused('new Event("kind")', "Event", ["it.type"], { isQuiet: true }),
  "a target of events": refused("new EventTarget()", "EventTarget", ["typeof it.addEventListener"]),
  "an encoder of texts": refused("new TextEncoder()", "TextEncoder", ["it.encoding"]),
  "a decoder of texts": refused("new TextDecoder()", "TextDecoder", ["it.encoding"]),
  "a file handle": {
    make: written + 'return await open(path, "r");',
    takes: [...onDisk, "open node:fs/promises"],
    folder: true,
    type: "Handle",
    declares:
      "interface Handle {\n  fd: number;\n  readFile(encoding: string): Promise<string>;\n  stat(): Promise<{ size: number }>;\n  close(): Promise<void>;\n}\n",
    uses: [
      "it.constructor.name",
      "it.fd > 0",
      'await it.readFile("utf8")',
      "(await it.stat()).size",
      "await it.close()",
      "it.fd",
    ],
    list: "it",
    behind: ["it.fd > 0"],
    closes: "await it.close();",
    isQuiet: true,
  },
  "a secret key of node": value(
    'createSecretKey(Buffer.from("0123456789abcdef"))',
    "Key",
    ["it.type", "it.symmetricKeySize", 'it.export().toString("hex")', "it.constructor.name", "it.equals(it)"],
    {
      takes: ["createSecretKey node:crypto"],
      declares:
        "interface Key {\n  type: string;\n  symmetricKeySize?: number;\n  asymmetricKeyType?: string;\n  export(options?: object): { toString(encoding?: string): string };\n  equals(other: Key): boolean;\n}\n",
    },
  ),
  "a public key of node": value(
    `createPublicKey("${publicKey}")`,
    "Key",
    [
      "it.type",
      "it.asymmetricKeyType",
      'it.export({ type: "spki", format: "der" }).toString("hex").length',
      "it.constructor.name",
    ],
    {
      takes: ["createPublicKey node:crypto"],
      declares:
        "interface Key {\n  type: string;\n  symmetricKeySize?: number;\n  asymmetricKeyType?: string;\n  export(options?: object): { toString(encoding?: string): string };\n  equals(other: Key): boolean;\n}\n",
    },
  ),
  "a certificate": value(
    `new X509Certificate("${certificate}")`,
    "Certificate",
    [
      "it.subject",
      "it.serialNumber",
      "it.ca",
      "it.fingerprint256.length",
      "it.constructor.name",
      "it.publicKey.asymmetricKeyType",
      'it.checkHost("handed.example")',
    ],
    {
      takes: ["X509Certificate node:crypto"],
      declares:
        "interface Certificate {\n  subject: string;\n  serialNumber: string;\n  ca: boolean;\n  fingerprint256: string;\n  publicKey: { asymmetricKeyType?: string };\n  checkHost(name: string): string | undefined;\n}\n",
      isQuiet: true,
    },
  ),
  "a list of blocked addresses": {
    make: 'const it = new BlockList();\nit.addAddress("1.2.3.4");\nit.addSubnet("10.0.0.0", 8);\nreturn it;',
    takes: ["BlockList node:net"],
    type: "Blocked",
    declares:
      "interface Blocked {\n  check(address: string): boolean;\n  addAddress(address: string): void;\n  rules: string[];\n}\n",
    uses: [
      'it.check("1.2.3.4")',
      'it.check("10.9.9.9")',
      'it.check("8.8.8.8")',
      "it.rules.join()",
      "it.constructor.name",
      '(it.addAddress("8.8.8.8"), it.check("8.8.8.8"))',
    ],
    last: ['it.check("8.8.8.8")'],
    isQuiet: true,
  },
  "the address of a socket": value(
    'new SocketAddress({ address: "1.2.3.4", port: 80 })',
    "{ address: string; port: number; family: string }",
    ["it.address", "it.port + 1", "it.family", "it.constructor.name"],
    { takes: ["SocketAddress node:net"], isQuiet: true },
  ),
  "a histogram": {
    make: "const it = createHistogram();\nit.record(5);\nit.record(9);\nreturn it;",
    takes: ["createHistogram node:perf_hooks"],
    type: "Histogram",
    declares:
      "interface Histogram {\n  count: number;\n  min: number;\n  max: number;\n  mean: number;\n  percentile(part: number): number;\n  record(value: number): void;\n}\n",
    uses: [
      "it.count",
      "it.min",
      "it.max",
      "it.mean",
      "it.percentile(50)",
      "it.constructor.name",
      "(it.record(20), it.max)",
    ],
    last: ["it.max"],
    isQuiet: true,
  },
  "what is known about a file": {
    make: written + "return statSync(path);",
    takes: [...onDisk, "statSync node:fs"],
    folder: true,
    type: "{ size: number; mtime: Date; isFile(): boolean }",
    uses: ["it.size", "it.isFile()", "it.constructor.name", "it.mtime instanceof Date", "Object.keys(it).join()"],
    isQuiet: true,
  },
  "an entry of a folder": {
    make: written + "return readdirSync(process.env.HANDED_FOLDER, { withFileTypes: true })[0];",
    takes: [...onDisk, "readdirSync node:fs"],
    folder: true,
    type: "{ name: string; isFile(): boolean }",
    uses: ["it.name", "it.isFile()", "it.constructor.name", "Object.keys(it).join()"],
    isQuiet: true,
  },
  "an emitter nobody listens to": value(
    "new EventEmitter()",
    "{ listenerCount(name: string): number }",
    ["Object.keys(it).join()", "it.constructor.name", 'it.listenerCount("x")'],
    { takes: ["EventEmitter node:events"] },
  ),
  "an emitter somebody listens to": refused(
    'const it = new EventEmitter();\nit.on("x", () => {});\nreturn it;',
    "{ listenerCount(name: string): number }",
    ['it.listenerCount("x")'],
    { takes: ["EventEmitter node:events"] },
  ),
  "the environment": {
    make: 'process.env.HANDED = "yes";\nreturn process.env;',
    type: "Record<string, string | undefined>",
    uses: [
      "it.HANDED",
      "typeof it",
      "Object.getPrototypeOf(it) === Object.prototype",
      '(it.HANDED = 5 + "", it.HANDED)',
    ],
    last: ["it.HANDED"],
    isQuiet: true,
  },
  "a parsed path": value(
    'parse("/a/b/c.txt")',
    "{ base: string; ext: string; dir: string }",
    ["it.base", "it.ext.length", "Object.keys(it).join()"],
    { takes: ["parse node:path"] },
  ),
  "a hasher of Bun": refused(
    'new Bun.CryptoHasher("sha256")',
    "{ update(text: string): unknown }",
    ["typeof it.update"],
    { isQuiet: true },
  ),
  "a glob of Bun": refused('new Bun.Glob("*.ts")', "{ match(text: string): boolean }", ['it.match("a.ts")'], {
    isQuiet: true,
  }),
  "a cookie of Bun": refused('new Bun.Cookie("a", "b")', "{ name: string; value: string }", ["it.name", "it.value"], {
    isQuiet: true,
  }),
  "a map of cookies of Bun": refused(
    'new Bun.CookieMap("a=b")',
    "{ get(name: string): string | null }",
    ['it.get("a")'],
    { isQuiet: true },
  ),
  "the input of the process as a file": value(
    "Bun.stdin",
    "Blob",
    ["it.constructor.name", "it instanceof Blob", "it.type"],
    { isQuiet: true },
  ),
};

for (const each of [
  "null",
  "a boolean",
  "a fraction",
  "minus zero",
  "what is not a number",
  "an integer past 32 bits",
  "infinity",
  "a small negative big integer",
  "the big integer zero",
  "an empty text",
  "a text of wide characters",
  "a text that is put together",
  "half a pair of surrogates",
  "a long text",
  "a boxed text",
  "a boxed boolean",
  "a boxed big integer",
  "a date that is none",
  "a regular expression with names and sets",
  "a type error",
  "a range error",
  "a syntax error",
  "an error under another name",
  "an empty buffer",
  "clamped bytes",
  "signed bytes",
  "integers of 16 bits",
  "unsigned integers of 16 bits",
  "integers of 32 bits",
  "unsigned integers of 32 bits",
  "fractions of 16 bits",
  "fractions of 32 bits",
  "big integers of 64 bits",
  "unsigned big integers of 64 bits",
  "an empty blob",
  "a blob out of blobs and bytes",
  "an empty list",
  "a list of fractions",
  "a frozen list",
  "a part of a file on disk",
  "a file that is not there",
  "a public key of node",
  "a key that does not leave",
  "a parsed path",
  "an entry of a folder",
])
  things[each].isKin = true;

/** `t`: it takes a list of what is moved. `w`: it starts a worker. */
export const roads: Record<string, string> = {
  "workerData": "tw",
  "a message to a worker of node": "tw",
  "a message from a worker of node": "tw",
  "a message to a worker": "tw",
  "a message from a worker": "tw",
  "there and back": "tw",
  "a channel in one thread": "t",
  "a channel that is asked": "t",
  "a port that a worker is handed": "tw",
  "a port that a worker hands out": "tw",
  "between two workers": "tw",
  "a worker inside a worker": "tw",
  "a file that is its own worker": "tw",
  "a broadcast in one thread": "",
  "a broadcast to a worker": "w",
  "structuredClone": "t",
  "environment data": "w",
  "the serializer of node:v8": "",
  "the serializer of bun:jsc": "",
  "thrown in a worker": "w",
};

/** Every value on every road; what cannot be copied, and what is much like another value, on six of them, others for each. What can be moved goes each road that has a list twice: moved, and copied. */
export const corners: string[] = Object.entries(things).flatMap(([thing, { isRefused, isKin, list }], at) =>
  Object.keys(roads)
    .filter(
      (_, road, all) =>
        !(isRefused || isKin) ||
        ((road + all.length - ((at * 7) % all.length)) % 3 === 0 &&
          (road + all.length - ((at * 7) % all.length)) % all.length < 18),
    )
    .flatMap(road =>
      list && roads[road].includes("t") ? [`${thing} | ${road} | moved`, `${thing} | ${road}`] : [`${thing} | ${road}`],
    ),
);

/** Values whose readers are handed something else now and then. */
const readers = [
  "an integer",
  "a text",
  "a date",
  "a map",
  "a list of integers",
  "a literal",
  "bytes",
  "a blob",
  "an instance of a class",
  "an error",
  "a buffer",
];

const indented = (lines: string, by = "  ") =>
  lines
    .split("\n")
    .map(line => (line ? by + line : line))
    .join("\n");

export function generate(random: Random, corner: string) {
  const [named, road, moved] = corner.split(" | ");
  const thing = things[named];
  const isMoved = moved === "moved";
  const language = random.weighted([
    [3, "JavaScript"],
    [3, "TypeScript reads"],
    [3, "TypeScript"],
  ] as const);
  const isCommonJS = language === "JavaScript" && random.chance(0.3);
  const isTyped = language !== "JavaScript";
  const script = isCommonJS ? "cjs" : "mjs";
  const program = language === "TypeScript" ? "ts" : script;
  const T = (written: string) => (isTyped ? written : "");
  const P = (written: string) => (program === "ts" ? written : "");
  const read =
    random.chance(0.2) && !thing.closes ? things[random.pick(readers.filter(each => each !== named))] : thing;
  const isWarmed = read === thing && !thing.isRefused && named !== "a port" && random.chance(0.35);
  const isOfNode = random.chance(0.5);

  // How the value is held in what is sent.
  const [hold, taken] = random.weighted<[string, string]>([
    [6, ["§", "§"]],
    [2, ["{ it: § }", "§.it"]],
    [1, ["[§]", "§[0]"]],
    [1, ['{ before: 1, it: §, behind: "x" }', "§.it"]],
    [1, ["{ it: §, list: [§] }", "§.list[0]"]],
    [1, ['new Map([["it", §]])', '§.get("it")']],
    [1, ["{ deep: { deeper: [0, §] } }", "§.deep.deeper[1]"]],
    [1, ["new Set([§])", "[...§][0]"]],
  ]);
  const held = hold.replaceAll("§", "it");
  const out = (from: string) => taken.replaceAll("§", from) + (read !== thing || hold !== "§" ? P(" as any") : "");
  const moves = isMoved ? `[${thing.list}]` : "";

  const take = (names: string[], from: string, isScript: boolean) =>
    isCommonJS && isScript
      ? `const { ${names.join(", ")} } = require("${from}");\n`
      : `import { ${names.join(", ")} } from "${from}";\n`;
  const grouped = (wanted: string[]) => {
    const modules = new Map<string, string[]>();
    for (const each of new Set(wanted)) {
      const [name, from] = each.split(" ");
      modules.set(from, [...(modules.get(from) ?? []), name]);
    }
    return [...modules].map(([from, names]) => take(names, from, true)).join("");
  };
  const handsOn = (names: string[], isScript: boolean) =>
    isCommonJS && isScript ? names.map(each => `exports.${each} = ${each};\n`).join("") : "";
  const exported = isCommonJS ? "" : "export ";

  // The file that makes the value: always JavaScript.
  const files: Record<string, string> = {};
  files[`makes.${script}`] =
    grouped(thing.takes ?? []) +
    `${exported}async function make() {\n${indented(thing.make)}\n}\n` +
    handsOn(["make"], true);
  if (program === "ts")
    files["makes.d.mts"] = `${thing.declares ?? ""}export declare function make(): Promise<${thing.type}>;\n`;

  // The file that reads it.
  const generic = thing.isQuiet
    ? ["typeof it", "Object.prototype.toString.call(it)"]
    : [
        "typeof it",
        "Object.prototype.toString.call(it)",
        "show(it)",
        "JSON.stringify(it)",
        "show(Object.getPrototypeOf(it)?.constructor?.name)",
        "keys(it)",
        "Object.isFrozen(it)",
        "show(structuredClone(it))",
      ];
  const asked = [
    ...random.sample(generic, random.between(1, 3)),
    ...(read.uses.length > 5 && random.chance(0.5) && !thing.closes
      ? read.uses.filter((_, at) => at === read.uses.length - 1 || random.chance(0.6))
      : read.uses),
  ];
  const caught = `(error${T(" as Error")}).name`;
  const reader = isTyped ? "ts" : script;
  files[`reads.${reader}`] =
    grouped(read.reads ?? []).replaceAll(
      /^const \{ (.*) \} = require\((.*)\);$/gm,
      isTyped ? "import { $1 } from $2;" : "$&",
    ) +
    T(read.declares ?? "") +
    `${exported}function show(value${T(": any")}, depth = 0)${T(": string")} {
  if (typeof value === "string") return value.length > 60 ? "a text of " + value.length : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "symbol " + value.description;
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  const name = Object.getPrototypeOf(value)?.constructor?.name ?? "no prototype";
  if (depth > 2) return name;
  if (Array.isArray(value)) return "[" + Array.from(value, (each, at) => (at in value ? show(each, depth + 1) : "hole")).join(", ") + "]";
  if (ArrayBuffer.isView(value)) return name + " " + value.byteLength;
  if (value instanceof Map) return name + " (" + [...value].map(each => show(each, depth + 1)).join(", ") + ")";
  if (value instanceof Set) return name + " (" + [...value].map(each => show(each, depth + 1)).join(", ") + ")";
  if (value instanceof Date) return name + " " + value.getTime();
  if (value instanceof Error) return name + " " + value.name + ": " + value.message;
  return name + " {" + Object.keys(value).map(key => key + ": " + show(value[key], depth + 1)).join(", ") + "}";
}
function keys(value${T(": any")})${T(": string")} {
  return Reflect.ownKeys(value).map(String).join();
}
function call(callee${T(": any")}, ...given${T(": unknown[]")})${T(": unknown")} {
  return callee(...given);
}
${exported}async function told(it${T(`: ${read.type}`)})${T(": Promise<string[]>")} {
  const lines${T(": string[]")} = [];
${asked
  .map(use => {
    const label = JSON.stringify(use.split("\n")[0].slice(0, 70));
    return `  try {\n    lines.push(${label} + " " + show(${use}));\n  } catch (error) {\n    lines.push(${label} + " THROWS " + ${caught});\n  }\n`;
  })
  .join("")}  return lines;
}
void keys, call;
` +
    handsOn(["show", "told"], !isTyped);

  // How a file names another one.
  const from = (file: string, extension: string) => `./${file}${extension === "ts" ? "" : "." + extension}`;
  const entryPoints: string[] = [];
  let embedded = "";
  const worker = (file: string, options: string, _isOfNode: boolean, inFile = "main") => {
    const name = `${file}.${program}`;
    const how = random.weighted([
      [4, "a URL"],
      [3, "a relative text"],
      [1, "a path"],
      [isCommonJS || inFile !== "main" ? 0 : 2, "embedded"],
    ] as const);
    if (how !== "embedded" && !entryPoints.includes(name)) entryPoints.push(name);
    if (how === "embedded")
      embedded += `${P("// @ts-ignore\n")}import ${file}File from "./${name}" with { type: "file" };\n`;
    const says =
      how === "embedded"
        ? `${file}File`
        : how === "a relative text"
          ? `"./${name}"`
          : isCommonJS
            ? how === "a URL"
              ? `require("node:url").pathToFileURL(require("node:path").join(__dirname, "${name}"))`
              : `require("node:path").join(__dirname, "${name}")`
            : how === "a URL"
              ? `new URL("./${name}", import.meta.url)`
              : `import.meta.dirname + "/${name}"`;
    return `opened(new Worker(${says}${options ? `, ${options}` : ""}))`;
  };

  const print = (lines: string) => `for (const line of ${lines}) console.log(line);\n`;
  const asks = (label: string, list: string[] | undefined) =>
    (list ?? [])
      .map(
        each =>
          `try {\n  console.log("${label}", ${JSON.stringify(each)}, show(${each}));\n} catch (error) {\n  console.log("${label}", ${JSON.stringify(each)}, "THROWS", (error${P(" as Error")}).name);\n}\n`,
      )
      .join("");
  const behind = asks("behind", thing.behind);
  const last = asks("at the end", thing.last);
  const warm = isWarmed ? "await told(await make());\n" : "";
  const any = P(": any");

  // What waits for a worker: the lines that it reports and how it ends.
  const ofNode = `function answers(worker${any})${P(": Promise<[any, number]>")} {
  return new Promise((resolve, reject) => {
    let message${any};
    worker.on("message", (given${any}) => (message = given));
    worker.on("error", reject);
    worker.on("exit", (code${P(": number")}) => resolve([message, code]));
  });
}
`;
  const ofTheWeb = `function answers(worker${P(": Worker")})${P(": Promise<any>")} {
  return new Promise((resolve, reject) => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => {
      event.preventDefault();
      reject(new Error("the worker failed"));
    };
    worker.onmessageerror = () => reject(new Error("the message failed"));
  });
}
`;
  const second = (list: string, isOptions: boolean) =>
    list ? (isOptions ? `, { transfer: ${list} }` : `, ${list}`) : "";
  const isOptions = random.chance(0.4);
  const threads: string[] = [];
  const needs = { main: new Set<string>(), far: new Set<string>(), other: new Set<string>() };
  let main = "";
  let far = "";
  let other = "";
  let helpers = "";
  const made = "const it = await make();\n";
  const ends = `const [lines, code] = await ended;\n${print("lines ?? []")}console.log("exit", code);\n`;

  switch (road) {
    case "workerData":
      threads.push("Worker");
      helpers = ofNode;
      main =
        made +
        `const ended = answers(${worker("far", `{ workerData: ${held}${moves && `, transferList: ${moves}`} }`, true)});\n` +
        behind +
        ends +
        last;
      far = `${warm}parentPort.postMessage(await told(${out("workerData")}));\n`;
      needs.far.add("parentPort").add("workerData");
      break;
    case "a message to a worker of node":
      threads.push("Worker");
      helpers = ofNode;
      main =
        made +
        `const worker = ${worker("far", "", true)};\nconst ended = answers(worker);\nworker.postMessage(${held}${second(moves, isOptions)});\n` +
        behind +
        ends +
        last;
      far = `${warm}parentPort.once("message", async (message${any}) => {\n  parentPort.postMessage(await told(${out("message")}));\n});\n`;
      needs.far.add("parentPort");
      break;
    case "a message from a worker of node":
      threads.push("Worker");
      helpers = ofNode;
      main = `${warm}const [message, code] = await answers(${worker("far", "", true)});\n${print(`await told(${out("message")})`)}console.log("exit", code);\n`;
      far = made + `parentPort.postMessage(${held}${second(moves, isOptions)});\n`;
      needs.far.add("parentPort");
      break;
    case "a message to a worker":
      helpers = ofTheWeb;
      main =
        made +
        `const worker = ${worker("far", "", false)};\nconst answer = answers(worker);\nworker.postMessage(${held}${second(moves, isOptions)});\n` +
        behind +
        print("await answer") +
        "worker.terminate();\n" +
        last;
      far = `${warm}self.onmessage = async event => {\n  postMessage(await told(${out("event.data")}));\n};\n`;
      break;
    case "a message from a worker":
      helpers = ofTheWeb;
      main = `${warm}const worker = ${worker("far", "", false)};\nconst message = await answers(worker);\n${print(`await told(${out("message")})`)}worker.terminate();\n`;
      far = made + `postMessage(${held}${second(moves, true)});\n`;
      break;
    case "there and back":
      threads.push("Worker");
      helpers = ofNode;
      main =
        made +
        `const worker = ${worker("far", "", true)};\nconst ended = answers(worker);\nworker.postMessage(${held}${second(moves, isOptions)});\n` +
        behind +
        `const [message, code] = await ended;\n${print(`await told(${out("message")})`)}console.log("exit", code);\n` +
        last;
      far = `parentPort.once("message", (message${any}) => {\n  ${isMoved ? `const it = ${out("message")};\n  ` : ""}parentPort.postMessage(message${second(moves, isOptions)});\n});\n`;
      needs.far.add("parentPort");
      break;
    case "a channel in one thread": {
      if (isOfNode) threads.push("MessageChannel");
      const listens = random.pick([
        `port2.onmessage = ${isOfNode ? `(event${any})` : "event"} => resolve(event.data);`,
        ...(isOfNode
          ? [`port2.once("message", resolve);`]
          : [`port2.addEventListener("message", event => resolve(event.data));\n  port2.start();`]),
      ]);
      main =
        made +
        warm +
        `const { port1, port2 } = new MessageChannel();\nopened(port1);\nopened(port2);\nconst arrives = new Promise${P("<any>")}(resolve => {\n  ${listens}\n});\nport1.postMessage(${held}${second(moves, isOptions)});\n` +
        behind +
        print(`await told(${out("(await arrives)")})`) +
        "port1.close();\nport2.close();\n" +
        last;
      break;
    }
    case "a channel that is asked":
      threads.push("receiveMessageOnPort");
      if (isOfNode) threads.push("MessageChannel");
      main =
        made +
        warm +
        `const { port1, port2 } = new MessageChannel();\nopened(port1);\nopened(port2);\nport1.postMessage(${held}${second(moves, isOptions)});\n` +
        behind +
        print(`await told(${out("receiveMessageOnPort(port2).message")})`) +
        "port1.close();\nport2.close();\n" +
        last;
      break;
    case "a port that a worker is handed":
      threads.push("Worker");
      if (isOfNode) threads.push("MessageChannel");
      helpers = ofNode;
      main =
        made +
        `const { port1, port2 } = new MessageChannel();\nopened(port1);\nopened(port2);\nconst ended = answers(${worker("far", "{ workerData: { port: port2 }, transferList: [port2] }", true)});\nport1.postMessage(${held}${second(moves, isOptions)});\n` +
        behind +
        ends +
        "port1.close();\n" +
        last;
      far = `${warm}workerData.port.once("message", async (message${any}) => {\n  workerData.port.close();\n  parentPort.postMessage(await told(${out("message")}));\n});\n`;
      needs.far.add("parentPort").add("workerData");
      break;
    case "a port that a worker hands out":
      threads.push("Worker");
      main =
        warm +
        `const worker = ${worker("far", "", true)};\nconst exited = new Promise(resolve => worker.once("exit", resolve));\nconst port = await new Promise${P("<any>")}((resolve, reject) => {\n  worker.once("message", resolve);\n  worker.once("error", reject);\n});\nopened(port);\nconst arrives = new Promise${P("<any>")}((resolve, reject) => {\n  port.once("message", resolve);\n  worker.once("error", reject);\n});\nworker.postMessage("send");\nconst message = await arrives;\nport.close();\nworker.postMessage("taken");\n` +
        print(`await told(${out("message")})`) +
        `console.log("exit", await exited);\n`;
      far =
        made +
        `const { port1, port2 } = new MessageChannel();\nparentPort.once("message", () => {\n  parentPort.once("message", () => port1.close());\n  port1.postMessage(${held}${second(moves, isOptions)});\n});\nparentPort.postMessage(port2, [port2]);\n`;
      needs.far.add("parentPort").add("MessageChannel");
      break;
    case "between two workers":
      threads.push("Worker", "MessageChannel");
      helpers = ofNode;
      main =
        `const { port1, port2 } = new MessageChannel();\nopened(port1);\nopened(port2);\nconst ended = answers(${worker("far", "{ workerData: { port: port2 }, transferList: [port2] }", true)});\nconst sender = ${worker("other", "{ workerData: { port: port1 }, transferList: [port1] }", true)};\nconst sent = answers(sender);\n` +
        ends.replace("await ended", "await Promise.race([ended, sent.then(() => ended)])") +
        `sender.postMessage("taken");\nconsole.log("the sender", (await sent)[1]);\n`;
      far = `${warm}workerData.port.once("message", async (message${any}) => {\n  workerData.port.close();\n  parentPort.postMessage(await told(${out("message")}));\n});\n`;
      other =
        made +
        `workerData.port.postMessage(${held}${second(moves, isOptions)});\nparentPort.once("message", () => workerData.port.close());\n`;
      needs.far.add("parentPort").add("workerData");
      needs.other.add("workerData").add("parentPort");
      break;
    case "a worker inside a worker":
      threads.push("Worker");
      helpers = ofNode;
      main = `const ended = answers(${worker("other", "", true)});\n` + ends;
      other =
        ofNode +
        made +
        `const [lines, code] = await answers(${worker("far", `{ workerData: ${held}${moves && `, transferList: ${moves}`} }`, true, "other").replace(/^opened\((.*)\)$/s, "$1")});\nparentPort.postMessage([...(lines ?? []), "inner exit " + code]);\n`;
      far = `${warm}parentPort.postMessage(await told(${out("workerData")}));\n`;
      needs.far.add("parentPort").add("workerData");
      needs.other.add("parentPort").add("Worker");
      break;
    case "a file that is its own worker":
      threads.push("Worker", "isMainThread", "parentPort", "workerData");
      helpers = ofNode;
      main =
        `if (isMainThread) {\n` +
        indented(
          made +
            `const ended = answers(opened(new Worker(${isCommonJS ? "__filename" : random.chance(0.5) ? "new URL(import.meta.url)" : `"./main.${program}"`}, { workerData: ${held}${moves && `, transferList: ${moves}`} })));\n` +
            behind +
            ends +
            last,
        ) +
        `} else {\n${indented(`${warm}parentPort.postMessage(await told(${out("workerData")}));\n`)}}\n`;
      break;
    case "a broadcast in one thread":
      if (isOfNode) threads.push("BroadcastChannel");
      main =
        made +
        warm +
        `const sends = opened(new BroadcastChannel("handed"));\nconst hears = opened(new BroadcastChannel("handed"));\nconst arrives = new Promise${P("<any>")}((resolve, reject) => {\n  hears.onmessage = (event${any}) => resolve(event.data);\n  hears.onmessageerror = () => reject(new Error("the message failed"));\n});\nsends.postMessage(${held});\n` +
        print(`await told(${out("(await arrives)")})`) +
        "sends.close();\nhears.close();\n" +
        last;
      break;
    case "a broadcast to a worker":
      threads.push("Worker");
      helpers = ofNode;
      main =
        made +
        `const sends = opened(new BroadcastChannel("handed"));\nconst worker = ${worker("far", "", true)};\nconst ended = answers(worker);\nawait new Promise(resolve => worker.once("message", resolve));\nsends.postMessage(${held});\n` +
        ends +
        "sends.close();\n" +
        last;
      far = `${warm}const hears = new BroadcastChannel("handed");\nhears.onmessage = async (event${any}) => {\n  hears.close();\n  parentPort.postMessage(await told(${out("event.data")}));\n};\nparentPort.postMessage("listens");\n`;
      needs.far.add("parentPort");
      break;
    case "structuredClone":
      main =
        made +
        warm +
        `const copy = structuredClone(${held}${second(moves, true)});\n` +
        behind +
        print(`await told(${out("copy")})`) +
        last;
      break;
    case "environment data":
      threads.push("Worker", "setEnvironmentData");
      helpers = ofNode;
      main =
        made +
        `setEnvironmentData("handed", ${held});\nconst ended = answers(${worker("far", "", true)});\n` +
        ends +
        last;
      far = `${warm}parentPort.postMessage(await told(${out('getEnvironmentData("handed")')}));\n`;
      needs.far.add("parentPort").add("getEnvironmentData");
      break;
    case "the serializer of node:v8":
      main = made + warm + print(`await told(${out(`deserialize(serialize(${held}))`)})`) + last;
      needs.main.add("serialize node:v8").add("deserialize node:v8");
      break;
    case "the serializer of bun:jsc":
      main = made + warm + print(`await told(${out(`deserialize(serialize(${held}))`)})`) + last;
      needs.main.add("serialize bun:jsc").add("deserialize bun:jsc");
      break;
    case "thrown in a worker":
      threads.push("Worker");
      main =
        warm +
        `const worker = ${worker("far", "", true)};\nconst thrown = await new Promise${P("<any>")}(resolve => {\n  worker.once("error", resolve);\n  worker.once("exit", () => resolve("nothing was thrown"));\n});\n` +
        print(`await told(${out("thrown")})`);
      far = made + (random.chance(0.5) ? `throw ${held};\n` : `Promise.reject(${held});\n`);
      break;
  }

  const closing = (body: string) => {
    const lines = body.split("\n");
    const at = lines.findIndex(line => line.trim() === "const it = await make();");
    if (!thing.closes || at < 0) return body;
    const pad = lines[at].slice(0, lines[at].indexOf("const"));
    let end = lines.findIndex((line, index) => index > at && line !== "" && !line.startsWith(pad));
    if (end < 0) end = lines.length;
    while (lines[end - 1] === "") end--;
    return [
      ...lines.slice(0, at + 1),
      `${pad}try {`,
      ...lines.slice(at + 1, end).map(line => (line ? "  " + line : line)),
      `${pad}} finally {`,
      `${pad}  ${thing.closes}`,
      `${pad}}`,
      ...lines.slice(end),
    ].join("\n");
  };
  main = closing(main);
  far = closing(far);
  other = closing(other);
  const inside = (body: string, isScript: boolean) =>
    isCommonJS && isScript ? `(async () => {\n${indented(body)}})();\n` : body;
  const uses = (body: string, name: string) => new RegExp(`\\b${name}\\(`).test(body);
  const head = (body: string, wanted: string[], more: Set<string>) => {
    const isScript = program !== "ts";
    const fromThreads = [...new Set([...wanted, ...[...more].filter(each => !each.includes(" "))])];
    const reading = ["show", "told"].filter(each => uses(body, each));
    return (
      (fromThreads.length ? take(fromThreads, "node:worker_threads", isScript) : "") +
      [...more]
        .filter(each => each.includes(" "))
        .reduce((modules, each) => {
          const [name, module] = each.split(" ");
          modules.set(module, [...(modules.get(module) ?? []), name]);
          return modules;
        }, new Map<string, string[]>())
        .entries()
        .map(([module, names]) => take(names, module, isScript))
        .toArray()
        .join("") +
      (uses(body, "make") ? take(["make"], from("makes", script), isScript) : "") +
      (reading.length ? take(reading, from("reads", reader), isScript) : "")
    );
  };
  const failed = `(error${P(" as Error")}).name`;
  const closes =
    "  for (const each of open) {\n    if (each.terminate) each.terminate();\n    else each.close();\n  }\n";
  const folder = thing.folder
    ? [
        `const folder = mkdtempSync(join(tmpdir(), "handed-"));\nprocess.env.HANDED_FOLDER = folder;\n`,
        ` finally {\n${closes}  rmSync(folder, { recursive: true, force: true });\n}`,
      ]
    : ["", ` finally {\n${closes}}`];
  helpers += `const open${P(": any[]")} = [];\nfunction opened${P("<T>")}(each${P(": T")})${P(": T")} {\n  open.push(each);\n  return each;\n}\n`;
  if (thing.folder)
    needs.main.add("mkdtempSync node:fs").add("rmSync node:fs").add("join node:path").add("tmpdir node:os");
  const isOwnWorker = road === "a file that is its own worker";
  const guarded = `${isOwnWorker && thing.folder ? folder[0].replace("const folder = mkdtempSync", 'const folder = !isMainThread ? "" : mkdtempSync').replace("process.env.HANDED_FOLDER = folder;", "if (isMainThread) process.env.HANDED_FOLDER = folder;") : folder[0]}try {\n${indented(main)}} catch (error) {\n  console.log("THROWS", ${failed});\n}${isOwnWorker && thing.folder ? folder[1].replace("rmSync(", "if (isMainThread) rmSync(") : folder[1]}\n`;
  const text =
    head(helpers + guarded, threads, needs.main) +
    embedded +
    helpers +
    inside(guarded, program !== "ts") +
    (isCommonJS ? "" : "export {};\n");
  if (far)
    files[`far.${program}`] =
      head(far, [], needs.far) + inside(far, program !== "ts") + (isCommonJS ? "" : "export {};\n");
  if (other)
    files[`other.${program}`] =
      head(other, [], needs.other) + inside(other, program !== "ts") + (isCommonJS ? "" : "export {};\n");

  if (isTyped) {
    files["host.d.ts"] = `declare module "node:worker_threads" {
  export const workerData: any;
  export const parentPort: any;
  export const isMainThread: boolean;
  export class Worker {
    constructor(file: string | URL, options?: object);
    postMessage(value: unknown, moved?: unknown): void;
    on(name: string, listener: (...given: any[]) => void): this;
    once(name: string, listener: (...given: any[]) => void): this;
  }
  export class MessageChannel {
    port1: any;
    port2: any;
  }
  export class BroadcastChannel {
    constructor(name: string);
    onmessage: unknown;
    onmessageerror: unknown;
    postMessage(value: unknown): void;
    close(): void;
  }
  export function receiveMessageOnPort(port: unknown): { message: any };
  export function setEnvironmentData(key: string, value: unknown): void;
  export function getEnvironmentData(key: string): any;
}
declare module "node:v8" {
  export function serialize(value: unknown): Uint8Array;
  export function deserialize(bytes: Uint8Array): any;
}
declare module "bun:jsc" {
  export function serialize(value: unknown): SharedArrayBuffer;
  export function deserialize(bytes: SharedArrayBuffer): any;
}
declare module "node:fs" {
  export function mkdtempSync(start: string): string;
  export function rmSync(path: string, options: object): void;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "*.ts" {
  const path: string;
  export default path;
}
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: { isBuffer(value: unknown): boolean };
interface ImportMeta {
  url: string;
  dirname: string;
}
`;
    files["tsconfig.json"] =
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "preserve",
            moduleResolution: "bundler",
            noEmit: true,
            strict: true,
            types: [],
            allowImportingTsExtensions: true,
          },
        },
        null,
        2,
      ) + "\n";
  }
  return { file: `main.${program}`, text, files, entryPoints };
}
