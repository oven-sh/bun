// How modules load under `bun test --aot`: each project runs under plain `bun test` and compiled, and both must print and pass alike.
// The test files are one side and the files they share are the other, whether one image holds both or the shared files have an image of their own.
// Every project runs in every way. A way has test files of its own, test/aot/modules-in-a-test-run*.test.ts: all of them in one file took six minutes.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { test } from "../supported";
import { run } from "./run";

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
  "a CommonJS file that throws runs again where files are taken out of require.cache": {
    "helpers/throws.cjs": `globalThis.commonLoads = (globalThis.commonLoads ?? 0) + 1;\nexports.partial = 1;\nthrow new RangeError("from throws.cjs, " + globalThis.commonLoads);`,
    "helpers/mends.cjs": `globalThis.mendLoads = (globalThis.mendLoads ?? 0) + 1;\nif (globalThis.mendLoads < 2) throw new RangeError("not yet");\nexports.loads = globalThis.mendLoads;`,
    "helpers/again.js": `export const again = path => { delete require.cache[path]; };`,
    "throws.test.js": `${head}
      import { again } from "./helpers/again.js";
      test("throws", () => {
        const errors = [];
        for (let turn = 0; turn < 3; turn++) {
          try { require("./helpers/throws.cjs"); } catch (error) { errors.push(error); console.log("require", error.name, error.message, globalThis.commonLoads); }
        }
        console.log("each its own error", errors[0] !== errors[1] && errors[1] !== errors[2], typeof again);
        try { require("./helpers/mends.cjs"); } catch (error) { console.log("first", error.message); }
        console.log("second", require("./helpers/mends.cjs").loads, require("./helpers/mends.cjs").loads);
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
  "names that only the onResolve of a plugin answers for": {
    "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
    "setup.js": `import { plugin } from "bun";
      plugin({ name: "late", setup(build) {
        build.onResolve({ filter: /^late:/ }, args => ({ path: args.path, namespace: "late" }));
        build.onLoad({ filter: /.*/, namespace: "late" }, args => ({ contents: "export const value = " + JSON.stringify(args.path) + ";", loader: "js" }));
      } });`,
    "late.test.js": `${head}
      import { value as stated } from "late:stated";
      const said = (name, load) => test(name, async () => {
        try { console.log(name, "|", JSON.stringify(await load())); } catch (error) { console.log(name, "|", error.name, error.code); }
      });
      said("a statement", () => stated);
      said("a name made at run time", async () => (await import(["late", "made"].join(":"))).value);
      said("written out", async () => (await import("late:written")).value);
      said("required", () => require("late:required").value);
      said("a scheme nobody answers for", async () => (await import("nobody:here")).value);
      said("a scheme nobody answers for, required", () => require("nobody:here").value);
      said("a package that is not installed", () => require("not-installed"));
      said("a built-in module that does not exist", async () => (await import("node:nothing")).value);`,
    "fine.test.js": `${head}\ntest("fine", () => { console.log("the other file runs"); });`,
  },
  "a plugin answers for a package that exists": {
    "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js", "type": "module" }`,
    "node_modules/dep/index.js": `export default "the real dep"; export const kind = "real"; export const only = "only the real one";`,
    "node_modules/dep/sub.js": `export default "the real sub";`,
    "node_modules/old/package.json": `{ "name": "old", "version": "1.0.0", "main": "index.js" }`,
    "node_modules/old/index.js": `module.exports = { kind: "the real old" };`,
    "helpers/user.js": `import dep, { kind } from "dep"; export const seen = () => dep + " " + kind;`,
    "helpers/again.js": `export * from "dep"; export { default } from "dep";`,
    "helpers/names.js": `import * as all from "dep"; export const names = () => Object.keys(all).join();`,
    "helpers/old-user.cjs": `const old = require("old"); exports.seen = () => old.kind;`,
    // Whoever is linked keeps the package. Each test takes its plugin away again, so that a second run of the file begins as the first.
    "over.test.js": `${head}
      import { plugin } from "bun";
      import { seen } from "./helpers/user.js";
      import early from "dep";
      test("the package has loaded", async () => {
        console.log("before", early, seen(), (await import("dep")).default);
        plugin({ name: "over", setup(build) { build.module("dep", () => ({ exports: { default: "the plugin's dep", kind: "virtual" }, loader: "object" })); } });
        console.log("after", early, seen(), (await import("dep")).default, require("dep").default, (await import(["d", "ep"].join(""))).default);
        console.log("a file of the package", (await import("dep/sub.js")).default);
        console.log("linked later", (await import("./helpers/again.js")).kind, (await import("./helpers/names.js")).names());
        plugin.clearAll();
        console.log("cleared", early, seen(), (await import("dep")).default, require("dep").default, (await import(["d", "ep"].join(""))).default);
      });`,
    "first.test.js": `${head}
      import { plugin } from "bun";
      test("the package has not loaded", async () => {
        plugin({ name: "first", setup(build) { build.module("dep", () => ({ exports: { default: "the plugin's dep", kind: "virtual" }, loader: "object" })); } });
        console.log("first", (await import("dep")).default, require("dep").kind, (await import("./helpers/user.js")).seen(), (await import("./helpers/names.js")).names());
        plugin.clearAll();
      });`,
    "text.test.js": `${head}
      import { plugin } from "bun";
      test("source text", async () => {
        plugin({ name: "text", setup(build) { build.module("dep", () => ({ contents: "export default 'text of the plugin'; export const kind = 'text';", loader: "js" })); } });
        console.log("text", (await import("dep")).default, (await import("./helpers/user.js")).seen(), (await import("./helpers/again.js")).default);
        plugin.clearAll();
      });`,
    "old.test.js": `${head}
      import { plugin } from "bun";
      import { seen } from "./helpers/old-user.cjs";
      test("a CommonJS package", async () => {
        console.log("old before", require("old").kind, seen());
        plugin({ name: "old", setup(build) { build.module("old", () => ({ exports: { kind: "the plugin's old" }, loader: "object" })); } });
        console.log("old after", require("old").kind, seen(), (await import("old")).kind);
        plugin.clearAll();
      });`,
    "untouched.test.js": `${head}
      import dep, { kind, only } from "dep";
      test("a file without the plugin", async () => {
        console.log("untouched", dep, kind, only, (await import("dep")).only, require("old").kind);
      });`,
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
  "what a CommonJS file knows of itself": {
    "helpers/about.cjs": `module.exports = { id: typeof module.id, file: module.filename.split("/").at(-1), loaded: module.loaded, parent: typeof module.parent, parentFile: module.parent?.filename?.split("/").at(-1), main: require.main === module, paths: Array.isArray(module.paths) };`,
    "helpers/through.cjs": `module.exports = require("./below.cjs");`,
    "helpers/below.cjs": `module.exports = { parentFile: module.parent?.filename?.split("/").at(-1) };`,
    "about.test.ts": `${head}
      test("about", () => {
        console.log(JSON.stringify(require("./helpers/about.cjs")));
        console.log(JSON.stringify(require("./helpers/through.cjs")), JSON.stringify(require("./helpers/below.cjs")));
      });`,
  },
  "mock.module of built-in modules, and of bun, which takes no mock": {
    "builtin-mocks.test.js": `${head}
      test("mocked", async () => {
        mock.module("node:os", () => ({ homedir: () => "mocked" }));
        mock.module("undici", () => ({ fetch: () => "mocked" }));
        mock.module("bun", () => ({ which: () => "mocked", default: {} }));
        console.log((await import("node:os")).homedir(), require("node:os").homedir(), (await import("undici")).fetch());
        console.log("bun", typeof (await import("bun")).which("sh"), (await import("bun")).which("sh") === Bun.which("sh"), require("bun").which("sh") === Bun.which("sh"));
      });`,
  },
  "a file of data that a test file imports, loaded by shared code that is given its path": {
    "data/one.json": `{ "name": "one", "list": [1] }`,
    "data/two.json": `{ "name": "two", "list": [1] }`,
    "data/three.json": `{ "name": "three", "list": [1] }`,
    "helpers/loads.cjs": `exports.load = path => require(path);`,
    "node_modules/loader-pkg/package.json": `{ "name": "loader-pkg", "type": "module", "main": "./index.js" }`,
    "node_modules/loader-pkg/index.js": `import { createRequire } from "node:module";\nexport const imports = path => import(path);\nexport const requires = path => createRequire(import.meta.url)(path);`,
    "given.test.js": `${head}
      import one from "./data/one.json";
      import two from "./data/two.json";
      import three from "./data/three.json";
      import { load } from "./helpers/loads.cjs";
      import { imports, requires } from "loader-pkg";
      test("given the path", async () => {
        console.log("a helper requires it", JSON.stringify(load(import.meta.dir + "/data/one.json")), JSON.stringify(one));
        const imported = await imports(import.meta.dir + "/data/two.json");
        console.log("a package imports it", JSON.stringify(imported.default), imported.default === two);
        three.list.push(2);
        console.log("a package requires it", JSON.stringify(requires(import.meta.dir + "/data/three.json").list));
      });`,
  },
  "a file of data that one statement imports, found by a name made at run time where the importer has not run": {
    "data/only.toml": `a = 1\n`,
    "data/typed.json": `{ "name": "typed" }\n`,
    "src/holds.mjs": `import toml from "../data/only.toml";\nimport text from "../data/typed.json" with { type: "text" };\nexport const held = { toml, text };`,
    "holds.test.js": `${head}
      import { held } from "./src/holds.mjs";
      test("the importer", () => { console.log("held", JSON.stringify(held)); });`,
    "finds.test.js": `${head}
      const made = text => JSON.parse(JSON.stringify(text));
      test("found by a name", async () => {
        console.log("toml", JSON.stringify((await import(made("./data/only.toml"))).default));
        console.log("json as text", JSON.stringify((await import(made("./data/typed.json"), { with: { type: "text" } })).default));
      });`,
  },
  "require() of a file of data that another test file's modules import": {
    "data/shared.json": `{ "name": "shared" }`,
    "data/beside.json": `{ "name": "beside" }`,
    "data/ahead.json": `{ "name": "ahead" }`,
    "src/imports.mjs": `import json from "../data/shared.json";\nexport const held = json;`,
    "src/beside.cjs": `exports.required = require("../data/beside.json");`,
    "src/ahead.mjs": `export const required = require("../data/ahead.json");`,
    "src/behind.mjs": `import json from "../data/ahead.json";\nexport const held = json;`,
    "imports.test.js": `${head}
      import { held } from "./src/imports.mjs";
      const shown = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
      test("the realm that imports it", () => { console.log("imported", JSON.stringify(held), shown(require("./data/shared.json"))); });`,
    "requires.test.js": `${head}
      const shown = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
      test("the realm that only requires it", async () => {
        console.log("required alone", shown(require("./data/shared.json")));
        console.log("imported behind that", shown(await import("./data/shared.json")), shown(require("./data/shared.json")));
      });`,
    "beside.test.js": `${head}
      import json from "./data/beside.json";
      import cjs from "./src/beside.cjs";
      const shown = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
      test("a CommonJS file beside the import", () => { console.log("beside", JSON.stringify(json), shown(cjs.required)); });`,
    "ahead.test.js": `${head}
      import { required } from "./src/ahead.mjs";
      import { held } from "./src/behind.mjs";
      const shown = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
      test("a module that runs ahead of the importer", () => { console.log("ahead", JSON.stringify(held), shown(required)); });`,
  },
  "the require.cache that the code of a Bun.ModuleGraph sees": {
    "helpers/counted.cjs": `globalThis.counted = (globalThis.counted ?? 0) + 1;\nmodule.exports = "counted " + globalThis.counted;`,
    "graph.test.js": `${head}
      import { mkdtempSync, writeFileSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join, basename } from "node:path";
      test("it holds the modules of the graph alone", async () => {
        const counted = require.resolve("./helpers/counted.cjs");
        console.log("the realm:", require("./helpers/counted.cjs"), counted in require.cache);
        const folder = mkdtempSync(join(tmpdir(), "graph-"));
        writeFileSync(join(folder, "other.cjs"), "module.exports = 1;");
        const lines = [
          'export const other = require("./other.cjs");',
          "export const keys = () => Object.keys(require.cache);",
          "export const has = key => key in require.cache;",
          "export const get = key => typeof require.cache[key];",
          "export const take = key => delete require.cache[key];",
        ];
        writeFileSync(join(folder, "inside.mjs"), lines.join(" "));
        const inside = await new Bun.ModuleGraph({}).import(join(folder, "inside.mjs"));
        console.log("keys:", inside.keys().map(key => basename(key)).sort().join());
        console.log("has:", inside.has(counted), "get:", inside.get(counted));
        console.log("delete:", inside.take(counted), "| the realm keeps its file:", counted in require.cache, require("./helpers/counted.cjs"));
      });`,
  },
  "every load that comes to an import statement that fails gets one error": {
    "shared/wants-package.mjs": `import x from "not-installed"; console.log("never runs", x);`,
    "shared/wants-file.mjs": `import x from "./no-such-file.mjs"; console.log("never runs", x);`,
    "shared/above.mjs": `import "./wants-package.mjs";`,
    "shared/beside.mjs": `import "./wants-package.mjs";`,
    "shared/wants-it-too.mjs": `import y from "not-installed"; console.log("never runs", y);`,
    "shared/late.mjs": `import z from "not-installed-either"; console.log("never runs", z);`,
    "shared/above-late.mjs": `import "./late.mjs";`,
    "shared/calls.mjs": `const errorOf = async load => { try { await load(); } catch (error) { return error; } };
      export const calls = async () => [
        (await errorOf(() => import("not-installed"))) === (await errorOf(() => import("not-installed"))),
        (await errorOf(async () => require("not-installed"))) === (await errorOf(async () => require("not-installed"))),
      ].join();`,
    "errors.test.mjs": `${head}
      import { calls } from "./shared/calls.mjs";
      const errorOf = async load => { try { await load(); } catch (error) { return error; } };
      test("one object for a statement, a new one for each call", async () => {
        const module = await errorOf(() => import("./shared/wants-package.mjs"));
        console.log("the module again:", module === (await errorOf(() => import("./shared/wants-package.mjs"))), module.name);
        const file = await errorOf(() => import("./shared/wants-file.mjs"));
        console.log("a file that is not there:", file === (await errorOf(() => import("./shared/wants-file.mjs"))), file.name);
        const above = await errorOf(() => import("./shared/above.mjs"));
        console.log("the one above:", module === above, above === (await errorOf(() => import("./shared/above.mjs"))));
        console.log("another one above:", above === (await errorOf(() => import("./shared/beside.mjs"))));
        console.log("require():", module === (await errorOf(async () => require("./shared/wants-package.mjs"))));
        console.log("another statement for the same package:", module === (await errorOf(() => import("./shared/wants-it-too.mjs"))));
        const first = await errorOf(() => import("./shared/above-late.mjs"));
        console.log("the one above first:", first === (await errorOf(() => import("./shared/late.mjs"))));
        console.log("calls:", await calls());
      });`,
    "again.test.mjs": `${head}
      import { calls } from "./shared/calls.mjs";
      test("each test file has its own", async () => {
        let one, two;
        await import("./shared/wants-package.mjs").catch(error => (one = error));
        await import("./shared/above.mjs").catch(error => (two = error));
        console.log("in another test file:", one === two, await calls());
      });`,
  },
  "an import that shares its name with a declaration of the test file": {
    "shared/value.ts": `console.log("value.ts runs"); export const name = "imported";`,
    "shared/space.ts": `console.log("space.ts runs"); export const inner = "imported";`,
    "shared/kind.ts": `console.log("kind.ts runs"); export interface Kind { level: number }`,
    "shared/partly.ts": `console.log("partly.ts runs"); export const name = "imported"; export const other = "other of partly.ts";`,
    "shared/standard.ts": `console.log("standard.ts runs"); export default "imported";`,
    // The import stands in front: it is dropped.
    "value.test.ts": `import { name } from "./shared/value"; ${head} const name = "own const"; test("a value", () => { console.log("a value:", name); });`,
    "space.test.ts": `import * as name from "./shared/space"; ${head} let name = "own let"; test("a namespace", () => { console.log("a namespace:", name); });`,
    "kind.test.ts": `import { Kind } from "./shared/kind"; ${head} const Kind = { level: 1 }; const typed: Kind = Kind; test("a type", () => { console.log("a type:", typed.level); });`,
    "partly.test.ts": `import { name, other } from "./shared/partly"; ${head} function name() { return "own function"; } test("one of two", () => { console.log("one of two:", name(), other); });`,
    "standard.test.ts": `import name from "./shared/standard"; ${head} enum name { A = "own enum" } test("a default", () => { console.log("a default:", name.A); });`,
    // The import stands behind: the file is no program, whatever the import names.
    "value-behind.test.ts": `${head} const name = "own const"; import { name } from "./shared/value"; test("never runs", () => { console.log("never runs:", name); });`,
    "kind-behind.test.ts": `${head} const Kind = { level: 1 }; import { Kind } from "./shared/kind"; test("never runs", () => { console.log("never runs:", Kind.level); });`,
    "type-behind.test.ts": `${head} const Kind = { level: 1 }; import type { Kind } from "./shared/kind"; const typed: Kind = Kind; test("a type by its syntax", () => { console.log("a type by its syntax:", typed.level); });`,
    // So that the files are shared: a layer holds them, and a test file knows nothing of what they export.
    "uses-them.test.ts": `import { name } from "./shared/value"; import { inner } from "./shared/space"; import type { Kind } from "./shared/kind"; import { other } from "./shared/partly"; import standard from "./shared/standard"; ${head}
      test("they are there", () => { const kind: Kind = { level: 2 }; console.log("they are there:", name, inner, kind.level, other, standard); });`,
  },
  "a name that a test file imports twice": {
    "shared/one.ts": `console.log("one.ts runs"); export const name = "name of one.ts"; export const other = "other of one.ts"; export default "default of one.ts";`,
    "shared/two.ts": `console.log("two.ts runs"); export const name = 2; export const other = 22; export default 222;`,
    "shared/kind.ts": `console.log("kind.ts runs"); export interface name { level: number }`,
    "built-in.test.ts": `import { test, mock } from "bun:test"; import { mock } from "bun:test"; test("from a built-in module", () => { console.log("from a built-in module:", typeof mock); });`,
    "two-built-ins.test.ts": `import { join as name } from "node:path"; import { basename as name } from "node:path"; ${head} test("two of a built-in module", () => { console.log("two of a built-in module:", name("a/b")); });`,
    "one-file.test.ts": `import { name } from "./shared/one"; import { name } from "./shared/one"; ${head} test("from one file", () => { console.log("from one file:", name); });`,
    "two-files.test.ts": `import { name } from "./shared/one"; import { name } from "./shared/two"; ${head} test("from two files", () => { console.log("from two files:", name + 1); });`,
    "partly.test.ts": `import { name, other } from "./shared/one"; import { name } from "./shared/two"; ${head} test("one of two", () => { console.log("one of two:", name + 1, other); });`,
    "three.test.ts": `import { name } from "./shared/two"; import name from "./shared/two"; import { other as name } from "./shared/one"; ${head} test("three times", () => { console.log("three times:", name); });`,
    "space.test.ts": `import { name } from "./shared/one"; import * as name from "./shared/two"; ${head} test("a namespace", () => { console.log("a namespace:", Object.keys(name).join(), name.name + 1); });`,
    "statement.test.ts": `import name, * as name from "./shared/two"; import other, { other } from "./shared/two"; ${head} test("in one statement", () => { console.log("in one statement:", name + 1, other + 1); });`,
    "type-first.test.ts": `import { name } from "./shared/kind"; import { name } from "./shared/two"; ${head} test("a type first", () => { console.log("a type first:", name + 1); });`,
    "type-behind.test.ts": `import { name } from "./shared/two"; import type { name } from "./shared/kind"; ${head} test("a type by its syntax", () => { console.log("a type by its syntax:", name + 1); });`,
    "interface-between.test.ts": `import { name } from "./shared/one"; interface name { level: number } import { name } from "./shared/two"; ${head} test("an interface between", () => { console.log("an interface between:", name + 1); });`,
    "required.test.ts": `import { name } from "./shared/one"; import name = require("./shared/two"); ${head} test("import = require", () => { console.log("import = require:", name.name + 1); });`,
    "own.test.ts": `import { name } from "./shared/one"; import { name } from "./shared/two"; ${head} const name = "own const"; test("and the file's own", () => { console.log("and the file's own:", name); });`,
    "unused.test.ts": `import { name } from "./shared/one"; import { name } from "./shared/two"; ${head} test("never read", () => { console.log("never read"); });`,
    "uses-them.test.ts": `import { name } from "./shared/one"; import { other } from "./shared/two"; import type { name as Kind } from "./shared/kind"; ${head}
      test("they are there", () => { const kind: Kind = { level: 2 }; console.log("they are there:", name, other, kind.level); });`,
  },
  "names imported from a CommonJS file that hands on the exports of another": {
    "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "./index.js" }`,
    "node_modules/dep/index.js": `exports.x = function x() { return "x of dep"; }; exports.y = 2;`,
    "node_modules/forwarded/package.json": `{ "name": "forwarded", "version": "1.0.0", "type": "commonjs", "main": "./index.js" }`,
    "node_modules/forwarded/index.js": `module.exports = require("dep");`,
    "local/own.cjs": `exports.x = () => "x of own.cjs"; exports.y = 3;`,
    "local/hands-on-a-package.cjs": `module.exports = require("dep");`,
    "local/hands-on-a-file.cjs": `module.exports = require("./own.cjs");`,
    "local/twice.cjs": `module.exports = require("./hands-on-a-package.cjs");`,
    "package.test.mjs": `${head} import { x, y } from "forwarded"; test("a package hands on a package", () => { console.log("package:", x(), y); });`,
    "file.test.mjs": `${head} import { x, y } from "./local/hands-on-a-package.cjs"; test("a file hands on a package", () => { console.log("file:", x(), y); });`,
    "own.test.mjs": `${head} import { x, y } from "./local/hands-on-a-file.cjs"; test("a file hands on a file", () => { console.log("own:", x(), y); });`,
    "twice.test.mjs": `${head} import { x, y } from "./local/twice.cjs"; import * as all from "./local/twice.cjs"; test("handed on twice", () => { console.log("twice:", x(), y, Object.keys(all).sort().join()); });`,
    "absent.test.mjs": `${head} test("a name that is not there", async () => {
        console.log("absent:", await import("./wants-absent.mjs").then(() => "loaded", error => error.name + ": " + error.message.replace(/'[^']*[\\/]/, "'")));
      });`,
    "wants-absent.mjs": `import { z } from "./local/hands-on-a-package.cjs"; console.log(z);`,
  },
  "a module below a graph that failed runs for the next graph that imports it": {
    "first.mjs": `
      import { next } from "./shared.mjs";
      import { made } from "./barrel.mjs";
      import "./throws.cjs";
      console.log("first runs", next(), made);`,
    "shared.mjs": `
      console.log("shared runs");
      let count = 0;
      export function next() {
        return ++count;
      }`,
    "barrel.mjs": `export * from "./behind-barrel.mjs";`,
    "behind-barrel.mjs": `
      console.log("behind-barrel runs");
      export const made = "behind the barrel " + process.argv.slice(0, 0).length;`,
    "throws.cjs": `
      console.log("throws.cjs runs");
      exports.v = 4;
      throw new Error("boom");`,
    "third.mjs": `
      import { next } from "./shared.mjs";
      import { made } from "./barrel.mjs";
      console.log("third runs", next(), made);`,
    "fourth.mjs": `
      import { next } from "./shared.mjs";
      console.log("fourth runs", next());`,
    "failed.test.ts": `${head}
      test("in a test", async () => {
        await import("./first.mjs").then(
          () => console.log("first loaded"),
          error => console.log("first rejected:", error.message),
        );
        await import("./third.mjs");
        await import("./fourth.mjs");
      });`,
  },
  "a require() that has answered before answers anew behind an eviction and a mock": {
    "data.json": `{ "value": 1 }`,
    "other.json": `{ "value": 5 }`,
    "esm.mjs": `export const name = "esm"; export let count = 0; export const bump = () => ++count;`,
    "plain.cjs": `exports.runs = globalThis.runsOfPlain = (globalThis.runsOfPlain ?? 0) + 1;`,
    "evicted.test.ts": `${head}
      test("behind an eviction", () => {
        const first = require("./data.json");
        for (let turn = 0; turn < 3; turn++) console.log("a data file again:", first === require("./data.json"), require("./data.json").value);
        const esm = require("./esm.mjs");
        esm.bump();
        console.log("an ES module again:", esm === require("./esm.mjs"), require("./esm.mjs").count);
        const plain = require("./plain.cjs");
        console.log("a CommonJS file again:", plain === require("./plain.cjs"), require("./plain.cjs").runs);
        delete require.cache[require.resolve("./data.json")];
        const fresh = require("./data.json");
        console.log("a data file behind an eviction:", fresh === first, fresh.value, fresh === require("./data.json"));
        delete require.cache[require.resolve("./esm.mjs")];
        console.log("an ES module behind an eviction:", esm === require("./esm.mjs"), require("./esm.mjs").count);
        delete require.cache[require.resolve("./plain.cjs")];
        console.log("a CommonJS file behind an eviction:", plain === require("./plain.cjs"), require("./plain.cjs").runs);
      });`,
    "mocked.test.ts": `${head}
      test("behind a mock", async () => {
        const other = require("./other.json");
        console.log("before the mock:", other === require("./other.json"), other.value);
        mock.module("./other.json", () => ({ default: { value: "mocked" } }));
        console.log("behind a mock:", JSON.stringify(require("./other.json")), other === require("./other.json"));
        console.log("by import():", JSON.stringify((await import("./other.json")).default));
        mock.module("./other.json", () => ({ default: { value: "mocked again" } }));
        console.log("behind a second mock:", JSON.stringify(require("./other.json")));
        mock.restore();
        console.log("behind restore:", JSON.stringify(require("./other.json")));
      });`,
  },
  "a loader that a test stores into require.extensions": {
    "files/own.custom": `module.exports = "own.custom as JavaScript";`,
    "files/late.custom": `module.exports = "late.custom as JavaScript";`,
    "files/plain.cjs": `module.exports = "plain.cjs";`,
    "files/wrapped.cjs": `module.exports = "wrapped.cjs";`,
    "files/ran.cjs": `globalThis.ran = (globalThis.ran ?? 0) + 1;\nmodule.exports = "ran.cjs " + globalThis.ran;`,
    "helpers/asks.cjs": `exports.ask = () => require("../files/wrapped.cjs");`,
    "loaders.test.js": `${head}
      import Module from "node:module";
      import { ask } from "./helpers/asks.cjs";
      const short = path => path.slice(path.lastIndexOf("/") + 1);
      test("an extension of its own", () => {
        require.extensions[".custom"] = (module, filename) => module._compile('module.exports = "made of " + ' + JSON.stringify(short(filename)), filename);
        console.log("custom:", require("./files/own"), "|", require("./files/own.custom"));
        console.log("custom, under the short name alone:", require("./files/late"));
        delete require.extensions[".custom"];
        let said; try { said = require("./files/own"); } catch (error) { said = error.code ?? error.name; }
        console.log("custom, behind the delete:", said, "|", require("./files/own.custom"));
        console.log("custom, loaded before the delete and named whole behind it:", require("./files/late.custom"));
        delete require.cache[require.resolve("./files/late.custom")];
        console.log("custom, taken out of the cache:", require("./files/late.custom"));
      });
      test("in place of a loader of Bun's", () => {
        const original = Module._extensions[".cjs"] ?? Module._extensions[".js"];
        console.log("before:", require("./files/ran.cjs"));
        const seen = [];
        Module._extensions[".cjs"] = (module, filename) => { seen.push(short(filename)); module._compile('module.exports = "replaced"', filename); };
        console.log("replaced:", require("./files/plain.cjs"), "| a file that has run stays:", require("./files/ran.cjs"), "|", seen.join());
        Module._extensions[".cjs"] = (module, filename) => { seen.push(short(filename)); original(module, filename); };
        console.log("wrapped:", ask(), "|", seen.join());
        delete Module._extensions[".cjs"];
        console.log("behind:", require("./files/plain.cjs"), require("./files/wrapped.cjs"), require("./files/ran.cjs"));
      });`,
    "reads.test.js": `${head}
      test("whoever only reads the table changes nothing", () => {
        console.log("reads:", typeof require.extensions[".js"], Object.keys(require.extensions).includes(".json"), require("./files/plain.cjs"));
      });`,
  },
  "a JSON file without a value": {
    "data/empty.json": ``,
    "data/blank.json": `  \n`,
    "data/no-extension": ``,
    "data/empty.jsonc": ``,
    "helpers/reads.cjs": `exports.read = () => require("../data/empty.json");`,
    "empty.test.js": `${head}
      import { read } from "./helpers/reads.cjs";
      const said = async load => { try { return JSON.stringify((await load()).default); } catch (error) { return error.name + ": " + error.message; } };
      test("JSON.parse takes no empty text", async () => {
        console.log("by its extension", await said(() => import("./data/empty.json")));
        console.log("by its type", await said(() => import("./data/no-extension", { with: { type: "json" } })));
        console.log("blanks alone", await said(() => import("./data/blank.json")));
        console.log("require()", await said(async () => ({ default: require("./data/blank.json") })));
        console.log("require() in a shared file", await said(async () => ({ default: read() })));
        console.log("with comments allowed", await said(() => import("./data/empty.jsonc")));
      });`,
  },
  "a built-in module under a name made at run time": {
    "mocked.test.js": `${head}
      const made = text => text.slice(process.argv.length > 90 ? 1 : 0);
      test("behind a mock", async () => {
        mock.module("node:path", () => ({ join: () => "mocked" }));
        console.log("node:path", (await import(made("node:path"))).join("a", "b"), (await import(made("path"))).join("a", "b"));
        mock.module("node:os", () => ({ platform: () => "mocked" }));
        console.log("node:os", (await import(made("node:os"))).platform());
      });`,
    "same.test.js": `${head}
      const made = text => text.slice(process.argv.length > 90 ? 1 : 0);
      test("one module, however it is named", async () => {
        // The piece holds node:path and node:fs for its own library code, and not the others.
        for (const name of ["node:path", "path", "node:fs", "node:events", "node:util", "node:stream"]) {
          const byName = await import(made(name));
          console.log(name, byName.default === require(name), byName === (await import(made(name))), byName.default === require(made(name)));
        }
        console.log("written out", (await import("node:path")) === (await import(made("node:path"))), (await import("node:events")).default === (await import(made("events"))).default);
      });`,
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
  // The loader takes every step of the import() before the require() returns, and what it made for the two modules goes when the test has ended.
  "what an import() loaded inside a require() is when later tests load it again": {
    ...state,
    "helpers/running.js": `import { bump } from "./state.js";\nexport const loaded = import("./beside.js");\nexport const first = bump();`,
    "helpers/beside.js": `import { bump } from "./state.js";\nexport const second = bump();\nlet calls = 0;\nexport function call() { return ++calls; }`,
    "again.test.js": `${head}
      test("a require() of a module that calls import() while it runs", async () => {
        const running = require("./helpers/running.js");
        const beside = await running.loaded;
        console.log("the first load", running.first, beside.second, beside.call());
      });
      test("a later test loads both again", async () => {
        const running = require("./helpers/running.js");
        const beside = await import("./helpers/beside.js");
        console.log("a later load", running.first, beside.second, beside.call(), beside === (await running.loaded), beside === require("./helpers/beside.js"));
      });
      test("the file that both import has run once", async () => {
        const { count } = await import("./helpers/state.js");
        console.log("the shared file", count, require("./helpers/state.js").bump(), require("./helpers/beside.js").call());
      });`,
  },
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { stdout: printed.sort(), results: results.sort(), exitCode };
}

// A run of few test files is one program. The words ask for what a large run gets: the packages in one image, the other shared files in a second, and each test file in one of its own.
const ways = {
  "each file in its own realm": { flags: ["--isolate"] },
  "in parallel": { flags: ["--isolate", "--parallel=2"] },
  "twice": { flags: ["--isolate", "--rerun-each=2"] },
  "over two layers": { flags: ["--isolate"], words: "TestRunLayers:2,TestRunPartFiles:1" },
  "over three layers": { flags: ["--isolate"], words: "TestRunLayers:3,TestRunPartFiles:1" },
} satisfies Record<string, { flags: string[]; words?: string }>;

// TODO: what happens today, by project and way.
const differs: Record<string, string[]> = {
  // The file is read from disk, and its import of a compiled file is refused ("can't load a module from a dynamic path"): an Error. Plain: a SyntaxError, a BuildMessage.
  "a file that fails when it is linked to a compiled file": [
    "each file in its own realm",
    "twice",
    "over two layers",
    "over three layers",
  ],
};

// A run in layers builds the library anew, and each of its test files is an image of its own. So over layers these projects are the folders of one. They
// say nothing about a whole run: no file that several test files share loads or evicts under a name that it does not spell, none fails to load, and there
// is no plugin, preload, package, or mock of a package or of a built-in module. A new project runs alone until it is listed here.
const shareARunInLayers = [
  "every way from a test file to a shared file",
  "files of data",
  "a file that is written while the tests run",
  "each test file has its own modules under --isolate",
  "a test file that imports another test file",
  "what a file knows of itself",
  "circles across the border",
  "top-level await",
  "mock.module of a file that has run",
  "mock.module before the shared files load",
  "a query makes one more instance of a file",
  "what a CommonJS file knows of itself",
  "a file of data that one statement imports, found by a name made at run time where the importer has not run",
  "require() of a file of data that another test file's modules import",
  "built-in modules that only the test file names",
  "a name that a test file imports twice",
];

// The results of each folder, and what the whole run printed.
async function runFolders(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const results = new Map<string, string[]>();
  let folder = "";
  for (const line of stderr.split("\n")) {
    const [, file] = line.match(/^(\S+\.test\.\w+):$/) ?? [];
    if (file) folder = file.split("/")[0];
    const [, result, name] = line.match(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/) ?? [];
    if (result) results.getOrInsertComputed(folder, () => []).push(`${result} ${name}`);
  }
  for (const list of results.values()) list.sort();
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { results, stdout: printed.sort(), exitCode };
}

function declareProjectsThatShareARun(way: string, names: string[], flags: string[], words: string) {
  const folderOf = (name: string) => `p${String(names.indexOf(name) + 1).padStart(2, "0")}`;
  let dir: ReturnType<typeof tempDir> | undefined;
  afterAll(() => dir?.[Symbol.dispose]());
  let runs: Promise<Awaited<ReturnType<typeof runFolders>>[]> | undefined;
  const ran = () =>
    (runs ??= (async () => {
      const files: Record<string, string> = {
        "package.json": `{ "type": "module" }`,
        "tsconfig.json": `{ "compilerOptions": { "allowJs": true } }`,
      };
      for (const name of names)
        for (const [path, text] of Object.entries(projects[name])) files[`${folderOf(name)}/${path}`] = text;
      dir = tempDir("modules-in-a-test-run", files);
      return [
        await runFolders(String(dir), undefined, ...flags),
        await runFolders(String(dir), words, "--aot", ...flags),
      ];
    })());
  for (const name of names) {
    test.concurrent(`${name}: ${way}`, async () => {
      const [plain, compiled] = await ran();
      expect(plain.results.get(folderOf(name)) ?? []).not.toEqual([]);
      expect(compiled.results.get(folderOf(name))).toEqual(plain.results.get(folderOf(name)));
    });
  }
  test.concurrent(`what the projects that share a run print: ${way}`, async () => {
    const [plain, compiled] = await ran();
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      exitCode: plain.exitCode,
    });
  });
}

