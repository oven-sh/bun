import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `TestRunLayers:<n>` cuts what the test files import into n programs that stand one above the other, and a worker loads them all
// into one realm. How many there are changes nothing that a test sees. Each file below imports the one before it, so each can be a
// program of its own, and each does what needs the program of a value to be found again: a method and a static field of a class, a
// namespace object, an import() by a path that is put together, a frame in a stack trace.
const steps = 20;

const step = (n: number) => `import * as below from "./step${n - 1}";
  import { Step${n - 1}, climb as climbBelow, fail as failBelow } from "./step${n - 1}";
  globalThis.ran.push(${n});
  export class Step${n} extends Step${n - 1} {
    static made = 0;
    static count() { return Step${n}.made + Step${n - 1}.count(); }
    #mark = ${n};
    constructor() { super(); Step${n}.made++; }
    sum() { return this.#mark + super.sum(); }
    get name${n}() { return "step${n}"; }
  }
  export let calls = 0;
  export const climb = () => (calls++, climbBelow() + ${n});
  export function fail(depth: number): number { return failBelow(depth) + 1; }
  export const callsBelow = () => below.calls;
  export const keysBelow = () => Object.keys(below).join();
  export const load = (name: string) => import(name);`;

const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "src/step0.ts": `(globalThis.ran ??= []).push(0);
    export class Step0 { static made = 0; static count() { return Step0.made; } constructor() { Step0.made++; } sum() { return 0; } }
    export let calls = 0;
    export const climb = () => (calls++, 0);
    export function fail(depth: number): number { throw new RangeError("from the lowest of " + depth); }`,
  "top.test.ts": `import { test } from "bun:test";
    import { join } from "node:path";
    import * as top from "./src/step${steps}";
    import * as middle from "./src/step${steps >> 1}";
    test("classes", () => {
      const object = new top.Step${steps}();
      new middle.Step${steps >> 1}();
      console.log("classes", object.sum(), top.Step${steps}.count(), middle.Step${steps >> 1}.made, object.name1, object.name${steps >> 1}, object.name${steps}, object instanceof middle.Step${steps >> 1});
    });
    test("variables", () => {
      for (let i = 0; i < 100; i++) top.climb();
      middle.climb();
      console.log("variables", top.climb(), top.calls, top.callsBelow(), middle.calls, middle.callsBelow(), middle.keysBelow());
    });
    test("imports", async () => {
      const loaded = await Promise.all([1, ${steps >> 1}, ${steps}].map(n => middle.load(join(import.meta.dir, "src", "step" + n + ".ts"))));
      console.log("imports", loaded[1] === middle, loaded[2] === top, loaded.map(module => module.calls).join(), globalThis.ran.join());
    });
    test("frames", () => {
      Error.stackTraceLimit = 100;
      try { top.fail(${steps}); } catch (error) {
        const frames = (error as Error).stack!.split("\\n").filter(line => line.includes("/src/")).map(line => line.replace(/^.*\\/src\\//, "").replace(/\\)$/, ""));
        console.log("frames", (error as Error).message, frames.length, frames.join());
      }
    });`,
};
for (let n = 1; n <= steps; n++) files[`src/step${n}.ts`] = step(n);

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr.slice(-4000));
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  const layers = stderr.match(/^AOT test run \| layers (\d+) /m)?.[1];
  // How many of the files of the project went to each program between the packages and the last.
  const went = [...stderr.matchAll(/the lowest files are found: (\d+) of \d+ files/g)].map(match => +match[1]);
  return {
    layers,
    empty: went.filter(files => !files).length,
    seen: { stdout: printed.sort(), results: results.sort(), exitCode },
  };
}

test("a test sees the same however many programs stand below it", async () => {
  using dir = tempDir("aot-a-test-run-in-more-than-eight-programs", files);
  const plain = await runTests(String(dir), "");
  expect(plain.seen.results).toEqual(["pass classes", "pass frames", "pass imports", "pass variables"]);
  expect(plain.seen.exitCode).toBe(0);
  expect(plain.seen.stdout.find(line => line.startsWith("frames"))).toStartWith(
    `frames from the lowest of ${steps} ${steps + 1} step0.ts`,
  );

  // A build takes a few seconds however little it builds, and these stand in a row: one run, with more programs than any table or bit field held.
  expect(await runTests(String(dir), "TestRunLayers:17", "--aot")).toEqual({
    layers: "17",
    empty: 0,
    seen: plain.seen,
  });
}, 600_000);
