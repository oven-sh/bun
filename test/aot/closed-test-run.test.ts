// A test run in which no file of the tests can load what was not compiled stays closed: a load by name in the code under test finds compiled files alone, as it does in an executable.
// `require("node:path")` in a helper beside the tests is as closed as an import of it: the word `require` opens nothing. Handing the loader about, a name that nobody knows, and text that is evaluated do.
// What the run is compiled as stands in the build's own log: `loads code by name` (open) or `loads compiled files by name` (closed) counts the load in src/load.cjs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const helpers: [name: string, file: string, text: string, stays: "closed" | "open"][] = [
  ["an import of a built-in module", "helper.mjs", `export { sep as mark } from "node:path";`, "closed"],
  ["require of a built-in module", "helper.cjs", `exports.mark = require("node:path").sep;`, "closed"],
  ["require of a built-in module without node:", "helper.cjs", `exports.mark = require("path").sep;`, "closed"],
  ["require of a file", "helper.cjs", `exports.mark = require("./other.cjs").other;`, "closed"],
  ["require of a package", "helper.cjs", `exports.mark = require("a-package").which;`, "closed"],
  ["typeof require", "helper.cjs", `exports.mark = typeof require;`, "closed"],
  ["require.resolve", "helper.cjs", `exports.mark = require.resolve("./other.cjs");`, "closed"],
  ["import.meta.require", "helper.mjs", `export const mark = import.meta.require("node:path").sep;`, "closed"],
  [
    "process.getBuiltinModule",
    "helper.mjs",
    `export const mark = process.getBuiltinModule("node:path").sep;`,
    "closed",
  ],
  [
    "require under a name that nobody knows",
    "helper.cjs",
    `exports.mark = process.env.NOBODY_SETS_THIS ? require(process.env.NOBODY_SETS_THIS) : 1;`,
    "open",
  ],
  ["require handed on", "helper.cjs", `exports.mark = 1; globalThis.kept = [require];`, "open"],
  ["text that is evaluated", "helper.cjs", `exports.mark = (0, eval)("1");`, "open"],
  // From such a store on a plain require("./a") anywhere may be answered with a file that no import names.
  [
    "a resolver is stored",
    "helper.cjs",
    `const Module = require("node:module"); const original = Module._resolveFilename; Module._resolveFilename = function (...given) { return original.apply(this, given); }; exports.mark = 1;`,
    "open",
  ],
  [
    "a loader is stored",
    "helper.cjs",
    `const Module = require("module"); const original = Module._load; Module._load = function (...given) { return original.apply(this, given); }; exports.mark = 1;`,
    "open",
  ],
  [
    "require of the prototype is stored",
    "helper.cjs",
    `const Module = require("node:module"); const original = Module.prototype.require; Module.prototype.require = function (name) { return original.call(this, name); }; exports.mark = 1;`,
    "open",
  ],
  [
    "a handler for an extension is stored",
    "helper.cjs",
    `require("node:module")._extensions[".mine"] = (module, path) => { module.exports = path; }; exports.mark = 1;`,
    "open",
  ],
  [
    "a handler is stored in require.extensions",
    "helper.cjs",
    `require.extensions[".mine"] = (module, path) => { module.exports = path; }; exports.mark = 1;`,
    "open",
  ],
  [
    "the module's object as a bundler hands it on",
    "helper.cjs",
    `const wrap = given => ({ default: given }); const Module = wrap(require("module")); const original = Module.default._load; Module.default._load = function (...given) { return original.apply(this, given); }; exports.mark = 1;`,
    "open",
  ],
  [
    "the module's object by an import",
    "helper.mjs",
    `import Module from "node:module"; const original = Module._resolveFilename; Module._resolveFilename = function (...given) { return original.apply(this, given); }; export const mark = 1;`,
    "open",
  ],
  [
    "the module's object by process.getBuiltinModule",
    "helper.mjs",
    `const Module = process.getBuiltinModule("module"); const original = Module._load; Module._load = function (...given) { return original.apply(this, given); }; export const mark = 1;`,
    "open",
  ],
  [
    "the module's object by import()",
    "helper.mjs",
    `const Module = (await import("node:module")).default; const original = Module._load; Module._load = function (...given) { return original.apply(this, given); }; export const mark = 1;`,
    "open",
  ],
  [
    "a handler is stored in the extensions of what createRequire makes",
    "helper.mjs",
    `import { createRequire } from "node:module"; createRequire(import.meta.url).extensions[".mine"] = (module, path) => { module.exports = path; }; export const mark = 1;`,
    "open",
  ],
  ["a package stores a loader", "helper.mjs", `import "a-hook"; export const mark = 1;`, "open"],
  [
    "createRequire under names that are written out",
    "helper.mjs",
    `import { createRequire } from "node:module"; export const mark = createRequire(import.meta.url)("node:path").sep;`,
    "closed",
  ],
  [
    "createRequire under a name that nobody knows",
    "helper.mjs",
    `import { createRequire } from "node:module"; export const mark = process.env.NOBODY_SETS_THIS ? createRequire(import.meta.url)(process.env.NOBODY_SETS_THIS) : 1;`,
    "open",
  ],
  [
    "what createRequire makes is handed on",
    "helper.mjs",
    `import { createRequire } from "node:module"; globalThis.kept = [createRequire(import.meta.url)]; export const mark = 1;`,
    "open",
  ],
];