// The runs of a way are dealt over its test files, <name>.test.ts, <name>-2.test.ts and so on, which all read alike. CI's runner gives a file three minutes
// on four processors, and a run in layers takes about 40 s of one. A way that has grown too long gets one more file: there is nothing else to change.
function dealsRunsTo(testFile: string) {
  const withoutNumber = (file: string) => file.replace(/(-\d+)?\.test\.ts$/, ".test.ts");
  const testFiles = readdirSync(dirname(testFile))
    .filter(file => withoutNumber(file) === withoutNumber(basename(testFile)))
    .sort();
  let dealt = 0;
  return () => testFiles[dealt++ % testFiles.length] === basename(testFile);
}

export function declareEveryProject(way: keyof typeof ways, testFile: string) {
  const { flags, words }: { flags: string[]; words?: string } = ways[way];
  const nextRunIsHere = dealsRunsTo(testFile);
  const sharing = words ? shareARunInLayers.filter(name => !differs[name]?.includes(way)) : [];
  if (words && nextRunIsHere()) declareProjectsThatShareARun(way, sharing, flags, words);
  for (const [name, files] of Object.entries(projects)) {
    if (sharing.includes(name) || !nextRunIsHere()) continue;
    const declare = differs[name]?.includes(way) ? test.todo : test.concurrent;
    declare(`${name}: ${way}`, async () => {
      using dir = tempDir("modules-in-a-test-run", {
        "package.json": `{ "type": "module" }`,
        "tsconfig.json": `{ "compilerOptions": { "allowJs": true } }`,
        // No run of one test file has layers.
        "zz-one-more.test.js": `${head}\ntest("one more file", () => { console.log("one more file runs"); });`,
        ...files,
      });
      const plain = await runTests(String(dir), undefined, ...flags);
      // A project whose own test files do not even parse fails alike in both runs.
      expect(plain.results.filter(result => result !== "pass one more file")).not.toEqual([]);
      expect(await runTests(String(dir), words, "--aot", ...flags)).toEqual(plain);
    });
  }
}
