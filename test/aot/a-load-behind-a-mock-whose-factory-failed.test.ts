import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const modules = Object.fromEntries(
  ["imported", "required", "mixed", "answers-nothing", "rejects", "named"].map(name => [
    `src/${name}.ts`,
    `console.log("the body of ${name} runs"); export const v = "real v";`,
  ]),
);

const files = {
  "package.json": `{ "name": "a-load-behind-a-mock-whose-factory-failed" }`,
  ...modules,
  "failed.test.ts": `
    import { test, mock } from "bun:test";
    const say = (label: string, f: () => unknown) =>
      Promise.resolve().then(f).then(v => console.log(label, String(v)), e => console.log(label, e.constructor.name, e.message));
    const fails = () => { throw new RangeError("from the factory"); };
    test("import()", async () => {
      mock.module("./src/imported.ts", fails);
      for (const turn of [1, 2, 3]) await say("import " + turn, async () => (await import("./src/imported.ts")).v);
    });
    test("require()", async () => {
      mock.module("./src/required.ts", fails);
      for (const turn of [1, 2, 3]) await say("require " + turn, () => require("./src/required.ts").v);
    });
    test("one after the other", async () => {
      mock.module("./src/mixed.ts", fails);
      await say("mixed require", () => require("./src/mixed.ts").v);
      await say("mixed import", async () => (await import("./src/mixed.ts")).v);
      await say("mixed require again", () => require("./src/mixed.ts").v);
    });
    test("a factory that answers no object", async () => {
      mock.module("./src/answers-nothing.ts", () => undefined as any);
      for (const turn of [1, 2, 3]) await say("nothing " + turn, async () => (await import("./src/answers-nothing.ts")).v);
    });
    test("a factory whose promise is rejected", async () => {
      mock.module("./src/rejects.ts", () => Promise.reject(new RangeError("rejected")));
      for (const turn of [1, 2, 3]) await say("rejects " + turn, async () => (await import("./src/rejects.ts")).v);
    });
    test("a factory with names of its own", async () => {
      const factory = Object.assign(() => { throw new RangeError("from the factory"); }, { v: "of the function" });
      mock.module("./src/named.ts", factory);
      for (const turn of [1, 2]) await say("named " + turn, async () => (await import("./src/named.ts")).v);
    });`,
};

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, ""), exitCode };
}

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("%s", async (_, words) => {
  using directory = tempDir("a-load-behind-a-mock-whose-factory-failed", files);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain("import 1 RangeError from the factory\nimport 2 undefined\nimport 3 undefined");
  expect(plain.printed).not.toContain("runs");
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
