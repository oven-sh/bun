// A CommonJS file that throws while it loads is taken out of the cache, so the next load runs it again. A package that hands its own `require` on lets a loader out of the
// build's sight; the program gives it the path of one of its own files. The build has to take that file for one that may run again, in an executable and in a test run.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "node_modules/late/package.json": `{ "name": "late", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/late/index.js": `const through = (load, name) => load(name);\nmodule.exports = name => through(require, name);\n`,
  "shaky.cjs": `globalThis.runs = (globalThis.runs || 0) + 1;
if (globalThis.runs === 1) throw new Error("cold");
exports.said = "ran " + globalThis.runs;
`,
};
const turns = `for (let turn = 0; turn < 3; turn++) {
  try {
    say(late(process.env.WHICH).said);
  } catch (error) {
    say(error.message);
  }
}`;
const env = { ...bunEnv, WHICH: "../../shaky.cjs" };
const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
const expected = ["SAID cold", "SAID ran 2", "SAID ran 2"];

test("an executable whose second entry point nothing starts", async () => {
  using dir = tempDir("loader-of-a-package", {
    ...files,
    "main.cjs": `const late = require("late");\nconst say = it => console.log("SAID " + it);\n${turns}\n`,
  });
  const cwd = String(dir);
  const plain = await run([bunExe(), "main.cjs"], cwd, env);
  expect({ said: said(plain.stdout), exitCode: plain.exitCode }).toEqual({ said: expected, exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "shaky.cjs", "--outfile", "program"],
    cwd,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const compiled = await run([join(cwd, "program")], cwd, env);
  expect({ said: said(compiled.stdout), exitCode: compiled.exitCode }).toEqual({ said: expected, exitCode: 0 });
});

test("a test run whose test file requires the file behind the package's load", async () => {
  using dir = tempDir("loader-of-a-package-in-a-test-run", {
    ...files,
    "shaky.cjs": `process.env.RUNS_OF_SHAKY = String(Number(process.env.RUNS_OF_SHAKY || 0) + 1);
exports.early = process.env.RUNS_OF_SHAKY;
if (process.env.RUNS_OF_SHAKY === "1") throw new Error("cold");
exports.late = process.env.RUNS_OF_SHAKY;
`,
    "late.test.cjs": `const { test } = require("bun:test");
const late = require("late");
let first = "loaded";
try { late(process.env.WHICH); } catch (error) { first = error.message; }
console.error("SAID the first load", first, "after", process.env.RUNS_OF_SHAKY);
const shaky = require("./shaky.cjs");
console.error("SAID the second load holds", shaky.early, shaky.late, "after", process.env.RUNS_OF_SHAKY);
test("t", () => {});
`,
  });
  const cwd = String(dir);
  for (const way of [[], ["--aot"]]) {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...way], cwd, env);
    expect({ way, said: said(stdout + "\n" + stderr), exitCode }).toEqual({
      way,
      said: ["SAID the first load cold after 1", "SAID the second load holds 2 2 after 2"],
      exitCode: 0,
    });
  }
});
