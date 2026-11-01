import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll, raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Faults of `bun test --aot` that are fixed: everyday uses of mocks, of stubs and of what one test file leaves to the next. A folder a case, all of them ONE project
// whose test files share a realm and are named in order on the command line: one plain run, which is the specification, one compiled run as one program and one over two layers. A run over layers compiles all
// of Bun's own library whatever stands over it, so a case here costs a second of processor time where a project of its own costs forty.
// A NEW CASE: the company may hide a fault. It goes in only if it FAILS HERE, beside the others, on a Bun from before its fix. One that fails only alone gets a file of
// its own, outside ../every-build.txt.
// Every line that a case prints begins with `| CASE`, which stands for the name of its folder.
raiseDefaultTimeout(240_000);

const library = `
export const later = (ms, f) => setTimeout(f, ms);
export const every = (ms, f) => setInterval(f, ms);
export const stop = id => clearTimeout(id);
export const now = () => Date.now();
export const year = () => new Date().getFullYear();
export const perf = () => Math.floor(performance.now());
export const tick = f => process.nextTick(f);
export const soon = f => setImmediate(f);
export const readGlobal = () => (typeof someGlobal === "undefined" ? "none" : someGlobal);
export const readFetch = () => typeof fetch;
export const env = () => String(process.env.LR_NAME);
export const metaEnv = () => String(import.meta.env.LR_NAME);
export const nodeEnv = () => String(process.env.NODE_ENV);
export const random = () => Math.random();
export const json = value => JSON.stringify(value);
export const keys = value => Object.keys(value).join();
export class Box {
  value() { return "real"; }
  static make() { return "real"; }
  get size() { return 1; }
}
export const boxValue = () => new Box().value();
export const boxSize = () => new Box().size;
export const boxMake = () => Box.make();
export const object = { method() { return "real"; }, nested: { deep() { return "real"; } }, list: [1, 2], number: 1 };
export const callMethod = () => object.method();
export function plain() { return "real"; }
export const callPlain = () => plain();
export default function main() { return "real default"; }
`;
const user = `import main, { plain } from "./lib.js";
export const call = () => plain() + " " + main();
`;
const commonjs = `exports.plain = () => "real";
exports.number = 1;
exports.Box = class { value() { return "real"; } };
`;
const head = `import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, mock, test, vi } from "bun:test";
const say = (...all) => console.log("| CASE", ...all);
const tried = async f => { try { return await f(); } catch (e) { return e.name + ": " + String(e.message).slice(0, 100); } };
`;
const overLibrary = (tests: string, more: Record<string, string> = {}) => ({
  "package.json": `{ "name": "p", "type": "module" }\n`,
  "lib.js": library,
  "user.js": user,
  "file.cjs": commonjs,
  "m.test.js": head + tests,
  ...more,
});

