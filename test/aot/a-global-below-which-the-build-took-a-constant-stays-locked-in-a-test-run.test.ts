// `Symbol` is looked up in a test run, so that a test can replace it, and so is `Map`, with its `prototype`. `Symbol.iterator` is what it is in the executable: a key of a layout.
// A test run compiles what an executable compiles. So a file that names `Symbol.iterator` has taken `Symbol` for what it was, and `Symbol` stays locked in that run unless a file of the tests spells a store
// to it: then the build looks `Symbol.iterator` up. A store that the build cannot read used to replace `Symbol` for some readers alone: "fake iterator fake iterator" under `bun test`,
// "Symbol(Symbol.iterator) Symbol(Symbol.iterator)" compiled. It throws now, names the member and says what to write. `Map.prototype` is a value, which the engine folds where nobody replaces `Map`.
// Bun's own JavaScript is a reader like any other: `util.getSystemErrorMap()` says `new Map()` at each call, and makes what the test has laid there, however the test reached the global object.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const namesPrototype = `export function look() {
  const above: any = Map.prototype;
  return typeof above.mine + " " + typeof above.get + " " + (Object.getPrototypeOf(new Map()) === above);
}
`;
const namesMapAlone = `export function look() {
  const made: any = new Map();
  return typeof made.mine + " " + typeof made.get;
}
`;
const asksLibrary = `import util from "node:util";
export function look() {
  return new Map().constructor.name + " " + util.getSystemErrorMap().constructor.name;
}
`;
const namesSymbol = `export function look() {
  const o: any = { [Symbol.iterator]: 1 };
  return String(Symbol.iterator) + " " + Reflect.ownKeys(o).map(String).join();
}
`;

const refusal = (name: string) =>
  new RegExp(
    `Cannot assign to ${name} because built-in objects are read-only in compiled code, and the build didn't see a test replace this one\\. Spell out the object and the name where the test does it, as in globalThis\\.${name} = f or spyOn\\(globalThis, "${name}"\\)`,
  );

type Case = {
  product: string;
  name: string;
  value: string;
  lay: string;
  plain: string;
  compiled?: RegExp;
  beside?: string;
};
const fake = `class Fake { mine() { return 1; } }`;
const cases: Record<string, Case> = {
  "a helper that is handed the global object": {
    product: namesPrototype,
    name: "Map",
    value: "Fake",
    lay: `((root, value) => { root.Map = value; })(take(globalThis), Fake)`,
    plain: "function undefined true",
    // `Map.prototype` is looked up with `Map`.
  },
  "a key that arrives": {
    product: namesPrototype,
    name: "Map",
    value: "Fake",
    lay: `globalThis[JSON.parse('"Map"')] = Fake`,
    plain: "function undefined true",
    // `Map.prototype` is looked up with `Map`.
  },
  "a root behind a choice": {
    product: namesPrototype,
    name: "Map",
    value: "Fake",
    lay: `(typeof window !== "undefined" ? window : globalThis).Map = Fake`,
    plain: "function undefined true",
    // `Map.prototype` is looked up with `Map`.
  },
  "a root behind a choice, and Bun's own code makes one": {
    product: asksLibrary,
    name: "Map",
    value: "Wider",
    lay: `(typeof window !== "undefined" ? window : globalThis).Map = Wider`,
    beside: `class Wider extends Map {}`,
    plain: "Wider Wider",
  },
  "a key that arrives, and Bun's own code makes one": {
    product: asksLibrary,
    name: "Map",
    value: "Wider",
    lay: `globalThis[JSON.parse('"Map"')] = Wider`,
    beside: `class Wider extends Map {}`,
    plain: "Wider Wider",
  },
  "Symbol, whose iterator is a key": {
    product: namesSymbol,
    name: "Symbol",
    value: `{ iterator: "fake iterator" }`,
    lay: `install(globalThis, { iterator: "fake iterator" })`,
    beside: `const install = (root, value) => { root.Symbol = value; };`,
    plain: "fake iterator fake iterator",
    compiled: refusal("Symbol"),
  },
  // The build reads the store, wherever in the tests it stands, and looks up what hangs below.
  "spelled": {
    product: namesPrototype,
    name: "Map",
    value: "Fake",
    lay: `globalThis.Map = Fake`,
    plain: "function undefined true",
  },
  "a root behind a choice, and the member spelled in a function that nobody calls": {
    product: namesPrototype,
    name: "Map",
    value: "Fake",
    lay: `(typeof window !== "undefined" ? window : globalThis).Map = Fake`,
    beside: `export const spelled = () => { globalThis.Map = Fake; };`,
    plain: "function undefined true",
  },
  // Nothing was taken for a constant below it, so the engine opens what it follows the store to, as before.
  "a root behind a choice, where no file names what hangs below": {
    product: namesMapAlone,
    name: "Map",
    value: "Fake",
    lay: `(typeof window !== "undefined" ? window : globalThis).Map = Fake`,
    plain: "function undefined",
  },
};

for (const [title, { product, name, lay, plain, compiled, beside = "" }] of Object.entries(cases))
  test.concurrent(title, async () => {
    using dir = tempDir("aot-constant-below", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "product.ts": product,
      "a.test.js": `import { test } from "bun:test";
import { look } from "./product.ts";
${fake}
const take = it => [it][JSON.parse("0")];
${beside}
test("t", () => {
  const kept = take(globalThis)[JSON.parse('"${name}"')];
  ${lay};
  let seen;
  try { seen = look(); } finally { take(globalThis)[JSON.parse('"${name}"')] = kept; }
  console.error("SEEN " + seen);
});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")),
        refused: compiled !== undefined && lines.some(line => compiled.test(line)),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen: ["SEEN " + plain], refused: false, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({
      seen: compiled ? [] : ["SEEN " + plain],
      refused: compiled !== undefined,
      exitCode: compiled ? 1 : 0,
    });
  });
