import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const runTests = async (files: Record<string, string>) => {
  using directory = tempDir("originals-come-from-disk", {
    "package.json": `{ "name": "p", "type": "module" }`,
    ...files,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), bunEnv);
  const all = stdout + "\n" + stderr;
  return { said: all.split("\n").filter(line => line.startsWith("SAID ")), all };
};

const kinds = {
  "an ES module": { name: "lib.mjs", text: (value: string) => `export const read = () => "${value}";` },
  "a CommonJS file": { name: "lib.cjs", text: (value: string) => `exports.read = () => "${value}";` },
};
const requests = {
  "vi.importActual()": (name: string) =>
    `vi.doMock("./${name}", () => ({}));\n  const lib = await vi.importActual("./${name}");`,
  "a partial mock": (name: string) =>
    `vi.doMock("./${name}", async original => ({ ...(await original()) }));\n  const lib = await import("./${name}");`,
  "a spy": (name: string) => `vi.doMock("./${name}", { spy: true });\n  const lib = await import("./${name}");`,
};
const rows = Object.entries(kinds).flatMap(([kind, file]) =>
  Object.entries(requests).map(([request, lay]) => [kind, request, file, lay] as const),
);

test.each(rows)(
  "the original of %s that the test has written comes from disk, by %s",
  async (_, __, { name, text }, lay) => {
    const { said, all } = await runTests({
      [name]: text("as built"),
      "a.test.mjs": `import { test, vi } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", async () => {
  writeFileSync(import.meta.dir + "/${name}", ${JSON.stringify(text("written by the test"))});
  ${lay(name)}
  console.log("SAID", lib.read());
});`,
    });
    expect(said).toEqual(["SAID written by the test"]);
    expect(all).toContain(" 1 pass");
    expect(all).toContain(`  ${name}?actual`);
  },
);

test("and so does that of a file that an earlier test file has written", async () => {
  const { said, all } = await runTests({
    "lib.mjs": `export const value = "as built";`,
    "a.test.mjs": `import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", () => writeFileSync(import.meta.dir + "/lib.mjs", 'export const value = "written by a test";'));`,
    "b.test.mjs": `import { test, vi } from "bun:test";
import { value } from "./lib.mjs";
vi.mock("./lib.mjs", async original => ({ ...(await original()) }));
test("b", () => console.log("SAID", value));`,
  });
  expect(said).toEqual(["SAID written by a test"]);
  expect(all).toContain(" 2 pass");
  expect(all).toContain("  lib.mjs?actual");
});
