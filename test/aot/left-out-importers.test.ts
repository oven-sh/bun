// An ES file takes a name of a CommonJS file. On the written path from the entry the ES file is left out ("sideEffects" and nothing
// of it used), and it stays in the executable because an import() or a require() names it. The executable died before its first
// line: "export 'K1' not found in './c.cjs'". Each case changes one thing about that program: what the CommonJS file exports, how
// the ES file takes it, what is left out on the way, how the file is loaded. An executable, run without its sources, prints what
// `bun run` prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { partOfGrid } from "./harness/ways";
import { test } from "./supported";

type Files = Record<string, string>;
const start = `console.log("start", C);\n`;
const fromIndex = `import { C } from "./p/index.mjs";\n` + start;
const beside = `import { C } from "./p/c2.mjs";\n`;
const kept = `const m = await import("./p/b.mjs");\nconsole.log(typeof m.K1);\n`;
const base: Files = {
  "main.mjs": fromIndex + kept,
  "p/package.json": `{ "name": "p", "sideEffects": false }\n`,
  "p/index.mjs": `export * from "./c2.mjs";\nexport * from "./b.mjs";\n`,
  "p/c2.mjs": `export const C = 1;\n`,
  "p/b.mjs": `export { K1 } from "./c.cjs";\n`,
  "p/c.cjs": `exports.K1 = class {};\n`,
};
const used: Files = {
  "main.mjs": fromIndex + `const m = await import("./p/b.mjs");\nconsole.log(m.use());\n`,
  "p/b.mjs": `import { K1 } from "./c.cjs";\nexport function use() { return typeof K1; }\n`,
};
const esModule = `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n`;
const tsc = esModule + `exports.K1 = void 0;\nclass K1 {\n}\nexports.K1 = K1;\n`;
const esbuild = `var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var src_exports = {};
__export(src_exports, {
  K1: () => K1
});
module.exports = __toCommonJS(src_exports);
class K1 {
}
`;

