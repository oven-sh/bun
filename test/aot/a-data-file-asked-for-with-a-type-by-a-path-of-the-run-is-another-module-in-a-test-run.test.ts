// A test file has `import here from "./src/data.json"`, and a package is handed the path of that file and asks for it with a type: `import(file, { with: { type: "json" } })`.
// To the loader a file with a type is another module than the file without one, so the two are two objects. The compiled run held the file without a type alone and let that answer:
// what is right in an executable, whose files are on no disk. A test run's files lie where they are named.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/data-tools/package.json": `{ "name": "data-tools", "type": "module", "main": "index.js" }`,
  "node_modules/data-tools/index.js": `
    export const asJson = file => import(file, { with: { type: "json" } }).then(it => it.default);
    export const asText = file => import(file, { with: { type: "text" } }).then(it => it.default);
    export const plain = file => import(file).then(it => it.default);
    export const required = file => import.meta.require(file);`,
  "src/data.json": `{ "a": 1 }\n`,
  "a.test.mjs": `
    import { test } from "bun:test";
    import * as data from "data-tools";
    import here from "./src/data.json";
    test("t", async () => {
      const file = import.meta.dir + "/src/data.json";
      const typed = await data.asJson(file);
      console.log("with a type:", typed === here, JSON.stringify(typed), "again:", (await data.asJson(file)) === typed);
      console.log("without:", (await data.plain(file)) === here, "required:", data.required(file) === here);
      console.log("as text:", JSON.stringify(await data.asText(file)));
      here.a = 2;
      console.log("stored on one:", typed.a, (await data.plain(file)).a);
    });`,
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [form, flags, words] of [
  ["at default flags", [], ""],
  ["as one program under --isolate", ["--isolate"], "TestRunLayers:0"],
  ["over two layers", ["--isolate"], "TestRunLayers:2"],
] as const)
  test.concurrent(
    form,
    async () => {
      using dir = tempDir("a-data-file-with-a-type-by-a-path-of-the-run", files);
      const plain = await runTests(String(dir), [...flags]);
      expect(plain.exitCode).toBe(0);
      expect(plain.printed[0]).toStartWith("with a type: false");
      expect(await runTests(String(dir), ["--aot", ...flags], words)).toEqual(plain);
    },
    240_000,
  );
