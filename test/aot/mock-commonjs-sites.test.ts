// A CommonJS test file gets `jest`, `vi` and `mock` out of a require(): `bun test` hands it the names so, and `const { jest } = require("bun:test")` says it in
// the file. The build read `jest.mock(..)` and `jest.requireActual(..)` only off the names of an import statement, so in such a file any use of `jest`,
// `jest.fn()` too, counted as a mock that it can't see: every module may be mocked, and every built-in module may be handed out. The run answered
// right and held three times the code of its twin in ES syntax.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const body = (what: string) => `it("t", () => console.log("OUT", use(), ${what}));`;
const twins = (what: string) => ({
  "imported.test.mjs": `import { it, jest } from "bun:test";\nimport lib from "./lib.cjs";\nconst { use } = lib;\n${body(what)}`,
  "global.test.cjs": `const { use } = require("./lib.cjs");\n${body(what)}`,
  "required.test.cjs": `const { it, jest } = require("bun:test");\nconst { use } = require("./lib.cjs");\n${body(what)}`,
});

const shared = {
  "package.json": `{ "name": "mock-commonjs-sites" }`,
  "lib.cjs": `const path = require("node:path"), util = require("node:util");
exports.use = () => [path.basename("/a/b"), util.format("%s", 1), require("./dep.cjs").value].join();`,
  "dep.cjs": `exports.value = "real";`,
};

const projects = {
  "jest.fn()": twins(`jest.fn()() === undefined`),
  "jest.requireActual() of a built-in": twins(
    `({ ...jest.requireActual("node:path"), basename: () => "mine" }).basename()`,
  ),
  "jest.requireActual() of a file": twins(`jest.requireActual("./dep.cjs").value`),
};

const mocked = {
  "global.test.cjs": `jest.mock("./dep.cjs", () => ({ value: "mocked" }));
const { use } = require("./lib.cjs");
it("t", () => console.log("OUT", use(), require("./dep.cjs").value, jest.requireActual("./dep.cjs").value));`,
  "required.test.cjs": `const { it, jest: renamed } = require("bun:test");
renamed.mock("./dep.cjs", () => ({ value: "mocked" }));
const { use } = require("./lib.cjs");
it("t", () => console.log("OUT", use(), require("./dep.cjs").value, renamed.requireActual("./dep.cjs").value));`,
  "member.test.cjs": `require("bun:test").jest.mock("./dep.cjs", () => ({ value: "mocked" }));
const { use } = require("./lib.cjs");
it("t", () => console.log("OUT", use(), require("./dep.cjs").value));`,
  "stored.test.cjs": `let { it, jest: stored } = require("bun:test");
const kept = stored;
stored = { mock() {} };
stored.mock("./dep.cjs", () => ({ value: "never" }));
kept.mock("./dep.cjs", () => ({ value: "mocked" }));
const { use } = require("./lib.cjs");
it("t", () => console.log("OUT", use(), require("./dep.cjs").value));`,
};

async function run(dir: string, file: string, flags: string[]) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./" + file],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0", BUN_AOT_VERBOSE: flags.length ? "1" : undefined },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const code = Number(/^\[aot\] image: \d+ bytes, (\d+) of code/m.exec(stderr)?.[1] ?? NaN);
  return { seen: { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode }, code };
}

test.concurrent.each(Object.keys(projects) as (keyof typeof projects)[])(
  "%s: a CommonJS test file holds the code of its twin in ES syntax",
  async name => {
    using folder = tempDir("aot-mock-commonjs-sites", { ...shared, ...projects[name] });
    const dir = String(folder);
    const twin = await run(dir, "imported.test.mjs", ["--aot"]);
    expect(twin.seen).toEqual((await run(dir, "imported.test.mjs", [])).seen);
    expect(twin.seen.exitCode).toBe(0);
    for (const file of ["global.test.cjs", "required.test.cjs"]) {
      const compiled = await run(dir, file, ["--aot"]);
      expect(compiled.seen).toEqual((await run(dir, file, [])).seen);
      expect(compiled.seen).toEqual(twin.seen);
      expect(compiled.code / twin.code).toBeLessThan(1.5);
    }
  },
  240_000,
);

test.concurrent.each(Object.keys(mocked) as (keyof typeof mocked)[])(
  "a mock in %s",
  async file => {
    using folder = tempDir("aot-mock-commonjs-sites", { ...shared, ...mocked });
    const dir = String(folder);
    const plain = await run(dir, file, []);
    expect(plain.seen.exitCode).toBe(0);
    expect(plain.seen.lines.join()).toContain("mocked");
    expect((await run(dir, file, ["--aot"])).seen).toEqual(plain.seen);
  },
  240_000,
);
