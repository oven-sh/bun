// import-fresh, decache, clear-module and proxyquire take a file out of require.cache by a path that they are handed: packages all of them.
// The look through the test files reads no package, so over layers only the program that holds the package knew that any file may load again. A file of the project was
// compiled for a module that loads once, and the run stopped: "Cannot take '../src/dep.js' out of require.cache: the build found nothing that does".
import { expect } from "bun:test";
import { foldersOfOneRun } from "./harness/folders-of-one-run";
import { test } from "./supported";

const ways = {
  "a path that the test resolves": `clear(require.resolve("./src/dep.js")); clear(require.resolve("./src/counter.js"));`,
  "a path that the test puts together": `for (const name of ["dep", "counter"]) clear(__dirname + "/src/" + name + ".js");`,
  "every key that is no package's": `clearAll();`,
};

// About the layers: every case runs in every form. The package and the files of the project read alike in all of them, so they share the run of a form.
const linesOf = foldersOfOneRun(
  "aot-package-evicts-a-file",
  Object.fromEntries(
    Object.entries(ways).map(([name, way]) => [
      name,
      {
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
      },
    ]),
  ),
);

test.concurrent.each(Object.keys(ways))("%s: plain Bun", async name => {
  expect(await linesOf(name, [])).toEqual({
    lines: [`OUT {"run":1,"dep":1}`, `OUT {"run":2,"dep":2} {"run":2,"dep":2}`],
    exitCode: 0,
  });
});

test.concurrent.each(
  Object.keys(ways).flatMap(name =>
    (
      [
        ["as the run builds itself", undefined],
        ["two layers", "TestRunLayers:2"],
        ["three layers", "TestRunLayers:3"],
      ] as const
    ).map(([form, words]) => [name, form, words] as const),
  ),
)("%s: %s", async (name, _, words) => {
  expect(await linesOf(name, ["--aot"], words)).toEqual(await linesOf(name, []));
});
