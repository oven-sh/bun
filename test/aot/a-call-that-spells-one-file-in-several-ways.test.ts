import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `require(short ? "./a" : "./a.cjs")` spells two names and may load one file. Three places of the build counted the names and looked them up in the list of the files.
const files = {
  "a.cjs": `exports.name = "a";`,
  "b.cjs": `globalThis.timesLoaded = (globalThis.timesLoaded ?? 0) + 1; exports.name = "b";`,
  "helper.cjs": `
    globalThis.timesHelperLoaded = (globalThis.timesHelperLoaded ?? 0) + 1;
    exports.load = short => require(short ? "./a" : "./a.cjs").name;`,
  "a-file-that-loads-again.test.cjs": `
    const { test } = require("bun:test");
    test("a file that loads again", () => {
      console.log(require("./helper.cjs").load(true));
      delete require.cache[require.resolve("./helper.cjs")];
      console.log(require("./helper.cjs").load(false), globalThis.timesHelperLoaded);
    });`,
  "a-key.test.cjs": `
    const { test } = require("bun:test");
    test("a key that is taken out of require.cache", () => {
      for (const short of [true, false]) {
        console.log(require("./b.cjs").name);
        delete require.cache[require.resolve(short ? "./b" : "./b.cjs")];
      }
      console.log(require("./b.cjs").name, globalThis.timesLoaded);
    });`,
  "main.cjs": `
    const load = way => require(way == 0 ? "fs" : way == 1 ? "./a" : way == 2 ? "./a.cjs" : "../files/a.cjs");
    console.log(typeof load(process.argv.length - 2).readFileSync, load(1).name, load(2).name, load(3).name);`,
  "beside-the-library.test.cjs": `
    const { test } = require("bun:test");
    const load = way => require(way == 0 ? "fs" : way == 1 ? "./a" : way == 2 ? "./a.cjs" : "../files/a.cjs");
    test("beside a module of the library", () => {
      console.log(typeof load(0).readFileSync, load(1).name, load(2).name, load(3).name);
    });`,
};
const nested = Object.fromEntries(Object.entries(files).map(([name, text]) => ["files/" + name, text]));

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, env);
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each(["", "TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])(
  "a test run prints what bun test prints: %s",
  async words => {
    using dir = tempDir("a-call-that-spells-one-file-in-several-ways", nested);
    const folder = join(String(dir), "files");
    const plain = await runTests(folder, []);
    expect(plain).toMatchObject({ counts: [" 3 pass", " 0 fail"], exitCode: 0 });
    expect(plain.printed).toContain("a 2\n");
    expect(plain.printed).toContain("b 3\n");
    expect(plain.printed).toContain("function a a a\n");
    expect(await runTests(folder, ["--aot"], words)).toEqual(plain);
  },
  240_000,
);

test("an executable prints what bun run prints", async () => {
  using dir = tempDir("a-call-that-spells-one-file-in-several-ways", nested);
  const folder = join(String(dir), "files");
  const plain = await run([bunExe(), "main.cjs"], folder, bunEnv);
  expect(plain).toMatchObject({ stdout: "function a a a\n", exitCode: 0 });
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "main"], folder, bunEnv);
  expect(built.stderr).not.toContain("panic");
  expect(built.exitCode).toBe(0);
  expect(await run([join(folder, isWindows ? "main.exe" : "main")], folder, bunEnv)).toMatchObject({
    stdout: plain.stdout,
    exitCode: 0,
  });
}, 240_000);
