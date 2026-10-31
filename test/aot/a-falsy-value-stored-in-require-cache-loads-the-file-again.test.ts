import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

const counter = (name: string) =>
  `globalThis.${name} = (globalThis.${name} ?? 0) + 1;\nmodule.exports = { load: globalThis.${name} };`;

// Every key is one that the build can follow to its file: no other file of the project may load again.
const keysThatTheFilesSpell = {
  "counts/counter.cjs": counter("counts"),
  "counts/one.test.js": `
    import { test } from "bun:test";
    test("require() runs the file again", () => {
      const path = require.resolve("./counter.cjs");
      const first = require("./counter.cjs");
      require.cache[path] = undefined;
      const second = require("./counter.cjs");
      console.log("counts:", first.load, second.load, first === second, second === require("./counter.cjs"));
      require.cache[require.resolve("./counter.cjs")] = null;
      console.log("counts:", require("./counter.cjs").load);
    });`,

  "hooks/counter.cjs": counter("hooks"),
  "hooks/one.test.js": `
    import { beforeEach, test } from "bun:test";
    beforeEach(() => { require.cache[require.resolve("./counter.cjs")] = undefined; });
    test("one", () => { console.log("hooks:", require("./counter.cjs").load); });
    test("two", () => { console.log("hooks:", require("./counter.cjs").load); });
    test("three", () => { console.log("hooks:", require("./counter.cjs").load); });`,

  "imports/required.cjs": counter("required"),
  "imports/imported.cjs": counter("imported"),
  "imports/declared.cjs": counter("declared"),
  "imports/module.mjs": `globalThis.loads = (globalThis.loads ?? 0) + 1;\nexport const load = globalThis.loads;`,
  "imports/required.json": `{ "n": 1 }`,
  "imports/declared.json": `{ "n": 2 }`,
  "imports/one.test.js": `
    import { test } from "bun:test";
    import declared from "./declared.cjs";
    import data from "./declared.json";
    test("import() behind the store runs the file again", async () => {
      const first = require("./required.cjs");
      require.cache[require.resolve("./required.cjs")] = undefined;
      const second = await import("./required.cjs");
      console.log("imports:", first.load, second.default.load, require("./required.cjs").load);
    });
    test("a file that import() has loaded stays", async () => {
      const first = await import("./imported.cjs");
      require.cache[require.resolve("./imported.cjs")] = undefined;
      const second = await import("./imported.cjs");
      console.log("imports:", first.default.load, second.default.load, require("./imported.cjs").load);
    });
    test("a file that a declaration has loaded stays", () => {
      require.cache[require.resolve("./declared.cjs")] = undefined;
      console.log("imports:", declared.load, require("./declared.cjs").load);
    });
    test("an ES module stays", async () => {
      const first = require("./module.mjs");
      require.cache[require.resolve("./module.mjs")] = undefined;
      const second = require("./module.mjs");
      console.log("imports:", first.load, second.load, (await import("./module.mjs")).load, first === second);
    });
    test("a file of data is read again, unless a declaration has loaded it", () => {
      const first = require("./required.json");
      require.cache[require.resolve("./required.json")] = undefined;
      console.log("imports:", first.n, require("./required.json").n, first === require("./required.json"));
      const held = require("./declared.json");
      require.cache[require.resolve("./declared.json")] = undefined;
      console.log("imports:", data.n, held === require("./declared.json"));
    });`,

  "shows/counter.cjs": counter("shows"),
  "shows/one.test.js": `
    import { test } from "bun:test";
    test("what the table shows behind the store", () => {
      const path = require.resolve("./counter.cjs");
      const shown = () => [typeof require.cache[path], path in require.cache, Object.keys(require.cache).includes(path)].join(" ");
      require("./counter.cjs");
      console.log("shows:", shown());
      require.cache[path] = undefined;
      console.log("shows:", shown());
      require("./counter.cjs");
      console.log("shows:", shown(), require.cache[path].exports.load);
    });`,

  "unloaded/counter.cjs": counter("unloaded"),
  "unloaded/one.test.js": `
    import { test } from "bun:test";
    test("a store before the first load changes nothing", () => {
      require.cache[require.resolve("./counter.cjs")] = undefined;
      const first = require("./counter.cjs");
      console.log("unloaded:", first.load, first === require("./counter.cjs"));
    });`,
};

const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"];
const keysMadeAtRunTime = {
  ...Object.fromEntries(names.map(name => [name + ".cjs", counter(name)])),
  "forget.cjs": `exports.forget = path => { require.cache[path] = undefined; };`,
  "own.cjs": `globalThis.own = (globalThis.own ?? 0) + 1;\nrequire.cache[__filename] = undefined;\nmodule.exports = { load: globalThis.own };`,
  "one.test.js": `
    import { test } from "bun:test";
    import Module from "node:module";
    import { forget } from "./forget.cjs";
    const twice = (name, forget) => {
      const path = require.resolve("./" + name + ".cjs");
      const first = require(path);
      forget(path);
      return [name, first.load, require(path).load].join(" ");
    };
    test("every falsy value", () => {
      console.log([
        twice("a", path => { require.cache[path] = 0; }),
        twice("b", path => { require.cache[path] = false; }),
        twice("c", path => { require.cache[path] = ""; }),
        twice("d", path => { require.cache[path] = NaN; }),
      ].join(", "));
    });
    test("every way to store", () => {
      console.log([
        twice("e", forget),
        twice("f", path => { const table = require.cache; table[path] = null; }),
        twice("g", path => { Module._cache[path] = undefined; }),
        twice("h", path => { [require.cache[path]] = [undefined]; }),
        twice("i", path => { ({ entry: require.cache[path] } = { entry: undefined }); }),
        twice("j", path => { require.cache[path] &&= undefined; }),
        twice("k", path => { Reflect.set(require.cache, path, undefined); }),
      ].join(", "));
    });
    test("nothing is stored over an entry that is there", () => {
      console.log([
        twice("l", path => { require.cache[path] ||= undefined; }),
        twice("m", path => { require.cache[path] ??= undefined; }),
      ].join(", "));
    });
    test("a file that stores over its own entry runs each time", () => {
      console.log("own:", require("./own.cjs").load, require("./own.cjs").load, require("./own.cjs").load);
    });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
  ["with the test files from disk", { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }],
];

for (const [project, files] of Object.entries({ keysThatTheFilesSpell, keysMadeAtRunTime })) {
  for (const [way, env] of ways) {
    test(`${project}, ${way}`, async () => {
      using dir = tempDir("falsy-value-in-require-cache", files);
      const said = async (flags: string[], env: Record<string, string>) => {
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
          ...bunEnv,
          ...env,
        });
        if (exitCode !== 0) console.error(stderr);
        return { stdout, exitCode };
      };
      const plain = await said([], {});
      expect(plain.exitCode).toBe(0);
      expect(plain.stdout).toContain(" 1 2");
      expect(await said(["--aot"], env)).toEqual(plain);
    });
  }
}
