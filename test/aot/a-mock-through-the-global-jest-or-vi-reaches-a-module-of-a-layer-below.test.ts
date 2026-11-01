// `bun test` hands every file the names of the test runner, so a suite written for jest or vitest says `jest.mock("validator", ..)` and `vi.mock("../src/report.ts", ..)`
// without an import. A build gives such a file the import. The look through the test files did not, took the call for nobody's, and no layer below was told of the mock:
// "TypeError: mock(module, fn) cannot replace .. because the build didn't see a test mock it". Found on the suites of xstate and clean-ts-api.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tests = {
  "jest.mock of a package": `
    import { run } from "../src";
    import validator from "validator";
    jest.mock("validator", () => ({ isEmail(): boolean { return true; } }));
    describe("d", () => { test("t", () => { console.error("OUT", run(), validator.isEmail("x")); }); });`,
  "vi.mock of a file of the project": `
    import { run } from "../src";
    vi.mock("../src/report.ts", () => { return { report: () => "mocked" }; });
    describe("d", () => { it("t", () => { console.error("OUT", run()); }); });`,
  "in a CommonJS test file": `
    const { run } = require("../src");
    jest.mock("../src/report.ts", () => ({ report: () => "mocked" }));
    test("t", () => { console.error("OUT", run(), require("../src/report.ts").report()); });`,
  "jest.spyOn on a namespace": `
    import { run } from "../src";
    import * as report from "../src/report.ts";
    test("t", () => { jest.spyOn(report, "report").mockReturnValue("spied"); console.error("OUT", run()); });`,
};

async function linesOf(name: string, text: string, flags: string[], words?: string) {
  using dir = tempDir("aot-global-jest", {
    "package.json": `{ "name": "p" }`,
    "node_modules/validator/package.json": `{ "name": "validator", "main": "index.js" }`,
    "node_modules/validator/index.js": `exports.isEmail = text => /@/.test(text);\n`,
    "src/report.ts": `export const report = (error?: unknown) => "real";\n`,
    "src/index.ts": `import { report } from "./report.ts";\nimport validator from "validator";\nexport const run = () => [report(1), validator.isEmail("x")].join();\n`,
    [name.includes("CommonJS") ? "test/a.test.cjs" : "test/a.test.ts"]: text,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error|TypeError)/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(tests))(
  "%s",
  async (name, text) => {
    const plain = await linesOf(name, text, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines).toHaveLength(1);
    expect(await linesOf(name, text, ["--aot"])).toEqual(plain);
    expect(await linesOf(name, text, ["--aot"], "TestRunLayers:2")).toEqual(plain);
    expect(await linesOf(name, text, ["--aot"], "TestRunLayers:3")).toEqual(plain);
  },
  240_000,
);
