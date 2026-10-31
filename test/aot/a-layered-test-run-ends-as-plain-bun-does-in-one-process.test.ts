import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": JSON.stringify({ name: "how-a-run-ends", version: "1.0.0", type: "module" }),
  "stored.test.ts": `import { test, expect } from "bun:test";
test("matches a stored one", () => {
  expect({ sum: 3 }).toMatchSnapshot();
});
test("differs from a stored one", () => {
  expect({ sum: 4 }).toMatchSnapshot();
});
`,
  "__snapshots__/stored.test.ts.snap":
    "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n" +
    'exports[`matches a stored one 1`] = `\n{\n  "sum": 3,\n}\n`;\n\n' +
    'exports[`differs from a stored one 1`] = `\n{\n  "sum": 99,\n}\n`;\n',
  "new.test.ts": `import { test, expect } from "bun:test";
test("has none yet", () => {
  expect("new").toMatchSnapshot();
});
test("inline, still empty", () => {
  expect(6).toMatchInlineSnapshot();
});
`,
  "same.test.ts": `import { test, expect } from "bun:test";
test("matches", () => {
  expect("same").toMatchSnapshot();
  expect(1).toMatchInlineSnapshot(\`1\`);
});
`,
  "__snapshots__/same.test.ts.snap":
    '// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`matches 1`] = `"same"`;\n',
  "exit-code.test.ts": `import { test } from "bun:test";
test("leaves an exit code", () => {
  process.exitCode = 3;
});
`,
  "one-place.test.ts": `import { test, expect } from "bun:test";
test("two values for one inline snapshot", () => {
  for (const value of [1, 2]) expect(value).toMatchInlineSnapshot();
});
`,
};

async function end(...flags: string[]) {
  using dir = tempDir("aot-how-a-layered-run-ends", files);
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
  if (flags.includes("--aot")) expectLayers(stderr);
  const lines = stderr.split("\n").map(line => line.replace(/ *\[[\d.]+ ?m?s\]/, "").trim());
  return { summary: lines.slice(lines.findLastIndex(line => /^\d+ pass$/.test(line))).filter(Boolean), exitCode };
}

test.concurrent.each([
  {
    flags: ["--parallel=2", "./stored.test.ts"],
    summary: ["1 pass", "1 fail", "snapshots: 1 passed, 1 failed", "2 expect() calls", "Ran 2 tests across 1 file."],
    exitCode: 1,
  },
  {
    flags: ["--parallel=1", "./stored.test.ts", "./new.test.ts", "./same.test.ts"],
    summary: [
      "4 pass",
      "1 fail",
      "snapshots: 3 passed, 2 added, 1 failed",
      "6 expect() calls",
      "Ran 5 tests across 3 files.",
    ],
    exitCode: 1,
  },
  {
    flags: ["--parallel=1", "./exit-code.test.ts", "./same.test.ts"],
    summary: ["2 pass", "0 fail", "2 snapshots, 2 expect() calls", "Ran 2 tests across 2 files."],
    exitCode: 3,
  },
  {
    flags: ["--parallel=2", "./one-place.test.ts"],
    summary: ["1 pass", "0 fail", "snapshots: +1 added", "2 expect() calls", "Ran 1 test across 1 file."],
    exitCode: 1,
  },
  {
    flags: ["--parallel=2", "./exit-code.test.ts", "./same.test.ts"],
    summary: ["2 pass", "0 fail", "2 expect() calls", "Ran 2 tests across 2 files."],
    exitCode: 0,
  },
])(
  "bun test $flags",
  async ({ flags, ...plain }) => {
    expect(await end(...flags)).toEqual(plain);
    expect(await end("--aot", "--aot-memory-limit=1KB", ...flags)).toEqual(plain);
  },
  240_000,
);
