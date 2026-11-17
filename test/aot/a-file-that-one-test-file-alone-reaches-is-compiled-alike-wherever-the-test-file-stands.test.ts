// A CommonJS file that throws while it loads has not run: the next require() runs it again, so its variables can't lie in the slots of the module. The runner catches what a test
// file throws while it loads and goes on to the next test file, which may load the same file. The build took that for every file below the second and each later test file, so a
// project with two test files was compiled unlike the executable: 331 functions of a server on express differed for a first test file that imports nothing.
// Only a file that two test files reach can have half run when a test file loads it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { operationsOfProgram } from "./servers/functions-of-a-map";
import { describe, test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const empty = `const { test } = require("bun:test");\ntest("nothing", () => console.log("SAID nothing"));\n`;
const reads = (name: string) =>
  `const { test } = require("bun:test");\nconst part = require("./part.cjs");\ntest("${name}", () => console.log("SAID ${name}", part.read(), part.read()));\n`;
const counts = `let count = 0;\nlet held = "held";\nfunction read() {\n  count += 1;\n  return count + " " + held;\n}\nexports.read = read;\n`;
const throwsAtFirst = `globalThis.runsOfPart = (globalThis.runsOfPart || 0) + 1;\nlet count = globalThis.runsOfPart;\nlet held = "held " + count;\nfunction read() {\n  return count + " " + held;\n}\nif (count === 1) throw new Error("the first run of part throws");\nexports.read = read;\n`;

type Run = { said: string[]; operations: Map<string, { bytes: string; operations: string }> };

// functions-of-a-map.ts takes the files of a program to lie below a folder named app.
async function run(folder: string, map: string, compiled: boolean, testFiles: string[]): Promise<Run> {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...(compiled ? ["--aot"] : []), ...testFiles.map(name => `./${name}`)],
    cwd: join(folder, "app"),
    env: { ...bunEnv, [buildEnvironment.mapFilePath]: join(folder, map) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  // What the tests print, then what the runner says of a test file that threw: the two come through two pipes.
  const said = [
    ...out.split("\n").filter(line => line.startsWith("SAID ")),
    ...err.split("\n").filter(line => line.startsWith("error: ")),
  ];
  return { said, operations: compiled ? operationsOfProgram([join(folder, map)]) : new Map() };
}

const ofPart = (run: Run) => [...run.operations].filter(([name]) => name.startsWith("/app/part.cjs "));
const keepsVariablesInEnvironment = (run: Run) =>
  ofPart(run).some(([, { operations }]) => operations.includes("GetEnvironmentField"));

describe.skipIf(isWindows)("a file that may have half run when a test file loads it", () => {
  test("is not one that the second test file alone reaches", async () => {
    const files = {
      "app/package.json": "{}",
      "app/part.cjs": counts,
      "app/a_test.js": empty,
      "app/b_test.js": reads("b"),
    };
    const folder = String(tempDir("aot-one-test-file-reaches", files));
    const alone = await run(folder, "alone.map", true, ["b_test.js"]);
    const behind = await run(folder, "behind.map", true, ["a_test.js", "b_test.js"]);
    expect(ofPart(alone).length).toBeGreaterThan(0);
    expect(ofPart(behind)).toEqual(ofPart(alone));
    expect(keepsVariablesInEnvironment(behind)).toBe(false);
    expect(behind.said).toEqual(["SAID nothing", "SAID b 1 held 2 held"]);
  });

  test("is one that two test files reach", async () => {
    const files = {
      "app/package.json": "{}",
      "app/part.cjs": throwsAtFirst,
      "app/a_test.js": reads("a"),
      "app/b_test.js": reads("b"),
    };
    const folder = String(tempDir("aot-two-test-files-reach", files));
    const testFiles = ["a_test.js", "b_test.js"];
    const compiled = await run(folder, "both.map", true, testFiles);
    expect(keepsVariablesInEnvironment(compiled)).toBe(true);
    expect(compiled.said).toEqual(["SAID b 2 held 2 2 held 2", "error: the first run of part throws"]);
    expect(compiled.said).toEqual((await run(folder, "", false, testFiles)).said);
  });

  test("is one that the second and the third reach", async () => {
    const files = {
      "app/package.json": "{}",
      "app/part.cjs": throwsAtFirst,
      "app/a_test.js": empty,
      "app/b_test.js": reads("b"),
      "app/c_test.js": reads("c"),
    };
    const folder = String(tempDir("aot-second-and-third-reach", files));
    const testFiles = ["a_test.js", "b_test.js", "c_test.js"];
    const compiled = await run(folder, "three.map", true, testFiles);
    expect(keepsVariablesInEnvironment(compiled)).toBe(true);
    expect(compiled.said).toEqual(["SAID nothing", "SAID c 2 held 2 2 held 2", "error: the first run of part throws"]);
    expect(compiled.said).toEqual((await run(folder, "", false, testFiles)).said);
  });

  test("is one that a function asks for which the test file that failed left behind", async () => {
    const files = {
      "app/package.json": "{}",
      "app/part.cjs": throwsAtFirst,
      "app/asks.cjs": `globalThis.askAgain = () => require("./part.cjs").read();\n`,
      "app/a_test.js": empty,
      "app/b_test.js": `require("./asks.cjs");\n${reads("b")}`,
      "app/c_test.js": `const { test } = require("bun:test");\ntest("c", () => console.log("SAID c", globalThis.askAgain(), globalThis.askAgain()));\n`,
    };
    const folder = String(tempDir("aot-left-behind-asks", files));
    const testFiles = ["a_test.js", "b_test.js", "c_test.js"];
    const compiled = await run(folder, "left.map", true, testFiles);
    expect(keepsVariablesInEnvironment(compiled)).toBe(true);
    expect(compiled.said).toEqual(["SAID nothing", "SAID c 2 held 2 2 held 2", "error: the first run of part throws"]);
    expect(compiled.said).toEqual((await run(folder, "", false, testFiles)).said);
  });

  test("is every file where the first test file loads by a name that the build cannot read", async () => {
    const files = {
      "app/package.json": "{}",
      "app/part.cjs": throwsAtFirst,
      "app/a_test.js": `const { test } = require("bun:test");\nglobalThis.askAgain = name => require(name).read();\ntest("a", () => console.log("SAID a"));\n`,
      "app/b_test.js": reads("b"),
      "app/c_test.js": `const { test } = require("bun:test");\ntest("c", () => console.log("SAID c", globalThis.askAgain(["./part", "cjs"].join("."))));\n`,
    };
    const folder = String(tempDir("aot-unread-name-reaches", files));
    const testFiles = ["a_test.js", "b_test.js", "c_test.js"];
    const compiled = await run(folder, "unread.map", true, testFiles);
    expect(keepsVariablesInEnvironment(compiled)).toBe(true);
    expect(compiled.said).toEqual(["SAID a", "SAID c 2 held 2", "error: the first run of part throws"]);
    expect(compiled.said).toEqual((await run(folder, "", false, testFiles)).said);
  });
});