const cases: Record<string, Record<string, string>> = {
  "automock-over-a-barrel": {
    "a.test.mjs": `import { test, mock } from "bun:test";
test("a", async () => { mock.module("./leaf.mjs", () => ({ leaf: "mock leaf", f: () => "mock f", default: "mock default" })); console.log("| CASE a", (await import("./reader.mjs")).read()); });
`,
    "b.test.mjs": `import { test, vi } from "bun:test";
test("b", async () => { vi.doMock("./barrel.mjs"); const space = await import("./barrel.mjs"); console.log("| CASE b", typeof space.f, String(space.f()), space.leaf, space.ofBarrel, Object.keys(space).join("+")); });
`,
    "barrel.mjs": `export * from "./dep.mjs"; export { default } from "./dep.mjs"; export const ofBarrel = "of barrel";
`,
    "dep.mjs": `export * from "./leaf.mjs"; export { default } from "./leaf.mjs"; export const real = "real";
`,
    "leaf.mjs": `export const leaf = "real leaf"; export function f() { return "real f"; } export default "real default";
`,
    "package.json": `{ "name": "p" }
`,
    "reader.mjs": `import d, { leaf, f, real, ofBarrel } from "./barrel.mjs"; import * as space from "./barrel.mjs"; export const read = () => [d, leaf, f(), real, ofBarrel, Object.keys(space).join("+")].join(",");
`,
    "z.test.mjs": `import { test } from "bun:test";
test("z", async () => { console.log("| CASE z", (await import("./reader.mjs")).read()); });
`,
  },
  "commonjs-mocked-before-it-ran": {
    "a.test.js": `import { filler1 } from "./filler.mjs"; void filler1;
import { test, vi } from "bun:test";
test("a", async () => { vi.doMock("./dep.cjs", () => ({ who: "one" })); const held = await import("./held.js"); console.log("| CASE a " + held.read()); });
`,
    "b.test.js": `import { filler1 } from "./filler.mjs"; void filler1;
import { test } from "bun:test";
import { read } from "./held.js";
test("b", () => console.log("| CASE b " + read()));
`,
    "dep.cjs": `exports.who = "real";
`,
    "filler.mjs": `export function filler0(x) { return x + 0; }
export function filler1(x) { return x + 1; }
`,
    "held.js": `import { who } from "./dep.cjs";
import * as ns from "./dep.cjs";
export const read = () => who + " " + ns.who;
`,
    "package.json": `{ "type": "module" }
`,
  },
  "domock": overLibrary(
    `test("t", async () => {
vi.doMock("./lib.js", () => ({ plain: () => "mocked", default: () => "mocked default" })); say((await import("./user.js")).call(), (await import("./lib.js")).plain());
});
`,
  ),
  "domock-behind-the-load": overLibrary(
    `import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
vi.doMock("./lib.js", () => ({ plain: () => "mocked", default: () => "mocked default" })); say(lib.plain(), call(), (await import("./lib.js")).plain());
});
`,
  ),
  "dounmock": overLibrary(
    `test("t", async () => {
vi.doMock("./lib.js", () => ({ plain: () => "mocked", default: () => "mocked default" })); say((await import("./lib.js")).plain()); vi.doUnmock("./lib.js"); say((await import("./lib.js")).plain(), (await import("./user.js")).call());
});
`,
  ),
  "ended-package-mock": {
    "a.test.js": `import { filler1 } from "./filler.mjs"; void filler1;
import { test, mock } from "bun:test";
mock.module("pkg", () => ({ default: { f: () => "mocked" }, f: () => "mocked" }));
const { seen: mine } = await import("./src/uses.js");
const { seen: ofPackage } = await import("reads");
test("a", () => console.log("| CASE a " + mine() + "," + ofPackage()));
`,
    "b.test.js": `import { filler1 } from "./filler.mjs"; void filler1;
import { test } from "bun:test";
import { seen as mine } from "./src/uses.js";
import { seen as ofPackage } from "reads";
test("b", () => console.log("| CASE b " + mine() + "," + ofPackage()));
`,
    "filler.mjs": `export function filler0(x) { return x + 0; }
export function filler1(x) { return x + 1; }
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "node_modules/pkg/index.js": `export const f = () => "real"; export default { f };
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }
`,
    "node_modules/reads/index.js": `import { f } from "pkg";
export const seen = () => f() + "+" + require("pkg").f();
`,
    "node_modules/reads/package.json": `{ "name": "reads", "type": "module", "main": "index.js" }
`,
    "src/uses.js": `import { f } from "pkg";
export const seen = () => f() + "+" + require("pkg").f();
`,
  },
  "hoisted-mocks-of-a-built-in-and-a-package": {
    "hoist.test.ts": `import { test, vi } from "vitest";
import { exists, name } from "./uses";
import fs, { existsSync } from "node:fs";
vi.mock("node:fs", () => ({ default: { existsSync: () => "default" }, existsSync: () => "mocked" }));
vi.mock("pkg", () => ({ default: { name: "mocked" } }));
(globalThis.events ??= []).push(exists, name, existsSync("/"), fs.existsSync("/"));
test("t", () => console.log("| CASE " + JSON.stringify(globalThis.events)));
`,
    "uses.ts": `import { existsSync } from "node:fs";
import pkg from "pkg";
export const exists = existsSync("/"), name = pkg.name;
`,
    "node_modules/pkg/index.js": `(globalThis.events ??= []).push("load pkg"); module.exports = { name: "real" };
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }
`,
  },
  "import-actual": overLibrary(
    `vi.mock("./lib.js", async () => ({ ...(await vi.importActual("./lib.js")), plain: () => "mocked" }));
