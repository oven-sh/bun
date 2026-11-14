import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `writeFileSync(path, text); await import(path)`: the build knows the path and finds no file there, so the loader reads the file when the
// call runs. Nobody has read what the text imports: it may be any file of the run, under any name that the file exports, and it has to be
// the instance that the compiled files share.
const library = `
  export const one = 1;
  export function readByNoCompiledFile(list) { return list.map(x => x * 2); }
  export let count = 0;
  export function bump() { return ++count; }`;

const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;

const files: Record<string, string> = {
  "src/lib.mjs": library,
  "src/file.cjs": `exports.three = 3; exports.readByNoCompiledFile = () => "unread";`,
  "src/data.json": `{ "four": 4, "five": 5 }`,
  "written.test.mjs": testFile(`
    import { rmSync, writeFileSync } from "node:fs";
    import { one, bump } from "./src/lib.mjs";
    import common from "./src/file.cjs";
    import data from "./src/data.json";
    const path = import.meta.dir + "/src/made.mjs";
    writeFileSync(path, \`
      import * as lib from "./lib.mjs";
      import common from "./file.cjs";
      import data from "./data.json";
      import { hostname } from "node:os";
      lib.bump();
      export const two = lib.one + 1;
      export const list = lib.readByNoCompiledFile([1, 2]);
      export const names = Object.keys(lib).join();
      export const rest = common.readByNoCompiledFile() + data.five + typeof hostname();\`);
    bump();
    const made = await import(path).finally(() => rmSync(path));
    console.log(one, common.three, data.four, made.two, made.list.join(), made.names, made.rest, bump());`),
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const said = stderr.replaceAll(folder, ".").split("\n");
  return {
    printed: stdout.replace(/^bun test .*\n/, ""),
    results: said
      .filter(line => /^(\((pass|fail)\)|\w*[Ee]rror:)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    exitCode,
  };
}

test("import() of an absolute path", async () => {
  using dir = tempDir("a-module-that-a-test-writes", { "package.json": `{}`, ...files });
  const folder = String(dir);
  const plain = await runTests(folder, []);
  expect(plain.printed).toBe("1 3 4 2 2,4 bump,count,one,readByNoCompiledFile unread5string 3\n");
  expect(plain.exitCode).toBe(0);
  expect(await runTests(folder, ["--aot"], "TestRunLayers:0")).toEqual(plain);
}, 120_000);
