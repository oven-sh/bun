import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// Built-in objects are locked in a program that is compiled ahead of time. Whoever meets the lock is mostly not who wrote the code
// that tries: a package does, at load. So every refusal names the built-in and the property, says why, and its stack leads to the
// file and the line.

const attempts: Record<string, [code: string, says: string]> = {
  "adds a name": [`Function.prototype.call$0 = function () {};`, "Cannot change 'call$0' of Function.prototype"],
  "defines a new name": [
    `Object.defineProperty(Object.prototype, "should", { get() { return 1; }, configurable: true });`,
    "Cannot change 'should' of Object.prototype",
  ],
  "adds a getter the old way": [
    `String.prototype.__defineGetter__("red", function () { return this; });`,
    "Cannot change 'red' of String.prototype",
  ],
  "adds by Object.assign": [
    `Object.assign(Array.prototype, { last() {} });`,
    "Cannot change 'last' of Array.prototype",
  ],
  "adds an index": [`Array.prototype[3] = 1;`, "Cannot change '3' of Array.prototype"],
  "replaces a name": [
    `Function.prototype.toString = function () { return "x"; };`,
    "Cannot change 'toString' of Function.prototype",
  ],
  "defines a name anew": [
    `Object.defineProperty(Function.prototype, "toString", { value() { return "x"; } });`,
    "Cannot change 'toString' of Function.prototype",
  ],
  "replaces a symbol": [
    `Array.prototype[Symbol.iterator] = function* () {};`,
    "Cannot change [Symbol.iterator] of Array.prototype",
  ],
  "hides an inherited name": [`Date.toString = () => "x";`, "Cannot change 'toString' of Date"],
  "deletes a name": [`delete Function.prototype.toString;`, "Cannot delete 'toString' of Function.prototype"],
  "deletes a name in strict code": [
    `"use strict"; delete Function.prototype.toString;`,
    "Cannot delete 'toString' of Function.prototype",
  ],
  "deletes a computed name": [
    `delete Array.prototype[["pu", "sh"].join("")];`,
    "Cannot delete 'push' of Array.prototype",
  ],
  "replaces a global": [`globalThis.Date = function () {};`, "Cannot change 'Date' of globalThis"],
  "stores to a global by its name": [`Date = function () {};`, "Cannot change 'Date' of globalThis"],
  "defines a global anew": [
    `Object.defineProperty(globalThis, "Date", { value: 1 });`,
    "Cannot change 'Date' of globalThis",
  ],
  "deletes a global": [`"use strict"; delete globalThis.Date;`, "Cannot delete 'Date' of globalThis"],
  "changes the prototype of a prototype": [
    `Object.setPrototypeOf(Array.prototype, {});`,
    "Cannot change the prototype of Array.prototype",
  ],
  "stores to __proto__": [`Array.prototype.__proto__ = {};`, "Cannot change '__proto__' of Array.prototype"],
};

test("every refusal of the lock names the built-in and the property, says why, and leads to the line", async () => {
  const kinds = Object.keys(attempts);
  using dir = tempDir("the-lock-says", {
    "node_modules/patches/package.json": `{ "name": "patches", "main": "index.js" }`,
    "node_modules/patches/index.js": kinds
      .map((kind, line) => `exports[${line}] = () => { ${attempts[kind][0]} };\n`)
      .join(""),
    "main.mjs": `import patches from "patches";
for (const line of Object.keys(patches)) {
  try { patches[line](); console.log(line, "was allowed"); } catch (e) { console.log(JSON.stringify([e.name, e.message, String(e.stack).split("\\n").find(frame => frame.includes("index.js"))?.trim()])); }
}
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
  const said = (await program.stdout.text()).trim().split("\n");
  expect(await program.exited).toBe(0);
  const why = ": built-ins are locked in a program compiled with --aot";
  expect(
    said.map(line => {
      try {
        const [name, message, frame] = JSON.parse(line);
        return [name, message.slice(0, message.indexOf(why) + why.length), /index\.js:(\d+):/.exec(frame ?? "")?.[1]];
      } catch {
        return line;
      }
    }),
  ).toEqual(kinds.map((kind, line) => ["TypeError", attempts[kind][1] + why, String(line + 1)]));
}, 120_000);
