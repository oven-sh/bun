import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// `require.cache[path] = { exports: fake }`: how a test puts something of its own in place of a CommonJS file. require() answers with the entry from then on.
const real = (name: string) =>
  `globalThis.${name} = (globalThis.${name} ?? 0) + 1;\nmodule.exports = { name: "real ${name}", load: globalThis.${name} };`;
const head = `import { test } from "bun:test";\nconst fake = name => ({ exports: { name: "fake " + name }, loaded: true });`;

const project = {
  "package.json": `{ "type": "module" }`,
  "node_modules/pk/package.json": `{ "name": "pk", "main": "index.js" }`,
  "node_modules/pk/index.js": real("pk"),

  "unloaded/file.cjs": real("unloaded"),
  "unloaded/user.cjs": `exports.ask = () => require("./file.cjs").name;`,
  "unloaded/one.test.js": `${head}
    import { ask } from "./user.cjs";
    test("a file that has not run never runs", () => {
      require.cache[require.resolve("./file.cjs")] = fake("unloaded");
      console.log("unloaded:", require("./file.cjs").name, ask(), globalThis.unloaded);
    });`,

  "loaded/file.cjs": real("loaded"),
  "loaded/user.cjs": `exports.ask = () => require("./file.cjs").name;`,
  "loaded/one.test.js": `${head}
    import { ask } from "./user.cjs";
    test("a file that has run", () => {
      const first = require("./file.cjs");
      console.log("loaded:", first.name, ask());
      require.cache[require.resolve("./file.cjs")] = fake("loaded");
      console.log("loaded:", first.name, require("./file.cjs").name, ask(), globalThis.loaded);
    });`,

  "packages/user.cjs": `exports.ask = () => require("pk").name;`,
  "packages/one.test.js": `${head}
    import { ask } from "./user.cjs";
    test("a package", () => {
      console.log("packages:", require("pk").name, ask());
      require.cache[require.resolve("pk")] = fake("pk");
      console.log("packages:", require("pk").name, ask());
    });`,

  "back/file.cjs": real("back"),
  "back/one.test.js": `${head}
    test("the file is back behind a delete", () => {
      const path = require.resolve("./file.cjs");
      require.cache[path] = fake("back");
      console.log("back:", require("./file.cjs").name);
      delete require.cache[path];
      console.log("back:", require("./file.cjs").name, require("./file.cjs").load);
      require.cache[path] = fake("again");
      console.log("back:", require("./file.cjs").name);
      require.cache[path] = undefined;
      console.log("back:", require("./file.cjs").name, require("./file.cjs").load);
    });`,

  "hooks/file.cjs": real("hooks"),
  "hooks/user.cjs": `exports.ask = () => require("./file.cjs").name;`,
  "hooks/one.test.js": `${head}
    import { afterEach, beforeEach } from "bun:test";
    import { ask } from "./user.cjs";
    const path = require.resolve("./file.cjs");
    let count = 0;
    beforeEach(() => { require.cache[path] = fake("hooks " + ++count); });
    afterEach(() => { delete require.cache[path]; });
    test("one", () => { console.log("hooks:", ask()); });
    test("two", () => { console.log("hooks:", ask()); });`,

  "shows/file.cjs": real("shows"),
  "shows/one.test.js": `${head}
    test("what the table shows", () => {
      const path = require.resolve("./file.cjs");
      const entry = fake("shows");
      require.cache[path] = entry;
      console.log("shows:", require.cache[path] === entry, path in require.cache, Object.keys(require.cache).includes(path));
      require("./file.cjs");
      console.log("shows:", require.cache[path] === entry);
    });`,

  "kinds/module.mjs": `export const name = "real module";`,
  "kinds/data.json": `{ "name": "real data" }`,
  "kinds/one.test.js": `${head}
    test("an ES module and a file of data", () => {
      require.cache[require.resolve("./module.mjs")] = fake("module");
      require.cache[require.resolve("./data.json")] = fake("data");
      console.log("kinds:", require("./module.mjs").name, require("./data.json").name);
    });`,

  "moved/one.cjs": real("one"),
  "moved/other.cjs": real("other"),
  "moved/one.test.js": `${head}
    test("the entry of another file", () => {
      require("./other.cjs");
      require.cache[require.resolve("./one.cjs")] = require.cache[require.resolve("./other.cjs")];
      console.log("moved:", require("./one.cjs").name, require("./one.cjs") === require("./other.cjs"), globalThis.one);
    });`,

  "ways/a.cjs": real("a"),
  "ways/b.cjs": real("b"),
  "ways/c.cjs": real("c"),
  "ways/d.cjs": real("d"),
  "ways/put.cjs": `exports.put = (path, entry) => { require.cache[path] = entry; };`,
  "ways/one.test.js": `${head}
    import Module from "node:module";
    import { put } from "./put.cjs";
    test("every way to store", () => {
      const by = (name, store) => { const path = require.resolve("./" + name + ".cjs"); store(path, fake(name)); return require(path).name; };
      console.log("ways:", [
        by("a", put),
        by("b", (path, entry) => { Module._cache[path] = entry; }),
        by("c", (path, entry) => { const table = require.cache; table[path] = entry; }),
        by("d", (path, entry) => { Reflect.set(require.cache, path, entry); }),
      ].join(", "));
    });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
  ["with the test files from disk", { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, {
    ...bunEnv,
    ...env,
  });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { printed: printed.sort(), results: results.sort(), exitCode };
}

for (const [way, env] of ways) {
  test.concurrent(`an entry that a test stores in require.cache answers require(), ${way}`, async () => {
    using dir = tempDir("an-entry-stored-in-require-cache", project);
    const plain = await runTests(String(dir), {});
    expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
    expect(plain.printed).toContain("unloaded: fake unloaded fake unloaded undefined");
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
}
