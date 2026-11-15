// A package that the project depends on loads by a name that is made at run time. Asked for are a package on disk that nothing imports, and a compiled file that no text spells.
// `bun test --aot` is there to say whether the executable works, so each load ends as it ends in an executable built from the same files: it went by whose loader answered, and
// the loader of the main module, of the parent or of a path that a test hands in is a test file's, which may load code from disk. A test passed on what the executable refuses.
// It goes by where the call is written. What a compiled file hands out is called with a text where the program calls it with numbers alone.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const project = (loader: string, handed: string) => {
  const asks = `const open = require("./app.js");
const hidden = require("node:path").join(__dirname, JSON.parse('["li", "b/hid", "den.js"]').join(""));
const say = () => { console.log("UNSEEN " + open(JSON.parse('"engine"'), ${handed})); console.log("COMPILED " + open(hidden, ${handed})); };
`;
  return {
    "package.json": `{ "name": "made-up", "dependencies": { "loader": "1.0.0" } }`,
    "node_modules/loader/package.json": `{ "name": "loader", "version": "1.0.0", "main": "index.js" }`,
    "node_modules/loader/index.js": loader,
    "node_modules/engine/package.json": `{ "name": "engine", "version": "1.0.0", "main": "index.js" }`,
    "node_modules/engine/index.js": `module.exports = { twice(n) { return n + n; } };`,
    "lib/hidden.js": `exports.twice = function twice(n) { return n + n; };`,
    "app.js": `const load = require("loader");
const kept = require("./lib/hidden.js");
let sum = 0;
for (let i = 0; i < 50; i++) sum += kept.twice(i);
module.exports = function open(name, handed) {
  try {
    return "found " + load(name, handed).twice("ab") + " " + sum;
  } catch (error) {
    return "refused " + String(error.message).replace(/'[^']*'/, "'the file'");
  }
};
`,
    "main.js": asks + "say();\n",
    "app.test.js": asks + `require("bun:test").test("the loads", say);\n`,
  };
};

const said = (stdout: string) => stdout.split("\n").filter(line => /^(UNSEEN|COMPILED) /.test(line));
const verdicts = (stdout: string) => said(stdout).map(line => line.split(" ").slice(0, 2).join(" "));
const found = ["UNSEEN found abab 2450", "COMPILED found abab 2450"];

async function inExecutable(directory: string, ...furtherEntryPoints: string[]) {
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", "./main.js", ...furtherEntryPoints, "--outfile", executable], directory); // prettier-ignore
  expect(built.exitCode).toBe(0);
  return (await run([executable], directory, bunEnv)).stdout;
}
const inTestRun = async (directory: string, ...flags: string[]) =>
  (await run([bunExe(), "test", ...flags, "./app.test.js"], directory, bunEnv)).stdout;

describe.each(
  Object.entries({
    "the file's own require": ["module.exports = name => require(name);", "undefined"],
    "the require of the main module": ["module.exports = name => require.main.require(name);", "undefined"],
    "the require of the parent's parent": ["module.exports = name => module.parent.parent.require(name);", "undefined"],
    "the require of process.mainModule": ["module.exports = name => process.mainModule.require(name);", "undefined"],
    "a loader made for a path that is handed in": [
      `const { createRequire } = require("node:module"); module.exports = (name, path) => createRequire(path)(name);`,
      "__filename",
    ],
  }),
)("%s", (_, [loader, handed]) => {
  test("ends in a test run as in the executable", async () => {
    using dir = tempDir("aot-a-load-written-in-the-product", project(loader, handed));
    expect(said(await inTestRun(String(dir)))).toEqual(found);
    const executable = verdicts(await inExecutable(String(dir)));
    expect(executable).toEqual(["UNSEEN refused", "COMPILED refused"]);
    expect(verdicts(await inTestRun(String(dir), "--aot"))).toEqual(executable);
  });
});

test("a loader of its own that a test hands in loads as under bun test", async () => {
  using dir = tempDir(
    "aot-a-loader-that-a-test-hands-in",
    project("module.exports = (name, load) => load(name);", "require"),
  );
  expect(said(await inTestRun(String(dir)))).toEqual(found);
  expect(said(await inTestRun(String(dir), "--aot"))).toEqual(found);
});

test("a test run does not know of further entry points, and says what helps", async () => {
  using dir = tempDir("aot-a-further-entry-point", project("module.exports = name => require(name);", "undefined"));
  expect(said(await inExecutable(String(dir), "./lib/hidden.js"))[1]).toBe(found[1]);
  expect(said(await inTestRun(String(dir), "--aot"))[1]).toBe(
    "COMPILED refused Cannot load 'the file': no import() or require() that the build saw can reach it by a dynamic path. " +
      "Import the file by a constant path, or add --aot-allow-code-from-disk. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)",
  );
  expect(said(await inTestRun(String(dir), "--aot", "--aot-allow-code-from-disk"))).toEqual(found);
});
