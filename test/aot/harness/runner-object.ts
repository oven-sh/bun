// A file may hold the object of `bun:test` as a value: what `Bun.jest(path)` answers, `import * as runner from "bun:test"`. It has `spyOn` and `mock` among its members, so where it
// goes out of the file's sight a spy may take any export of any module whose object goes somewhere, and a mock any module. Where the file shows all that becomes of it, only
// what is read off it counts. Plain `bun test` says what is right; the build's own line says what it opened.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./default-timeout";
import { run } from "./run";
import { test } from "../supported";

const shared = {
  "package.json": `{ "type": "module" }`,
  "src/lib.js": `export function answer() { return "real"; }\nexport function other() { return 1; }\n`,
  "src/far.js": `export function far() { return "far"; }\nexport function farther() { return "farther"; }\n`,
  "src/user.js": `import { answer } from "./lib.js";\nexport const ask = () => answer();\n`,
  "support/names.js": `const { jest } = Bun;\nexport const { expect, test } = jest(import.meta.path);\n`,
  "support/returns.js": `const { jest } = Bun;\nexport function runner() {\n  return jest(import.meta.path);\n}\n`,
  "support/one-of-two.js": `const { jest } = Bun;\nconst copy = { ...jest(import.meta.path) };\nexport function runner(takesCopy) {\n  if (takesCopy) return copy;\n  return jest(import.meta.path);\n}\n`,
  "support/spies.js": `export const spyWith = (runner, object, name) => runner.spyOn(object, name).mockReturnValue("spied");
export const spyWithMaker = (make, object, name) => make().spyOn(object, name).mockReturnValue("spied");
`,
};
const holds = `import * as far from "../src/far.js";
import * as lib from "../src/lib.js";
import { ask } from "../src/user.js";
const held = { lib, far };
const name = process.env.NOTHING ?? ["ans", "wer"].join("");
`;
const reads = `() => { console.log("SAID " + held.lib.answer() + held.far.far() + ask()); }`;
const spies = (spy: string) => `() => {
  const spy = ${spy};
  console.log("SAID " + held.far.far() + ask());
  spy.mockRestore();
  console.log("SAID " + held.far.far() + ask());
}`;
const factory = `() => ({ answer: () => "mocked", other: () => 2 })`;
const asksBehindMock = `async () => { console.log("SAID " + (await import("../src/user.js")).ask()); }`;

const unspied = ["SAID realfarreal"];
const spied = ["SAID farspied", "SAID farreal"];
// `inSight`: the build opens nothing.
const cases: Record<string, { file: string; said: string[]; inSight: boolean }> = {
  "names taken off Bun.jest() and exported": {
    file: `import { test } from "../support/names.js";\n${holds}test("t", ${reads});\n`,
    said: unspied,
    inSight: true,
  },
  "a spy through what an exported function returns": {
    file: `import { runner } from "../support/returns.js";\n${holds}runner().test("t", ${spies(`runner().spyOn(held.lib, name).mockReturnValue("spied")`)});\n`,
    said: spied,
    inSight: false,
  },
  "the object in a constant": {
    file: `const { jest } = Bun;\n${holds}const runner = jest(import.meta.path);\nrunner.test("t", ${reads});\n`,
    said: unspied,
    inSight: true,
  },
  "the object goes into a call of another file": {
    file: `import { spyWith } from "../support/spies.js";\nconst { jest } = Bun;\n${holds}const runner = jest(import.meta.path);\nrunner.test("t", ${spies(`spyWith(runner, held.lib, name)`)});\n`,
    said: spied,
    inSight: false,
  },
  "import * as": {
    file: `import * as runner from "bun:test";\n${holds}runner.test("t", ${reads});\n`,
    said: unspied,
    inSight: true,
  },
  "the function goes into a call of another file": {
    file: `import { spyWithMaker } from "../support/spies.js";\nconst { jest } = Bun;\n${holds}function runner() {\n  return jest(import.meta.path);\n}\nrunner().test("t", ${spies(`spyWithMaker(runner, held.lib, name)`)});\n`,
    said: spied,
    inSight: false,
  },
  "a function of the file returns the object": {
    file: `const { jest } = Bun;\n${holds}function runner() {\n  return jest(import.meta.path);\n}\nconst { test } = runner();\nconst { describe } = runner();\ndescribe("d", () => { test("t", ${reads}); });\n`,
    said: unspied,
    inSight: true,
  },
  "the function returns the object or a copy of it": {
    file: `import { runner } from "../support/one-of-two.js";\n${holds}runner().test("t", ${spies(`runner(true).spyOn(held.lib, name).mockReturnValue("spied")`)});\n`,
    said: spied,
    inSight: false,
  },
  "a mock through what an exported function returns": {
    file: `import { runner } from "../support/returns.js";\nconst { mock, test } = runner();\nmock.module("../src/lib.js", ${factory});\ntest("t", ${asksBehindMock});\n`,
    said: ["SAID mocked"],
    inSight: false,
  },
  "a spy through `default` of the namespace": {
    file: `import * as runner from "bun:test";\n${holds}runner.test("t", ${spies(`runner.default.spyOn(held.lib, name).mockReturnValue("spied")`)});\n`,
    said: spied,
    inSight: false,
  },
  "a mock through an object that was stored": {
    file: `import { runner } from "../support/returns.js";\nconst kit = { it: runner() };\nkit[process.env.NOTHING ?? "it"].mock.module("../src/lib.js", ${factory});\nkit.it.test("t", ${asksBehindMock});\n`,
    said: ["SAID mocked"],
    inSight: false,
  },
};

export function runnerObject(part: number, of: number) {
  raiseDefaultTimeout(120_000);
  const mine = Object.entries(cases).filter((_, index) => index % of === part);
  for (const [name, { file, said, inSight }] of mine) {
    test(name, async () => {
      using dir = tempDir("aot-runner-object", { ...shared, "test/a.test.js": file });
      const seenWith = async (...flags: string[]) => {
        const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
        const lines = (stdout + "\n" + stderr).split("\n");
        const opened = lines.flatMap(line => /variables that tests may replace (\d+) in/.exec(line)?.[1] ?? []);
        return {
          said: lines.filter(line => line.startsWith("SAID ") || /^error|Error: /.test(line)),
          opensNothing:
            opened.every(count => count === "0") && !lines.some(line => line.includes("a spy under any name true")),
          builds: opened.length > 0,
          exitCode,
        };
      };
      expect(await seenWith()).toEqual({ said, opensNothing: true, builds: false, exitCode: 0 });
      expect(await seenWith("--aot")).toEqual({ said, opensNothing: inSight, builds: true, exitCode: 0 });
    });
  }
}
