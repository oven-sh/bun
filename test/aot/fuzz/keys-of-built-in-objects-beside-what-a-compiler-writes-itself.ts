// Some built-in objects add a member to their own properties when it is first read, and the rest when the object is first copied. From then on
// their keys stand in that order. A compiler may write a call of a built-in function where the program reads none: for a literal without a
// prototype, an import() of a name made at run time, an async function, a class, a spread. It may also know the value of a member that the
// program does read. A program takes one such object, uses none, one or all of its members, does a few things for which plain Bun reads no member
// by name, may use a module of the library, copies the object and lists its keys in every way.
import { holders } from "./keys-of-built-in-objects-that-add-members-when-read";
import type { Random } from "./random";

export { holders };
export const uses = ["none", "one", "all"] as const;
export const numberOfRounds = 3;

const head = `function names(keys) {
  return keys.length + " " + keys.map(key => String(key)).join();
}
function walked(object) {
  const keys = [];
  for (const key in object) keys.push(key);
  return keys;
}
function rest({ ...copy }) {
  return copy;
}
function attempt(label, run) {
  let text;
  try {
    text = String(run());
  } catch (error) {
    text = "throws " + error.name;
  }
  console.log(label, text);
}
const never = Date.now() < 5;`;

const copies: ((it: string) => string)[] = [
  it => `Object.entries(${it}).length`,
  it => `Object.values(${it}).length`,
  it => `Object.keys({ ...${it} }).length`,
  it => `Object.keys(rest(${it})).length`,
  it => `Object.keys(Object.assign({}, ${it})).length`,
];

const listings: ((it: string) => string)[] = [
  it => `names(Reflect.ownKeys(${it}))`,
  it => `names(Object.getOwnPropertyNames(${it}))`,
  it => `names(Object.keys(${it}))`,
  it => `names(walked(${it}))`,
  it => `names(Object.keys(Object.getOwnPropertyDescriptors(${it})))`,
];

// Plain Bun reads no member of a built-in object by name for these but the ones that are written, or native code reads it, as it does in an executable.
const quiet = [
  `const bare = { __proto__: null }; attempt("bare", () => typeof bare);`,
  `const bare = { __proto__: null, a: 1 }; attempt("bare", () => bare.a);`,
  `const made = ["node:", "os"].join(never ? "x" : ""); attempt("require", () => typeof require(made).EOL);`,
  `const made = ["node:", "os"].join(never ? "x" : ""); attempt("import", () => typeof import(made).then(() => {}));`,
  `attempt("missing", () => typeof import(["./no", "where"].join(never ? "x" : "")).catch(() => {}));`,
  `async function waits() { await null; return 1; } attempt("async", () => typeof waits());`,
  `function* steps() { yield 1; yield 2; } attempt("generator", () => [...steps()].length);`,
  `async function* slow() { yield 1; } attempt("async generator", () => typeof (async () => { for await (const step of slow()); })());`,
  `class Point { #x = 1; static origin = new Point(); get x() { return this.#x; } static has(o) { return #x in o; } } attempt("class", () => Point.has(Point.origin) + " " + Point.origin.x);`,
  `const first = { a: 1, get b() { return 2; } }; const second = { ...first, c: 3 }; const { a, ...others } = second; attempt("spread", () => a + Object.keys(others).length);`,
  'const tag = (strings, ...values) => strings.raw.length + values.length; attempt("template", () => tag`a${1}b` + `${1}${"x"}${null}`);',
  `attempt("question", () => { if (Number.isSafeInteger("no")) return 1; if (Number.isInteger(null)) return 2; if (Number.isFinite("1")) return 3; if (Number.isNaN("x")) return 4; return 0; });`,
  `attempt("convert", () => String(new Error("e")) + new Date(0).getTime() + [1, 2] + {} + 1n + Symbol("s").description + true);`,
  `attempt("lists", () => { const [one, ...more] = "abc"; const map = new Map([[one, 1], [more[0], 2]]); const set = new Set([one, ...more]); return map.size + set.size + Array.from({ length: 2 }).length + Array(3).fill(0).length; });`,
  `attempt("text", () => { let text = ""; for (const letter of "ab") text += letter; switch (text) { case "ab": return text[0] + text.length; default: return ""; } });`,
  `attempt("error", () => { try { null.x; } catch (error) { return error instanceof TypeError; } });`,
  `attempt("known", () => { const { arch, platform } = process; const host = process; return typeof arch + typeof platform + typeof host["platform"] + typeof host.arch; });`,
  `attempt("meta", () => typeof import.meta.url + typeof import.meta.dir + typeof import.meta.main);`,
  `attempt("typeof", () => typeof Bun + typeof process + typeof Buffer + typeof WebAssembly + typeof Intl + typeof Reflect + typeof JSON);`,
  `using held = { [Symbol.dispose]() {} }; attempt("using", () => typeof held);`,
];

