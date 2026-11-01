import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A loader of plugins in a package, or in the application, is handed the path of a file. Over layers the file may be compiled into the piece of the test file
// that alone names it, under a name that only the build of the piece puts together. The layers below are built without the piece, so their import() finds the
// file through the loader, as a name that no build followed: that was refused ("this executable can't load a module from a dynamic path").
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }
`,
  "tsconfig.json": `{}
`,
  "node_modules/loads/package.json": `{ "name": "loads", "version": "1.0.0", "type": "module", "main": "index.js" }
`,
  "node_modules/loads/index.js": `import { createRequire } from "node:module";
const requireHere = createRequire(import.meta.url);
export const importByPath = path => import(path);
export const requireByPath = path => requireHere(path);
`,
  "src/loads.js": `export const importByPath = path => import(path);
`,
  "helpers/state.js": `export let count = 0;
export const bump = () => ++count;
`,
  "helpers/hidden.js": `export const onlyByPath = "an export that is read only off what came back";
globalThis.loadsOfHidden = (globalThis.loadsOfHidden ?? 0) + 1;
export { count } from "./state.js";
export class Plugin { describe() { return "plugin " + globalThis.loadsOfHidden; } }
export default { kind: "default" };
export const isMain = import.meta.main;
`,
  "helpers/hidden-too.js": `export const text = "the application loads this one";
globalThis.loadsOfHiddenToo = (globalThis.loadsOfHiddenToo ?? 0) + 1;
`,
  "helpers/hidden.cjs": `globalThis.loadsOfHiddenCommonJS = (globalThis.loadsOfHiddenCommonJS ?? 0) + 1;
exports.onlyByPath = "a name on exports that is read only off what came back";
exports.about = () => [typeof module, typeof require, __filename.split("/").slice(-2).join("/")];
`,
  "a.test.js": `import { expect, test } from "bun:test";
import * as ofPackage from "loads";
import * as ofApplication from "./src/loads.js";
import * as state from "./helpers/state.js";
const here = import.meta.dir;
const say = (label, value) => console.log("SEEN " + label + " | " + JSON.stringify(value));
const tried = (label, act) => test(label, async () => { try { say(label, await act()); } catch (error) { say(label, "THREW " + error.name + ": " + String(error.message).replace(/\\/[^ '"]*\\//g, "<dir>/").slice(0, 70)); } expect(1).toBe(1); });

tried("a package imports it", async () => { state.bump(); const got = await ofPackage.importByPath(here + "/helpers/hidden.js"); const mine = await import([here, "helpers", "hidden.js"].join("/")); return [got.onlyByPath, got === mine, got.count === state.count, globalThis.loadsOfHidden]; });
tried("all of it is there", async () => { const got = await ofPackage.importByPath(here + "/helpers/hidden.js"); return [Object.keys(got), new got.Plugin().describe(), got.default, got["only" + "ByPath"].length]; });
tried("the application imports one", async () => { const got = await ofApplication.importByPath(here + "/helpers/hidden-too.js"); const mine = await import([here, "helpers", "hidden-too.js"].join("/")); return [got.text, got === mine, globalThis.loadsOfHiddenToo]; });
tried("a package requires a CommonJS file", () => { const got = ofPackage.requireByPath(here + "/helpers/hidden.cjs"); const mine = require([here, "helpers", "hidden.cjs"].join("/")); return [got.onlyByPath, got === mine, got.about(), globalThis.loadsOfHiddenCommonJS]; });
tried("a package imports the CommonJS file", async () => { const got = await ofPackage.importByPath(here + "/helpers/hidden.cjs"); return [got.default.onlyByPath, got.default === require([here, "helpers", "hidden.cjs"].join("/")), globalThis.loadsOfHiddenCommonJS]; });
tried("it is not the main module", async () => [import.meta.main, (await ofPackage.importByPath(here + "/helpers/hidden.js")).isMain, Bun.main.split("/").at(-1)]);
`,
  "b.test.js": `import { expect, test } from "bun:test";
test("another file, so that the run has pieces", () => expect(1).toBe(1));
`,
};

async function seenIn(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("a layer below loads, by a path it is handed, a file that a test file alone names", async () => {
  using dir = tempDir("aot-a-layer-below-loads-a-file-of-a-piece", files);
  const plain = await seenIn(String(dir), undefined);
  expect(plain).toEqual({
    seen: [
      'SEEN a package imports it | ["an export that is read only off what came back",true,true,1]',
      'SEEN all of it is there | [["Plugin","count","default","isMain","onlyByPath"],"plugin 1",{"kind":"default"},46]',
      'SEEN the application imports one | ["the application loads this one",true,1]',
      'SEEN a package requires a CommonJS file | ["a name on exports that is read only off what came back",true,["object","function","helpers/hidden.cjs"],1]',
      'SEEN a package imports the CommonJS file | ["a name on exports that is read only off what came back",true,1]',
      'SEEN it is not the main module | [true,false,"a.test.js"]',
    ],
    exitCode: 0,
  });
  expect(await seenIn(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:1,TestRunPartFiles:1", "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
}, 180_000);
