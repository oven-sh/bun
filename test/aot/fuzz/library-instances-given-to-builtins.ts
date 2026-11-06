// An object that a library module or the host made is handed to a built-in that calls a member on it which the program never
// names: JSON.stringify calls toJSON, a template calls toString, for-of calls [Symbol.iterator], for-await calls
// [Symbol.asyncIterator], await calls then, `using` calls [Symbol.dispose], arithmetic calls valueOf. An executable contains
// only what the program can reach, so those members have to count as reached. Each scene picks who makes the object, whether
// it passes through a place where the compiler loses sight of it, and which built-ins get it. What is printed does not depend
// on the machine: kinds, lengths and whether it threw, not contents.
import type { Random } from "./random";

/** Expressions that make an object, with the imports they need. Nothing here opens a socket, starts a process or leaves a file. */
const makers: [text: string, imports?: string][] = [
  ['new Database(":memory:").query("select 1 as a")', 'import { Database } from "bun:sqlite";'],
  ['new Database(":memory:").prepare("select 1 as a")', 'import { Database } from "bun:sqlite";'],
  ['new Database(":memory:")', 'import { Database } from "bun:sqlite";'],
  ["await fs.promises.opendir(import.meta.dir)", 'import fs from "node:fs";'],
  ["fs.opendirSync(import.meta.dir)", 'import fs from "node:fs";'],
  ["fs.statSync(import.meta.dir)", 'import fs from "node:fs";'],
  ["fs.readdirSync(import.meta.dir, { withFileTypes: true })[0]", 'import fs from "node:fs";'],
  ["new EventEmitter()", 'import { EventEmitter } from "node:events";'],
  ['Readable.from(["a", "b"])', 'import { Readable } from "node:stream";'],
  ["new PassThrough()", 'import { PassThrough } from "node:stream";'],
  ['new StringDecoder("utf8")', 'import { StringDecoder } from "node:string_decoder";'],
  ['url.parse("http://a/b?c=d")', 'import url from "node:url";'],
  ['new URL("http://a/b?c=d")'],
  ['new URLSearchParams("a=1&b=2")'],
  ['new Headers({ a: "1", b: "2" })'],
  ['Buffer.from("ab")'],
  ['new Blob(["ab"])'],
  ['new File(["ab"], "f")'],
  ['new Response("ab")'],
  ['new Request("http://a/")'],
  ["new FormData()"],
  ["new AbortController().signal"],
  ['new Event("e")'],
  ['new DOMException("m", "AbortError")'],
  ['new TextDecoder("utf-8")'],
  ['new ReadableStream({ start: controller => (controller.enqueue("a"), controller.close()) })'],
  ['createHash("sha1")', 'import { createHash } from "node:crypto";'],
  ['new Bun.Glob("*.none")'],
  ['new Bun.CookieMap("a=1; b=2")'],
  ['new Bun.Cookie("a", "1")'],
  ["Bun.file(import.meta.path)"],
  ['new assert.AssertionError({ message: "m" })', 'import assert from "node:assert";'],
  ['util.promisify(callback => callback(null, "done"))()', 'import util from "node:util";'],
  ["new util.TextEncoder()", 'import util from "node:util";'],
  ["new AsyncLocalStorage()", 'import { AsyncLocalStorage } from "node:async_hooks";'],
  ['performance.mark("m")'],
  ['querystring.parse("a=1&b=2")', 'import querystring from "node:querystring";'],
  ['path.parse("/a/b.c")', 'import path from "node:path";'],
  ["setTimeout(() => {}, 0)"],
  ["setImmediate(() => {})"],
  ['new Intl.NumberFormat("en")'],
  ["new WeakRef({})"],
];

/** How the object gets from its maker to its use. */
const paths = [
  "MADE",
  "MADE",
  "[MADE][key(0)]",
  '{ held: MADE }[key("held")]',
  "kept(MADE)",
  "(globalThis.handed = MADE, globalThis.handed)",
  "new Map([[1, MADE]]).get(1)",
  "(await Promise.all([[MADE]]))[0][0]",
];

/** Expressions that hand `it` to a built-in. Each answers with something that is the same on every machine. */
const uses = [
  "typeof JSON.stringify(it)",
  "typeof JSON.stringify({ inside: it })",
  "typeof JSON.stringify([it])",
  "typeof `${it}`",
  'typeof (it + "")',
  "typeof String(it)",
  "typeof +it",
  "typeof (it < 1)",
  "it == 1",
  "[...it].length >= 0",
  "Array.from(it).length >= 0",
  "new Set(it).size >= 0",
  "(([first]) => typeof first)(it)",
  "(await Array.fromAsync(it)).length >= 0",
  "await (async () => {\n      let count = 0;\n      for await (const each of it) if (++count > 5) break;\n      return count >= 0;\n    })()",
  "(() => {\n      let count = 0;\n      for (const each of it) if (++count > 5) break;\n      return count >= 0;\n    })()",
  "typeof (await it)",
  "typeof (await Promise.resolve(it))",
  "Object.prototype.toString.call(it)",
  "typeof Bun.inspect(it)",
  "typeof util.inspect(it)",
  'typeof util.format("%s %j %o", it, it, it)',
  "Object.keys(it).length >= 0",
  "typeof Object.entries(it)",
  "typeof { ...it }",
  "typeof Object.assign({}, it)",
  "typeof structuredClone(it)",
  '(() => {\n      using held = it;\n      return "used";\n    })()',
  'await (async () => {\n      await using held = it;\n      return "used";\n    })()',
  "[it, it].sort().length",
  "[it].join().length >= 0",
  "[it].includes(it)",
  "typeof [it].toString()",
  "typeof [it].toLocaleString()",
  "new Map([[it, 1]]).get(it)",
  "({})[it] === undefined",
  "isNaN(it)",
  "typeof Number(it)",
  "typeof Symbol(it).description",
  "typeof new Error(it).message",
  "typeof encodeURIComponent(it)",
  '"x".concat(it).length > 0',
  "typeof Buffer.from(it).length",
  "typeof new Uint8Array(it).length",
  "assert.deepStrictEqual(it, it)",
  "util.isDeepStrictEqual(it, it)",
  "Bun.deepEquals(it, it)",
  "it instanceof Object",
];

export function generate(random: Random): string {
  const imports = new Set(['import util from "node:util";', 'import assert from "node:assert";']);
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 5); scene < total; scene++) {
    const [made, needed] = random.pick(makers);
    if (needed) imports.add(needed);
    const asked = random.sample(uses, random.between(2, 5));
    scenes.push(`{
  const make = async () => (${random.pick(paths).replace("MADE", () => made)});
  const answers = [];
${asked
  .map(
    use => `  answers.push(
    await told(async () => {
      const it = await boxed(make);
      return ${use};
    }),
  );`,
  )
  .join("\n")}
  console.log("scene ${scene}", answers.join(" | "));
}`);
  }
  return `${[...imports].join("\n")}
const key = name => process.argv[9] ?? name;
const all = [];
const kept = it => (all.push(it), all[all.length - 1]);
// A thenable must not be awaited on its way to the use, so it travels in a box.
const boxed = async make => (await (async () => [await make().then(it => [it])])())[0][0];
async function told(ask) {
  try {
    return String(await ask());
  } catch (error) {
    return "threw " + error.name + (/was not compiled/.test(error.message) ? " " + error.message.slice(0, 40) : "");
  }
}
${scenes.join("\n")}
process.exit(0);
`;
}
