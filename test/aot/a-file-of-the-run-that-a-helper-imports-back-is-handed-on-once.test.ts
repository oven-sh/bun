// The build of the lowest layer of a test run walks from the test files and the preloads to all that they import, and hands the list on: to the look
// for what tests replace, to the builds of the layers above, to the sum of bytes by which the run is laid out. The files that it starts from were not
// among those that it had seen, so a helper that imports a preload or a test file back put that file on the list a second time.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

async function filesLookedThrough(helper: string) {
  using dir = tempDir("aot-a-file-imported-back", {
    "package.json": `{ "name": "p" }`,
    "bunfig.toml": `[test]\npreload = ["./setup.ts"]\n`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
    "node_modules/pkg/index.js": `exports.one = 1;\n`,
    "setup.ts": `export const ready = 1;\n`,
    "helper.ts": helper,
    "a.test.ts": `import { test } from "bun:test";\nimport { help } from "./helper";\ntest("a", () => { console.error("OUT a", help()); });\n`,
    "b.test.ts": `import { test } from "bun:test";\nimport { help } from "./helper";\ntest("b", () => { console.error("OUT b", help()); });\n`,
  });
  const flags = ["--aot", "--parallel=2", "--aot-memory-limit=1KB"];
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
  const counts = [...stderr.matchAll(/^AOT test run \| scan of (\d+) files/gm)].map(match => Number(match[1]));
  return { most: Math.max(...counts), printed: stderr.split("\n").filter(line => line.startsWith("OUT b")), exitCode };
}

test("a preload and a test file", async () => {
  const [without, back] = await Promise.all([
    filesLookedThrough(`import { one } from "pkg";\nexport const help = () => 1 + one;\n`),
    filesLookedThrough(
      `import { ready } from "./setup";\nimport { one } from "pkg";\nimport "./a.test";\nexport const help = () => ready + one;\n`,
    ),
  ]);
  expect(without).toEqual({ most: expect.any(Number), printed: ["OUT b 2"], exitCode: 0 });
  expect(back).toEqual(without);
}, 120_000);
