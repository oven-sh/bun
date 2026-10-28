// A function that runs often and names a top-level function tests whether the function object is there yet, and calls a stub where it
// is not. That call makes a function object and changes no object that exists, so whatever the caller has read of its own objects
// still holds behind it. The function below fills a list with top-level functions: it reads the storage of the list once, not once
// an element.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const numberOfFunctions = 400;
// On x86-64 an element takes 80 bytes, and 93 where the storage is read again for each.
const maxBytesAnElement = 86;

function programOf(head: string) {
  const names = Array.from({ length: numberOfFunctions }, (_, index) => `f${index}`);
  return [
    ...names.map((name, index) => `${head} ${name}(a) { return a + ${index}; }`),
    `function all() { return [${names.join(", ")}]; }`,
    `let sum = 0;`,
    `for (const f of all()) sum += await f(1);`,
    `console.log(sum, all().every((f, index) => f === all()[index]));`,
  ].join("\n");
}

async function bytesAnElement(head: string) {
  using dir = tempDir("aot-a-list-of-top-level-functions", { "main.mjs": programOf(head) });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const report = join(folder, "report.json");
  const flags = ["--aot-heat=everything-is-hot", "--aot-report=" + report, "--aot-report-detail=functions"];
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.mjs", "--outfile", executable], folder, env));
  const plain = await spawned([bunExe(), "main.mjs"], folder, env);
  expect(await spawned([executable], folder, env)).toEqual({
    stdout: plain.stdout,
    stderr: "",
    exitCode: 0,
    signal: null,
  });
  const { functions } = JSON.parse(readFileSync(report, "utf8")) as {
    functions: { name: string; codeBytes: number }[];
  };
  return (
    functions.filter(({ name }) => name === "all").reduce((sum, { codeBytes }) => sum + codeBytes, 0) /
    numberOfFunctions
  );
}

describe.concurrent("a list of top-level functions reads its storage once", () => {
  test.skipIf(process.arch !== "x64").each([
    ["functions", "function"],
    ["async functions", "async function"],
  ])(
    "%s",
    (_, head) =>
      slot(async () => {
        const bytes = await bytesAnElement(head);
        expect(bytes).toBeGreaterThan(0);
        expect(bytes).toBeLessThan(maxBytesAnElement);
      }),
    300_000,
  );
});
