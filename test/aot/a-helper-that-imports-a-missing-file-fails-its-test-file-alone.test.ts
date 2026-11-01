import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The exported instance has a layout whose chain leads to a function of the file, and the functions of a file that cannot load are left out.
test("a helper that imports a missing file fails its test file alone", async () => {
  using dir = tempDir("a-helper-that-imports-a-missing-file", {
    "package.json": `{ "type": "module" }`,
    "helper.js": `
      import { absent } from "./not-there.js";
      const Kind = function (size) { this.size = size; };
      export const made = new (class extends Kind {})();`,
    "first.test.js": `
      import { made } from "./helper.js";
      import { test } from "bun:test";
      test("never runs", () => { console.log(made); });`,
    "second.test.js": `
      import { test } from "bun:test";
      test("runs", () => { console.log("the other file ran"); });`,
  });
  const runTests = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    expect(stderr).not.toContain("internal compiler error");
    const passed = [...stderr.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]);
    return { stdout, passed, exitCode, cannotFind: stderr.includes("Cannot find module './not-there.js'") };
  };
  const plain = await runTests();
  expect(plain).toMatchObject({ passed: ["runs"], exitCode: 1, cannotFind: true });
  expect(await runTests("--aot")).toEqual(plain);
});
