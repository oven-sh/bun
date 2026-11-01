import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// /^#/ and /\s+/g stand in a package, in a file of the project and in the test file: three programs of one realm, each with a record of its own for the pattern.
// Each keeps one RegExp for its literal, however often the literal is evaluated.
const body = `text.trim().replace(/^#/, "").replace(/\\s+/g, " ")`;
const testFile = `import { test } from "bun:test";
import { heapStats } from "bun:jsc";
import { bare as theirs } from "pkg";
import { bare } from "./src/bare";
const own = (text: string) => ${body};
test("literals", () => {
  const count = () => { Bun.gc(true); return heapStats().objectTypeCounts.RegExp ?? 0; };
  let length = theirs("#a  b").length + bare("#a  b").length + own("#a  b").length;
  const before = count();
  for (let turn = 0; turn < 1_000_000; turn++) length += theirs("#a  b" + (turn & 7)).length + bare("#a  b" + (turn & 7)).length + own("#a  b" + (turn & 7)).length;
  console.log("SEEN", length, "more RegExp cells than before:", count() - before);
}, 600000);
`;

test("no RegExp is made for a literal that has been evaluated before", async () => {
  using dir = tempDir("aot-regexp-literal-of-two-layers", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": `{}`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js" }`,
    "node_modules/pkg/index.js": `export function bare(text) { return ${body}; }\n`,
    "src/bare.ts": `export function bare(text: string): string { return ${body}; }\n`,
    "a.test.ts": testFile,
    "b.test.ts": testFile,
  });
  for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"]) {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--isolate"], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    const seen = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN"));
    expect({ words, exitCode, seen }).toEqual({
      words,
      exitCode: 0,
      seen: Array(2).fill("SEEN 12000009 more RegExp cells than before: 0"),
    });
  }
}, 600000);
