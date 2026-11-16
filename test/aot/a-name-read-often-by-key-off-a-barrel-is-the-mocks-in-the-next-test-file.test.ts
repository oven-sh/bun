// The first test file reads a name by key off the namespace of a barrel often enough for the read to be remembered. The second lays a mock over the file behind the barrel.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const project = (lib: string, text: string, reads: number) => ({
  "package.json": `{ "name": "made-up", "type": "module" }`,
  [lib]: text,
  "barrel.mjs": `export { kept } from "./${lib}";`,
  "user.mjs": `import * as all from "./barrel.mjs";
export const look = name => all[name];`,
  "a.test.mjs": `import { test } from "bun:test";
test("a", async () => {
  const { look } = await import("./user.mjs");
  let sum = 0;
  for (let i = 0; i < ${reads}; i++) sum += look("kept");
  console.log("|", sum);
});`,
  "b.test.mjs": `import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./${lib}", () => ({ kept: 10 }));
  const { look } = await import("./user.mjs");
  console.log("|", look("kept"));
});`,
  "c.test.mjs": `import { test } from "bun:test";
test("c", async () => {
  const { look } = await import("./user.mjs");
  let sum = 0;
  for (let i = 0; i < ${reads}; i++) sum += look("kept");
  console.log("|", sum);
});`,
});

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "./a.test.mjs", "./b.test.mjs", "./c.test.mjs"],
    directory,
    bunEnv,
  );
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), exitCode };
}

for (const [name, lib, text] of [
  ["an ES file", "lib.mjs", `export const kept = 1;`],
  ["a CommonJS file", "lib.cjs", `exports.kept = 1;`],
] as const) {
  for (const reads of [1, 64]) {
    test(`${name}, read ${reads} times`, async () => {
      using dir = tempDir("a-name-read-often-by-key-off-a-barrel", project(lib, text, reads));
      const plain = await runTests(String(dir));
      expect(plain.printed[1]).toBe("| 10");
      expect(await runTests(String(dir), "--aot")).toEqual(plain);
    }, 120_000);
  }
}
