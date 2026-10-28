import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// Built-in objects are locked in a program that is compiled ahead of time. Whoever meets the lock is mostly not who wrote the code
// that tries: a package does, at load. So every refusal names the built-in and the property, says why, and its stack leads to the
// file and the line. In sloppy code JavaScript ignores a store to a read-only property and a delete that fails, and the package would
// go on as if its patch were in place: so the lock throws there too. Either way nothing has changed afterwards.

const attempts: Record<string, [code: string, says: string]> = {
  "adds a name": [`Function.prototype.call$0 = function () {};`, "Cannot assign to Function.prototype.call$0"],
  "defines a new name": [
    `Object.defineProperty(Object.prototype, "should", { get() { return 1; }, configurable: true });`,
    "Cannot assign to Object.prototype.should",
  ],
  "adds a getter the old way": [
    `Object.prototype.__defineGetter__("red", function () { return this; });`,
    "Cannot assign to Object.prototype.red",
  ],
  "adds by Object.assign": [
    `Object.assign(Object.prototype, { last() {} });`,
    "Cannot assign to Object.prototype.last",
  ],
  "adds an index": [`Array.prototype[3] = 1;`, "Cannot assign to Array.prototype[3]"],
  "replaces a name": [
    `Function.prototype.call = function () { return "x"; };`,
    "Cannot assign to Function.prototype.call",
  ],
  "defines a name anew": [
    `Object.defineProperty(Function.prototype, "call", { value() { return "x"; } });`,
    "Cannot assign to Function.prototype.call",
  ],
  "replaces a symbol": [
    `Array.prototype[Symbol.iterator] = function* () {};`,
    "Cannot assign to Array.prototype[Symbol(Symbol.iterator)]",
  ],
  "hides an inherited name": [`Date.toString = () => "x";`, "Cannot assign to Date.toString"],
  "deletes a name": [`delete Function.prototype.call;`, "Cannot delete Function.prototype.call"],
  "deletes a computed name": [`delete Array.prototype[["pu", "sh"].join("")];`, "Cannot delete Array.prototype.push"],
  "replaces a global": [`globalThis.Math = function () {};`, "Cannot assign to Math"],
  "stores to a global by its name": [`Math = function () {};`, "Cannot assign to Math"],
  "defines a global anew": [`Object.defineProperty(globalThis, "Math", { value: 1 });`, "Cannot assign to Math"],
  "deletes a global": [`delete globalThis.Math;`, "Cannot delete Math"],
  "changes the prototype of a prototype": [
    `Object.setPrototypeOf(Array.prototype, {});`,
    "Cannot change the prototype of Array.prototype",
  ],
  "stores to __proto__": [`Array.prototype.__proto__ = {};`, "Cannot assign to Array.prototype.__proto__"],
};
const kinds = Object.keys(attempts);
const why = " because built-in objects are read-only in a compiled executable";

async function run() {
  const functions = kinds.map((kind, line) => `exports[${line}] = () => { ${attempts[kind][0]} };\n`).join("");
  using dir = tempDir("the-lock-says", {
    "node_modules/patches/package.json": `{ "name": "patches" }`,
    "node_modules/patches/strict.js": `"use strict";\n` + functions,
    "node_modules/patches/sloppy.js": `\n` + functions,
    "main.mjs": `import strict from "patches/strict.js";
import sloppy from "patches/sloppy.js";
for (const patches of [strict, sloppy])
  for (const line of Object.keys(patches)) {
    try { patches[line](); console.log(JSON.stringify(["nothing is thrown"])); } catch (e) { console.log(JSON.stringify([e.name, e.message, String(e.stack).split("\\n").find(frame => frame.includes("patches"))?.trim()])); }
  }
console.log(JSON.stringify([typeof Function.prototype.call$0, "should" in {}, "red" in {}, "last" in {}, 3 in [], (function () { return "its own"; }).call(), [...[1, 2]].length, Date.toString === Function.prototype.toString, typeof [].push, typeof Math.abs, Object.getPrototypeOf(Array.prototype) === Object.prototype]));
`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "program"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
    stderr: expect.any(String),
    exitCode: 0,
  });
  await using program = Bun.spawn({
    cmd: [join(String(dir), "program")],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const said: string[][] = (await program.stdout.text())
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
  expect(await program.exited).toBe(0);
  const short = ([name, message, frame]: string[]) =>
    message === undefined
      ? [name]
      : [
          name,
          message.includes(why) ? message.slice(0, message.indexOf(why) + why.length) : message,
          /\.js:(\d+):/.exec(frame ?? "")?.[1],
        ];
  return {
    strict: said.slice(0, kinds.length).map(short),
    sloppy: said.slice(kinds.length, 2 * kinds.length).map(short),
    afterwards: said.at(-1),
  };
}
const ran = run();
const refusal = (kind: string) => ["TypeError", attempts[kind][1] + why, String(kinds.indexOf(kind) + 2)];

test("in strict code every attempt is refused, at its line", async () => {
  expect((await ran).strict.map(([name, , line]) => [name, line])).toEqual(
    kinds.map((_, line) => ["TypeError", String(line + 2)]),
  );
}, 120_000);

test.each(kinds)(
  "the refusal names the built-in and the property and says why: %s",
  async kind => {
    expect((await ran).strict[kinds.indexOf(kind)]).toEqual(refusal(kind));
  },
  120_000,
);

test("in sloppy code every attempt is refused too, at its line", async () => {
  expect((await ran).sloppy.map(([name, , line]) => [name, line])).toEqual(
    kinds.map((_, line) => ["TypeError", String(line + 2)]),
  );
}, 120_000);

test("nothing has changed afterwards", async () => {
  expect((await ran).afterwards).toEqual([
    "undefined",
    false,
    false,
    false,
    false,
    "its own",
    2,
    true,
    "function",
    "function",
    true,
  ]);
}, 120_000);
