import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const functions = 2000;

function bundle() {
  let source = "";
  for (let index = 0; index < functions; index++)
    source += `export function f${index}(a, b) {\n  let sum = ${index};\n  for (const value of [a, b]) sum += value;\n  return { k${index}: a, sum };\n}\n`;
  return source;
}

test("a file that takes as long as all the others", async () => {
  using dir = tempDir("aot-a-file-that-takes-as-long-as-all-the-others", {
    "package.json": `{ "type": "module" }`,
    "bundle.js": bundle(),
    "other.js": `export const one = 1;\n`,
    "main.js": `import { f0, f${functions - 1} as last } from "./bundle.js";\nimport { one } from "./other.js";\nconsole.log(f0(1, 2).sum + last(3, 4).sum + one);\n`,
  });
  const directory = String(dir);
  const expected = await run([bunExe(), "main.js"], directory, bunEnv);
  expect(expected.exitCode).toBe(0);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", withThreads(4), "main.js", "--outfile", executable],
    directory,
    { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
  );
  expect(built.exitCode).toBe(0);
  expect((await run([executable], directory, bunEnv)).stdout).toBe(expected.stdout);
  const rounds = (built.stderr + built.stdout)
    .split("\n")
    .filter(line => line.startsWith("AOT round of the checker | all threads | 3 files"));
  expect(rounds.length).toBe(1);
  expect(rounds[0]).toContain("| 1 long files, a second thread beside 1 of them |");
  const packedAway = /the trees of (\d+) files packed away/.exec(rounds[0])?.[1];
  expect(Number(packedAway ?? Infinity)).toBeLessThan(3);
}, 240_000);
