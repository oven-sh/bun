// In a compiled test run a name that is made at run time may be the name of any file of the program. The analysis says so file by
// file, and it takes the files in parts of a thousand, side by side. So this program has 2,500: the first, the last and the ones at
// the seams are loaded by require() and by import(), each hands out a function and an object of its own, and all of it prints what
// plain Bun prints.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./with-compiler";

setDefaultTimeout(600_000);

const files = 2500;
const loaded = [0, 1, 1022, 1023, 1024, 1025, 2046, 2047, 2048, 2049, 2498, 2499];
const nameOf = (index: number) => `./files/f${index}.${index % 2 ? "cjs" : "mjs"}`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, passed: /^ *(\d+) pass$/m.exec(stderr)?.[1], exitCode };
}

const testFile = `
import { test } from "bun:test";
const all = [${Array.from({ length: files }, (_, index) => `() => require("${nameOf(index)}")`).join(", ")}];
test("any file answers to its name", async () => {
  console.log(all.length);
  for (const index of ${JSON.stringify(loaded)}) {
    const name = "./files/f" + index + (index % 2 ? ".cjs" : ".mjs");
    const required = require(name);
    const imported = await import(name);
    const made = required.make(index);
    made.seen = (made.seen ?? 0) + 1;
    console.log(name, required.id, imported.id ?? imported.default.id, made.twice, made.seen, required.make === (imported.make ?? imported.default.make));
    console.log(Object.keys(required).join(), required.state.count++, (imported.state ?? imported.default.state).count);
  }
});
`;

describe("a program of thousands of files", () => {
  test("loads any of them by a name made at run time", async () => {
    const sources: Record<string, string> = { "any.test.mjs": testFile };
    for (let index = 0; index < files; index++) {
      const body = `function make(n) { return { twice: n * 2 + ${index}, own${index}: true }; }\nconst state = { count: ${index} };\n`;
      sources[nameOf(index).slice(2)] =
        index % 2
          ? `${body}module.exports = { id: ${index}, make, state };\n`
          : `${body}export const id = ${index};\nexport { make, state };\n`;
    }
    using dir = tempDir("aot-thousands-of-files", sources);
    const plain = await run([bunExe(), "test", "./any.test.mjs"], String(dir));
    expect({ passed: plain.passed, exitCode: plain.exitCode }).toEqual({ passed: "1", exitCode: 0 });
    expect(plain.stdout.split("\n").filter(line => line.startsWith("./files/")).length).toBe(loaded.length);
    expect(await run([bunExe(), "test", "--aot", "./any.test.mjs"], String(dir))).toEqual(plain);
  });

  // The analysis takes the entry points of a program in parts too, of 256. Test files are entry points where a run is one program,
  // and what they import is where they stand on a layer.
  test.each(["TestRunLayers:0", "TestRunLayers:2"])("has hundreds of entry points (%s)", async words => {
    const testFiles = 300;
    const sources: Record<string, string> = {};
    for (let index = 0; index < testFiles; index++) {
      sources[`helpers/h${index}.mjs`] =
        `export const state = { count: ${index} };\nexport function next() { return ++state.count; }\n`;
      sources[`t${index}.test.mjs`] =
        `import { test, expect } from "bun:test";\nimport { next, state } from "./helpers/h${index}.mjs";\n` +
        `test("counts", () => { expect(next()).toBe(${index + 1}); expect(state.count).toBe(${index + 1}); });\n`;
    }
    using dir = tempDir("aot-hundreds-of-entry-points", sources);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", "--isolate", "--parallel=4"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({
      passed: /^ *(\d+) pass$/m.exec(stderr)?.[1],
      failed: /^ *(\d+) fail$/m.exec(stderr)?.[1],
      exitCode,
    }).toEqual({
      passed: String(testFiles),
      failed: "0",
      exitCode: 0,
    });
  });
});
