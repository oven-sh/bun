import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Each way is a project of its own: what one file spies on is open for all the others.
// No file spells `spyOn` beside `bun:test`, or `Bun.jest`, so the build has to follow the values.
const ways: Record<string, { imports?: string; spy: string }> = {
  "Bun.jest under a name that is made at run time": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path).spyOn(lib, "total");`,
  },
  "Bun under a name that is made at run time": {
    spy: `return globalThis[["B", "un"].join("")].jest(import.meta.path).spyOn(lib, "total");`,
  },
  "Bun.jest by Reflect.get": {
    spy: `return Reflect.get(Bun, "jest")(import.meta.path).spyOn(lib, "total");`,
  },
  "Bun is handed to a helper": {
    imports: `import { toolsOf } from "./tools.js";`,
    spy: `return toolsOf(Bun, import.meta.path).spyOn(lib, "total");`,
  },
  "the helper makes the name": {
    imports: `import { spyBy } from "./tools.js";`,
    spy: `return spyBy(["je", "st"].join(""), import.meta.path, lib, "total");`,
  },
  "the name of the spy is made too": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path)[["spy", "On"].join("")](lib, "total");`,
  },
  "jest.spyOn of what it answers": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path).jest.spyOn(lib, "total");`,
  },
  "the name of the export is made too": {
    spy: `return Bun[["je", "st"].join("")](import.meta.path).spyOn(lib, ["to", "tal"].join(""));`,
  },
  "the spy waits in a list": {
    spy: `const steps = []; steps.push(Bun[["je", "st"].join("")](import.meta.path).spyOn); return steps.pop()(lib, "total");`,
  },
  "the namespace object lies on the global object": {
    spy: `globalThis.kept = lib; return Bun[["je", "st"].join("")](import.meta.path).spyOn(globalThis.kept, "total");`,
  },
  "text from a file is handed the namespace object": {
    spy: `return new Function("ns", "path", textOf("operand"))(lib, import.meta.path);`,
  },
  "text from a file is handed it as the second operand": {
    spy: `return new Function("path", "ns", textOf("operand"))(import.meta.path, lib);`,
  },
  "text from a file is handed it in an object": {
    spy: `return new Function("held", "path", textOf("member"))({ module: lib }, import.meta.path);`,
  },
  "text from a file takes it off the global object": {
    spy: `globalThis.kept = lib; return new Function("path", textOf("global"))(import.meta.path);`,
  },
  "a built-in function calls text from a file": {
    spy: `globalThis.path = import.meta.path; return [lib].map(new Function("ns", textOf("operand")))[0];`,
  },
  "eval of text from a file sees the variable": {
    spy: `const ns = lib, path = import.meta.path; return eval("(() => {" + textOf("operand") + "})()");`,
  },
  "node:vm runs the text": {
    imports: `import vm from "node:vm";`,
    spy: `return vm.runInThisContext("(ns, path) => {" + textOf("operand") + "}")(lib, import.meta.path);`,
  },
};

const testFile = (way: { imports?: string; spy: string }) => `
import { test } from "bun:test";
import { readFileSync } from "node:fs";
import * as lib from "./lib.js";
import { read } from "./reader.js";
${way.imports ?? ""}
const textOf = name => readFileSync(import.meta.dir + "/" + name + ".txt", "utf8");
test("a spy", async () => {
  let said;
  try {
    const before = read();
    const made = await (async () => { ${way.spy} })();
    made.mockImplementation(() => "spied");
    const under = read();
    made.mockRestore();
    said = [before, under, read()];
  } catch (error) {
    said = error.name + ": " + String(error.message).slice(0, 60);
  }
  console.error("SEEN " + JSON.stringify(said));
});
`;

test.concurrent.each(Object.keys(ways))("%s", async name => {
  using dir = tempDir("aot-spy-that-no-file-names", {
    "package.json": `{ "name": "spy-that-no-file-names", "type": "module" }`,
    "lib.js": `export function sumOf(pair) { return pair.x + pair.y; }\nexport function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\n`,
    "reader.js": `import { sumOf, total } from "./lib.js";\nexport const read = () => [sumOf({ x: 1, y: 2 }), total([1, 2, 3])];\n`,
    "tools.js": `export const toolsOf = (holder, path) => holder.jest(path);\nexport const spyBy = (name, path, object, key) => Bun[name](path).spyOn(object, key);\n`,
    "operand.txt": `return Bun.jest(path).spyOn(ns, "total")`,
    "member.txt": `return Bun.jest(path).spyOn(held.module, "total")`,
    "global.txt": `return Bun.jest(path).spyOn(kept, "total")`,
    "a.test.js": testFile(ways[name]),
  });
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain).toEqual({ seen: [`SEEN [[3,6],[3,"spied"],[3,6]]`], exitCode: 0 });
  expect(compiled).toEqual(plain);
});