import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
say(lib.plain(), call(), lib.object.number, lib.callPlain()); const actual = await vi.importActual("./lib.js"); say(actual.plain(), actual === lib);
});
`,
  ),
  "import-mock": overLibrary(
    `import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
const made = await vi.importMock("./lib.js"); say(vi.isMockFunction(made.plain), String(made.plain()), made.object.number, typeof made.Box, lib.plain(), made === lib);
});
`,
  ),
  "import-original": {
    "factory.test.ts": `import { test, vi } from "bun:test";
import { seen } from "./user.ts";
vi.mock("./styled.ts", async importOriginal => { try { const actual: any = await importOriginal(); return { who: () => "mocked " + actual.who() }; } catch (e: any) { console.log("| CASE SWALLOWED", e.constructor.name, e.message); return {}; } });
test("t", () => { try { console.log("| CASE said", seen()); } catch (e: any) { console.log("| CASE THROWS", e.constructor.name, e.message); } });
`,
    "package.json": `{ "name": "builtin-left-out", "type": "module" }
`,
    "styled.ts": `import { styleText } from "node:util"; export const who = () => styleText("bold", "real").length > 0 ? "real" : "none";
`,
    "user.ts": `import { who } from "./styled.ts"; export const seen = () => who();
`,
  },
  "mock-and-the-next-file": {
    "a-first.test.mjs": `import { mock, test } from "bun:test";
import * as reader from "./reader.mjs";
mock.module("./store.cjs", () => ({ value: "mocked" }));
test("first", () => { console.log("| CASE first file holds " + reader.held()); });
`,
    "b-second.test.mjs": `import { test } from "bun:test";
import * as store from "./store.cjs";
console.log("| CASE second file sees " + store.value);
test("second", () => {});
`,
    "package.json": `{ "type": "module" }
`,
    "reader.mjs": `import { createRequire } from "node:module";
const store = createRequire(import.meta.url)("./store.cjs");
export const held = () => JSON.stringify(store);
`,
    "store.cjs": `module.exports = { value: "real", other: "real too" };
`,
  },
  "mock-of-a-built-in": overLibrary(
    `vi.mock("node:os", () => ({ EOL: "mocked", default: { EOL: "mocked default" } }));
import os, { EOL } from "node:os";
test("t", async () => {
say(EOL, os.EOL, require("node:os").EOL);
});
`,
  ),
  "mock-of-a-preload": {
    "a.test.js": `import { test, vi, mock } from "bun:test";
const say = (...a) => console.log("| CASE", ...a);
test("a", async () => { say("a own", mineOfPreload()); vi.doUnmock("dep"); say("a by name", (await import("dep")).value()); say("a own", mineOfPreload()); });
`,
    "b.test.js": `import { test, vi, mock } from "bun:test";
const say = (...a) => console.log("| CASE", ...a);
test("b", () => say("b the package, first read:", seenOfPreload(), "own:", mineOfPreload()));
`,
    "own.js": `import { value } from "dep";
export const mine = () => value();
`,
    "package.json": `{ "type": "module" }
`,
    "setup.js": `import { vi } from "bun:test";
import { seen } from "reads";
import { mine } from "./own.js";
vi.mock("dep", () => ({ value: () => "preload" }));
globalThis.seenOfPreload = seen; globalThis.mineOfPreload = mine;
`,
    "node_modules/dep/index.js": `export const value = () => "real";
`,
    "node_modules/dep/package.json": `{ "name": "dep", "type": "module", "main": "index.js" }
