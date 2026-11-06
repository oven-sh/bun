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
  "z-fails.test.ts": `import { test, expect } from "bun:test";
test("fails first", () => {
  console.log("in the first");
  expect(1).toBe(2);
});
test("passes between", () => {
  console.log("in the second");
});
test("fails last", () => {
  throw new Error("thrown in a test");
});
`,
  "a-adds.test.ts": `import { test, expect } from "bun:test";
test("adds", () => {
  console.log("in a-adds");
  expect(1 + 2).toBe(3);
});
`,
  "other-names.test.ts": `import { test } from "bun:test";
test("nobody asks for this one", () => {});
`,
  "no-tests.ts": `console.log("in a file without tests");
`,
};

async function printed(...flags: string[]) {
  using dir = tempDir("aot-how-a-layered-run-ends", files);
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
  if (flags.includes("--aot")) expectLayers(stderr);
  const lines = (text: string) =>
    text
      .replaceAll(String(dir), "DIR")
      .split("\n")
      .filter(line => !/^(AOT test run \||bun test v)/.test(line))
      .map(line => line.replace(/ *\[[\d.]+ ?m?s\]/, "").trimEnd());
  return { stdout: lines(stdout), stderr: lines(stderr), exitCode };
}

async function end(...flags: string[]) {
  const { stderr, exitCode } = await printed(...flags);
  const lines = stderr.map(line => line.trim());
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

test.concurrent.each([
  {
    flags: [
      "--parallel=1",
      "-t",
      "adds|fails",
      "./z-fails.test.ts",
      "./no-tests.ts",
      "./other-names.test.ts",
      "./a-adds.test.ts",
    ],
    inOrder: [
      "z-fails.test.ts:",
      "error: expect(received).toBe(expected)",
      "(fail) fails first",
      "error: thrown in a test",
      "(fail) fails last",
      "no-tests.ts:",
      "other-names.test.ts:",
      "a-adds.test.ts:",
      "(pass) adds",
    ],
  },
  {
    flags: ["--parallel=1", "--bail", "./a-adds.test.ts", "./z-fails.test.ts", "./other-names.test.ts"],
    inOrder: ["(pass) adds", "(fail) fails first", "Ran 2 tests across 2 files.", "Bailed out after 1 failure"],
  },
  {
    flags: ["--parallel=4", "--bail=2", "./z-fails.test.ts"],
    inOrder: ["(fail) fails first", "(pass) passes between", "(fail) fails last", "Bailed out after 2 failures"],
  },
  {
    flags: ["--parallel=1", "--rerun-each=2", "./a-adds.test.ts", "./other-names.test.ts"],
    inOrder: [
      "a-adds.test.ts: (run #1)",
      "a-adds.test.ts: (run #2)",
      "other-names.test.ts: (run #1)",
      "other-names.test.ts: (run #2)",
    ],
  },
])(
  "bun test $flags prints",
  async ({ flags, inOrder }) => {
    const plain = await printed(...flags);
    expect(plain.stderr.filter(line => inOrder.includes(line))).toEqual(inOrder);
    expect(await printed("--aot", "--aot-memory-limit=1KB", ...flags)).toEqual(plain);
  },
  240_000,
);
