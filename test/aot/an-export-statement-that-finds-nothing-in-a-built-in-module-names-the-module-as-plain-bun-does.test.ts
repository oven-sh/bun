import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string> = {
  "package.json": `{ "name": "names-that-built-in-modules-lack" }`,
  "plain.mjs": `export { absent } from "fs";\n`,
  "renamed.mjs": `export { absent as renamed, readFileSync } from "fs";\n`,
  "prefixed.mjs": `export { absent } from "node:fs";\n`,
  "path.mjs": `export { absent } from "path";\n`,
  "with-a-slash.mjs": `export { absent } from "fs/promises";\n`,
  "another-name.mjs": `export { absent } from "sys";\n`,
  "of-bun.mjs": `export { absent } from "bun:sqlite";\n`,
  "imported-then-exported.mjs": `import { absent } from "fs";\nexport { absent };\n`,
  "imported.mjs": `import { absent } from "fs";\nconsole.log(absent);\n`,
  "found.mjs": `export { readFileSync as read } from "fs";\n`,
  "loads.test.mjs": `import { test } from "bun:test";
const say = async (label, load) => {
  let said;
  try {
    said = "loaded " + Object.keys(await load());
  } catch (error) {
    said = error.name + " " + error.message;
  }
  console.log(label, "|", said);
};
await say("without the prefix", () => import("./plain.mjs"));
await say("under another name", () => import("./renamed.mjs"));
await say("with the prefix", () => import("./prefixed.mjs"));
await say("another module", () => import("./path.mjs"));
await say("a name with a slash", () => import("./with-a-slash.mjs"));
await say("another name for a module", () => import("./another-name.mjs"));
await say("a module of Bun", () => import("./of-bun.mjs"));
await say("imported, then exported", () => import("./imported-then-exported.mjs"));
await say("imported", () => import("./imported.mjs"));
await say("found", () => import("./found.mjs"));
test("ran", () => {});
`,
};

test("it says what plain Bun says, as one program and in layers", async () => {
  using dir = tempDir("aot-export-statement-finds-nothing-in-a-built-in-module", files);
  const directory = String(dir);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags], directory, env);
    return {
      lines: ran.stdout.split("\n").filter(line => line.includes(" | ")),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain.summary).toEqual([" 1 pass", " 0 fail"]);
  expect(plain.lines.length).toBe(10);
  expect(plain.lines).toContain("without the prefix | SyntaxError export 'absent' not found in 'node:fs'");
  expect(plain.lines).toContain("another name for a module | SyntaxError export 'absent' not found in 'node:util'");
  expect(plain.lines).toContain("found | loaded read");
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