`,
    "node_modules/reads/index.js": `import { value } from "dep";
export const seen = () => value();
`,
    "node_modules/reads/package.json": `{ "name": "reads", "type": "module", "main": "index.js" }
`,
  },
  "mock-with-a-factory": overLibrary(
    `vi.mock("./lib.js", () => ({ plain: () => "mocked", default: () => "mocked default" }));
import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
say(lib.plain(), call(), Object.keys(lib).join());
});
`,
  ),
  "mock-without-a-factory": overLibrary(
    `vi.mock("./lib.js");
import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
say(String(lib.plain()), vi.isMockFunction(lib.plain), lib.object.number, JSON.stringify(lib.object.list), typeof lib.Box, String(new lib.Box().value()), await tried(() => call()));
});
`,
  ),
  "mocks-folder": overLibrary(
    `vi.mock("./lib.js");
import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
say(await tried(() => lib.plain()), await tried(() => call()));
});
`,
    {
      "__mocks__/lib.js": `export const plain = () => "of the folder";
export default () => "default of the folder";
`,
    },
  ),
  "require-actual-in-a-factory": {
    "alone.test.ts": `import { test, jest } from "bun:test";
test("jest.requireActual() of a file that no mock names, in a program without a require of its own", () => {
  const real = jest.requireActual("./src/real");
  console.error("| CASE alone", real.kept, real.replaced, real.twice(2));
});
`,
    "package.json": `{ "name": "mock-import-original" }
`,
    "required.test.ts": `
import { test, jest } from "bun:test";
import { seen } from "./src/user";
jest.mock("./src/real", () => ({ ...jest.requireActual("./src/real"), replaced: "mocked" }));
test("jest.requireActual() in the factory", () => console.error("| CASE required", seen()));
`,
    "unmocked.test.ts": `import { test } from "bun:test";
import { seen } from "./src/user";
test("no mock and no original", () => console.error("| CASE unmocked", seen()));
`,
    "written.test.ts": `import { test, jest } from "bun:test";
import { seen } from "./src/user";
jest.mock("./src/real", () => ({ kept: "kept", replaced: "mocked", twice: (n: number) => n * 2 }));
test("the same mock with its three members written out", () => console.error("| CASE written", seen()));
`,
    "src/real.ts": `console.error("| CASE real runs");
export const kept = "kept";
export const replaced = "real";
export function twice(n: number) { return n * 2; }
`,
    "src/user.ts": `import { kept, replaced, twice } from "./real";
export const seen = () => [kept, replaced, twice(2)].join();
`,
  },
  "shared-mocks-file": {
    "a.test.js": `import "./mocks.js";
import { test } from "bun:test";
import { read } from "./user.js";
test("a imports the helper that mocks", () => console.log("| CASE a, with the helper, reads", read()));
`,
    "b.test.js": `import "./mocks.js";
import { test } from "bun:test";
import { read } from "./user.js";
test("b imports the helper that mocks", () => console.log("| CASE b, with the helper, reads", read()));
`,
    "c.test.js": `import { test } from "bun:test";
import { read } from "./user.js";
test("c mocks nothing", () => console.log("| CASE c, without the helper, reads", read()));
`,
    "dep.js": `export const flag = "real";
`,
    "mocks.js": `import { mock } from "bun:test";
mock.module("./dep.js", () => ({ flag: "mock" }));
`,
    "package.json": `{ "type": "module" }
`,
    "user.js": `import { flag } from "./dep.js";
export const read = () => flag;
`,
  },
  "stub-built-in-objects": overLibrary(
    `import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
vi.stubGlobal("Math", { random: () => 0.25 }); vi.stubGlobal("Date", class { static now() { return 3; } getFullYear() { return 4; } }); vi.stubGlobal("setTimeout", f => (f(), "stubbed")); let hit = 0; say(lib.random(), lib.now(), lib.year(), lib.later(1, () => hit++), hit); vi.unstubAllGlobals(); say(lib.random() === 0.25, lib.now() === 3);
});
`,
  ),
  "stub-global": overLibrary(
    `import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
