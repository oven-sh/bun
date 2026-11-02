import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The layer that holds a helper is built before anybody compiles the test files: a scan of their text tells it which modules they mock.
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "helpers/there.ts": `export const bar = "real";\n`,
  "helpers/other.ts": `export const bar = "real too";\n`,
  "url.test.js": `import { expect, mock, test } from "bun:test";
import { bar } from "./helpers/there.ts";
test("the helper is named by a relative file URL", async () => {
  mock.module("file:./helpers/there.ts", () => ({ bar: 41 }));
  console.log("SEEN url | " + [(await import("./helpers/there.ts")).bar, require("./helpers/there.ts").bar, bar]);
  expect(1).toBe(1);
});
`,
  "path.test.js": `import { expect, mock, test } from "bun:test";
test("the helper is named by a relative path", async () => {
  mock.module("./helpers/other.ts", () => ({ bar: 42 }));
  console.log("SEEN path | " + [(await import("./helpers/other.ts")).bar, require("./helpers/other.ts").bar]);
  expect(1).toBe(1);
});
`,
};

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-layers-mock-by-url", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN "));
  return { seen: seen.sort(), exitCode };
}

test("a layer leaves a module to the mocks that a test names file:./", async () => {
  const [plain, one, layers] = await Promise.all([
    seenIn(undefined),
    seenIn(undefined, "--aot"),
    seenIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain).toEqual({ seen: ["SEEN path | 42,42", "SEEN url | 41,41,41"], exitCode: 0 });
  expect(one).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);
