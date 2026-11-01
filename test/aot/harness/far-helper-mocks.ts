// A helper mocks a module for the test file. It stands three imports away, or outside the folders of the test files under a name of tsconfig.json, and it reaches
// the mock functions of the runner by a global name, by require() or by a namespace. The build sees the call where it is spelled, however far away that is.
// Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./default-timeout";
import { run } from "./run";
import { waysFor } from "./ways";
import { describe, test } from "../supported";

raiseDefaultTimeout(120_000);

const said = `const said = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };`;

const commonJs = (helper: string) => ({
  "src/dep.cjs": `exports.name = "real";`,
  "src/user.cjs": `exports.use = () => require("./dep.cjs").name;`,
  "test/a.test.cjs": `const { act } = require("./tools/h1.cjs");
const { use } = require("../src/user.cjs");
${said}
test("t", () => console.log("|", use(), said(act), use()));`,
  "test/tools/h1.cjs": `exports.act = require("./h2.cjs").act;`,
  "test/tools/h2.cjs": `exports.act = require("./h3.cjs").act;`,
  "test/tools/h3.cjs": helper,
});
const typeScript = (helper: string) => ({
  "src/dep.ts": `export const name = "real";`,
  "src/user.ts": `export const use = () => require("./dep").name;`,
  "test/a.test.ts": `import { act } from "./tools/h1";
import { use } from "../src/user";
${said}
test("t", () => console.log("|", use(), said(act), use()));`,
  "test/tools/h1.ts": `export { act } from "./h2";`,
  "test/tools/h2.ts": `export { act } from "./h3";`,
  "test/tools/h3.ts": helper,
});
const underAnotherName = (helper: string, user: string) => ({
  "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }`,
  "src/dep.ts": `export const name = "real";`,
  "src/user.ts": user,
  "src/test-utils/mocks.ts": helper,
  "src/components/__tests__/a.test.ts": `import { act } from "@/test-utils/mocks";
import { use } from "../../user";
${said}
test("t", () => console.log("|", use(), said(act), use()));`,
});
// Native code finds the file that "./dep" is written in by the frame of its caller.
const loadsBesideItself = (helper: string) => ({
  "test/a.test.ts": `import { load } from "./tools/h1";
test("t", async () => console.log("| real", (await load()).name));`,
  "test/dep.ts": `export const name = "beside the test file";`,
  "test/tools/h1.ts": `export { load } from "./far/h2";`,
  "test/tools/dep.ts": `export const name = "beside the file that passes it on";`,
  "test/tools/far/h2.ts": helper,
  "test/tools/far/dep.ts": `export const name = "beside the helper: not mocked";`,
});
const factory = `() => ({ name: "mocked" })`;

const projects: Record<string, Record<string, string>> = {
  "the global jest, CommonJS": commonJs(`exports.act = function () { jest.doMock("../../src/dep.cjs", ${factory}); };`),
  "the global vi, CommonJS": commonJs(`exports.act = function () { vi.doMock("../../src/dep.cjs", ${factory}); };`),
  "require() of the runner": commonJs(
    `exports.act = function () { require("bun:test").mock.module("../../src/dep.cjs", ${factory}); };`,
  ),
  "a pattern off the require()": commonJs(
    `const { mock } = require("bun:test");\nexports.act = function () { mock.module("../../src/dep.cjs", ${factory}); };`,
  ),
  "the runner is required below its use": commonJs(
    `exports.act = function () { runner.mock.module("../../src/dep.cjs", ${factory}); };\nconst runner = require("bun:test");`,
  ),
  "the global vi, TypeScript": typeScript(`export function act() { vi.doMock("../../src/dep", ${factory}); }`),
  "the global jest, TypeScript": typeScript(`export function act() { jest.doMock("../../src/dep", ${factory}); }`),
  "a namespace of the runner": typeScript(
    `import * as runner from "bun:test";\nexport function act() { runner.vi.doMock("../../src/dep", ${factory}); }`,
  ),
  "the mock is the last call of the helper": typeScript(
    `export const act = () => vi.doMock("../../src/dep", ${factory});`,
  ),
  "vi.importActual() is the last call of the helper": loadsBesideItself(
    `export const load = () => vi.importActual("./dep");`,
  ),
  "jest.requireActual() is the last call of the helper": loadsBesideItself(
    `export const load = () => jest.requireActual("./dep");`,
  ),
  "a name of tsconfig.json, outside the folders of the test files": underAnotherName(
    `export function act() { vi.doMock("../dep", ${factory}); }`,
    `export const use = () => require("./dep").name;`,
  ),
  "a module of Bun, under a name of tsconfig.json": underAnotherName(
    `export function act() { vi.doMock("node:os", () => ({ hostname: () => "mocked" })); }`,
    `export const use = () => (require("node:os").hostname() === "mocked" ? "mocked" : "real");`,
  ),
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), results, exitCode };
}

/**
 * Every case builds its project, most of them in layers: under a sanitizer most of a minute of processor time each.
 * So the cases are dealt to several test files: of `of` files, this one takes every `of`-th case, from the `part`-th on.
 */
export function farHelperMocks(part: number, of: number) {
  // These three failed in layers on the build in front of the cure, and as one program too. No other case failed in layers.
  const witnesses = [
    "the mock is the last call of the helper",
    "vi.importActual() is the last call of the helper",
    "jest.requireActual() is the last call of the helper",
  ];
  describe.each(ways)("%s", (way, env) => {
    const runsIn = (name: string) => waysFor(ways, witnesses.includes(name)).some(([each]) => each === way);
    const mine = Object.keys(projects).filter((_, index) => index % of === part);
    test.each(mine.filter(runsIn))("%s", async name => {
      using dir = tempDir("far-helper-mocks", projects[name]);
      const plain = await runTests(String(dir), {});
      expect(plain.results).toEqual(["pass t"]);
      expect(plain.printed.join()).toMatch(/^\| real (\S+( \S+)?|beside the helper: not) mocked$/);
      expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
    });
  });
}
