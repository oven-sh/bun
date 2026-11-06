// A built-in object or function is a value like any other. A program takes 1 to 3 objects or functions of the language, Bun, Node.js
// or the web, many of them functions that carry members of their own. Each goes along 0 to 2 routes: a copy (spread, rest pattern,
// Object.assign, entries, descriptors), a Proxy, a reviver, Reflect, a collection, a closure, a field, a getter, a parameter, a throw,
// a promise. The program then walks what arrived and tests every member (typeof, === undefined, instanceof, name, length), reads
// members by name and calls the ones whose answer is the same in every run. The steps stand at the top of the module, in a function,
// in a method, in an async function, or in a function that a loop calls many times.
import type { Random } from "./random";

type Subject = {
  path: string;
  /** The import that `path` needs. */
  needs?: string;
  names: string[];
  /** Members and arguments whose answer is the same in every run. */
  calls?: [string, string][];
  /** Every member that is a function takes one of these arguments. */
  each?: string[];
  except?: string[];
  /** Arguments for a call of the value itself. */
  self?: string;
  /** An executable holds only the members that the program names: nothing walks this one. */
  onlyByName?: boolean;
  /** Part of the language: its members are not enumerable, so a program walks them by their own names. */
  language?: boolean;
  /** Some of its functions have no name in plain Bun. */
  unnamed?: boolean;
};

const pathCalls: [string, string][] = [
  ["join", `"a", "b"`],
  ["basename", `"/a/b.c"`],
  ["extname", `"a.b"`],
  ["dirname", `"/a/b"`],
  ["normalize", `"/a/../b"`],
  ["isAbsolute", `"/a"`],
];
const util = `import util from "node:util";`;
const path = `import path from "node:path";`;
const os = `import os from "node:os";`;
const fs = `import fs from "node:fs";`;
const assert = `import assert from "node:assert";`;
const stream = `import stream from "node:stream";`;
const http = `import http from "node:http";`;

