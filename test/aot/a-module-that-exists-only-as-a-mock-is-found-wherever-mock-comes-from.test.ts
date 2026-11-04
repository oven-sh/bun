import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `const { mock } = require("bun:test"); mock.module("made-up", () => ({ v: "mocked" }))`, where no package and no file has the name.
// The build listed the names that only a mock answers for from the calls of `mock.module` whose `mock` an import statement names. Any other way to `mock` left the
// name off the list, and whoever imported it was told at run time that the build had not found it.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "readers.test.ts": `import { test } from "bun:test";
import { v } from "made-up";
test("three ways to read the mock", async () => {
  console.log("SEEN the mock:", v, require("made-up").v, (await import("made-up")).v);
});
`,
  // Over layers these two lie in a program below the test files.
  "lazy.cjs": `exports.read = function () { return require("made-up").v; };`,
  "lazy-import.ts": `export async function read() { return (await import("made-up")).v; }`,
  "lazy-readers.test.ts": `import { test } from "bun:test";
import { read as readByRequire } from "./lazy.cjs";
import { read as readByImport } from "./lazy-import.ts";
test("files that test files import read the mock when they are called", async () => {
  console.log("SEEN the mock, from the files that test files import:", readByRequire(), await readByImport());
});
`,
  "nobody.test.ts": `import { test } from "bun:test";
const here = import.meta.dirname;
const say = (how: string, error: any) => console.log("SEEN nobody mocks it,", how, error.name, error.code, String(error.message).replaceAll(here, "<here>").split(" imported from ")[0]);
test("names that nobody mocks", async () => {
  try { require("nobody-has-it"); } catch (error) { say("require():", error); }
  try { await import("nobody-has-it"); } catch (error) { say("import():", error); }
  try { require("./no-such-file.js"); } catch (error) { say("a path:", error); }
  // The error names what the program asked for, which the build spells "./no-such-file.js".
  try { require(here + "/no-such-file.js"); } catch (error) { say("require() of a whole path:", error); }
  try { require.resolve(here + "/no-such-file.js"); } catch (error) { say("require.resolve() of a whole path:", error); }
});
`,
  "nobody-imported.test.ts": `import { test } from "bun:test";
import { v } from "nobody-has-it-either";
test("never runs", () => console.log("SEEN", v));
`,
};

const mocked = `("made-up", () => ({ v: "mocked" }));`;
const preloads: [how: string, file: string, text: string][] = [
  ["a pattern takes it from require()", "preload.cjs", `const { mock } = require("bun:test");\nmock.module${mocked}`],
  ["it is a member of require()", "preload.cjs", `require("bun:test").mock.module${mocked}`],
  [
    "a name holds what require() answered",
    "preload.cjs",
    `const runner = require("bun:test");\nrunner.mock.module${mocked}`,
  ],
  ["an ES module calls require()", "preload.ts", `const { mock } = require("bun:test");\nmock.module${mocked}`],
  ["jest.mock() of require()", "preload.cjs", `const { jest } = require("bun:test");\njest.mock${mocked}`],
  ["it is a member of the namespace", "preload.ts", `import * as runner from "bun:test";\nrunner.mock.module${mocked}`],
  [
    "a function is handed it",
    "preload.ts",
    `import { mock } from "bun:test";\nfunction fake(handed: typeof mock) { handed.module${mocked} }\nfake(mock);`,
  ],
];

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return {
    seen: stdout
      .split("\n")
      .filter(line => line.startsWith("SEEN"))
      .sort(),
    errors: stderr
      .split("\n")
      .filter(line => line.startsWith("error: "))
      .map(line => line.split(" from ")[0]),
    exitCode,
  };
}

const ways = [
  ...preloads.map(preload => [preload, "as one program", "TestRunLayers:0"] as const),
  [preloads[0], "over two layers", "TestRunLayers:2,TestRunPartFiles:1"] as const,
];

for (const [[how, file, text], way, words] of ways) {
  test(`a module that exists only as a mock is found: ${how}, ${way}`, async () => {
    using dir = tempDir("aot-a-module-that-exists-only-as-a-mock", {
      ...files,
      [file]: text,
      "bunfig.toml": `[test]\npreload = ["./${file}"]\n`,
    });
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      seen: [
        "SEEN nobody mocks it, a path: ResolveMessage MODULE_NOT_FOUND Cannot find module './no-such-file.js'",
        "SEEN nobody mocks it, import(): ResolveMessage ERR_MODULE_NOT_FOUND Cannot find package 'nobody-has-it'",
        "SEEN nobody mocks it, require() of a whole path: ResolveMessage MODULE_NOT_FOUND Cannot find module '<here>/no-such-file.js'",
        "SEEN nobody mocks it, require(): ResolveMessage MODULE_NOT_FOUND Cannot find module 'nobody-has-it'",
        "SEEN nobody mocks it, require.resolve() of a whole path: ResolveMessage MODULE_NOT_FOUND Cannot find module '<here>/no-such-file.js'",
        "SEEN the mock, from the files that test files import: mocked mocked",
        "SEEN the mock: mocked mocked mocked",
      ],
      errors: ["error: Cannot find package 'nobody-has-it-either'"],
      exitCode: 1,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