const exported: Record<string, string> = {
  "a literal": `exports.K1 = 1;\n`,
  "a function": `exports.K1 = function () { return 1; };\n`,
  "a class": base["p/c.cjs"],
  "what a call answers": `function make() { return { v: 1 }; }\nexports.K1 = make();\n`,
  "a getter": `Object.defineProperty(exports, "K1", { enumerable: true, get() { return 1; } });\n`,
  "Object.assign": `Object.assign(exports, { K1: class {} });\n`,
  "module.exports": `module.exports = { K1: class {} };\n`,
  "a computed key": `exports[["K", "1"].join("")] = 1;\n`,
  "a store in a function": `function fill(e) { e.K1 = 1; }\nfill(exports);\n`,
  "a store under a condition": `if (process.argv.length < 99) exports.K1 = 1;\n`,
  "as tsc prints a class": tsc,
  "as Babel prints a class":
    esModule +
    `exports.K1 = void 0;\nvar K1 = exports.K1 = /*#__PURE__*/function () {\n  function K1() {}\n  return K1;\n}();\n`,
  "as esbuild prints a class": esbuild,
  "as swc prints a class":
    esModule +
    `Object.defineProperty(exports, "K1", {\n    enumerable: true,\n    get: function() {\n        return K1;\n    }\n});\nclass K1 {\n}\n`,
};
const taken: Record<string, Files> = {
  "import { K1 } and a use": used,
  "export *": { "p/b.mjs": `export * from "./c.cjs";\n` },
  "import d": { "p/b.mjs": `import d from "./c.cjs";\nexport const K1 = d.K1;\n` },
  "import * as": { "p/b.mjs": `import * as ns from "./c.cjs";\nexport const K1 = ns.K1;\n` },
};
const leftOut: Record<string, Files> = {
  'a list of "sideEffects"': { "p/package.json": `{ "name": "p", "sideEffects": ["./none.mjs"] }\n` },
  'no "sideEffects"': { "p/package.json": `{ "name": "p" }\n` },
  'no "name"': { "p/package.json": `{ "sideEffects": false }\n` },
  "the star comes first": { "p/index.mjs": `export * from "./b.mjs";\nexport * from "./c2.mjs";\n` },
  "two stars deep": {
    "p/index.mjs": `export * from "./c2.mjs";\nexport * from "./mid.mjs";\n`,
    "p/mid.mjs": `export * from "./b.mjs";\n`,
  },
  "export * as": { "p/index.mjs": `export * from "./c2.mjs";\nexport * as inner from "./b.mjs";\n` },
  "an import of nothing": { "main.mjs": beside + `import "./p/b.mjs";\n` + start + kept },
  "an import nobody uses": { "main.mjs": beside + `import { K1 } from "./p/b.mjs";\n` + start + kept },
  "a barrel": { "p/index.mjs": `export { C } from "./c2.mjs";\nexport { K1 as unused } from "./b.mjs";\n` },
  "a pure call": {
    "main.mjs":
      beside +
      `import * as taken from "./p/b.mjs";\nconst wrap = x => x;\nconst unused = /* @__PURE__ */ wrap(taken);\n` +
      start +
      kept,
  },
  "no written path": { "main.mjs": beside + start + kept },
  "two written paths, one stays": {
    "main.mjs": `import { seen } from "./p/other.mjs";\n` + fromIndex + `console.log(seen());\n` + kept,
    "p/other.mjs": `import { K1 } from "./b.mjs";\nexport const seen = () => typeof K1;\n`,
  },
};
const loaded: Record<string, Files> = {
  "destructured": { "main.mjs": fromIndex + `const { K1 } = await import("./p/b.mjs");\nconsole.log(typeof K1);\n` },
  "destructured, a function that uses the name": {
    ...used,
    "main.mjs": fromIndex + `const { use } = await import("./p/b.mjs");\nconsole.log(use());\n`,
  },
  "then()": { "main.mjs": fromIndex + `import("./p/b.mjs").then(m => console.log(typeof m.K1));\n` },
  "nobody waits": { "main.mjs": fromIndex + `import("./p/b.mjs");\nconsole.log("end");\n` },
  "in a try": {
    "main.mjs":
      fromIndex + `try {\n  ${kept.replace("\n", "\n  ")}} catch (error) {\n  console.log("caught", error.name);\n}\n`,
  },
  "in a function nobody calls": {
    "main.mjs": fromIndex + `export function never() { return import("./p/b.mjs"); }\nconsole.log("end");\n`,
  },
  "below a file that import() loads": {
    "main.mjs": fromIndex + `console.log((await import("./later.mjs")).seen);\n`,
    "later.mjs": `const m = await import("./p/b.mjs");\nexport const seen = typeof m.K1;\n`,
  },
  "a joined name": { "main.mjs": fromIndex + kept.replace(`"./p/b.mjs"`, `["./p/b", "mjs"].join(".")`) },
  "what import.meta.resolve answers": {
    "main.mjs": fromIndex + kept.replace(`"./p/b.mjs"`, `import.meta.resolve("./p/b.mjs")`),
  },
  "a URL": { "main.mjs": fromIndex + kept.replace(`"./p/b.mjs"`, `new URL("./p/b.mjs", import.meta.url)`) },
  "require()": { "main.mjs": fromIndex + kept.replace("await import", "require") },
  "require() in a CommonJS file": {
    "main.mjs": `import { load } from "./loader.cjs";\n` + fromIndex + `console.log(typeof load().K1);\n`,
    "loader.cjs": `exports.load = () => require("./p/b.mjs");\n`,
  },
  "require() in a function nobody calls": {
    "main.mjs": fromIndex + `export function never() { return require("./p/b.mjs"); }\nconsole.log("end");\n`,
  },
};
const cycle = `import "./d.mjs";\nexport { K1 } from "./c.cjs";\n`;
const further: Record<string, Files> = {
  "a plain name beside a class": {
    "p/c.cjs": `exports.K0 = 1;\nexports.K1 = class {};\n`,
    "p/b.mjs": `export { K0, K1 } from "./c.cjs";\n`,
  },
  "a CommonJS file that hands on another": {
    "p/c.cjs": `module.exports = require("./d.cjs");\n`,
    "p/d.cjs": base["p/c.cjs"],
  },
  "a CommonJS file that copies another": {
    "p/c.cjs": `const d = require("./d.cjs");\nfor (const k in d) exports[k] = d[k];\n`,
    "p/d.cjs": base["p/c.cjs"],
  },
  "CommonJS in a .js file": { "p/b.mjs": `export { K1 } from "./c.js";\n`, "p/c.js": base["p/c.cjs"] },
  "a CommonJS package": {
    "p/b.mjs": `export { K1 } from "dep";\n`,
    "p/node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }\n`,
    "p/node_modules/dep/index.js": base["p/c.cjs"],
  },
  "a dual package": {
    "p/b.mjs": `import * as ns from "dual";\nexport const K1 = ns.K1;\n`,
    "p/node_modules/dual/package.json": `{ "name": "dual", "exports": { "import": "./index.mjs", "require": "./index.cjs" } }\n`,
    "p/node_modules/dual/index.mjs": `export { K1 } from "./index.cjs";\n`,
    "p/node_modules/dual/index.cjs": tsc,
  },
  "two files take the name": {
    "main.mjs": fromIndex + kept + `console.log(typeof (await import("./p/b2.mjs")).K2);\n`,
    "p/index.mjs": base["p/index.mjs"] + `export * from "./b2.mjs";\n`,
    "p/b2.mjs": `export { K1 as K2 } from "./c.cjs";\n`,
  },
  "the file stands in a cycle": {
    "p/b.mjs": cycle,
    "p/d.mjs": `import * as b from "./b.mjs";\nexport const seen = () => typeof b.K1;\n`,
  },
  "the file awaits": { "p/b.mjs": `await 0;\n` + base["p/b.mjs"] },
  "the file imports one that awaits": {
    "p/b.mjs": `import "./t.mjs";\n` + base["p/b.mjs"],
    "p/t.mjs": `await 0;\nexport const T = 1;\n`,
  },
  "a JSON file": { "p/b.mjs": `export { K1 } from "./c.json";\n`, "p/c.json": `{ "K1": 1 }\n` },
  "a built-in module": { "p/b.mjs": `export { join as K1 } from "node:path";\n` },
  "an ES file": { "p/b.mjs": `export { K1 } from "./c.mjs";\n`, "p/c.mjs": `export class K1 {}\n` },
};