const subjects: Subject[] = [
  {
    path: "Math",
    language: true,
    names: ["abs", "max", "PI", "floor", "hypot", "sign"],
    calls: [
      ["max", "1, 2"],
      ["abs", "-3"],
      ["hypot", "3, 4"],
    ],
    each: ["2", "-1.5"],
    except: ["random"],
  },
  {
    path: "JSON",
    language: true,
    names: ["parse", "stringify", "rawJSON"],
    calls: [
      ["stringify", `[1, "a"]`],
      ["parse", `"[1]"`],
    ],
  },
  {
    path: "Reflect",
    language: true,
    names: ["get", "ownKeys", "apply", "has"],
    calls: [
      ["ownKeys", "{ a: 1 }"],
      ["has", `{ a: 1 }, "a"`],
    ],
  },
  {
    path: "Object",
    language: true,
    names: ["keys", "assign", "entries", "is", "hasOwn", "prototype"],
    calls: [
      ["keys", "{ a: 1 }"],
      ["is", "1, 1"],
      ["hasOwn", `{ a: 1 }, "a"`],
      ["isFrozen", "{}"],
    ],
  },
  {
    path: "Array",
    language: true,
    names: ["isArray", "of", "from", "prototype"],
    calls: [
      ["isArray", "[]"],
      ["of", "1, 2"],
      ["from", `"ab"`],
    ],
  },
  {
    path: "Number",
    language: true,
    names: ["isInteger", "parseFloat", "MAX_SAFE_INTEGER", "EPSILON", "isNaN"],
    each: [`"1.5"`, "3"],
  },
  {
    path: "String",
    language: true,
    names: ["fromCharCode", "fromCodePoint", "raw"],
    calls: [
      ["fromCharCode", "65"],
      ["fromCodePoint", "66"],
    ],
  },
  {
    path: "Symbol",
    language: true,
    names: ["iterator", "asyncIterator", "hasInstance", "for", "keyFor"],
    calls: [
      ["for", `"a"`],
      ["keyFor", `Symbol.for("a")`],
    ],
  },
  { path: "Promise", language: true, names: ["resolve", "all", "withResolvers", "race"] },
  {
    path: "Date",
    language: true,
    names: ["UTC", "parse", "now"],
    calls: [
      ["UTC", "2020, 1"],
      ["parse", `"2020-01-01T00:00:00Z"`],
    ],
  },
  { path: "BigInt", language: true, names: ["asIntN", "asUintN"], calls: [["asIntN", "8, 255n"]] },
  { path: "Atomics", language: true, names: ["add", "load", "store", "notify"] },
  {
    path: "Intl",
    language: true,
    names: ["DateTimeFormat", "NumberFormat", "Collator", "getCanonicalLocales"],
    calls: [["getCanonicalLocales", `"en-us"`]],
  },
  {
    path: "Error",
    language: true,
    names: ["captureStackTrace", "stackTraceLimit", "isError"],
    calls: [["isError", "new Error()"]],
  },
  { path: "Proxy", language: true, names: ["revocable", "name", "length"] },
  { path: "ArrayBuffer", language: true, names: ["isView", "prototype"], calls: [["isView", "new Uint8Array(1)"]] },
  { path: "Uint8Array", language: true, names: ["from", "of", "BYTES_PER_ELEMENT", "fromBase64"] },
  { path: "RegExp", language: true, names: ["escape", "prototype", "name"], calls: [["escape", `"a.b"`]] },
  { path: "URL", names: ["canParse", "parse", "createObjectURL"], calls: [["canParse", `"http://a/"`]] },
  { path: "Response", names: ["json", "error", "redirect"], calls: [["json", "{ a: 1 }"]] },
  { path: "AbortSignal", names: ["abort", "any", "timeout"], calls: [["abort", ""]] },
  { path: "crypto", names: ["subtle", "randomUUID", "getRandomValues", "timingSafeEqual"] },
  { path: "performance", names: ["now", "timeOrigin", "mark", "measure"] },
  { path: "console", names: ["log", "error", "warn", "table", "assert"] },
  {
    path: "WebAssembly",
    names: ["Module", "Instance", "validate", "Memory"],
    calls: [["validate", "new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])"]],
  },
  { path: "fetch", names: ["preconnect", "name", "length"] },
  { path: "setTimeout", names: ["name", "length"] },
  { path: "structuredClone", names: ["name", "length"], self: "[1, 2]" },
  {
    path: "Buffer",
    unnamed: true,
    names: ["from", "alloc", "byteLength", "concat", "isBuffer", "poolSize", "isEncoding"],
    calls: [
      ["byteLength", `"abc"`],
      ["isBuffer", "1"],
      ["isEncoding", `"utf8"`],
    ],
  },
  {
    path: "Bun",
    names: ["hash", "inspect", "escapeHTML", "stringWidth", "deepEquals", "semver", "peek", "file", "sleep", "color"],
    calls: [
      ["escapeHTML", `"<a>"`],
      ["stringWidth", `"abc"`],
      ["deepEquals", "{ a: 1 }, { a: 1 }"],
      ["inspect", "1"],
      ["hash", `"abc"`],
    ],
    onlyByName: true,
  },
  {
    path: "Bun.hash",
    names: ["crc32", "adler32", "wyhash", "xxHash32", "cityHash32", "name", "length"],
    each: [`"abc"`, `""`],
    self: `"abc"`,
  },
  { path: "Bun.inspect", names: ["custom", "table", "name", "length"], self: "{ a: 1 }" },
  { path: "Bun.peek", unnamed: true, names: ["status", "name"], calls: [["status", "Promise.resolve(1)"]], self: "1" },
  {
    path: "Bun.semver",
    names: ["order", "satisfies"],
    calls: [
      ["order", `"1.0.0", "2.0.0"`],
      ["satisfies", `"1.0.0", "^1"`],
    ],
  },
  { path: "Bun.password", names: ["hash", "verify", "hashSync", "verifySync"] },
  {
    path: "Bun.$",
    names: ["braces", "escape", "ShellError", "env", "cwd"],
    calls: [
      ["escape", `"a b"`],
      ["braces", `"{a,b}"`],
    ],
  },
  { path: "Bun.color", names: ["name", "length"], self: `"red", "hex"` },
  { path: "Bun.sql", names: ["begin", "unsafe", "file", "name"] },
  { path: "Bun.unsafe", names: ["arrayBufferToString", "gcAggressionLevel"] },
  { path: "Bun.dns", names: ["lookup", "prefetch", "getCacheStats"] },
  { path: "Bun.TOML", names: ["parse"], calls: [["parse", `"a = 1"`]] },
  { path: "Bun.YAML", names: ["parse", "stringify"], calls: [["parse", `"a: 1"`]] },
  { path: "Bun.CryptoHasher", names: ["algorithms", "hash", "prototype"], calls: [["hash", `"md5", "a", "hex"`]] },
  { path: "Bun.Glob", names: ["prototype", "name", "length"] },
  { path: "Bun.file", names: ["name", "length"] },
  { path: "process.hrtime", names: ["bigint", "name", "length"] },
  { path: "process.memoryUsage", names: ["rss", "name", "length"] },
  { path: "process.versions", names: ["bun", "node", "v8", "uv"] },
  { path: "process.release", names: ["name", "sourceUrl"] },
  { path: "process.features", names: ["typescript", "ipv6", "tls"] },
  {
    path: "util",
    needs: util,
    names: ["inspect", "format", "types", "promisify", "isDeepStrictEqual", "inherits", "TextEncoder"],
    calls: [
      ["format", `"%s-%d", "a", 1`],
      ["isDeepStrictEqual", "[1], [1]"],
      ["inspect", "{ a: 1 }"],
      ["stripVTControlCharacters", `"a"`],
    ],
  },
  {
    path: "util.types",
    needs: util,
    names: ["isDate", "isRegExp", "isPromise", "isMap", "isProxy", "isTypedArray"],
    each: ["new Date(0)", "/a/", "new Map()", "1", "new Uint8Array(1)", "Promise.resolve()"],
  },
  { path: "util.inspect", needs: util, names: ["custom", "colors", "styles", "defaultOptions"], self: "[1]" },
  { path: "util.promisify", needs: util, names: ["custom", "name", "length"] },
  { path: "path", needs: path, names: ["join", "posix", "win32", "sep", "delimiter", "basename"], calls: pathCalls },
  { path: "path.posix", needs: path, names: ["join", "sep", "posix", "win32", "parse"], calls: pathCalls },
  { path: "path.win32", needs: path, names: ["join", "sep", "posix", "win32", "parse"], calls: pathCalls },
  { path: "os.constants", needs: os, names: ["signals", "errno", "priority", "UV_UDP_REUSEADDR"] },
  { path: "os.constants.signals", needs: os, names: ["SIGINT", "SIGTERM", "SIGKILL"] },
  { path: "fs", needs: fs, names: ["readFileSync", "existsSync", "promises", "constants", "Stats"] },
  { path: "fs.constants", needs: fs, names: ["O_RDONLY", "F_OK", "S_IFMT"] },
  { path: "fs.promises", needs: fs, names: ["readFile", "writeFile", "stat", "constants"] },
  { path: "zlib.constants", needs: `import zlib from "node:zlib";`, names: ["Z_OK", "Z_BEST_SPEED", "BROTLI_DECODE"] },
  {
    path: "EventEmitter",
    needs: `import EventEmitter from "node:events";`,
    names: ["once", "on", "EventEmitter", "defaultMaxListeners", "getEventListeners", "errorMonitor"],
  },
  {
    path: "assert",
    needs: assert,
    names: ["ok", "equal", "strict", "deepStrictEqual", "AssertionError", "throws"],
    calls: [
      ["ok", "1"],
      ["equal", "1, 1"],
    ],
    self: "1",
  },
  { path: "assert.strict", needs: assert, names: ["ok", "equal", "strict", "AssertionError"], self: "1" },
  { path: "stream", needs: stream, names: ["Readable", "Writable", "pipeline", "promises", "finished"] },
  { path: "stream.promises", needs: stream, names: ["pipeline", "finished"] },
  { path: "http.STATUS_CODES", needs: http, names: ["200", "404", "500"] },
  { path: "http.METHODS", needs: http, names: ["0", "length"] },
  {
    path: "querystring",
    needs: `import querystring from "node:querystring";`,
    names: ["escape", "stringify", "parse", "unescape"],
    calls: [
      ["escape", `"a b"`],
      ["stringify", "{ a: 1 }"],
    ],
  },
  {
    path: "net",
    needs: `import net from "node:net";`,
    names: ["isIP", "isIPv4", "isIPv6", "Socket", "createServer"],
    calls: [
      ["isIP", `"1.1.1.1"`],
      ["isIPv6", `"::1"`],
    ],
  },
  {
    path: "nodeModule",
    onlyByName: true,
    needs: `import nodeModule from "node:module";`,
    names: ["builtinModules", "createRequire", "isBuiltin"],
    calls: [["isBuiltin", `"fs"`]],
  },
  { path: "timers", needs: `import timers from "node:timers";`, names: ["setTimeout", "promises", "setImmediate"] },
  { path: "buffer.constants", needs: `import buffer from "node:buffer";`, names: ["MAX_LENGTH", "MAX_STRING_LENGTH"] },
  {
    path: "allOfPath",
    needs: `import * as allOfPath from "node:path";`,
    names: ["join", "posix", "default", "sep"],
    calls: pathCalls,
  },
  {
    path: "allOfUtil",
    needs: `import * as allOfUtil from "node:util";`,
    names: ["types", "inspect", "default", "format"],
  },
  {
    path: "allOfBun",
    needs: `import * as allOfBun from "bun";`,
    names: ["hash", "inspect", "default", "semver"],
    onlyByName: true,
  },
];

