import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// ./a-file-of-the-product-that-overwrites-a-built-in-throws-as-in-the-executable.test.ts: a file that an executable holds too meets in a test run what it
// meets there. An executable takes a store on `fetch`, a timer or `Math.random`, because its build sees the store. A layer of a test run doesn't see the files above it.
const stores = {
  "fetch": [`globalThis.fetch = () => "replaced";`, `typeof fetch("http://127.0.0.1:1/")`, "ok string"],
  "a timer": [`globalThis.setTimeout = () => "replaced";`, `typeof setTimeout(() => {}, 0)`, "ok string"],
  "structuredClone": [`globalThis.structuredClone = () => "replaced";`, `typeof structuredClone(1)`, "ok string"],
  "Math.random": [`Math.random = () => "replaced";`, `typeof Math.random()`, "ok string"],
  "Date.now": [`Date.now = () => "replaced";`, `typeof Date.now()`, "ok string"],
  "JSON.parse": [`JSON.parse = () => "replaced";`, `typeof JSON.parse("1")`, "ok string"],
  "a function of Buffer, which is read-only": [
    `Buffer.isEncoding = () => "replaced";`,
    `typeof Buffer.isEncoding("utf8")`,
    "TypeError boolean",
  ],
};
const say = `
  let wrote = "ok";
  try { store(); } catch (error) { wrote = error.constructor.name; }
  console.log("SAID " + wrote + " " + read());`;

describe.skipIf(isWindows).each(Object.entries(stores))(
  "a file outside the folders of the tests stores on %s",
  (_, [store, read, answer]) => {
    const files = {
      "src/tools/store.js": `export function store() { ${store} }`,
      "src/read.js": `export const read = () => ${read};`,
      "src/main.js": `import { read } from "./read.js";\nimport { store } from "./tools/store.js";${say}`,
      "src/components/tests/a.test.js": `
      import { test } from "bun:test";
      import { read } from "../../read.js";
      import { store } from "../../tools/store.js";
      test("stores", () => {${say}
      });`,
      "src/components/tests/b.test.js": `import { test } from "bun:test";\ntest("b", () => {});`,
    };
    const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));

    test.concurrent.each([
      ["as one program", "TestRunLayers:0"],
      ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
    ])("a test run %s", async (_, words) => {
      using directory = tempDir("aot-product-stores", files);
      const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), env);
      expect(said(stdout + "\n" + stderr)).toEqual(["SAID " + answer]);
    });

    test.concurrent("an executable", async () => {
      using directory = tempDir("aot-product-stores", files);
      const executable = join(String(directory), "main");
      await run([bunExe(), ...compileCommand, "./src/main.js", "--outfile", executable], String(directory), bunEnv);
      expect(said((await run([executable], String(directory), bunEnv)).stdout)).toEqual(["SAID " + answer]);
    });
  },
);
