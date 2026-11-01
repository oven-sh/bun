import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The builds of the layers begin with the names that a rough look at the test files takes for imports. In "the module's .. don't" it takes the words between
// the apostrophes for one, and the resolver called a name too long for any file system an error.
const sentence = "a word ".repeat(60);
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "a.test.js": `import { expect, test } from "bun:test";
// This is the module's ${sentence}and the tests don't import it.
test("a sentence in a comment", () => expect(1).toBe(1));
`,
  "b.test.js": `import { expect, test } from "bun:test";\ntest("another file, so that the run has pieces", () => expect(1).toBe(1));\n`,
};

test("a long sentence between two apostrophes behind `module` is not looked for on disk", async () => {
  using dir = tempDir("aot-sentence-in-a-comment", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
  const { stderr, exitCode } = await run([bunExe(), "test", "--isolate", "--aot"], String(dir), env);
  expect(stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
  expect(stderr).toContain("2 pass");
  expect(exitCode).toBe(0);
}, 180_000);