// What a program asks of one member. Every one is legal TypeScript for a value of type unknown.
const answers = [
  `value === undefined ? "undefined" : typeof value`,
  `typeof value === "function" ? "function" : "other"`,
  `typeof value === "function" ? value.name : typeof value`,
  `typeof value === "function" ? String(value.length) : typeof value`,
  `value instanceof Function ? "callable" : "not"`,
  `value == null ? "nothing" : "something"`,
  `Object.prototype.toString.call(value)`,
  `typeof value === "object" && value !== null ? "object" : typeof value === "symbol" ? "symbol" : "else"`,
  `Array.isArray(value) ? "list" : typeof value`,
  `Object.is(value, undefined) ? "undefined" : "defined"`,
  `typeof value === "function" || (typeof value === "object" && value !== null) ? String(Object.keys(value).length > 0) : "-"`,
  `Object(value) === value ? "object or function" : "primitive"`,
];
const questions = [
  `typeof value === "function"`,
  `value === undefined`,
  `value !== undefined`,
  `value == null`,
  `value instanceof Function`,
  `typeof value === "object"`,
  `typeof value !== "undefined"`,
  `Object(value) === value`,
];

type Route = {
  /** Legal TypeScript without `any`, and what arrives has the members of what was sent. */
  typed?: boolean;
  awaits?: boolean;
  onlyFunctions?: boolean;
  /** Reads the members that are not enumerable too. */
  readsAll?: boolean;
  lines: (from: string, to: string, any: string) => string[];
};