say(lib.readGlobal(), lib.readFetch()); vi.stubGlobal("someGlobal", "stubbed"); vi.stubGlobal("fetch", 1); say(lib.readGlobal(), lib.readFetch()); vi.unstubAllGlobals(); say(lib.readGlobal(), lib.readFetch());
});
`,
  ),
  "unmock": overLibrary(
    `vi.mock("./lib.js", () => ({ plain: () => "mocked", default: () => "mocked default" }));
vi.unmock("./lib.js");
import * as lib from "./lib.js";
import { call } from "./user.js";
test("t", async () => {
say(lib.plain(), call());
});
`,
  ),
};

// One preload serves the whole run.
const ofProject = {
  "package.json": `{ "name": "runs", "type": "module" }\n`,
  "bunfig.toml": `[test]\npreload = ["./mock-of-a-preload/setup.js"]\n`,
};

// TODO: behind vi.doUnmock() a file that the preload imported reads the original over layers, and the mock under plain `bun test`.
const differs: Record<string, string[]> = { "two layers": ["mock-of-a-preload"] };

const laid = Object.entries(cases).flatMap(([name, files]) =>
  Object.entries(files).map(([path, text]) => [`${name}/${path}`, text.replaceAll("CASE", name)]),
);

// A folder is listed in the order that its file system gives, and what one test file leaves to the next is what many a case is about.
const testFiles = laid.map(([path]) => `./${path}`).filter(path => /\.test\.\w+$/.test(path));

/** By case: the lines that it printed, on either stream, and what the runner said under its test files. */
async function ran(flags: string[], words?: string) {
  using dir = tempDir("aot-fixed-runs", { ...ofProject, ...Object.fromEntries(laid) });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr } = await run([bunExe(), "test", ...flags, ...testFiles], String(dir), env);
  const said = new Map<string, string[]>(Object.keys(cases).map(name => [name, []]));
  const printed = /^\| (\S+) (.*)$/;
  for (const line of stdout.split(/\r?\n/)) {
    const [, name, words] = line.match(printed) ?? [];
    said.get(name)?.push(words);
  }
  let under: string[] | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const [, name, words] = line.match(printed) ?? [];
    const [, folder] = line.match(/^([^\s\\/]+)[\\/]\S*\.test\.\w+:$/) ?? [];
    const [, result] = line.match(/^(\((?:pass|fail)\) .*?)(?: \[[\d.]+ms\])?$/) ?? [];
    if (name) said.get(name)?.push(words);
    else if (folder) under = said.get(folder);
    // The runner lists the failed tests once more at the end.
    else if (/^\d+ tests? failed:$/.test(line)) under = undefined;
    else if (result) under?.push(result);
    else if (/^(error|\w*Error): /.test(line)) under?.push(line.replace(/\S*[\\/]/g, ""));
  }
  return said;
}

const ways: Record<string, [flags: string[], words?: string]> = {
  "plain": [[]],
  "one program": [["--aot"], "TestRunLayers:0"],
  "two layers": [["--aot"], "TestRunLayers:2"],
};
const runs = new Map<string, ReturnType<typeof ran>>();
const runOf = (way: string) => runs.getOrInsertComputed(way, () => ran(...ways[way]));
afterAll(() => Promise.allSettled(runs.values()));

describe.each(["one program", "two layers"])("%s", way => {
  test.each(Object.keys(cases))("%s", async name => {
    const [plain, compiled] = await Promise.all([runOf("plain"), runOf(way)]);
    const expected = plain.get(name)!;
    expect(expected.filter(line => !line.startsWith("("))).not.toEqual([]);
    expect(expected.filter(line => line.startsWith("(fail)"))).toEqual([]);
    const held = expect(compiled.get(name));
    if (differs[way]?.includes(name)) held.not.toEqual(expected);
    else held.toEqual(expected);
  });
});
