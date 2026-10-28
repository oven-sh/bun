import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const numberOfFunctions = 1200;

// A function that is declared at the top level of a module has one function object, which is made when something first asks for it. Here a function that runs twice asks for each of them.
function programOf(head: string) {
  const names = Array.from({ length: numberOfFunctions }, (_, index) => `f${index}`);
  return [
    ...names.map((name, index) => `${head} ${name}(a) { return a + ${index}; }`),
    `function all() { return [${names.join(", ")}]; }`,
    `const first = all();`,
    `const second = all();`,
    `let sum = 0;`,
    `for (const f of first) sum += await f(1);`,
    `console.log(sum, first.every((f, index) => f === second[index] && f.name === "f" + index && f.length === 1));`,
  ].join("\n");
}

async function callsOfRunTime(head: string, flags: string[]) {
  using dir = tempDir("aot-function-objects-of-top-level-functions", { "main.mjs": programOf(head) });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const counts = join(folder, "counts.txt");
  built(
    await spawned(
      [bunExe(), ...compileCommand, "--aot-count-arrivals", ...flags, "main.mjs", "--outfile", executable],
      folder,
      env,
    ),
  );
  const plain = await spawned([bunExe(), "main.mjs"], folder, env);
  const ran = await spawned([executable], folder, { ...env, [runtimeEnvironment.countsPath]: counts });
  expect(ran).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0, signal: null });
  const line = readFileSync(counts, "utf8")
    .split("\n")
    .find(line => line.endsWith("\toperation:operationAOTSingletonClosure"));
  return Number(line?.split("\t")[0] ?? 0);
}

// The run time makes the first of them, and one more whenever the allocator has to be given new cells.
describe.concurrent("function objects of top-level functions are made without the run time", () => {
  test.each([
    ["functions", "function", []],
    ["async functions", "async function", []],
    ["where all code counts as cold", "function", ["--aot-heat=everything-is-cold"]],
    ["where all code counts as hot", "function", ["--aot-heat=everything-is-hot"]],
    ["async functions where all code counts as hot", "async function", ["--aot-heat=everything-is-hot"]],
  ])(
    "%s",
    (_, head, flags) => slot(async () => expect(await callsOfRunTime(head, flags)).toBeLessThan(numberOfFunctions / 8)),
    300_000,
  );
});
