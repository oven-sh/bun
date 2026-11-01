import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` reads the text of a file that import() asks for on another thread, so the file runs in a later turn of the event loop, not in the jobs behind the runner's call of the test.
// What the file leaves unhandled is reported behind the jobs of that turn, and in those the test has gone on and passed. A compiled run had the file at once: the report came while the
// runner was still in its call of the test, and the test failed.
const sources = {
  "package.json": `{ "type": "module" }`,
  "src/rejects.ts": `
    console.log("rejects.ts runs");
    queueMicrotask(() => console.log("job of rejects.ts"));
    Promise.reject(new Error("rejected in rejects.ts"));
    export const v = 1;`,
  "src/throws-in-a-job.cjs": `
    console.log("throws-in-a-job.cjs runs");
    queueMicrotask(() => {
      throw new Error("thrown in a job of throws-in-a-job.cjs");
    });
    exports.v = 2;`,
};
const rejects = `test("imports a file that leaves a rejection unhandled", async () => {
      queueMicrotask(() => console.log("job of the test"));
      console.log("imported", (await import("./src/rejects.ts")).v);
    });`;
const oneTest = { ...sources, "loads.test.ts": `import { test } from "bun:test";\n${rejects}` };
const fourTests = {
  ...sources,
  "loads.test.ts": `
    import { test } from "bun:test";
    ${rejects}
    test("next", () => console.log("next"));
    test("imports a file that throws in a job", async () => {
      console.log("imported", (await import("./src/throws-in-a-job.cjs")).default.v);
    });
    test("last", () => console.log("last"));`,
};

const evaluated = {
  ...sources,
  "loads.test.ts": `
    import { test } from "bun:test";
    test("code made at run time imports the file", async () => {
      console.log("imported", (await new Function("return import('./src/rejects.ts')")()).v);
    });`,
};

async function runTests(folder: string, flags: string[], transpilesOnOneThread: boolean, words = "") {
  const env = {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_DEBUG_TEST_AOT_WORDS: words,
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: transpilesOnOneThread ? "1" : "0",
  };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, env);
  return {
    printed: stdout.replace(/^bun test .*\n/, ""),
    verdicts: stderr.replace(/ \[[\d.]+m?s\]$/gm, "").match(/^(?:\((?:pass|fail)\) .*| \d+ (?:pass|fail|errors?))$/gm),
    errors: stderr.match(/^error: .*$/gm),
    exitCode,
  };
}

test.each(["", "TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])(
  "the test that imports has passed when the rejection is reported: %s",
  async words => {
    using dir = tempDir("an-unhandled-rejection-in-an-imported-file", fourTests);
    const folder = String(dir);
    const plain = await runTests(folder, [], false);
    expect(plain.verdicts).toEqual([
      "(pass) imports a file that leaves a rejection unhandled",
      "(fail) next",
      "(fail) imports a file that throws in a job",
      "(pass) last",
      " 2 pass",
      " 2 fail",
    ]);
    expect(plain.errors).toEqual(["error: rejected in rejects.ts", "error: thrown in a job of throws-in-a-job.cjs"]);
    expect(await runTests(folder, ["--aot"], false, words)).toEqual(plain);
  },
  240_000,
);

test.each(["", "TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])(
  "so has a test in which code made at run time imports: %s",
  async words => {
    using dir = tempDir("an-unhandled-rejection-behind-evaluated-code", evaluated);
    const folder = String(dir);
    const plain = await runTests(folder, [], false);
    expect(plain.verdicts).toEqual(["(pass) code made at run time imports the file", " 1 pass", " 0 fail", " 1 error"]);
    expect(await runTests(folder, ["--aot"], false, words)).toEqual(plain);
  },
  240_000,
);

test("behind the only test the rejection is an error of the run", async () => {
  using dir = tempDir("an-unhandled-rejection-behind-the-only-test", oneTest);
  const folder = String(dir);
  const plain = await runTests(folder, [], false);
  expect(plain.verdicts?.slice(-3)).toEqual([" 1 pass", " 0 fail", " 1 error"]);
  expect(await runTests(folder, ["--aot"], false)).toEqual(plain);
}, 240_000);

test("where Bun transpiles on the thread of the program, the file runs in the jobs behind the call", async () => {
  using dir = tempDir("an-unhandled-rejection-with-one-thread", fourTests);
  const folder = String(dir);
  const plain = await runTests(folder, [], true);
  expect(plain.verdicts).toContain("(fail) imports a file that leaves a rejection unhandled");
  expect(await runTests(folder, ["--aot"], true)).toEqual(plain);
}, 240_000);
