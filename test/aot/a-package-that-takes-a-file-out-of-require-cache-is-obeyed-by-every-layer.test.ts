// import-fresh, decache, clear-module and proxyquire take a file out of require.cache by a path that they are handed: packages all of them.
// The look through the test files reads no package, so over layers only the program that holds the package knew that any file may load again. A file of the project was
// compiled for a module that loads once, and the run stopped: "Cannot take '../src/dep.js' out of require.cache: the build found nothing that does".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const ways = {
  "a path that the test resolves": `clear(require.resolve("./src/dep.js")); clear(require.resolve("./src/counter.js"));`,
  "a path that the test puts together": `for (const name of ["dep", "counter"]) clear(__dirname + "/src/" + name + ".js");`,
  "every key that is no package's": `clearAll();`,
};

async function linesOf(way: string, flags: string[], words?: string) {
  using dir = tempDir("aot-package-evicts-a-file", {
    "package.json": `{ "name": "p" }`,
    "node_modules/fresh/package.json": `{ "name": "fresh", "main": "index.js" }`,
    "node_modules/fresh/index.js": `
      exports.clear = filePath => { delete require.cache[filePath]; };
      exports.clearAll = () => { for (const key of Object.keys(require.cache)) if (!key.includes("node_modules")) delete require.cache[key]; };`,
    "src/dep.js": `globalThis.depRuns = (globalThis.depRuns ?? 0) + 1;\nexports.run = globalThis.depRuns;\n`,
    "src/counter.js": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.run = globalThis.runs;\nexports.dep = require("./dep.js").run;\n`,
    "src/user.js": `exports.load = () => JSON.stringify(require("./counter.js"));\n`,
    "a.test.cjs": `
      const { test } = require("bun:test");
      const { clear, clearAll } = require("fresh");
      const user = require("./src/user.js");
      test("t", () => {
        console.error("OUT", user.load());
        ${way}
        console.error("OUT", user.load(), JSON.stringify(require("./src/counter.js")));
      });`,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(ways))(
  "%s",
  async (_, way) => {
    const plain = await linesOf(way, []);
    expect(plain).toEqual({
      lines: [`OUT {"run":1,"dep":1}`, `OUT {"run":2,"dep":2} {"run":2,"dep":2}`],
      exitCode: 0,
    });
    expect(await linesOf(way, ["--aot"])).toEqual(plain);
    expect(await linesOf(way, ["--aot"], "TestRunLayers:2")).toEqual(plain);
    expect(await linesOf(way, ["--aot"], "TestRunLayers:3")).toEqual(plain);
  },
  240_000,
);
