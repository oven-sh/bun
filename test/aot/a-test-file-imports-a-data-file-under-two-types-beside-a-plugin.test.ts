import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// The import statements of a test file that name a file of data are linked by the loader when the test file starts. Two of them that name one
// file under two types get what the first of them loaded, under `bun test` and compiled. The build gave the second a module of its own
// that nothing asked for: "internal compiler error (ReadAndVerify): InvalidModule" where the program is verified, as it is under this harness.
const files = {
  "package.json": `{ "type": "module" }`,
  "object.json": `{ "a": 1 }`,
  "a.test.ts": `
    import { test } from "bun:test";
    Bun.plugin({ name: "probe", setup(build) { build.onLoad({ filter: /\\.yaml$/ }, () => ({ exports: { value: "from plugin" }, loader: "object" })); } });
    test("a", () => {});`,
  "c.test.mjs": `
    import { test } from "bun:test";
    import object from "./object.json" with { type: "yaml" };
    import namedText from "./object.json" with { type: "text" };
    console.log(typeof object, JSON.stringify(object), typeof namedText, JSON.stringify(namedText));
    test("c", () => {});`,
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, env);
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each([
  [[], ""],
  [[], "TestRunLayers:0"],
  [["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
] as [string[], string][])(
  "the run ends as under bun test: %j %s",
  async (flags, words) => {
    using dir = tempDir("a-data-file-under-two-types", files);
    const folder = String(dir);
    const plain = await runTests(folder, flags);
    expect(plain).toMatchObject({ counts: [" 2 pass", " 0 fail"], exitCode: 0 });
    expect(await runTests(folder, ["--aot", ...flags], words)).toEqual(plain);
  },
  240_000,
);
