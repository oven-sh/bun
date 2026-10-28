import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const numberOfFunctions = 300;

// The functions are declared at the top level, so each has one function object at the most. A branch that is not taken hands them to code that nobody has seen,
// and elsewhere the program gives a function it does not know a displayName. What runs calls them by their names alone.
function programOf(head: string, parameters: string) {
  const names = Array.from({ length: numberOfFunctions }, (_, index) => `f${index}`);
  const awaited = head.startsWith("async") ? "await " : "";
  return [
    `const handedBack = new Function("v", "return v" + String(process.argv.length).slice(9));`,
    `handedBack(function component() {}).displayName = "Component";`,
    ...names.map(
      (name, index) =>
        `${head} ${name}(${parameters}) { let s = ${index}; for (let i = 0; i < a; i++) s += (i ^ ${index}) % 7; return s; }`,
    ),
    `if (process.argv[9]) globalThis.kept = handedBack([${names.join(", ")}]);`,
    `${head} run() {`,
    `  let sum = 0;`,
    ...names.map(name => `  sum += ${awaited}${name}(1, 2);`),
    `  return sum;`,
    `}`,
    `console.log(await run());`,
  ].join("\n");
}

async function callsByValue(head: string, parameters: string) {
  using dir = tempDir("aot-functions-made-once-called-by-name", { "main.mjs": programOf(head, parameters) });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const counts = join(folder, "counts.txt");
  built(
    await spawned(
      [bunExe(), ...compileCommand, "--aot-count-arrivals", "main.mjs", "--outfile", executable],
      folder,
      env,
    ),
  );
  const plain = await spawned([bunExe(), "main.mjs"], folder, env);
  const ran = await spawned([executable], folder, { ...env, [runtimeEnvironment.countsPath]: counts });
  expect(ran).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0, signal: null });
  // One line for each place that calls a value and each compiled function that it reached: how often, the place, the function.
  return readFileSync(counts, "utf8")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(([, place, callee]) => place?.startsWith("arrival:") && callee?.startsWith("function:"))
    .reduce((sum, [count]) => sum + Number(count), 0);
}

describe.concurrent("functions made once are called directly where unseen code may rename them", () => {
  test.each([
    ["functions", "function", "a"],
    ["async functions", "async function", "a"],
    ["functions with a parameter that nothing reads", "function", "a, unread"],
  ])(
    "%s",
    (_, head, parameters) =>
      slot(async () => expect(await callsByValue(head, parameters)).toBeLessThan(numberOfFunctions / 8)),
    300_000,
  );
});