for (const [name, file, text, stays] of helpers) {
  test.concurrent(`${name}: the run stays ${stays}`, async () => {
    using dir = tempDir("closed-test-run", {
      "package.json": `{ "name": "p" }`,
      "node_modules/a-package/package.json": `{ "name": "a-package", "version": "1.0.0", "main": "index.js" }`,
      "node_modules/a-package/index.js": `exports.which = "a package";`,
      "node_modules/a-hook/package.json": `{ "name": "a-hook", "version": "1.0.0", "main": "index.js" }`,
      "node_modules/a-hook/index.js": `const Module = require("module"); const original = Module._load; Module._load = function (...given) { return original.apply(this, given); };`,
      "src/load.cjs": `exports.load = function (name) { return require(name); };`,
      "main.cjs": `require("./src/load.cjs").load("node:os");`,
      "test/other.cjs": `exports.other = 1;`,
      [`test/${file}`]: text,
      "test/a.test.js": `import { test } from "bun:test";
import { mark } from "./${file}";
import { load } from "../src/load.cjs";
test("t", () => console.log("SEEN", mark !== undefined, typeof load(process.env.NOBODY_SETS_THIS_EITHER ?? "node:os").EOL));`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), {
      ...bunEnv,
      BUN_JSC_logAOTPhaseTimes: "1",
    });
    const [, open, closed] = /loads code by name (\d+) \| loads compiled files by name (\d+)/.exec(stderr) ?? [];
    const found =
      Number(open) > 0 && closed === "0" ? "open" : open === "0" && closed === "1" ? "closed" : `${open} | ${closed}`;
    expect({ found, seen: stdout.includes("SEEN true string"), exitCode }).toEqual({
      found: stays,
      seen: true,
      exitCode: 0,
    });
  });
}

// module-alias and its like: the test file lays a resolver of its own, and a name that only that resolver knows finds a file that no import names.
for (const words of [undefined, "TestRunLayers:2"]) {
  test.concurrent(`a resolver of the test file's own is asked, ${words ?? "one program"}`, async () => {
    using dir = tempDir("closed-test-run-resolver", {
      "package.json": `{ "name": "p" }`,
      "src/x.cjs": `module.exports = "found";`,
      "a.test.cjs": `const Module = require("module");
const path = require("path");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@app/")) request = path.join(__dirname, "src", request.slice(5));
  return original.call(this, request, ...rest);
};
const { test } = require("bun:test");
test("t", () => console.log("SEEN", require("@app/x.cjs")));`,
    });
    const { stdout, exitCode } = await run(
      [bunExe(), "test", "--aot"],
      String(dir),
      words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv,
    );
    expect({ seen: stdout.includes("SEEN found"), exitCode }).toEqual({ seen: true, exitCode: 0 });
  });
}

// The module that the runner makes for a mock without a factory is made of text, and a run that stays in its compiled files refuses text. So such a run doesn't stay there.
for (const dep of ["dep.js", "dep.cjs"]) {
  test.concurrent(`a module that has loaded, a reset, and a mock of it without a factory: ${dep}`, async () => {
    using dir = tempDir("closed-test-run-automock", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "dep.js": `export const f = () => 1;`,
      "dep.cjs": `exports.f = () => 1;`,
      "a.test.js": `import { test, vi } from "bun:test";
test("t", async () => {
  await import("./${dep}");
  vi.resetModules();
  vi.doMock("./${dep}");
  try { const mocked = await import("./${dep}"); console.log("SEEN", typeof mocked.f, vi.isMockFunction(mocked.f)); } catch (error) { console.log("SEEN threw", error.message); }
});`,
    });
    const seen = ({ stdout }: { stdout: string }) => stdout.split("\n").filter(line => line.startsWith("SEEN"));
    const plain = seen(await run([bunExe(), "test"], String(dir), bunEnv));
    expect(plain).toEqual(["SEEN function true"]);
    expect(seen(await run([bunExe(), "test", "--aot"], String(dir), bunEnv))).toEqual(plain);
  });
}
