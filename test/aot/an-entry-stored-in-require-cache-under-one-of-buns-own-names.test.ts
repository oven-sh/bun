import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const project = {
  "package.json": `{}`,
  "tsconfig.json": `{}`,
  "src/required.cjs": `
    exports.seen = () => [require("bun:sqlite").fake, require("ws").fake, require("undici").fake].join();`,
  "own-names.test.js": `import { test } from "bun:test";
    import { Database } from "bun:sqlite";
    test("an entry under one of Bun's own names", async () => {
      const required = require("./src/required.cjs");
      console.log("SEEN before:", typeof require("bun:sqlite").Database, required.seen());
      const entry = { exports: { fake: "sqlite" } };
      require.cache["bun:sqlite"] = entry;
      require.cache.ws = { exports: { fake: "ws" } };
      require.cache[require.resolve("undici")] = { exports: { fake: "undici" } };
      console.log("SEEN stored:", require("bun:sqlite") === entry.exports, required.seen());
      console.log("SEEN imports:", typeof Database, typeof (await import("bun:sqlite")).Database);
      const name = "bun:sqlite";
      console.log("SEEN by a name:", require(name).fake, import.meta.require("bun:sqlite").fake);
      delete require.cache["bun:sqlite"];
      delete require.cache.ws;
      delete require.cache.undici;
      console.log("SEEN deleted:", typeof require("bun:sqlite").Database, required.seen());
      require.cache.bun = { exports: { fake: "bun" } };
      console.log("SEEN bun:", require("bun").fake, typeof require("bun").file);
    });`,
};

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("an entry under one of Bun's own names answers require() in a test run", async () => {
  using dir = tempDir("an-entry-under-one-of-buns-own-names", project);
  const plain = await runTests(String(dir), "");
  expect(plain.seen).toContain("SEEN stored: true sqlite,ws,undici");
  expect(await runTests(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
});

test("process.getBuiltinModule() looks in no cache, as one program and over layers", async () => {
  using dir = tempDir("aot-get-builtin-module-beside-an-entry", {
    "package.json": `{}`,
    "tsconfig.json": `{}`,
    "get-builtin-module.test.js": `import { test } from "bun:test";
      test("a stored entry", () => {
        const real = require("bun:sqlite");
        require.cache["bun:sqlite"] = { exports: { fake: "sqlite" } };
        const asked = process.getBuiltinModule("bun:sqlite");
        console.log("SEEN asked:", asked.fake, asked === real, typeof asked.Database);
        console.log("SEEN required:", require("bun:sqlite").fake);
      });`,
  });
  const plain = await runTests(String(dir), "");
  expect(plain.seen).toEqual(["SEEN asked: undefined true function", "SEEN required: sqlite"]);
  expect(await runTests(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await runTests(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
});
