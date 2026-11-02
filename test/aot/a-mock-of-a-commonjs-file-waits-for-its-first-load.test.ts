import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const commonJSFiles = Object.fromEntries(
  ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].map(name => [
    `${name}.cjs`,
    `console.log("the body of ${name}.cjs runs"); exports.name = "${name}.cjs";`,
  ]),
);

const files = {
  ...commonJSFiles,
  "package.json": `{ "type": "module" }`,
  "node_modules/lazy-package/package.json": `{ "name": "lazy-package", "main": "index.js" }`,
  "node_modules/lazy-package/index.js": `console.log("the body of lazy-package runs"); exports.name = "lazy-package";`,
  "requires-a.mjs": `export const byRequire = () => require("./a.cjs").name;`,
  "imports-h.mjs": `import h from "./h.cjs"; export const name = h.name;`,
  "names-i.mjs": `import { name } from "./i.cjs"; export const got = name;`,
  "requires-j.cjs": `exports.name = () => require("./j.cjs").name;`,
  "waits.test.ts": `
    import { test, mock } from "bun:test";
    function mocked(label: string, path: string) {
      mock.module(path, () => { console.log(label, "the factory runs"); return { default: { name: "mock of " + path }, name: "mock of " + path }; });
      console.log(label, "mocked");
    }
    test("required by a function of an ES module", () => { const top = require("./requires-a.mjs"); mocked("1", "./a.cjs"); console.log("1", top.byRequire()); });
    test("required by the test file", () => { mocked("2", "./b.cjs"); console.log("2", require("./b.cjs").name); });
    test("loaded by import()", async () => { mocked("3", "./c.cjs"); console.log("3", (await import("./c.cjs")).name); });
    test("never loaded", () => { mocked("4", "./d.cjs"); console.log("4", "the end"); });
    test("already loaded", () => { console.log("5", require("./e.cjs").name); mocked("5", "./e.cjs"); console.log("5", require("./e.cjs").name); });
    test("a package", () => { mocked("6", "lazy-package"); console.log("6", require("lazy-package").name); });
    test("what the factory reads is set in between", () => {
      let setting = "before";
      mock.module("./f.cjs", () => ({ name: "made with " + setting }));
      setting = "after";
      console.log("7", require("./f.cjs").name);
    });
    test("mocked twice before the first load", () => {
      mock.module("./g.cjs", () => { console.log("8", "the first factory runs"); return { name: "first" }; });
      mock.module("./g.cjs", () => { console.log("8", "the second factory runs"); return { name: "second" }; });
      console.log("8", require("./g.cjs").name);
    });
    test("below a module that imports it by a statement", async () => { mocked("9", "./h.cjs"); console.log("9", (await import("./imports-h.mjs")).name); });
    test("a name imported by a statement", async () => { mocked("10", "./i.cjs"); console.log("10", (await import("./names-i.mjs")).got); });
    test("required by another CommonJS file", () => { const uses = require("./requires-j.cjs"); mocked("11", "./j.cjs"); console.log("11", uses.name(), uses.name()); });
    test("what require.cache lists", () => {
      const path = require.resolve("./k.cjs");
      mocked("12", "./k.cjs");
      console.log("12", path in require.cache);
      console.log("12", require("./k.cjs").name, path in require.cache, require("./k.cjs") === require("./k.cjs"));
    });
    test("mocked again behind the first load", () => {
      mocked("13", "./l.cjs");
      console.log("13", require("./l.cjs").name);
      mock.module("./l.cjs", () => { console.log("13", "the second factory runs"); return { name: "second" }; });
      console.log("13", require("./l.cjs").name);
    });
    test("a factory that throws", () => {
      let runs = 0;
      mock.module("./m.cjs", () => { runs++; throw new RangeError("from the factory"); });
      console.log("14", "mocked");
      try { require("./m.cjs"); } catch (error: any) { console.log("14", error.name, error.message, runs, require.resolve("./m.cjs") in require.cache); }
    });`,
};

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, ""), exitCode };
}

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("%s", async (_, words) => {
  using directory = tempDir("mock-of-a-commonjs-file-waits", files);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain("2 mocked\n2 the factory runs\n2 mock of ./b.cjs");
  expect(plain.printed).toContain("7 made with after");
  expect(plain.printed).not.toContain("the first factory runs");
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
