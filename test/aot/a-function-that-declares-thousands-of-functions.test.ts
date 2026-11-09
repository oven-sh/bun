import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const declaredFunctions = 3000;

function bundle() {
  let source = "export function all() {\n";
  for (let index = 0; index < declaredFunctions; index++)
    source += `  function f${index}(a, b) { return { k${index}: a, sum: a + b + ${index} }; }\n`;
  source += "  let sum = 0;\n";
  for (let index = 0; index < declaredFunctions; index += 100) source += `  sum += f${index}(${index}, 1).sum;\n`;
  return source + "  return sum;\n}\n";
}

test("a function that declares thousands of functions", async () => {
  using dir = tempDir("aot-a-function-that-declares-thousands-of-functions", {
    "package.json": `{ "type": "module" }`,
    "bundle.js": bundle(),
    "other.js": `export const one = 1;\n`,
    "main.js": `import { all } from "./bundle.js";\nimport { one } from "./other.js";\nconsole.log(all() + one);\n`,
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
  const most = /at most (\d+) results stored between two idle moments of a task/.exec(rounds[0])?.[1];
  expect(Number(most ?? Infinity)).toBeLessThan(declaredFunctions / 10);
}, 240_000);