const routes: [number, Route][] = [
  [6, { typed: true, lines: (from, to, any) => [`const ${to}${any} = { ...${from} };`] }],
  [4, { typed: true, lines: (from, to, any) => [`const ${to}${any} = Object.assign({}, ${from});`] }],
  [4, { typed: true, lines: (from, to, any) => [`const ${to}${any} = Object.assign(new Holder(), ${from});`] }],
  [3, { typed: true, lines: (from, to, any) => [`const ${to}${any} = Object.assign(function target() {}, ${from});`] }],
  [3, { typed: true, lines: (from, to) => [`const { ...${to} } = ${from};`] }],
  [3, { typed: true, lines: (from, to, any) => [`const ${to}${any} = Object.fromEntries(Object.entries(${from}));`] }],
  [
    3,
    {
      readsAll: true,
      lines: (from, to, any) => [
        `const ${to}${any} = Object.defineProperties({}, Object.getOwnPropertyDescriptors(${from}));`,
      ],
    },
  ],
  [2, { lines: (from, to, any) => [`const ${to}${any} = Object.create(${from});`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = Object.setPrototypeOf({}, ${from});`] }],
  [3, { lines: (from, to, any) => [`const ${to}${any} = new Proxy(${from}, {});`] }],
  [
    3,
    {
      lines: (from, to, any) => [
        `const ${to}${any} = new Proxy({}${any && " as any"}, { get: () => ${from} }).anything;`,
      ],
    },
  ],
  [
    2,
    {
      lines: (from, to, any) => [
        `const ${to}${any} = new Proxy(function () {}${any && " as any"}, { apply: () => ${from} })();`,
      ],
    },
  ],
  [
    2,
    {
      lines: (from, to, any) => [
        `const ${to}${any} = Object.getPrototypeOf(new Proxy({}, { getPrototypeOf: () => ${from} }));`,
      ],
    },
  ],
  [3, { lines: (from, to, any) => [`const ${to}${any} = JSON.parse("1", () => ${from});`] }],
  [
    3,
    {
      lines: (from, to, any) => [
        `const ${to}${any} = JSON.parse('{"a":1,"b":2}', (key${any && ": string"}, value${any}) => (key === "a" ? ${from} : value)).a;`,
      ],
    },
  ],
  [3, { lines: (from, to, any) => [`const ${to}${any} = Reflect.get({ held: ${from} }, "held");`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = Reflect.apply(() => ${from}, undefined, []);`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = Reflect.construct(function () { return ${from}; }, []);`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = [${from}][0];`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = [${from}].pop();`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = [${from}].find(() => true);`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = Array.from([${from}])[0];`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = new Map([["key", ${from}]]).get("key");`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = new Set([${from}]).values().next().value;`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = (function* () { yield ${from}; })().next().value;`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = (() => () => ${from})()();`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = new (class { held = ${from}; })().held;`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = (class { static held = ${from}; }).held;`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = { get held() { return ${from}; } }.held;`] }],
  [
    2,
    {
      lines: (from, to, any) => [
        `const ${to}${any} = (function (${any && "first: any"}) { return arguments[0]; })(${from});`,
      ],
    },
  ],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = ((given = ${from}) => given)();`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = ((...all${any && ": any[]"}) => all[0])(${from});`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = Object.values({ held: ${from} })[0];`] }],
  [2, { typed: true, lines: (from, to, any) => [`const ${to}${any} = Object.entries({ held: ${from} })[0][1];`] }],
  [
    2,
    {
      lines: (from, to, any) => [
        `const ${to}${any} = Object.getOwnPropertyDescriptor({ held: ${from} }, "held")${any && "!"}.value;`,
      ],
    },
  ],
  [
    2,
    {
      lines: (from, to, any) => [
        `(globalThis${any && " as any"}).${to}Kept = ${from};`,
        `const ${to}${any} = (globalThis${any && " as any"}).${to}Kept;`,
      ],
    },
  ],
  [2, { lines: (from, to, any) => [`let ${to}${any};`, `try { throw ${from}; } catch (thrown) { ${to} = thrown; }`] }],
  [1, { lines: (from, to, any) => [`const ${to}${any} = new WeakRef(${from}).deref();`] }],
  [1, { lines: (from, to, any) => [`const ${to}${any} = ((strings${any}, given${any}) => given)\`\${${from}}\`;`] }],
  [2, { typed: true, lines: (from, to) => [`const [${to}] = [${from}];`] }],
  [2, { lines: (from, to, any) => [`const ${to}${any} = new (class { constructor() { return ${from}; } })();`] }],
  [
    2,
    {
      lines: (from, to, any) => [
        `let ${to}${any};`,
        `JSON.stringify({ a: 1 }, (key, value) => { ${to} = ${from}; return value; });`,
      ],
    },
  ],
  [2, { awaits: true, lines: (from, to, any) => [`const ${to}${any} = await Promise.resolve(${from});`] }],
  [1, { awaits: true, lines: (from, to, any) => [`const ${to}${any} = (await Promise.all([${from}]))[0];`] }],
  [1, { onlyFunctions: true, lines: (from, to, any) => [`const ${to}${any} = ${from}.bind(undefined);`] }],
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const needs = new Set<string>();
  const out: string[] = [];
  random
    .shuffled(subjects)
    .slice(0, random.between(1, 3))
    .forEach((subject, index) => {
      if (subject.needs) needs.add(subject.needs);
      // A typed program either calls everything `any` or leaves every type to the compiler.
      const inferred = typed && !subject.onlyByName && random.chance(0.4);
      const any = typed && !inferred ? ": any" : "";
      const place = random.between(0, 6);
      const mayAwait = place <= 1 || place === 5;
      const body: string[] = [];
      let it = subject.path;
      if (typed && !inferred) (body.push(`const start${index}: any = ${it};`), (it = `start${index}`));
      const start = it;
      const hops = random.weighted([
        [1, 0],
        [6, 1],
        [3, 2],
      ]);
      for (let hop = 0; hop < hops; hop++) {
        const fit = routes.filter(
          ([, route]) =>
            (!inferred || route.typed) &&
            (mayAwait || !route.awaits) &&
            (!route.onlyFunctions || subject.self) &&
            (!route.readsAll || subject.language),
        );
        body.push(...random.weighted(fit).lines(it, `v${index}_${hop}`, any));
        it = `v${index}_${hop}`;
      }
      // Whatever type the compiler finds for a member, every test of it is legal.
      const one = inferred ? "(value: unknown)" : "value";
      const pair = inferred ? "([key, value]: [string, unknown])" : "([key, value])";
      const answer = () =>
        random.pick(subject.unnamed ? answers.filter(text => !text.includes("value.name")) : answers);
      const names = () => (subject.language ? random.pick(["keys", "getOwnPropertyNames"]) : "keys");
      const question = () => random.pick(questions);
      const looks = random.between(1, 4);
      for (let look = 0; look < looks; look++) {
        const label = JSON.stringify(`${subject.path} ${look}`);
        const name = random.pick(subject.names);
        const quoted = JSON.stringify(name);
        const member = /^[A-Za-z_$][\w$]*$/.test(name) && random.chance(0.6) ? `${it}.${name}` : `${it}[${quoted}]`;
        const kind = subject.onlyByName
          ? random.between(10, 13)
          : inferred
            ? random.pick([0, 0, 1, 1, 2, 3, 4, 5, 6, 6])
            : random.between(0, 17);
        if (kind === 0)
          body.push(`attempt(${label}, () => Object.values(${it}).map(${one} => (${answer()})).sort().join());`);
        else if (kind === 1)
          body.push(
            `attempt(${label}, () => Object.entries(${it}).map(${pair} => key + "=" + (${answer()})).sort().join());`,
          );
        else if (kind === 2)
          body.push(`attempt(${label}, () => String(Object.values(${it}).filter(${one} => ${question()}).length));`);
        else if (kind === 3)
          body.push(
            `attempt(${label}, () => String(Object.values(${it}).${random.pick(["every", "some"])}(${one} => ${question()})));`,
          );
        else if (kind === 4)
          body.push(
            `attempt(${label}, () => { let count = 0; for (const value of Object.values(${it})${inferred ? " as unknown[]" : ""}) if (${question()}) count++; return String(count); });`,
          );
        else if (kind === 5)
          body.push(
            `attempt(${label}, () => [...new Map${inferred ? "<string, unknown>" : ""}(Object.entries(${it}))].map(([key, value]) => key + "=" + (${answer()})).sort().join());`,
          );
        else if (kind === 6)
          body.push(
            `attempt(${label}, () => ${subject.language ? "Reflect.ownKeys" : "Object.keys"}(${it}).map(key => { const value${as("unknown")} = Reflect.get(${it}, key); return String(key) + "=" + (${answer()}); }).sort().join());`,
          );
        else if (kind === 7)
          body.push(
            `attempt(${label}, () => { const seen${as("string[]")} = []; for (const key in ${it}) { const value = ${it}[key]; seen.push(key + "=" + (${answer()})); } return seen.sort().join(); });`,
          );
        else if (kind === 8)
          body.push(
            `attempt(${label}, () => Object.${names()}(${it}).map(key => { const value = ${it}[key]; return key + "=" + (${answer()}); }).sort().join());`,
          );
        else if (kind === 9)
          body.push(
            `attempt(${label}, () => String(Object.entries(${it}).every(([key, value]) => value === ${start}[key])));`,
          );
        else if (kind === 10) body.push(`attempt(${label}, () => { const value = ${member}; return ${answer()}; });`);
        else if (kind === 11)
          body.push(`attempt(${label}, () => { const { [${quoted}]: value } = ${it}; return ${answer()}; });`);
        else if (kind === 12)
          body.push(`attempt(${label}, () => { const value = Reflect.get(${it}, ${quoted}); return ${answer()}; });`);
        else if (kind === 13 && subject.calls) {
          const [called, given] = random.pick(subject.calls);
          body.push(
            `attempt(${label}, () => show(${random.pick([
              `${it}.${called}(${given})`,
              `${it}[${JSON.stringify(called)}](${given})`,
              `(0, ${it}.${called})(${given})`,
              `Reflect.apply(${it}.${called}, ${it}, [${given}])`,
              `${it}.${called}.call(${[it, given].filter(Boolean).join(", ")})`,
              `(Object.entries(${it}).find(([key]) => key === ${JSON.stringify(called)})${typed ? "![1] as any" : "[1]"})(${given})`,
            ])}));`,
          );
        } else if (kind === 14 && subject.each)
          body.push(
            `attempt(${label}, () => Object.${names()}(${it}).filter(key => typeof ${it}[key] === "function" && !${JSON.stringify(["prototype", ...(subject.except ?? [])])}.includes(key)).map(key => key + "=" + show(${it}[key](${random.pick(subject.each)}))).sort().join());`,
          );
        else if (kind === 15 && subject.each)
          body.push(
            `attempt(${label}, () => Object.values(${it}).filter(value => typeof value === "function").map((value${any}) => show(value(${random.pick(subject.each)}))).sort().join());`,
          );
        else if (kind === 16 && subject.self) body.push(`attempt(${label}, () => show(${it}(${subject.self})));`);
        else if (subject.onlyByName)
          body.push(`attempt(${label}, () => typeof ${it} + " " + (${quoted} in ${it}) + " " + typeof ${member});`);
        else
          body.push(
            `attempt(${label}, () => typeof ${it} + " " + Object.keys(${it}).length + " " + Object.getOwnPropertyNames(${it}).length + " " + (${quoted} in ${it}) + " " + Object.hasOwn(${it}, ${quoted}));`,
          );
      }
      const inside = body.map(line => "  " + line);
      if (place <= 1) out.push(...body);
      else if (place === 2) out.push(`function steps${index}()${as("void")} {`, ...inside, `}`, `steps${index}();`);
      else if (place === 3)
        out.push(
          `function steps${index}(turn${as("number")})${as("void")} {`,
          `  quiet = turn < 29;`,
          ...inside,
          `}`,
          `for (let turn = 0; turn < 30; turn++) steps${index}(turn);`,
        );
      else if (place === 4)
        out.push(
          `class Steps${index} {`,
          `  run()${as("void")} {`,
          ...inside.map(line => "  " + line),
          `  }`,
          `}`,
          `new Steps${index}().run();`,
        );
      else if (place === 5)
        out.push(`async function steps${index}()${as("Promise<void>")} {`, ...inside, `}`, `await steps${index}();`);
      else out.push(`[0].forEach(() => {`, ...inside, `});`);
    });
  return (
    [
      ...needs,
      `let quiet = false;`,
      `class Holder {}`,
      `function show(value${as("unknown")})${as("string")} {`,
      `  if (typeof value === "function") return "function " + value.name;`,
      `  if (typeof value === "bigint") return value + "n";`,
      `  if (typeof value !== "object" || value === null) return typeof value + " " + String(value);`,
      `  return Array.isArray(value) ? "list of " + value.length : Object.prototype.toString.call(value);`,
      `}`,
      `function attempt(label${as("string")}, ask${as("() => string")})${as("void")} {`,
      `  let text${as("string")};`,
      `  try {`,
      `    text = ask();`,
      `  } catch (error) {`,
      `    text = "threw " + (error instanceof Error ? error.name : typeof error);`,
      `  }`,
      `  if (!quiet) console.log(label + ": " + text);`,
      `}`,
      ...out,
    ].join("\n") + "\n"
  );
}
