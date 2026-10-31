import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A package stores into the global object under names that a test hands it, as fake timers do. The layer of the packages follows no name to the store, so it leaves the
// members open. The layers over it hold no such store: they have to read in the layer below that the members are open.
const said = `const said = (ask) => { try { return String(ask()); } catch (error) { return error.name + ": " + error.message; } };`;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/fake/package.json": `{ "name": "fake", "main": "index.js" }`,
  "node_modules/fake/index.js": `"use strict";
const target = typeof globalThis !== "undefined" ? globalThis : global;
const kept = {};
exports.install = function (names) {
  for (const name of names) { kept[name] = target[name]; target[name] = function fake() { return "fake " + name; }; }
};
exports.uninstall = function () { for (const name of Object.keys(kept)) target[name] = kept[name]; };
`,
  // As sinon's fake timers find the global object: in another file of another package.
  "node_modules/where/package.json": `{ "name": "where", "main": "index.js" }`,
  "node_modules/where/index.js": `exports.global = typeof globalThis !== "undefined" ? globalThis : global;\n`,
  "node_modules/fake-far/package.json": `{ "name": "fake-far", "main": "index.js" }`,
  "node_modules/fake-far/index.js": `"use strict";
const target = require("where").global;
const kept = {};
exports.install = function (names) {
  for (const name of names) { kept[name] = target[name]; target[name] = function fake() { return "far " + name; }; }
};
exports.uninstall = function () { for (const name of Object.keys(kept)) target[name] = kept[name]; };
`,
  "helpers/timers.js": `export const later = () => setTimeout(() => {}, 0);\nexport const soon = () => setImmediate(() => {});\n`,
  "named.test.js": `import { expect, test } from "bun:test";
import fake from "fake";
import { later } from "./helpers/timers.js";
${said}
test("the test file names the member", () => {
  console.log("SEEN named | " + said(() => { fake.install(["setTimeout", "clearTimeout"]); const got = [setTimeout(() => {}, 0), later()]; fake.uninstall(); return got + " " + typeof setTimeout(() => {}, 0); }));
  expect(1).toBe(1);
});
`,
  "far.test.js": `import { expect, test } from "bun:test";
import fake from "fake-far";
import { later } from "./helpers/timers.js";
${said}
test("the package reads the global object out of another package", () => {
  console.log("SEEN far | " + said(() => { fake.install(["setTimeout"]); const got = [setTimeout(() => {}, 0), later()]; fake.uninstall(); return got + " " + typeof later(); }));
  expect(1).toBe(1);
});
`,
  "joined.test.js": `import { expect, test } from "bun:test";
import fake from "fake";
import { soon } from "./helpers/timers.js";
${said}
test("the test file joins the name", () => {
  const name = ["set", "Immediate"].join("");
  console.log("SEEN joined | " + said(() => { fake.install([name]); const got = [globalThis[name](() => {}), soon()]; fake.uninstall(); return got + " " + typeof soon(); }));
  expect(1).toBe(1);
});
`,
};

async function seenIn(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  return {
    seen: stdout
      .split("\n")
      .filter(line => line.startsWith("SEEN "))
      .sort(),
    exitCode,
  };
}

test("a member that a package of the lowest layer stores under a name from above is open in every layer", async () => {
  using dir = tempDir("aot-layer-tells-what-it-writes", files);
  const plain = await seenIn(String(dir), undefined);
  expect(plain).toEqual({
    seen: [
      "SEEN far | far setTimeout,far setTimeout object",
      "SEEN joined | fake setImmediate,fake setImmediate object",
      "SEEN named | fake setTimeout,fake setTimeout object",
    ],
    exitCode: 0,
  });
  expect(await seenIn(String(dir), undefined, "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:1,TestRunPartFiles:1", "--aot")).toEqual(plain);
});
