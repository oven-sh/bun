// How modules load under `bun test --aot`: each project runs under plain `bun test` and compiled, and both must print and pass alike.
// The test files are one side and the files they share are the other, whether one image holds both or the shared files have an image of their own.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const state = {
  "helpers/state.js": `export let count = 0;\nexport function bump() { return ++count; }`,
  "helpers/state.cjs": `exports.count = 0;\nexports.bump = () => ++exports.count;`,
};
const head = `import { expect, mock, test } from "bun:test";`;

const projects: Record<string, Record<string, string>> = {
  "a file taken out of require.cache loads again": {
    ...state,
    "cache.test.js": `${head}
      const again = (name, load, path) => test(name, () => {
        const first = load(); first.bump();
        console.log(name, "in the cache:", path in require.cache);
        delete require.cache[path];
        const second = load();
        console.log(name, second === first, first.count, second.count, path in require.cache);
      });
      const esm = require.resolve("./helpers/state.js"), cjs = require.resolve("./helpers/state.cjs");
      const hidden = text => JSON.parse(JSON.stringify(text));
      again("a module, by the resolved path", () => require(esm), esm);
      again("a module, by a literal", () => require("./helpers/state.js"), esm);
      again("a module, by a path nobody follows", () => require(hidden(esm)), esm);
      again("a CommonJS file, by the resolved path", () => require(cjs), cjs);
      again("a CommonJS file, by a literal", () => require("./helpers/state.cjs"), cjs);
      again("a CommonJS file, by a path nobody follows", () => require(hidden(cjs)), cjs);`,
    "imported-too.test.js": `${head}
      import { bump } from "./helpers/state.js";
      test("a module that is also imported", () => {
        const path = require.resolve("./helpers/state.js");
        bump();
        const first = require(path);
        delete require.cache[path];
        const second = require(path);
        console.log("imported too", first.count, second.count, bump(), first.count, second.count);
      });`,
  },
  "what is loaded behind an eviction shares the new copy, by require and by import": {
    "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
    "node_modules/dep/index.js": `module.exports = require("./cjs/dep.development.js");`,
    "node_modules/dep/cjs/dep.development.js": `
      globalThis.timesEvaluated = (globalThis.timesEvaluated || 0) + 1;
      var priority = 0;
      exports.instance = globalThis.timesEvaluated;
      exports.sawDocument = typeof document !== "undefined";
      exports.flush = function (fn) { priority = 1; try { return fn(); } finally { priority = 0; } };
      exports.priorityNow = function () { return priority; };`,
    "node_modules/dep/client.js": `
      var m = require("dep");
      exports.priorityNow = function () { return m.priorityNow(); };
      exports.instance = m.instance;
      exports.sawDocument = m.sawDocument;`,
    "helpers/early.js": `import { instance, sawDocument } from "dep";\nexport const early = { instance, sawDocument };`,
    "helpers/component.js": `
      import { flush, instance, sawDocument } from "dep";
      export function flushed(read) { return flush(read); }
      export { instance, sawDocument };`,
    "helpers/harness.js": `
      import { dirname, sep } from "path";
      export async function install() {
        globalThis.document = {};
        const folder = dirname(require.resolve("dep")) + sep;
        let evicted = 0;
        for (const path of Object.keys(require.cache)) {
          if (path.startsWith(folder)) { delete require.cache[path]; evicted++; }
        }
        return { client: await import("dep/client"), evicted };
      }`,
    "evicted.test.js": `${head}
      import { early } from "./helpers/early.js";
      import { install } from "./helpers/harness.js";
      test("a package that a harness evicts so that it sees the document", async () => {
        const { client, evicted } = await install();
        const component = await import("./helpers/component.js");
        console.log("evicted", JSON.stringify(early), evicted, globalThis.timesEvaluated, client.instance, component.instance,
          client.sawDocument, component.sawDocument, component.flushed(() => client.priorityNow()));
      });`,
    "straight.test.js": `${head}
      import { dirname, sep } from "path";
      import { early } from "./helpers/early.js";
      test("an import straight behind the eviction, with no require() between", async () => {
        globalThis.document = {};
        const folder = dirname(require.resolve("dep")) + sep;
        for (const path of Object.keys(require.cache)) if (path.startsWith(folder)) delete require.cache[path];
        const component = await import("./helpers/component.js");
        console.log("straight", JSON.stringify(early), globalThis.timesEvaluated, component.instance, component.sawDocument);
      });`,
  },
  "a test file that takes itself out of require.cache": {
    "itself.test.js": `${head}
      globalThis.loads = (globalThis.loads ?? 0) + 1;
      export const loads = globalThis.loads;
      if (loads === 1) test("itself", () => {
        const first = require(import.meta.path);
        delete require.cache[import.meta.path];
        const second = require(import.meta.path);
        console.log("itself", first === second, Object.keys(first).join(), Object.keys(second).join(), first.loads, second.loads);
      });`,
  },
  "every way from a test file to a shared file": {
    ...state,
    "helpers/names.js": `export const name = "names.js";\nexport default "the default";`,
    "ways.test.js": `${head}
      import { name } from "./helpers/names.js";
      import * as all from "./helpers/names.js";
      const hidden = text => JSON.parse(JSON.stringify(text));
      test("ways", async () => {
        console.log("import", name, Object.keys(all).join());
        console.log("require", Object.keys(require("./helpers/names.js")).join(), require("./helpers/names.js") === all);
        console.log("import()", (await import("./helpers/names.js")) === all);
        console.log("import(name)", (await import(hidden("./helpers/names.js"))) === all);
        console.log("require(name)", require(hidden("./helpers/names.js")) === all);
        console.log("CommonJS", require("./helpers/state.cjs") === require(hidden("./helpers/state.cjs")), (await import("./helpers/state.cjs")).default === require("./helpers/state.cjs"));
        for (const one of ["names.js", "state.js"]) console.log("a pattern", Object.keys(await import("./helpers/" + one)).join());
      });`,
  },
  "a shared file that loads the test file": {
    "helpers/back.js": `export const back = async path => Object.keys(await import(path)).join();\nexport const backByRequire = path => Object.keys(require(path)).join();`,
    "back.test.js": `${head}
      import { back, backByRequire } from "./helpers/back.js";
      export const ofTheTestFile = 1;
      test("back", async () => { console.log("back", await back(import.meta.path), backByRequire(import.meta.path)); });`,
  },
  "files of data": {
    "data/a.json": `{ "a": 1, "nested": { "b": [1, 2] } }`,
    "data/a.txt": `text of a.txt`,
    "data/a.toml": `a = 1\n[nested]\nb = "two"\n`,
    "data/a.bin": `bytes`,
    "helpers/reads.js": `import json from "../data/a.json";\nimport text from "../data/a.txt";\nexport { json, text };`,
    "data.test.js": `${head}
      import json, { nested } from "./data/a.json";
      import text from "./data/a.txt";
      import toml from "./data/a.toml";
      import asText from "./data/a.json" with { type: "text" };
      import file from "./data/a.bin" with { type: "file" };
      import * as shared from "./helpers/reads.js";
      const hidden = text => JSON.parse(JSON.stringify(text));
      test("data", async () => {
        console.log(JSON.stringify(json), JSON.stringify(nested), text, JSON.stringify(toml), asText.length, file.endsWith("a.bin"));
        console.log("one object", shared.json === json, require("./data/a.json") === json, (await import("./data/a.json")).default === json);
        console.log("by name", require(hidden("./data/a.json")) === json, JSON.stringify(require(hidden("./data/a.txt"))), (await import(hidden("./data/a.toml"))).default === toml);
      });`,
  },
  "a file that is written while the tests run": {
    "written.test.js": `${head}
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      test("written", async () => {
        const path = join(import.meta.dir, "made-at-run-time.js");
        writeFileSync(path, "export const made = 6 * 7; export const where = import.meta.path.endsWith('made-at-run-time.js');");
        console.log("written", JSON.stringify(await import(path)), JSON.stringify(require(path)));
        const common = join(import.meta.dir, "made-at-run-time.cjs");
        writeFileSync(common, "module.exports = { made: typeof require, helper: require('./helpers/state.cjs').bump() };");
        console.log("written", JSON.stringify(require(common)), require("./helpers/state.cjs").count);
      });`,
    ...state,
  },
  "each test file has its own modules under --isolate": {
    ...state,
    "one.test.js": `${head}\nimport { bump } from "./helpers/state.js";\ntest("one", () => { globalThis.leaked = (globalThis.leaked ?? 0) + 1; console.log("one", bump(), require("./helpers/state.cjs").bump(), globalThis.leaked); });`,
    "two.test.js": `${head}\nimport { bump } from "./helpers/state.js";\ntest("two", () => { globalThis.leaked = (globalThis.leaked ?? 0) + 1; console.log("two", bump(), require("./helpers/state.cjs").bump(), globalThis.leaked); });`,
    "three.test.js": `${head}\ntest("three", async () => { console.log("three", (await import("./helpers/state.js")).bump(), require("./helpers/state.cjs").bump()); });`,
  },
  "a test file that imports another test file": {
    "first.test.js": `${head}\nexport const shared = { loads: 0 };\nshared.loads++;\ntest("of first", () => { console.log("first runs", shared.loads); });`,
    "second.test.js": `${head}\nimport { shared } from "./first.test.js";\ntest("of second", () => { console.log("second sees", shared.loads); });`,
  },
  "what a file knows of itself": {
    "helpers/self.js": `export const self = () => [import.meta.file, import.meta.dir.endsWith("helpers"), import.meta.path.endsWith("self.js"), import.meta.url.startsWith("file://"), import.meta.main, import.meta.resolve("./self.js") === import.meta.url, typeof import.meta.require].join();`,
    "helpers/self.cjs": `exports.self = () => [__filename.endsWith("self.cjs"), __dirname.endsWith("helpers"), require.main === module, module.id === __filename, require.resolve("./self.cjs") === __filename, module.loaded].join();`,
    "self.test.js": `${head}
      import { self } from "./helpers/self.js";
      test("self", () => {
        console.log("the test file", import.meta.file, import.meta.main, import.meta.resolve("./helpers/self.js").endsWith("helpers/self.js"), require.resolve("./helpers/self.js").endsWith("helpers/self.js"), import.meta.require("./helpers/self.cjs").self());
        console.log("the shared file", self());
        try { require.resolve("./helpers/absent.js"); } catch (error) { console.log(error.name, error.code); }
      });`,
  },
  "circles across the border": {
    "helpers/circle.js": `import { fromTest, later } from "../circle.test.js";\nexport const fromHelper = "helper";\nexport const seen = () => [fromTest(), later].join();`,
    "helpers/circle.cjs": `exports.early = 1;\nconst other = require("./circle-other.cjs");\nexports.late = other.sawEarly;`,
    "helpers/circle-other.cjs": `const first = require("./circle.cjs");\nexports.sawEarly = [first.early, first.late].join();`,
    "circle.test.js": `${head}
      import { fromHelper, seen } from "./helpers/circle.js";
      export function fromTest() { return "test sees " + fromHelper; }
      export const later = "later";
      test("circle", () => { console.log(seen(), JSON.stringify(require("./helpers/circle.cjs"))); });`,
  },
  "top-level await": {
    "helpers/waits.js": `export const order = [];\norder.push("before");\nawait new Promise(resolve => setTimeout(resolve, 1));\norder.push("after");`,
    "waits.test.js": `${head}
      import { order } from "./helpers/waits.js";
      order.push("test file");
      const late = await import("./helpers/waits.js");
      test("waits", () => {
        console.log(order.join(), late.order === order);
        try { require("./helpers/waits.js"); console.log("required"); } catch (error) { console.log(error.name); }
      });`,
  },
  "a shared file that throws while it loads": {
    "helpers/throws.js": `globalThis.throwsLoads = (globalThis.throwsLoads ?? 0) + 1;\nexport const never = 1;\nthrow new RangeError("from throws.js");`,
    "helpers/throws.cjs": `globalThis.commonLoads = (globalThis.commonLoads ?? 0) + 1;\nexports.partial = 1;\nthrow new RangeError("from throws.cjs");`,
    "throws.test.js": `${head}
      test("throws", async () => {
        for (let turn = 0; turn < 2; turn++) {
          await import("./helpers/throws.js").then(() => console.log("loaded"), error => console.log("import()", error.name, error.message, globalThis.throwsLoads));
          try { require("./helpers/throws.cjs"); } catch (error) { console.log("require", error.name, error.message, globalThis.commonLoads); }
        }
      });`,
  },
  "mock.module of a file that has run": {
    ...state,
    "helpers/uses.js": `import { bump, count } from "./state.js";\nexport const use = () => [bump(), count].join();`,
    "mocks.test.js": `${head}
      import { use } from "./helpers/uses.js";
      import { bump } from "./helpers/state.js";
      test("mocks", async () => {
        console.log("before", use(), bump());
        mock.module("./helpers/state.js", () => ({ bump: () => "mocked", count: -1 }));
        console.log("mocked", use(), bump(), (await import("./helpers/state.js")).count, require("./helpers/state.js").bump());
        mock.restore();
        console.log("after restore", use(), bump());
      });`,
  },
  "mock.module before the shared files load": {
    ...state,
    "helpers/uses.js": `import { bump, count } from "./state.js";\nexport const use = () => [bump(), count].join();`,
    "helpers/uses.cjs": `const state = require("./state.cjs");\nexports.use = () => [state.bump(), state.count].join();`,
    "mocked.test.js": `${head}
      mock.module("./helpers/state.js", () => ({ bump: () => "mocked", count: -1 }));
      mock.module("./helpers/state.cjs", () => ({ bump: () => "mocked too", count: -2 }));
      test("mocked", async () => {
        console.log("mocked", (await import("./helpers/uses.js")).use(), require("./helpers/uses.cjs").use());
      });`,
    "not-mocked.test.js": `${head}
      import { use } from "./helpers/uses.js";
      test("not mocked", () => { console.log("not mocked", use(), require("./helpers/uses.cjs").use()); });`,
  },
  "mock.module of a package and of a built-in module": {
    "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "./index.js" }`,
    "node_modules/pkg/index.js": `export const name = "pkg";\nexport default () => "the default of pkg";`,
    "helpers/uses-pkg.js": `import call, { name } from "pkg";\nimport { platform } from "node:os";\nexport const use = () => [name, call(), typeof platform()].join();`,
    "package-mocked.test.js": `${head}
      mock.module("pkg", () => ({ name: "mocked pkg", default: () => "mocked default" }));
      mock.module("node:os", () => ({ platform: () => 7 }));
      test("package mocked", async () => {
        console.log("package mocked", (await import("./helpers/uses-pkg.js")).use(), (await import("pkg")).name, require("node:os").platform());
      });`,
    "package-not-mocked.test.js": `${head}
      import { use } from "./helpers/uses-pkg.js";
      test("package not mocked", () => { console.log("package not mocked", use()); });`,
  },
  "a preload that mocks": {
    ...state,
    "bunfig.toml": `[test]\npreload = ["./pre.js"]\n`,
    "pre.js": `import { mock } from "bun:test";\nglobalThis.preloads = (globalThis.preloads ?? 0) + 1;\nmock.module("./helpers/state.js", () => ({ bump: () => "mocked by the preload", count: -1 }));`,
    "helpers/uses.js": `import { bump, count } from "./state.js";\nexport const use = () => [bump(), count].join();`,
    "after-preload.test.js": `${head}
      import { use } from "./helpers/uses.js";
      import { bump } from "./helpers/state.js";
      test("after the preload", () => { console.log("after the preload", use(), bump(), globalThis.preloads); });`,
    "after-preload-too.test.js": `${head}
      test("after the preload too", async () => { console.log("too", (await import("./helpers/uses.js")).use(), globalThis.preloads); });`,
  },
  "a file that is no program": {
    "helpers/broken.js": `export const a = ;`,
    "broken.test.js": `${head}
      test("broken", async () => {
        await import("./helpers/broken.js").then(() => console.log("loaded"), error => console.log("import()", error.name));
        try { require("./helpers/broken.js"); } catch (error) { console.log("require", error.name); }
      });`,
    "fine.test.js": `${head}\ntest("fine", () => { console.log("the other file runs"); });`,
  },
  "files that fail where a test loads them, and data that the compiler cannot hold": {
    "helpers/good.js": `export const good = 1;`,
    "broken/declared-twice.js": `export const a = 1;\nexport const a = 2;`,
    "broken/let-twice.js": `let a = 1;\nlet a = 2;\nexport default a;`,
    "broken/label-twice.js": `label: label: for (;;) {}`,
    "broken/with.js": `export {};\nwith (globalThis) {}`,
    "broken/break.cjs": `break;`,
    "broken/regexp.js": `export const r = /(/;`,
    "broken/comma.json": `{ "a": 1, }x`,
    "broken/value.json": `{ "a": }`,
    "data/dated.toml": `when = 2020-01-01T00:00:00Z\n`,
    "fails.test.js": `${head}
      const names = ["declared-twice.js", "let-twice.js", "label-twice.js", "with.js", "break.cjs", "regexp.js", "comma.json", "value.json"];
      test("written out", async () => {
        const said = (name, load) => load().then(() => console.log(name, "loaded"), error => console.log(name, error.name));
        await said("declared-twice.js", () => import("./broken/declared-twice.js"));
        await said("let-twice.js", () => import("./broken/let-twice.js"));
        await said("label-twice.js", () => import("./broken/label-twice.js"));
        await said("with.js", () => import("./broken/with.js"));
        await said("break.cjs", () => import("./broken/break.cjs"));
        await said("regexp.js", () => import("./broken/regexp.js"));
        await said("comma.json", () => import("./broken/comma.json"));
        await said("value.json", () => import("./broken/value.json"));
      });
      test("required", () => {
        for (const load of [() => require("./broken/let-twice.js"), () => require("./broken/break.cjs"), () => require("./broken/regexp.js"), () => require("./broken/value.json")]) {
          try { load(); console.log("required: loaded"); } catch (error) { console.log("required:", error.name); }
        }
      });
      test("by a name made at run time", async () => {
        for (const name of names) await import("./broken/" + name).then(() => console.log("made", name, "loaded"), error => console.log("made", name, error.name));
      });
      test("a date in TOML", async () => { console.log(JSON.stringify((await import("./data/dated.toml")).default), JSON.stringify(require("./data/dated.toml"))); });`,
    "statement.test.js": `${head}\nimport { a } from "./broken/declared-twice.js";\ntest("never runs", () => { console.log("never", a); });`,
    "fine.test.js": `${head}\nimport { good } from "./helpers/good.js";\ntest("fine", () => { console.log("the other file runs", good); });`,
  },
  "a file that fails when it is linked to a compiled file": {
    "helpers/good.js": `export const good = 1;`,
    "broken/declared-twice.js": `export const a = 1;\nexport const a = 2;`,
    "broken/no-such-export.js": `import { nope } from "../helpers/good.js";\nexport { nope };`,
    "broken/hands-on-nothing.js": `export { gone } from "../helpers/good.js";`,
    "broken/through.js": `import "./declared-twice.js";\nexport const through = 1;`,
    "links.test.js": `${head}
      import { good } from "./helpers/good.js";
      test("written out", async () => {
        const said = (name, load) => load().then(() => console.log(name, "loaded"), error => console.log(name, error.name));
        await said("no-such-export.js", () => import("./broken/no-such-export.js"));
        await said("hands-on-nothing.js", () => import("./broken/hands-on-nothing.js"));
        await said("through.js", () => import("./broken/through.js"));
        for (const name of ["no-such-export.js", "hands-on-nothing.js", "through.js"]) await said("made " + name, () => import("./broken/" + name));
        console.log(good);
      });`,
  },
  "modules that a plugin answers for": {
    "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
    "setup.js": `import { plugin } from "bun";
      plugin({ name: "from the preload", setup(build) {
        build.module("virtual:preloaded", () => ({ exports: { default: "preloaded", name: "p" }, loader: "object" }));
        build.module("virtual:static", () => ({ exports: { default: "static", name: "s" }, loader: "object" }));
        build.module("virtual:source", () => ({ contents: "export default 'source text';", loader: "js" }));
        build.module("no-scheme-at-all", () => ({ exports: { default: "no scheme" }, loader: "object" }));
        build.onResolve({ filter: /^resolved:/ }, args => ({ path: args.path.slice(9), namespace: "made" }));
        build.onLoad({ filter: /.*/, namespace: "made" }, args => ({ contents: "export default " + JSON.stringify("made " + args.path) + ";", loader: "js" }));
      } });`,
    "loads.test.js": `${head}
      import { plugin } from "bun";
      const said = (name, load) => test(name, async () => {
        try { console.log(name, "|", JSON.stringify(await load())); } catch (error) { console.log(name, "|", error.name, error.code); }
      });
      const answer = value => () => ({ exports: { default: value }, loader: "object" });
      said("in the test, import()", async () => { plugin({ name: "a", setup(build) { build.module("virtual:one", answer(1)); } }); return (await import("virtual:one")).default; });
      said("in the test, a name made at run time", async () => { plugin({ name: "b", setup(build) { build.module("virtual:two", answer(2)); } }); return (await import(["virtual", "two"].join(":"))).default; });
      said("in the test, require()", () => { plugin({ name: "c", setup(build) { build.module("virtual:three", answer(3)); } }); return require("virtual:three").default; });
      said("an arrow function", async () => { Bun.plugin({ name: "d", setup: build => { build.module("virtual:four", answer(4)); } }); return (await import("virtual:four")).default; });
      said("a function expression", async () => { Bun.plugin({ name: "e", setup: function (it) { it.module("virtual:five", answer(5)); } }); return (await import("virtual:five")).default; });
      said("an async setup", async () => { await plugin({ name: "f", async setup(build) { await 0; build.module("virtual:six", answer(6)); } }); return (await import("virtual:six")).default; });
      said("in the preload, import()", async () => (await import("virtual:preloaded")).default);
      said("in the preload, every export", async () => Object.keys(await import("virtual:preloaded")).sort());
      said("in the preload, source text", async () => (await import("virtual:source")).default);
      said("in the preload, no scheme", async () => [(await import("no-scheme-at-all")).default, require("no-scheme-at-all").default]);
      said("a namespace", async () => (await import("resolved:thing")).default);
      said("a namespace, a name made at run time", async () => (await import("resolved:" + ["o", "ther"].join(""))).default);
      said("nobody answers, import()", async () => (await import("virtual:nobody")).default);
      said("nobody answers, require()", () => require("virtual:nobody").default);
      said("no such package", () => require("no-such-package"));`,
    "statement.test.js": `${head}
      import fromStatic, { name } from "virtual:static";
      import * as all from "no-scheme-at-all";
      test("an import statement", () => { console.log("statement |", fromStatic, name, Object.keys(all).join()); });`,
    "missing.test.js": `${head}\nimport nothing from "virtual:nobody";\ntest("never runs", () => { console.log("never", nothing); });`,
    "fine.test.js": `${head}\ntest("fine", () => { console.log("the other file runs"); });`,
  },
  "a module that a plugin answers for only later": {
    "later.test.js": `${head}
      import { plugin } from "bun";
      test("later", async () => {
        console.log("early", await import("virtual:late").then(() => "loaded", error => error.name));
        plugin({ name: "late", setup(build) { build.module("virtual:late", () => ({ exports: { default: "late" }, loader: "object" })); } });
        console.log("late", (await import("virtual:late")).default, require("virtual:late").default);
      });`,
  },
  "a query makes one more instance of a file": {
    "helpers/alone.js": `globalThis.loads = (globalThis.loads ?? 0) + 1;\nexport const loads = globalThis.loads;\nexport const url = import.meta.url.slice(import.meta.url.lastIndexOf("/"));`,
    "helpers/alone.cjs": `globalThis.loads = (globalThis.loads ?? 0) + 1;\nexports.loads = globalThis.loads;\nexports.name = __filename.slice(__filename.lastIndexOf("/"));`,
    "query.test.js": `${head}
      import { loads as first, url } from "./helpers/alone.js";
      import { loads as second, url as secondUrl } from "./helpers/alone.js?statement";
      export * as again from "./helpers/alone.js?handed-on";
      test("a query", async () => {
        console.log("statements", first, url, second, secondUrl);
        const imported = await import("./helpers/alone.js?imported");
        console.log("import()", imported.loads, imported.url, (await import("./helpers/alone.js?imported")) === imported);
        const required = require("./helpers/alone.cjs?required");
        console.log("require", required.loads, required.name, require("./helpers/alone.cjs?required") === required, require("./helpers/alone.cjs") === required);
        console.log("an ES module", require("./helpers/alone.js?required").url, import.meta.require("./helpers/alone.cjs?meta").name);
        console.log("resolve", require.resolve("./helpers/alone.cjs?resolved").slice(import.meta.dir.length));
      });`,
  },
  "mock.module of a file that does not exist": {
    "absent.test.js": `${head}
      const tried = (label, act) => { try { console.log(label, String(act()).replace(import.meta.dir, "<dir>")); } catch (error) { console.log(label, "threw", error.name, error.code); } };
      test("a relative path", async () => {
        tried("require.resolve before", () => require.resolve("./absent.ts"));
        tried("import.meta.resolveSync before", () => import.meta.resolveSync("./absent.ts"));
        mock.module("./absent.ts", () => ({ bar: 42 }));
        console.log("loaded", (await import("./absent.ts")).bar, require("./absent.ts").bar);
        tried("require.resolve after", () => require.resolve("./absent.ts"));
        tried("import.meta.resolveSync after", () => import.meta.resolveSync("./absent.ts"));
      });
      test("a file URL", async () => {
        tried("require.resolve before", () => require.resolve("./absent-too.ts"));
        mock.module("file:./absent-too.ts", () => ({ bar: 43 }));
        console.log("loaded", (await import("./absent-too.ts")).bar, require("./absent-too.ts").bar);
        tried("require.resolve after", () => require.resolve("./absent-too.ts"));
      });`,
  },
  "files that fail where a test loads them, under names that are no paths": {
    "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "paths": { "@/*": ["./*"] } } }`,
    "broken/declared-twice.js": `export const a = 1;\nexport const a = 2;`,
    "node_modules/bad/package.json": `{ "name": "bad", "main": "./index.js" }`,
    "node_modules/bad/index.js": `let b = 1;\nlet b = 2;\nmodule.exports = b;`,
    "names.test.js": `${head}
      test("an alias and a package", async () => {
        await import("@/broken/declared-twice.js").then(() => console.log("loaded"), error => console.log("an alias", error.name));
        try { require("bad"); console.log("loaded"); } catch (error) { console.log("a package", error.name); }
      });`,
  },
  "one file under several types, taken out of require.cache in between": {
    "data/plain": `{ "a": 1 }`,
    "types.test.js": `${head}
      const forget = () => delete require.cache[require.resolve("./data/plain")];
      const shown = value => (typeof value === "string" ? value.replace(import.meta.dir, "<dir>") : JSON.stringify(value));
      test("forgotten in between", async () => {
        console.log("text", shown((await import("./data/plain", { with: { type: "text" } })).default));
        forget();
        console.log("file", shown((await import("./data/plain", { with: { type: "file" } })).default));
        forget();
        console.log("json", shown((await import("./data/plain", { with: { type: "json" } })).default));
        forget();
        console.log("text again", shown((await import("./data/plain", { with: { type: "text" } })).default));
      });
      test("kept", async () => {
        forget();
        console.log("kept: file", shown((await import("./data/plain", { with: { type: "file" } })).default));
        console.log("kept: text", shown((await import("./data/plain", { with: { type: "text" } })).default));
      });`,
  },
  "a plugin that loads files of the run": {
    "data/one.shout": `one`,
    "data/two.shout": `two`,
    "helpers/plain.js": `export const plain = "as written";`,
    "helpers/late.js": `export const late = "as written";`,
    "helpers/uses-late.js": `import { late } from "./late.js";\nexport const seen = late;`,
    "shout.test.js": `${head}
      import { plugin } from "bun";
      import { readFileSync } from "node:fs";
      import { plain } from "./helpers/plain.js";
      test("onLoad", async () => {
        plugin({ name: "shout", setup(build) {
          build.onLoad({ filter: /\\.shout$/ }, args => ({ contents: "export default " + JSON.stringify(readFileSync(args.path, "utf8").toUpperCase()) + ";", loader: "js" }));
          build.onLoad({ filter: /helpers\\/(plain|late)\\.js$/ }, () => ({ contents: "export const plain = 'from the plugin'; export const late = 'from the plugin';", loader: "js" }));
        } });
        console.log("its own extension", (await import("./data/one.shout")).default, require("./data/two.shout").default);
        console.log("a file that has run", plain, (await import("./helpers/plain.js")).plain);
        console.log("a file that has not", (await import("./helpers/late.js")).late, (await import("./helpers/uses-late.js")).seen);
      });`,
    "other.test.js": `${head}
      import { late } from "./helpers/late.js";
      test("no plugin here", () => { console.log("the other file", late); });`,
  },
  "built-in modules that only the test file names": {
    "builtins.test.js": `${head}
      import { basename } from "node:path";
      const hidden = text => JSON.parse(JSON.stringify(text));
      test("builtins", async () => {
        console.log(basename("/a/b.js"), typeof require("node:zlib").gzipSync, typeof (await import("node:readline")).createInterface, typeof require(hidden("node:dns")).lookup, typeof (await import(hidden("bun:sqlite"))).Database, typeof require("bun:ffi").dlopen);
        console.log(require("node:path") === require("path"), (await import("node:path")).default === require(hidden("path")));
      });`,
  },
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { stdout: printed.sort(), results: results.sort(), exitCode };
}

const ways: [string, string[]][] = [
  ["each file in its own realm", ["--isolate"]],
  ["in parallel", ["--isolate", "--parallel=2"]],
  ["twice", ["--isolate", "--rerun-each=2"]],
];

// TODO: what happens today, by project and way.
const differs: Record<string, string[]> = {
  // The second require() of a CommonJS file that threw throws the same error again. Plain runs the file again.
  "a shared file that throws while it loads": ["each file in its own realm", "in parallel", "twice"],
  // The file is read from disk, and its import of a compiled file is refused ("can't load a module from a dynamic path"): an Error. Plain: a SyntaxError, a BuildMessage.
  "a file that fails when it is linked to a compiled file": ["each file in its own realm", "in parallel", "twice"],
  // The second run of a file begins with new modules. Plain runs the test file again over the modules of its first run.
  "each test file has its own modules under --isolate": ["twice"],
  "a test file that takes itself out of require.cache": ["twice"],
  "what is loaded behind an eviction shares the new copy, by require and by import": ["twice"],
  "a test file that imports another test file": ["twice"],
  "top-level await": ["twice"],
  "mock.module of a file that has run": ["twice"],
  "one file under several types, taken out of require.cache in between": ["twice"],
  "mock.module of a file that does not exist": ["twice"],
  "mock.module before the shared files load": ["twice"],
  // The second run begins without the plugin of the first. Plain still has it, so the early import() loads.
  "a module that a plugin answers for only later": ["twice"],
};

for (const [name, files] of Object.entries(projects)) {
  for (const [way, flags] of ways) {
    const declare = differs[name]?.includes(way) ? test.todo : test.concurrent;
    declare(`${name}: ${way}`, async () => {
      using dir = tempDir("modules-in-a-test-run", {
        "package.json": `{ "type": "module" }`,
        "tsconfig.json": "{}",
        ...files,
      });
      const plain = await runTests(String(dir), ...flags);
      expect(plain.results).not.toEqual([]);
      expect(await runTests(String(dir), "--aot", ...flags)).toEqual(plain);
    });
  }
}
