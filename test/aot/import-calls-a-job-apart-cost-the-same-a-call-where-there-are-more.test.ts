import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./measures";

// In a test run the text of a module that import() asks for comes in a later turn. A call that was made j jobs behind the first call
// of its turn is made again j jobs behind the delivery. Where each call had a chain of j jobs of its own, the calls of one turn cost
// the square of their number.
// The run measures itself with process.cpuUsage(), around the calls alone.
const sizes = [500, 4_000];

function project(calls: number) {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "calls.test.mjs": `import { test } from "bun:test";
const loads = [${Array.from({ length: calls }, (_, k) => `() => import("./m${k}.mjs")`).join(", ")}];
test("calls", async () => {
  const start = process.cpuUsage();
  const calls = [];
  for (const load of loads) {
    calls.push(load());
    await null;
  }
  const sum = (await Promise.all(calls)).reduce((sum, module) => sum + module.v, 0);
  const spent = process.cpuUsage(start);
  console.log("answers", sum, "microseconds", spent.user + spent.system);
});
`,
  };
  for (let k = 0; k < calls; k++) files[`m${k}.mjs`] = `export const v = ${k};\n`;
  return files;
}

async function microseconds(calls: number, flags: string[]) {
  using dir = tempDir("aot-calls-a-job-apart", project(calls));
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./calls.test.mjs"], String(dir), bunEnv);
  const said = /^answers (\d+) microseconds (\d+)$/m.exec(stdout + stderr);
  expect({ sum: said?.[1], exitCode }).toEqual({ sum: String((calls * (calls - 1)) / 2), exitCode: 0 });
  return Number(said![2]);
}

test("what plain Bun answers", async () => {
  expect(await microseconds(sizes[0], [])).toBeGreaterThan(0);
});

test("a call costs the same where there are more", async () => {
  // The least of three runs: what else the machine does can only add.
  const least = async (calls: number) =>
    Math.min(...(await Promise.all([0, 1, 2].map(() => microseconds(calls, ["--aot"])))));
  const [small, large] = [(await least(sizes[0])) / sizes[0], (await least(sizes[1])) / sizes[1]];
  expect(large).toBeLessThanOrEqual(2 * small);
});
