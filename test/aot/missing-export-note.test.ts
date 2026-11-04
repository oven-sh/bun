import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Code that the loader reads from disk links to compiled modules by their tables, and the build keeps in a table what somebody may ask it for.
// Where the build did not see that code from disk asks a module, the name may be gone. A project may catch the error and go on without a word,
// so the error says whose fault it is, and the end of the run lists the name, caught or not.
const headline = "of a name that the build left out";

async function seenWith(files: Record<string, string>, words: string | undefined) {
  using dir = tempDir("missing-export-note", files);
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...(words === undefined ? [] : ["--aot"]), "./a.test.ts"],
    String(dir),
    { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words ?? "" },
  );
  const lines = (stdout + "\n" + stderr).split("\n");
  const start = lines.findIndex(line => line.includes(headline));
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("  '"));
  return {
    seen: lines.filter(line => line.startsWith("SEEN ")),
    exitCode,
    note: start < 0 ? [] : lines.slice(start, end),
  };
}
const oneProgram = "TestRunLayers:0";

test("a name that nobody exports has the error of bun test, and nothing is listed", async () => {
  const files = {
    "package.json": `{ "name": "missing-export-note", "type": "module" }`,
    "lib.ts": `export const bound = "bound";
export const unused = "unused";`,
    "a.test.ts": `
import { test } from "bun:test";
import { writeFileSync } from "node:fs";
import { bound } from "./lib.ts";
test("files that are written while the test runs", async () => {
  console.error("SEEN compiled code reads", bound);
  for (const [file, text] of [
    ["has-1.mjs", 'export { bound } from "./lib.ts";'],
    ["has-2.mjs", 'import { unused } from "./lib.ts"; export const got = unused;'],
    ["lacks-1.mjs", 'export { never as renamed } from "./lib.ts";'],
    ["lacks-2.mjs", 'import { never } from "./lib.ts"; export const got = never;'],
  ]) {
    writeFileSync(import.meta.dir + "/" + file, text);
    try {
      console.error("SEEN", file, JSON.stringify(await import(import.meta.dir + "/" + file)));
    } catch (error) {
      console.error("SEEN", file, error.constructor.name, error.message.replaceAll(import.meta.dir, "<dir>"));
    }
  }
});`,
  };
  const [plain, ...compiled] = await Promise.all([undefined, oneProgram].map(words => seenWith(files, words)));
  expect(plain).toEqual({
    seen: [
      "SEEN compiled code reads bound",
      'SEEN has-1.mjs {"bound":"bound"}',
      'SEEN has-2.mjs {"got":"unused"}',
      "SEEN lacks-1.mjs SyntaxError export 'renamed' not found in './lib.ts'",
      "SEEN lacks-2.mjs SyntaxError Export named 'never' not found in module '<dir>/lib.ts'.",
    ],
    exitCode: 0,
    note: [],
  });
  expect(compiled).toEqual([plain]);
});

test("a misspelled import has the error of bun test, and nothing is listed", async () => {
  // The build leaves a file whose import finds nothing to the loader, which reads it from disk.
  const files = {
    "package.json": `{ "name": "missing-export-note", "type": "module" }`,
    "lib.ts": `export const bound = "bound";`,
    "imports.mjs": `import { bonud } from "./lib.ts"; console.error("SEEN never", bonud);`,
    "exports.mjs": `export { bonud } from "./lib.ts";`,
    "a.test.ts": `
import { test } from "bun:test";
import { bound } from "./lib.ts";
test("two files that misspell the name", async () => {
  console.error("SEEN compiled code reads", bound);
  for (const load of [() => import("./imports.mjs"), () => import("./exports.mjs")]) {
    try {
      await load();
    } catch (error) {
      console.error("SEEN", error.constructor.name, error.message.replaceAll(import.meta.dir, "<dir>"));
    }
  }
});`,
  };
  const [plain, ...compiled] = await Promise.all([undefined, oneProgram].map(words => seenWith(files, words)));
  expect(plain).toEqual({
    seen: [
      "SEEN compiled code reads bound",
      "SEEN SyntaxError Export named 'bonud' not found in module '<dir>/lib.ts'.",
      "SEEN SyntaxError export 'bonud' not found in './lib.ts'",
    ],
    exitCode: 0,
    note: [],
  });
  expect(compiled).toEqual([plain]);
});