const grid: [string, Files][] = [
  ...Object.entries(exported).map(([name, text]): [string, Files] => [`exported: ${name}`, { "p/c.cjs": text }]),
  ...Object.entries(taken).map(([name, files]): [string, Files] => [`taken: ${name}`, files]),
  ...Object.entries(leftOut).map(([name, files]): [string, Files] => [`left out: ${name}`, files]),
  ...Object.entries(loaded).map(([name, files]): [string, Files] => [`loaded: ${name}`, files]),
  ...Object.entries(further),
];
// One of each way in which the executable died, and of each road to it.
const witnesses = [
  "exported: a class",
  "taken: import { K1 } and a use",
  "left out: an import of nothing",
  "loaded: in a function nobody calls",
  "loaded: require() in a CommonJS file",
  "a plain name beside a class",
  "a dual package",
];
const cases = [
  ...grid.filter(([name]) => witnesses.includes(name)),
  ...partOfGrid(
    "importers that are left out",
    grid.filter(([name]) => !witnesses.includes(name)),
    10,
    ([name]) => name,
  ),
];

test.each(cases)("%s", async (_, files) => {
  const all = Object.entries({ ...base, ...files }).map(([file, text]) => [`app/${file}`, text]);
  using dir = tempDir("left-out-importers", { ...Object.fromEntries(all), "away/empty.txt": "" });
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const { stdout, exitCode } = await run([bunExe(), "run", "main.mjs"], app, bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: expect.stringMatching(/^start 1\n/), exitCode: 0 });
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], app, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  rmSync(app, { recursive: true });
  const ran = await run([executable], away, bunEnv);
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stdout, stderr: "", exitCode });
});
