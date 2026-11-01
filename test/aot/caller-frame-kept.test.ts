// `vi.importActual("./dep")`, `jest.requireActual("./dep")`, `vi.doMock("./dep", ..)`, `expect(a).toMatchInlineSnapshot()`: native code of the test runner
// finds the file or the position of the call in the frame of its caller. In a test run Bun's transpiler prints none of them as a tail call, which
// would drop that frame, so a compiled test run makes none either. Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const project = {
  "package.json": `{}`,
  "dep.ts": `export const where = "beside the test file";`,
  "dep.cjs": `exports.where = "beside the test file";`,
  "sub/dep.ts": `export const where = "beside the helper";`,
  "sub/dep.cjs": `exports.where = "beside the helper";`,
  "sub/helper.ts": `import { expect, jest, vi } from "bun:test";
    export const arrow = () => vi.importActual<any>("./dep");
    export const throughName = () => { const loaded = vi.importActual<any>("./dep"); return loaded; };
    export function declared() { return vi.importActual<any>("./dep"); }
    export const either = (yes: boolean) => (yes ? vi.importActual<any>("./dep") : null);
    export const behindAnd = (yes: boolean) => yes && vi.importActual<any>("./dep");
    export const asserted = () => vi.importActual("./dep") as Promise<any>;
    export const mocked = () => vi.importMock<any>("./dep");
    export const required = () => jest.requireActual("./dep.cjs");
    export const requiredMock = () => jest.requireMock("./dep.cjs");
    export const made = () => jest.createMockFromModule("./dep.cjs") as any;
    export const mockIt = () => vi.doMock("./dep", () => ({ where: "mocked" }));
    export const unmockIt = () => vi.doUnmock("./dep");
    export const withoutName = () => vi.unmock();
    export const snapshot = (value: unknown) => expect(value).toMatchInlineSnapshot();
    export const snapshotOfError = (thrower: () => void) => expect(thrower).toThrowErrorMatchingInlineSnapshot();`,
  "1.test.ts": `import { test } from "bun:test";
    import * as helper from "./sub/helper";
    import "./dep";
    import "./dep.cjs";
    test("loads", async () => {
      for (const name of ["arrow", "throughName", "declared", "asserted", "mocked", "required", "requiredMock", "made"] as const)
        console.log(name + ":", (await helper[name]()).where);
      console.log("either:", (await helper.either(true)).where, "behindAnd:", (await helper.behindAnd(true)).where);
    });
    test("mocks", async () => {
      helper.mockIt();
      console.log("mocked:", (await import("./sub/dep")).where, ".", (await import("./dep")).where);
      helper.unmockIt();
    });
    test("frames", () => {
      try {
        helper.withoutName();
      } catch (error) {
        console.log((error as Error).stack!.split("\\n").slice(1, 3).map(line => line.trim().split(" ")[1]).join(" < "));
      }
    });
    test("snapshots in another file", () => {
      for (const ask of [() => helper.snapshot(1), () => helper.snapshotOfError(() => { throw new Error("boom"); })]) {
        try {
          ask();
          console.log("taken");
        } catch (error) {
          console.log(String((error as Error).message).split("\\n").filter(line => line.trim()).slice(0, 2).join(" | "));
        }
      }
    });`,
  "2.test.ts": `import { expect, test } from "bun:test";
    const check = (value: unknown) => expect(value).toMatchInlineSnapshot();
    const throughName = (value: unknown) => { const result = expect(value).toMatchInlineSnapshot(); return result; };
    test("snapshots", () => {
      check(1);
      throughName("two");
    });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
];

async function runTests(env: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("caller-frame-kept", project);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--update-snapshots", ...flags], String(dir), {
    ...bunEnv,
    ...env,
  });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { printed, results, exitCode, written: readFileSync(join(String(dir), "2.test.ts"), "utf8") };
}

test.each(ways)("%s", async (_, env) => {
  const plain = await runTests({});
  expect(plain.results).toEqual([
    "pass loads",
    "pass mocks",
    "pass frames",
    "pass snapshots in another file",
    "pass snapshots",
  ]);
  expect(plain.printed).toContain("arrow: beside the helper");
  expect(plain.written).toContain("toMatchInlineSnapshot(`1`)");
  expect(await runTests(env, "--aot")).toEqual(plain);
});
