import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// A package loads one of two files by process.env.NODE_ENV, as react does. `bun test` reads the name when the package loads, so
// `bun test --aot` compiles both files and loads the one that the name asks for then. A --define of the name decides it in the
// build, as it does in `bun test`, and the other file is no part of the program. The map of the code that the build writes names the
// file of each function: that is how the test sees which of the two were compiled.
const files = {
  "tsconfig.json": "{}",
  "picks/index.ts": `declare const require: (path: string) => { build: string };
    if (process.env.NODE_ENV === "production") {
      module.exports = require("./production.ts");
    } else {
      module.exports = require("./development.ts");
    }`,
  "picks/development.ts": `export const build: string = "development";`,
  "picks/production.ts": `export const build: string = "production";`,
  "stored.test.ts": `import { test } from "bun:test";
    test("the name is stored before the package loads", () => {
      process.env.NODE_ENV = "production";
      console.log("loaded", require("./picks/index.ts").build);
    });`,
};

async function runTests(directory: string, words: string, ...flags: string[]) {
  const map = join(directory, "program.map");
  const env = {
    ...bunEnv,
    NODE_ENV: undefined,
    BUN_DEBUG_TEST_AOT_WORDS: words,
    [buildEnvironment.mapFilePath]: map,
  };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  const rows = existsSync(map) ? readFileSync(map, "latin1") : "";
  rmSync(map, { force: true });
  const compiled = ["development.ts", "production.ts"].filter(name => rows.includes(`/picks/${name}\t`));
  return { loaded: stdout.match(/^loaded .*$/m)?.[0], compiled, exitCode };
}

test("both files are compiled, and the one that the name asks for is loaded", async () => {
  using dir = tempDir("aot-one-of-two-files-by-node-env", files);
  const plain = { loaded: "loaded production", compiled: [], exitCode: 0 };
  expect(await runTests(String(dir), "TestRunLayers:0")).toEqual(plain);
  expect(await runTests(String(dir), "TestRunLayers:0", "--aot")).toEqual({
    ...plain,
    compiled: ["development.ts", "production.ts"],
  });
});

test.each([["one program", "TestRunLayers:0"]])(
  "a --define of the name leaves the other file out: %s",
  async (_, words) => {
    using dir = tempDir("aot-one-of-two-files-by-node-env", files);
    const define = ["--define", `process.env.NODE_ENV="test"`];
    const plain = { loaded: "loaded development", compiled: [], exitCode: 0 };
    expect(await runTests(String(dir), words, ...define)).toEqual(plain);
    expect(await runTests(String(dir), words, ...define, "--aot")).toEqual({ ...plain, compiled: ["development.ts"] });
  },
);
