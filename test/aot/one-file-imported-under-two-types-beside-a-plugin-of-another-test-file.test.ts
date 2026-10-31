import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A plugin that a test file registers may answer for any file of data, so the run leaves those to the loader. Two statements that ask for one file under two types share a place
// there: the second gets what the first one made, and the loader never comes to a module of its own for it.
const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;
const files = {
  "package.json": `{}`,
  "object.json": `{"a": 1}\n`,
  "five.json": `5\n`,
  "a.test.ts": testFile(`
    Bun.plugin({
      name: "probe",
      setup(build) {
        build.onLoad({ filter: /\\.yaml$/ }, () => ({ exports: { value: "from plugin" }, loader: "object" }));
      },
    });`),
  "c.test.mjs": testFile(`
    import object from "./object.json" with { type: "yaml" };
    import namedText from "./object.json" with { type: "text" };
    import text from "./five.json" with { type: "text" };
    import * as namedNumber from "./five.json" with { type: "json5" };
    console.log(typeof object, typeof namedText, namedText === object);
    console.log(typeof text, typeof namedNumber.default, JSON.stringify(namedNumber.default));`),
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  return {
    printed: stdout.replace(/^bun test .*\n/, ""),
    results: stderr
      .split("\n")
      .filter(line => /^(\((pass|fail)\)|\w*[Ee]rror:|panic)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    exitCode,
  };
}

for (const [form, flags, words] of [
  ["at default flags", [], ""],
  ["as one program under --isolate", ["--isolate"], "TestRunLayers:0"],
  ["over two layers", ["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
] as const)
  test.concurrent(
    form,
    async () => {
      using dir = tempDir("two-types-beside-a-plugin", files);
      const plain = await runTests(String(dir), [...flags]);
      expect(plain.printed).toBe(`object object true\nstring string "5\\n"\n`);
      expect(plain.exitCode).toBe(0);
      expect(await runTests(String(dir), ["--aot", ...flags], words)).toEqual(plain);
    },
    240_000,
  );