const library: [imports: string, use: string][] = [
  [
    `import { EventEmitter } from "node:events";`,
    `attempt("events", () => new EventEmitter().on("a", () => {}).emit("a"));`,
  ],
  [
    `import { format, inspect } from "node:util";`,
    `attempt("util", () => inspect({ a: [1, { b: 2 }] }) + format("%s %d", "a", 1));`,
  ],
  [`import path from "node:path";`, `attempt("path", () => path.join("a", "..", "b") + path.extname("a.js"));`],
  [
    `import { Readable } from "node:stream";`,
    `attempt("stream", () => typeof Readable.from(["a"]).on("data", () => {}));`,
  ],
  [
    `import fs from "node:fs";`,
    `attempt("fs", () => fs.existsSync("/nowhere") + " " + typeof fs.readdirSync("/").length);`,
  ],
  [
    `import assert from "node:assert";`,
    `attempt("assert", () => { assert.deepStrictEqual({ a: 1 }, { a: 1 }); return 1; });`,
  ],
  [
    `import { Buffer as B } from "node:buffer";`,
    `attempt("buffer", () => B.from("ab").toString("hex") + B.concat([B.alloc(1)]).length);`,
  ],
  [
    ``,
    `attempt("console", () => { console.log({ a: 1, b: [1, 2], c: new Map([[1, 2]]), d: new Date(0), e: /x/g, f: new Error("e").message }); return 1; });`,
  ],
  [
    ``,
    `attempt("timers", () => typeof setTimeout(() => {}, 0) + typeof queueMicrotask(() => {}) + typeof process.nextTick(() => {}));`,
  ],
  [
    ``,
    `attempt("url", () => new URL("http://a/b?c=1").searchParams.get("c") + new TextEncoder().encode("a").length + structuredClone({ a: 1 }).a);`,
  ],
];

/** Round 0: the program alone. Round 1: what is listed could be a value that nobody knows, beside a module of the library. Round 2: beside a module of the library. */
export function generate(
  random: Random,
  holder: (typeof holders)[number],
  use: (typeof uses)[number],
  round: number,
): string {
  const [imports, useOfLibrary] = round === 0 ? ["", ""] : random.pick(library);
  const added = Object.keys(holder.uses);
  const used = use === "none" ? [] : use === "one" ? [random.pick(added)] : random.shuffled(added);
  const lines =
    round === 1
      ? [`let listed = ${holder.path};`, `if (never) listed = globalThis[String(Date.now())];`]
      : [`const listed = ${holder.path};`];
  for (let step = 0; step < 3; step++) lines.push(`{ ${random.pick(quiet)} }`);
  for (const key of used) {
    const call = holder.uses[key];
    lines.push(
      `attempt(${JSON.stringify(key)}, () => typeof ${call && random.chance(0.6) ? `(${call})` : `${holder.path}.${key}`});`,
    );
  }
  lines.push(`{ ${random.pick(quiet)} }`);
  lines.push(`attempt("before", () => ${random.pick(listings)("listed")});`);
  lines.push(`attempt("copy", () => ${random.pick(copies)("listed")});`);
  for (const listing of listings) lines.push(`attempt("keys", () => ${listing("listed")});`);
  return [imports, head, holder.setup ?? "", useOfLibrary, ...lines].filter(line => line !== "").join("\n") + "\n";
}
