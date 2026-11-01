import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const functionsInLongFile = 4000;
const smallFiles = 1000;
const functionsInSmallFile = 16;

function functions(prefix: string, count: number) {
  let source = "";
  for (let index = 0; index < count; index++)
    source += `export function ${prefix}${index}(a, b) {\n  let sum = ${index};\n  for (const value of [a, b]) sum += value;\n  return { k${index}: a, sum };\n}\n`;
  return source;
}

test("many small files beside one long file", async () => {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "long.js": functions("f", functionsInLongFile),
  };
  let main = `import * as long from "./long.js";\nlet sum = 0;\nfor (const name of Object.keys(long)) sum += long[name](1, 2).sum;\n`;
  for (let file = 0; file < smallFiles; file++) {
    files[`small${file}.js`] = functions(`s${file}_`, functionsInSmallFile);
    main += `import { s${file}_0 } from "./small${file}.js";\nsum += s${file}_0(${file}, 1).sum;\n`;
  }
  files["main.js"] = main + "console.log(sum);\n";
  using dir = tempDir("aot-many-small-files-beside-one-long-file", files);
  const directory = String(dir);
  const expected = await run([bunExe(), "main.js"], directory, bunEnv);
  expect(expected.exitCode).toBe(0);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", withThreads(2), "main.js", "--outfile", executable],
    directory,
    { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
  );
  expect(built.exitCode).toBe(0);
  expect((await run([executable], directory, bunEnv)).stdout).toBe(expected.stdout);
  const rounds = (built.stderr + built.stdout)
    .split("\n")
    .filter(line => line.startsWith(`AOT round of the checker | all threads | ${smallFiles + 2} files`));
  expect(rounds.length).toBe(1);
  const packedAway = /packed away, (\d+) before the longest task ended/.exec(rounds[0])?.[1];
  expect(Number(packedAway ?? 0)).toBeGreaterThan(0);
}, 240_000);
