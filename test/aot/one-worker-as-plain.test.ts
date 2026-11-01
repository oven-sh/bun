import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// With `--parallel=1` plain `bun test` runs every file in its own process, one after another. A compiled run that is too large for one program runs them
// in worker processes, a part of the files each. With one worker it ends and orders as plain does.

const filler = (count: number) =>
  Array.from({ length: count }, (_, index) => `export function filler${index}(x) { return x + ${index}; }\n`).join("");

test("--bail leaves the snapshot file as it was", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const before = header + '\nexports[`one 1`] = `"old"`;\n\nexports[`removed 1`] = `"old"`;\n';
  const file = `import { filler1 } from "./filler.mjs";
import { expect, test } from "bun:test";
test("one", () => { expect("new").toMatchSnapshot(); });
test("fails", () => { expect(filler1(1)).toBe(0); });
test("behind", () => { console.log("ROW behind the failure"); });
`;
  const update = async (flags: string[]) => {
    using dir = tempDir("aot-bail-keeps-snapshots", {
      "package.json": `{ "name": "bail-keeps-snapshots" }`,
      // Too much for a build in a megabyte, so the run takes layers by itself.
      "filler.mjs": filler(6000),
      "a.test.ts": file,
      "b.test.ts": file,
      "__snapshots__/a.test.ts.snap": before,
    });
    const env = { ...bunEnv, NO_COLOR: "1", CI: "false", BUN_JSC_logAOTPhaseTimes: "1" };
    const command = [bunExe(), "test", ...flags, "--parallel=1", "--update-snapshots", "--bail"];
    const { stdout, stderr, exitCode } = await run(command, String(dir), env);
    return {
      form: stderr.match(/^AOT test run \| (one program|layers \d+)/m)?.[1],
      exitCode,
      snap: readFileSync(join(String(dir), "__snapshots__/a.test.ts.snap"), "utf8"),
      ranBehindTheFailure: (stdout + stderr).includes("ROW behind the failure"),
    };
  };
  const plain = await update([]);
  expect(plain).toEqual({ form: undefined, exitCode: 1, snap: before, ranBehindTheFailure: false });
  expect(await update(["--aot", "--aot-memory-limit", "1MB"])).toEqual({ ...plain, form: "layers 2" });
}, 240_000);

test("the files run in plain's order, whichever part is built first", async () => {
  const file = (name: string, imported: string) => `import { filler1 } from "./${imported}.mjs";
import { test } from "bun:test";
test("${name}", () => { filler1(1); });
`;
  using dir = tempDir("aot-one-worker-order", {
    "package.json": `{ "name": "one-worker-order" }`,
    "small.mjs": filler(2),
    // It is a file of the first part alone, whose build so ends last.
    "a.test.ts": filler(4000).replaceAll("export function filler", "function local") + file("a", "small"),
    "b.test.ts": file("b", "small"),
    "c.test.ts": file("c", "small"),
    "d.test.ts": file("d", "small"),
  });
  const orderOf = async (flags: string[], words?: string) => {
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stderr, exitCode } = await run([bunExe(), "test", ...flags, "--parallel=1"], String(dir), env);
    return { order: [...stderr.matchAll(/^\(pass\) (\w+)/gm)].map(match => match[1]).join(""), exitCode };
  };
  const plain = await orderOf([]);
  expect(plain).toEqual({ order: "abcd", exitCode: 0 });
  expect(await orderOf(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
