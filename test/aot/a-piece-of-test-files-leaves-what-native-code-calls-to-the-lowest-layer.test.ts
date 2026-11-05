import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Native code calls code of Bun's own on behalf of a built-in: for `Promise` it reports a rejection that nobody handles, with process.emitWarning, the queue of
// process.nextTick and what those use. It takes all of that from the first image of the realm, so a program of test files above the layers holds none of it.
const files: Record<string, string> = {
  "tsconfig.json": "{}",
  "src/lib.ts": `export const later: any = async () => 1;\n`,
  "ticks.test.ts": `import { test } from "bun:test";
import { later } from "./src/lib";
test("ticks", async () => {
  const seen: string[] = [];
  await new Promise<void>(done => {
    setTimeout(() => { seen.push("timeout"); done(); }, 20);
    setImmediate(() => seen.push("immediate"));
    process.nextTick((a: string, b: string) => seen.push("tick " + a + b), "x", "y");
    Promise.resolve().then(() => seen.push("then"));
    queueMicrotask(() => seen.push("microtask"));
    seen.push("first");
  });
  console.log("SAID ticks", seen.join(), await later());
});
`,
  "warnings.test.ts": `import { test } from "bun:test";
test("warnings", async () => {
  const got: string[] = [];
  const on = (warning: Error) => got.push(warning.name + ": " + warning.message);
  process.on("warning", on);
  process.emitWarning("careful");
  process.emitWarning("old", "DeprecationWarning", "DEP0");
  await new Promise(resolve => setTimeout(resolve, 20));
  process.off("warning", on);
  console.log("SAID warnings", got.join(" | "));
});
`,
  "promises.test.ts": `import { test } from "bun:test";
import { later } from "./src/lib";
test("promises", async () => {
  const all = await Promise.all([later(), 2, Promise.resolve(3)]);
  const settled = await Promise.allSettled([later(), Promise.reject(new Error("no"))]);
  const raced = await Promise.race([new Promise(resolve => setTimeout(resolve, 50, "slow")), later()]);
  const any = await Promise.any([Promise.reject(new Error("a")), later()]);
  let sum = 0;
  for await (const x of [later(), 2]) sum += x;
  const { promise, resolve } = Promise.withResolvers<number>();
  resolve(7);
  const caught = await Promise.reject(new Error("caught")).catch(error => error.message);
  console.log("SAID promises", JSON.stringify(all), settled.map(it => it.status).join(), raced, any, sum, await promise, caught);
  console.log("SAID Promise", typeof Promise, later() instanceof Promise, Promise.name, Promise.length);
});
`,
  "await.test.ts": `import { test } from "bun:test";
import { later } from "./src/lib";
test("await", async () => {
  console.log("SAID await", await later(), await 2, await { then(resolve: (value: number) => void) { resolve(3); } });
});
`,
};

test("it says what plain Bun says, and holds little of Bun's own code", async () => {
  using dir = tempDir("aot-piece-without-what-native-code-calls", files);
  const directory = String(dir);
  const said = async (flags: string[], more: Record<string, string>) => {
    const env = { ...bunEnv, ...more, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags, "--isolate", "--parallel=1", "."], directory, env);
    const lines = (ran.stdout + "\n" + ran.stderr).split("\n");
    return {
      output: {
        lines: lines.filter(line => line.startsWith("SAID")).sort(),
        summary: lines.filter(line => /^ *\d+ (pass|fail)$/.test(line)),
      },
      form: lines.filter(line => line.startsWith("AOT test run | layers")),
      libraryFiles: lines
        .flatMap(line => /^AOT part build \| files of Bun's own code compiled \| (\d+)/.exec(line)?.[1] ?? [])
        .map(Number),
    };
  };
  const plain = await said([], {});
  expect(plain.output.summary).toEqual([" 4 pass", " 0 fail"]);
  expect(plain.output.lines).toEqual([
    "SAID Promise function true Promise 1",
    "SAID await 1 2 3",
    "SAID promises [1,2,3] fulfilled,rejected 1 1 3 7 caught",
    "SAID ticks first,tick xy,then,microtask,immediate,timeout 1",
    "SAID warnings Warning: careful | DeprecationWarning: old",
  ]);
  expect((await said(["--aot"], { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" })).output).toEqual(plain.output);
  const layered = await said(["--aot"], {
    BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
    BUN_JSC_logAOTPhaseTimes: "1",
  });
  expect(layered.output).toEqual(plain.output);
  expect(layered.form.length).toBe(1);
  expect(layered.form[0]).toStartWith("AOT test run | layers 2 | test files 4 | to a program 1");
  expect(layered.libraryFiles.length).toBe(4);
  // With what native code calls for Promise each of them held 34.
  expect(Math.max(...layered.libraryFiles)).toBeLessThan(20);
}, 240_000);
