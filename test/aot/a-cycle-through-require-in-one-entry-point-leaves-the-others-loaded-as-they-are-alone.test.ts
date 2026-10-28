// Where a CommonJS file that an ES module imports requires an ES module that leads back to it, the loader of the run time loads every graph that comes to that cycle, step by step.
// That is a matter of those graphs: an entry point from which no import and no require leads to the cycle is loaded as it is in an executable of its own.
// The ticks of an imported CommonJS file tell the two ways of loading apart.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "starter.ts": `await import(process.env.NAME_OF_PROGRAM!);\nexport {};\n`,
  "ticks/main.mjs": `import "./between.mjs";\nconsole.log("main runs");\n`,
  "ticks/between.mjs": `import "./first.cjs";\nimport "./second.cjs";\nconsole.log("between runs");\n`,
  "ticks/first.cjs": `console.log("first runs");\nprocess.nextTick(() => console.log("tick of first"));\n`,
  "ticks/second.cjs": `console.log("second runs");\n`,
  "cycle/main.mjs": `export { first } from "./lib.cjs";\nexport const own = "own";\nconsole.log("main runs");\n`,
  "cycle/lib.cjs": `console.log("lib begins");\nexports.first = 1;\nconst main = require("./main.mjs");\nconsole.log("lib: required", Object.keys(main).join(), main.own);\nconsole.log("lib ends");\n`,
  // It comes to the cycle by an import, and to the files with the ticks too.
  "both/main.mjs": `import "../cycle/main.mjs";\nimport "../ticks/between.mjs";\nconsole.log("both runs");\n`,
};

async function outputOf(dir: string, name: string, entryPoints: string[], program?: string) {
  const executable = join(dir, name + (isWindows ? ".exe" : ""));
  const build = await run([bunExe(), ...compileCommand, ...entryPoints, "--outfile", executable], dir);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  const { stdout, exitCode } = await run([executable], dir, { ...bunEnv, NAME_OF_PROGRAM: program });
  expect(exitCode).toBe(0);
  return stdout;
}

test.each(["./ticks/main.mjs", "./cycle/main.mjs", "./both/main.mjs"])(
  "%s prints the same alone and beside the others",
  async program => {
    using dir = tempDir("aot-cycle-beside-others", files);
    const alone = await outputOf(String(dir), "alone", ["./starter.ts", program], program);
    const beside = await outputOf(
      String(dir),
      "beside",
      ["./starter.ts", "./cycle/main.mjs", "./both/main.mjs", "./ticks/main.mjs"],
      program,
    );
    expect(beside).toBe(alone);
  },
);
