// `vi.mock()` or `vi.doMock()` of a package, with a factory that leaves a name out. A file of the project hands that name on: `export { v, w } from "pkg"`.
// Read through that file the name is undefined; only whoever imports it from the mocked module itself gets the error of the mock. Over layers the package lies
// in another program than the file that hands the name on. Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./default-timeout";
import { run } from "./run";
import { waysFor } from "./ways";
import { describe, test } from "../supported";

raiseDefaultTimeout(120_000);

const said = `const said = run => { try { const value = run(); return value === undefined ? "undefined" : JSON.stringify(value); } catch (error) { return "threw " + String(error.message).split("\\n")[0]; } };`;
const users: Record<string, string> = {
  "export from": `export { v, w } from "pkg";`,
  "import and export": `import { v, w } from "pkg";\nexport { v, w };`,
  "the default under a name": `export { default as w, v } from "pkg";`,
};
const reads = `console.log("| keys:", said(() => Object.keys(user)));
  console.log("| read:", said(() => user.v), said(() => user.w), said(() => Reflect.get(user, "w")), said(() => "w" in user));
  console.log("| listed:", said(() => Object.entries(user)), said(() => ({ ...user })), said(() => Object.getOwnPropertyDescriptor(user, "w")));
  const itself = await import("pkg");
  console.log("| of the mock itself:", said(() => itself.v), said(() => itself.w));`;
const mocks: Record<string, string> = {
  "vi.doMock": `import { test, vi } from "bun:test";
import "./filler.mjs";
${said}
test("reads", async () => {
  vi.doMock("pkg", () => ({ v: "mock v" }));
  const user = await import("./user.mjs");
  ${reads}
});`,
  "vi.mock": `import { test, vi } from "bun:test";
import "./filler.mjs";
import * as user from "./user.mjs";
vi.mock("pkg", () => ({ v: "mock v" }));
${said}
test("reads", async () => {
  ${reads}
});`,
};
// A run takes layers by itself where its sources are more than the memory it may use holds.
const filler = Array.from(
  { length: 6000 },
  (_, index) => `export function filler${index}(a) { return a + ${index}; }`,
).join("\n");

const ways: [string, string[], Record<string, string>][] = [
  ["as one program", [], { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["over two layers", [], { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }],
  [
    "over the layers that a large run takes",
    ["--parallel=2", "--aot-memory-limit", "1MB"],
    { BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" },
  ],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)]
    .map(match => `${match[1]} ${match[2]}`)
    .sort();
  if (exitCode !== 0) console.error(stderr);
  // A run with --parallel hands on what its workers print by its own standard error.
  const all = stdout + "\n" + stderr;
  return { seen: { printed: all.split("\n").filter(line => line.startsWith("| ")), results, exitCode }, all };
}

/**
 * Every case builds its project, most of them in layers: under a sanitizer most of a minute of processor time each.
 * So the cases are dealt to several test files: of `of` files, this one takes every `of`-th case, from the `part`-th on.
 */
export function mockLacksAHandedOnName(part: number, of: number) {
  describe.each(ways)("%s", (way, flags, env) => {
    describe.each(Object.keys(mocks))("%s", mock => {
      // The witness failed in all three ways on the build in front of the cure, as the five others did: none in layers alone.
      const runsIn = (user: string) =>
        waysFor(ways, mock === "vi.doMock" && user === "export from").some(([each]) => each === way);
      const mine = Object.keys(users).filter((_, index) => index % of === part);
      test.each(mine.filter(runsIn))("%s", async user => {
        using dir = tempDir("mock-lacks-handed-on-name", {
          "package.json": `{ "type": "module" }`,
          "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.js" }`,
          "node_modules/pkg/index.js": `module.exports = { v: "real v", w: "real w" };`,
          "filler.mjs": filler,
          "user.mjs": users[user],
          "a.test.mjs": mocks[mock],
          "b.test.mjs": `import { test } from "bun:test";\nimport "./filler.mjs";\ntest("other", () => {});`,
        });
        const plain = await runTests(String(dir), {}, ...flags.filter(flag => flag.startsWith("--parallel")));
        expect(plain.seen.results).toEqual(["pass other", "pass reads"]);
        expect(plain.seen.printed).toContain(`| read: "mock v" undefined undefined true`);
        const compiled = await runTests(String(dir), env, "--aot", ...flags);
        if (flags.length) expect(compiled.all).toContain("AOT test run | layers 2");
        expect(compiled.seen).toEqual(plain.seen);
      });
    });
  });
}
