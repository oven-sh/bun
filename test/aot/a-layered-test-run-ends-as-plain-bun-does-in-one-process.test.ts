import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string> = {
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

/**
 * `bun test` with these flags, in a copy of the project of its own: every line of both streams but the one that names the
 * version, the exit code, and each file of the project that the run has written, changed (its text) or removed (null).
 */
async function ended(...flags: string[]) {
  using dir = tempDir("aot-how-a-layered-run-ends", files);
  // Where CI is set, `bun test` writes no new snapshot. The word changes nothing: with it a compiled run says how it is built.
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
  if (flags.includes("--aot")) expectLayers(stderr);
  const printed = (text: string) =>
    text
      .replaceAll(String(dir) + sep, "DIR/")
      .split("\n")
      .filter(line => !/^(AOT test run \||bun test v)/.test(line))
      .map(line => line.replace(/ *\[[\d.]+ ?m?s\]/, "").trimEnd())
      .join("\n");
  const left = new Map(
    [...new Bun.Glob("**").scanSync({ cwd: String(dir), dot: true })].map(name => [
      name.replaceAll("\\", "/"),
      readFileSync(join(String(dir), name), "utf8"),
    ]),
  );
  const written: Record<string, string | null> = {};
  for (const name of new Set([...Object.keys(files), ...left.keys()])) {
    if (left.get(name) !== files[name]) written[name] = left.get(name) ?? null;
  }
  return { stdout: printed(stdout), stderr: printed(stderr), written, exitCode };
}

// What a failing test of the project prints above its result line.
const differsFromAStoredOne = `1 | import { test, expect } from "bun:test";
2 | test("matches a stored one", () => {
3 |   expect({ sum: 3 }).toMatchSnapshot();
4 | });
5 | test("differs from a stored one", () => {
6 |   expect({ sum: 4 }).toMatchSnapshot();
                         ^
error: expect(received).toMatchSnapshot(expected)


  {
-   "sum": 99,
+   "sum": 4,
  }


- Expected  - 1
+ Received  + 1

      at <anonymous> (DIR/stored.test.ts:6:22)`;
const failsFirst = `1 | import { test, expect } from "bun:test";
2 | test("fails first", () => {
3 |   console.log("in the first");
4 |   expect(1).toBe(2);
                ^
error: expect(received).toBe(expected)

Expected: 2
Received: 1

      at <anonymous> (DIR/z-fails.test.ts:4:13)`;
const failsLast = ` 5 | });
 6 | test("passes between", () => {
 7 |   console.log("in the second");
 8 | });
 9 | test("fails last", () => {
10 |   throw new Error("thrown in a test");
                                         ^
error: thrown in a test
      at <anonymous> (DIR/z-fails.test.ts:10:37)`;

type Ended = Awaited<ReturnType<typeof ended>>;

// Plain `bun test` runs the test files in its own process where `--parallel` comes to one worker: `--parallel=1`, or one test
// file. A run in layers runs them in worker processes whatever the flags are, and has to end as that one process does.
// Each case states what plain `bun test` prints, writes and exits with.
const cases: (Ended & { flags: string[]; startsWorkers?: boolean })[] = [
  {
    // One test file is one process, whatever `--parallel` says: the summary counts the snapshots.
    flags: ["--parallel=2", "./stored.test.ts"],
    stdout: "",
    stderr: `
stored.test.ts:
(pass) matches a stored one
${differsFromAStoredOne}
(fail) differs from a stored one

 1 pass
 1 fail
snapshots: 1 passed, 1 failed
 2 expect() calls
Ran 2 tests across 1 file.
`,
    written: {},
    exitCode: 1,
  },
  {
    // The snapshots of three files are counted together, and the two new ones are written.
    flags: ["--parallel=1", "./stored.test.ts", "./new.test.ts", "./same.test.ts"],
    stdout: "",
    stderr: `
stored.test.ts:
(pass) matches a stored one
${differsFromAStoredOne}
(fail) differs from a stored one

new.test.ts:
(pass) has none yet
(pass) inline, still empty

same.test.ts:
(pass) matches

 4 pass
 1 fail
snapshots: 3 passed, 2 added, 1 failed
 6 expect() calls
Ran 5 tests across 3 files.
`,
    written: {
      "__snapshots__/new.test.ts.snap":
        '// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`has none yet 1`] = `"new"`;\n',
      "new.test.ts": files["new.test.ts"].replace("toMatchInlineSnapshot()", "toMatchInlineSnapshot(`6`)"),
    },
    exitCode: 1,
  },
  {
    // Nothing fails, so the run exits with what a test has stored in `process.exitCode`.
    flags: ["--parallel=1", "./exit-code.test.ts", "./same.test.ts"],
    stdout: "",
    stderr: `
exit-code.test.ts:
(pass) leaves an exit code

same.test.ts:
(pass) matches

 2 pass
 0 fail
 2 snapshots, 2 expect() calls
Ran 2 tests across 2 files.
`,
    written: {},
    exitCode: 3,
  },
  {
    // No test fails and the run exits with 1: an inline snapshot could not be written.
    flags: ["--parallel=2", "./one-place.test.ts"],
    stdout: "",
    stderr: `
one-place.test.ts:
(pass) two values for one inline snapshot
3 |   for (const value of [1, 2]) expect(value).toMatchInlineSnapshot();
                                                                      ^
error: Failed to update inline snapshot: Multiple inline snapshots on the same line must all have the same value:
Expected: 1
Received: 2
    at DIR/one-place.test.ts:3:67

 1 pass
 0 fail
snapshots: +1 added
 2 expect() calls
Ran 1 test across 1 file.
`,
    written: {},
    exitCode: 1,
  },
  {
    // Here plain `bun test` starts two workers too: the run exits with 0 whatever a test has stored, and counts no snapshots.
    flags: ["--parallel=2", "./exit-code.test.ts", "./same.test.ts"],
    startsWorkers: true,
    stdout: "",
    stderr: `
exit-code.test.ts:
(pass) leaves an exit code

same.test.ts:
(pass) matches

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 2 files.
`,
    written: {},
    exitCode: 0,
  },
  {
    // The files run in the order in which they were typed, and each is named: one without tests, one whose tests `-t` leaves out.
    flags: [
      "--parallel=1",
      "-t",
      "adds|fails",
      "./z-fails.test.ts",
      "./no-tests.ts",
      "./other-names.test.ts",
      "./a-adds.test.ts",
    ],
    stdout: `in the first
in a file without tests
in a-adds
`,
    stderr: `
z-fails.test.ts:
${failsFirst}
(fail) fails first
${failsLast}
(fail) fails last

no-tests.ts:

other-names.test.ts:

a-adds.test.ts:
(pass) adds

 1 pass
 2 filtered out
 2 fail
 2 expect() calls
Ran 3 tests across 4 files.
`,
    written: {},
    exitCode: 1,
  },
  {
    // Behind the first failure no test runs: neither the rest of that file nor the file behind it.
    flags: ["--parallel=1", "--bail", "./a-adds.test.ts", "./z-fails.test.ts", "./other-names.test.ts"],
    stdout: `in a-adds
in the first
`,
    stderr: `
a-adds.test.ts:
(pass) adds

z-fails.test.ts:
${failsFirst}
(fail) fails first
Ran 2 tests across 2 files.
Bailed out after 1 failure
`,
    written: {},
    exitCode: 1,
  },
  {
    // The failures that `--bail=2` waits for are counted inside one file.
    flags: ["--parallel=4", "--bail=2", "./z-fails.test.ts"],
    stdout: `in the first
in the second
`,
    stderr: `
z-fails.test.ts:
${failsFirst}
(fail) fails first
(pass) passes between
${failsLast}
(fail) fails last
Ran 3 tests across 1 file.
Bailed out after 2 failures
`,
    written: {},
    exitCode: 1,
  },
  {
    // Each file is named once for each of its runs.
    flags: ["--parallel=1", "--rerun-each=2", "./a-adds.test.ts", "./other-names.test.ts"],
    stdout: `in a-adds
in a-adds
`,
    stderr: `
a-adds.test.ts: (run #1)
(pass) adds

a-adds.test.ts: (run #2)
(pass) adds

other-names.test.ts: (run #1)
(pass) nobody asks for this one

other-names.test.ts: (run #2)
(pass) nobody asks for this one

 4 pass
 0 fail
 2 expect() calls
Ran 4 tests across 2 files.
`,
    written: {},
    exitCode: 0,
  },
];

test.concurrent.each(cases)("bun test $flags", async ({ flags, startsWorkers, ...stated }) => {
  // Workers report when they end, so the files of a run that starts them come in any order. The rest stands still: an empty
  // line above each file, nothing above the first of those lines, and the summary behind the last file.
  const seen = (run: Ended) => {
    if (!startsWorkers) return run;
    const [above, ...files] = `\n${run.stderr}`.split("\n\n");
    const summary = files.pop();
    return { ...run, stderr: [above, ...files.sort(), summary] };
  };
  const plain = await ended(...flags);
  expect(seen(plain)).toEqual(seen(stated));
  // No build fits into this, so the run is built in layers.
  expect(seen(await ended("--aot", "--aot-memory-limit=1KB", ...flags))).toEqual(seen(plain));
});
