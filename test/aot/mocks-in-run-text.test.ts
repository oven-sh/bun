import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test holds code as text and runs it, and the code mocks a module under a path that the text does not spell. The build reads the text: any module may be mocked
// then. A text that only goes into a file which nothing can run opens none.
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");
const importsFiller = `import { filler1 } from "./filler.mjs"; void filler1;\n`;
const code = "`Bun.jest(globalThis.libPath).mock.module(globalThis.libPath, () => ({ answer: () => 'mocked' }))`";
const project = (imports: string, runs: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "filler.mjs": filler,
  "lib.js": `export function answer() { return "real"; }`,
  "a.test.js": `${importsFiller}import { test } from "bun:test";
${imports}
globalThis.libPath = import.meta.dir + "/lib.js";
const code = ${code};
test("a", async () => {
  ${runs}
  console.log("SEEN a " + (await import("./lib.js")).answer());
});`,
  // The next test file of the realm mocks nothing.
  "z.test.js": `${importsFiller}import { test } from "bun:test";
import { answer } from "./lib.js";
test("z", async () => console.log("SEEN z " + answer() + " " + (await import("./lib.js")).answer()));`,
});

async function printed(dir: string, flags: string[], words: string) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
  const { stdout, stderr } = await run([bunExe(), "test", "--parallel=1", "--no-isolate", ...flags], dir, env);
  return (stdout + "\n" + stderr).split("\n");
}
const seen = (lines: string[]) => lines.filter(line => line.startsWith("SEEN"));
// Bun's own library is a build of its own, of hundreds of files.
const mayBeMocked = (lines: string[]) =>
  lines
    .map(line => line.match(/may replace \d+ in (\d+) files \| modules that may be mocked (\d+)/))
    .filter(found => found && Number(found[1]) < 100)
    .reduce((sum, found) => sum + Number(found![2]), 0);

const ways = {
  "an indirect eval": ["", `(0, eval)(code);`],
  "the URL of a Blob": ["", `await import(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));`],
  "a module object": [
    `import Module from "node:module";`,
    `new Module(import.meta.dir + "/virtual.cjs")._compile(code, import.meta.dir + "/virtual.cjs");`,
  ],
};
test.each(Object.keys(ways))(
  "%s runs the text",
  async way => {
    using dir = tempDir("aot-mocks-in-run-text", project(...(ways[way as keyof typeof ways] as [string, string])));
    const plain = seen(await printed(String(dir), [], ""));
    expect(plain[0]).toBe("SEEN a mocked");
    expect(plain.length).toBe(2);
    const one = await printed(String(dir), ["--aot"], "TestRunLayers:0");
    expect(seen(one)).toEqual(plain);
    expect(mayBeMocked(one)).toBeGreaterThan(0);
    const layers = await printed(String(dir), ["--aot", "--aot-memory-limit", "1MB"], "TestRunSaysItsForm");
    expect(layers.filter(line => line.startsWith("AOT test run |")).join()).toContain("| layers 2 |");
    expect(seen(layers)).toEqual(plain);
  },
  600000,
);

test("the text goes into a file that nothing can run", async () => {
  const writes = `writeFileSync(import.meta.dir + "/notes.txt", code);`;
  using dir = tempDir("aot-mocks-in-run-text", project(`import { writeFileSync } from "node:fs";`, writes));
  const plain = seen(await printed(String(dir), [], ""));
  expect(plain[0]).toBe("SEEN a real");
  const one = await printed(String(dir), ["--aot"], "TestRunLayers:0");
  expect(seen(one)).toEqual(plain);
  expect(mayBeMocked(one)).toBe(0);
}, 600000);
