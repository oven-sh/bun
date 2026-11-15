import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./measures";

// In a test run an import() that fails costs the same however many files have failed before.
// The run measures itself with process.cpuUsage(), which some systems count in steps of 16 milliseconds.
const sizes = [500, 6_000];
const step = 16_000;

function project(calls: number) {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "fails.test.mjs": `import { test } from "bun:test";
const imports = [${Array.from({ length: calls }, (_, k) => `() => import("./importer${k}.mjs")`).join(", ")}];
test("fails", async () => {
  const start = process.cpuUsage();
  let caught = 0;
  for (const load of imports) {
    try {
      await load();
    } catch (error) {
      caught += error.message === "thrown";
    }
  }
  const spent = process.cpuUsage(start);
  console.log("answers", caught, "microseconds", spent.user + spent.system);
});
`,
  };
  for (let k = 0; k < calls; k++) {
    files[`importer${k}.mjs`] = `import "./throws${k}.cjs";\n`;
    files[`throws${k}.cjs`] = `throw new Error("thrown");\n`;
  }
  return files;
}

// The least of three runs: what else the machine does can only add.
async function microseconds(calls: number) {
  using dir = tempDir("aot-failed-import-cost", project(calls));
  const runs = [];
  for (let times = 0; times < 3; ++times) {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--aot", "./fails.test.mjs"],
      String(dir),
      bunEnv,
    );
    const said = /^answers (\d+) microseconds (\d+)$/m.exec(stdout + stderr);
    expect([said?.[1], exitCode]).toEqual([String(calls), 0]);
    runs.push(Number(said![2]));
  }
  return Math.min(...runs);
}

test("an import() that fails costs the same behind more failures", async () => {
  const small = await microseconds(sizes[0]);
  expect(await microseconds(sizes[1])).toBeLessThanOrEqual(1.7 * (sizes[1] / sizes[0]) * Math.max(small, step));
});
