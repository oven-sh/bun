import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./measures";

// A call of mock.module(), and an import() of what it mocks, cost the same however many modules the program has.
// The run measures itself with process.cpuUsage(), which some systems count in steps of 16 milliseconds.
const sizes = [500, 8_000];
const mocks = 500;
const step = 16_000;

function project(modules: number) {
  const others = Array.from({ length: modules }, (_, k) => `./m${k}.mjs`);
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "others.mjs":
      others.map((name, k) => `import { v as v${k} } from "${name}";\n`).join("") +
      `export const last = v${modules - 1};\n`,
    "mocks.test.mjs": `import { mock, test } from "bun:test";
import { last } from "./others.mjs";
const mocks = [${Array.from({ length: mocks }, (_, k) => `() => mock.module("./mocked${k}.mjs", () => ({ v: ${k} }))`).join(", ")}];
const imports = [${Array.from({ length: mocks }, (_, k) => `() => import("./mocked${k}.mjs")`).join(", ")}];
test("mocks", async () => {
  const start = process.cpuUsage();
  let sum = 0;
  for (let k = 0; k < ${mocks}; k++) {
    mocks[k]();
    sum += (await imports[k]()).v;
  }
  const spent = process.cpuUsage(start);
  console.log("answers", sum, last, "microseconds", spent.user + spent.system);
});
`,
  };
  others.forEach((name, k) => (files[name.slice(2)] = `export const v = ${k};\n`));
  for (let k = 0; k < mocks; k++) files[`mocked${k}.mjs`] = `export const v = -1;\n`;
  return files;
}

// The least of three runs: what else the machine does can only add.
async function microseconds(modules: number) {
  using dir = tempDir("aot-mock-cost", project(modules));
  const runs = [];
  for (let times = 0; times < 3; ++times) {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--aot", "./mocks.test.mjs"],
      String(dir),
      bunEnv,
    );
    const said = /^answers (\d+) (\d+) microseconds (\d+)$/m.exec(stdout + stderr);
    expect([said?.[1], said?.[2], exitCode]).toEqual([String((mocks * (mocks - 1)) / 2), String(modules - 1), 0]);
    runs.push(Number(said![3]));
  }
  return Math.min(...runs);
}

test("a mock costs the same beside more modules", async () => {
  const small = await microseconds(sizes[0]);
  expect(await microseconds(sizes[1])).toBeLessThanOrEqual(2 * Math.max(small, step));
});
