import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { measureUntilWithinBounds } from "./harness/measure-again";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// 3,000 modules import one another, every tenth a CommonJS file too. tools.js requires 800 modules above them by name while it loads, each of which nothing else imports.
// The mocked module reaches all 3,000, so any of them might lie behind the mock.
const modules = 3000;
const tools = 800;
const testFiles = 16;

function project() {
  const files: Record<string, string> = {};
  const other = (k: number, step: number, start: number) => (k * step + start) % modules;
  for (let k = 0; k < modules; k++) {
    const [a, b] = [other(k, 7, 1), other(k, 13, 5)];
    const file = k % 10 ? "" : `import c${k} from "./c${k}.cjs";\n`;
    if (file) files[`c${k}.cjs`] = `module.exports = ${k};\n`;
    files[`m${k}.js`] =
      `${file}import { v${a} as a } from "./m${a}.js";\nimport { v${b} as b } from "./m${b}.js";\n` +
      `export const v${k} = ${file ? `c${k}` : k};\nexport function sum${k}() { return a + b + v${k}; }\n`;
  }
  let text = `import { v0 } from "./m0.js";\nexport let total = v0;\n`;
  let total = 0;
  for (let k = 0; k < tools; k++) {
    const [a, b] = [other(k, 31, 3), other(k, 17, 2)];
    files[`tool${k}.js`] =
      `import { v${a} as a } from "./m${a}.js";\nimport { v${b} as b } from "./m${b}.js";\nexport const tool = a + b;\n`;
    text += `total += require("./tool${k}.js").tool;\n`;
    total += a + b;
  }
  files["tools.js"] = text;
  files["mocked.js"] = `import { v1 } from "./m1.js";\nexport const name = "real" + v1;\n`;
  files["timings.json"] = `{ "version": 1, "files": {} }`;
  // Every other file mocks.
  for (let k = 0; k < testFiles; k++)
    files[`${k % 2 ? "plain" : "mocking"}${k}.test.js`] =
      `import { expect, mock, test } from "bun:test";\n` +
      (k % 2 ? "" : `mock.module("./mocked.js", () => ({ name: "mock" }));\n`) +
      `const [{ total }, { name }] = [await import("./tools.js"), await import("./mocked.js")];\n` +
      `test("t${k}", () => { expect([total, name]).toEqual([${total}, "${k % 2 ? "real1" : "mock"}"]); });\n`;
  return files;
}

async function timeOfFilesThatMockInTimesThatOfTheOthers() {
  using dir = tempDir("loads-below-a-mock", project());
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot", "--isolate", "--timings=timings.json", "--update-timings", "."],
    String(dir),
    bunEnv,
  );
  expect({ exitCode, passed: stderr.match(/^\s*(\d+) pass$/m)?.[1] }).toEqual({
    exitCode: 0,
    passed: String(testFiles),
  });
  const timings: Record<string, number> = (await Bun.file(join(String(dir), "timings.json")).json()).files;
  const sumOf = (start: string) =>
    Object.entries(timings).reduce(
      (sum, [path, time]) => sum + (path.split(/[\\/]/).at(-1)!.startsWith(start) ? time : 0),
      0,
    );
  return sumOf("mocking") / sumOf("plain");
}

test("a mocked module does not make every load walk the modules below it", async () => {
  // Where each required module walked the graph in each test file, the files that mock took twenty times as long as the others.
  const most = 4;
  const times = await measureUntilWithinBounds(
    "the time of the test files that mock",
    timeOfFilesThatMockInTimesThatOfTheOthers,
    times => times < most,
  );
  expect(times).toBeLessThan(most);
});
