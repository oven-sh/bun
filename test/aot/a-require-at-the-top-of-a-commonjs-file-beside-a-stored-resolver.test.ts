// In a test run that stores `Module._resolveFilename` every bound require() first asks whether a function is stored, and the file is evaluated in one arm of that branch.
// At the top of a CommonJS file the evaluation still said that every run of the body passes it, in the order of the text, which the engine relies on. The verifier, which
// tests have on, stopped the build: "InvalidModuleEvaluation: the evaluation of a module breaks rule 8 of its sites", rule 7 with two such calls.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const stores = `const old = Module._resolveFilename; Module._resolveFilename = function (request, ...rest) { return old.call(this, request, ...rest); };`;
const tops = {
  "one file": [`const a = require("./a.js");`, `a.name`],
  "two files": [`const a = require("./a.js");\nconst b = require("./b.js");`, `a.name, b.name`],
  "a file for what it does, and a file": [`require("./a.js");\nconst b = require("./b.js");`, `b.name`],
  "a name of a file": [`const { name } = require("./a.js");\nconst b = require("./b.js");`, `name, b.name`],
};

async function linesOf([top, printed]: string[], flags: string[]) {
  using dir = tempDir("aot-require-at-the-top-beside-a-resolver", {
    "a.js": `exports.name = "a";\n`,
    "b.js": `exports.name = "b";\n`,
    "a.test.cjs": `const { test } = require("bun:test");\nconst Module = require("module");\n${top}
      test("t", () => { ${stores} console.error("OUT", ${printed}, require("./b.js").name); });`,
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(tops))(
  "%s",
  async (_, top) => {
    const plain = await linesOf(top, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines).toHaveLength(1);
    expect(await linesOf(top, ["--aot"])).toEqual(plain);
  },
  120_000,
);
