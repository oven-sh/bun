// CommonJS and plugins of `Bun.build`. What a CommonJS file exports, in which order the files run and which of them lie on a cycle
// is read off the text that the plugins yield and off the files that they resolve to, never off the disk: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const describeModule = `function describe(value) {
  if (typeof value === "function") return "function " + value.name + " " + JSON.stringify(Object.keys(value));
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(Object.fromEntries(Reflect.ownKeys(value).map(key => [String(key), typeof value[key] === "function" ? "function" : value[key]])));
}`;

const entry = (name: string) => `entrypoints: ["./${name}"]`;

function replace(files: Record<string, string>) {
  return `const texts: Record<string, string> = ${JSON.stringify(files)};
build.onLoad({ filter: /\\.[cm]?js$/ }, (args: any) => { const contents = texts[basename(args.path)]; if (contents !== undefined) return { contents, loader: "js" }; });`;
}

buildBothWays("compile/aot/CommonJS that the plugins of Bun.build supply", {
  "other names than the file on the disk exports, required": {
    files: {
      "main.cjs": `${describeModule}\nconst lib = require("./lib.cjs"); const { a, b, c } = require("./lib.cjs"); console.log(lib.a, lib.b, lib.c, a, b, c, describe(lib));`,
      "lib.cjs": `exports.a = "disk a"; exports.b = "disk b";`,
    },
    plugins: [replace({ "lib.cjs": `exports.a = "plugin a"; exports.c = "plugin c";` })],
    options: entry("main.cjs"),
    prints: `plugin a undefined plugin c plugin a undefined plugin c {"a":"plugin a","c":"plugin c"}\n`,
  },
  "other names than the file on the disk exports, imported": {
    files: {
      "main.mjs": `import lib, { a, c } from "./lib.cjs"; import * as all from "./lib.cjs"; console.log(a, c, lib.a, lib.b, lib.c, all.a, all.b, all.c);`,
      "lib.cjs": `exports.a = "disk a"; exports.b = "disk b";`,
    },
    plugins: [replace({ "lib.cjs": `exports.a = "plugin a"; exports.c = "plugin c";` })],
    options: entry("main.mjs"),
    prints: "plugin a plugin c plugin a undefined plugin c plugin a undefined plugin c\n",
  },
  "a name that only the file on the disk exports, imported": {
    files: {
      "main.mjs": `import { b } from "./lib.cjs"; console.log(b);`,
      "lib.cjs": `exports.a = "disk a"; exports.b = "disk b";`,
    },
    plugins: [replace({ "lib.cjs": `exports.a = "plugin a";` })],
    options: entry("main.mjs"),
    prints: "undefined\n",
    // As `bun run`: a SyntaxError when the modules are linked.
    differs: { stdout: "", exitCode: 1 },
  },
  "names on the disk, one value from the plugin": {
    files: {
      "main.cjs": `${describeModule}\nconst lib = require("./lib.cjs"); console.log(describe(lib), typeof lib === "function" && lib(2), lib.f, lib.extra);`,
      "lib.cjs": `exports.f = function f() { return "disk"; };`,
    },
    plugins: [
      replace({ "lib.cjs": `module.exports = function twice(n) { return n * 2; }; module.exports.extra = "extra";` }),
    ],
    options: entry("main.cjs"),
    prints: `function twice ["extra"] 4 undefined extra\n`,
  },
  "one value on the disk, names from the plugin": {
    files: {
      "main.cjs": `${describeModule}\nconst lib = require("./lib.cjs"); console.log(describe(lib), lib.f());`,
      "lib.cjs": `module.exports = class Disk {};`,
    },
    plugins: [replace({ "lib.cjs": `exports.f = function f() { return this === exports; }; exports.n = 1;` })],
    options: entry("main.cjs"),
    prints: `{"f":"function","n":1} true\n`,
  },
  "an ES module on the disk, CommonJS from the plugin": {
    files: {
      "main.mjs": `import lib, { a } from "./lib.js"; console.log(a, JSON.stringify(lib));`,
      "lib.js": `export const a = "disk"; export default "disk default";`,
    },
    plugins: [
      replace({ "lib.js": `exports.a = "plugin"; exports.more = typeof module + typeof require + typeof exports;` }),
    ],
    options: entry("main.mjs"),
    prints: `plugin {"a":"plugin","more":"objectfunctionobject"}\n`,
  },
  "CommonJS on the disk, an ES module from the plugin": {
    files: {
      "main.cjs": `${describeModule}\nconst lib = require("./lib.js"); console.log(lib.a, lib.default, lib.__esModule, Object.keys(lib).sort().join());`,
      "lib.js": `exports.a = "disk";`,
    },
    plugins: [
      replace({
        "lib.js": `export const a = "plugin"; export default "plugin default"; export let later; later = typeof module;`,
      }),
    ],
    options: entry("main.cjs"),
  },
  "a .cjs file whose text becomes an ES module": {
    files: {
      "main.mjs": `import lib, { a } from "./lib.cjs"; import * as all from "./lib.cjs"; console.log(a, lib, Object.keys(all).sort().join());`,
      "second.cjs": `const lib = require("./lib.cjs"); console.log("second", lib.a, lib.default);`,
      "lib.cjs": `exports.a = "disk";`,
    },
    plugins: [
      replace({
        "lib.cjs": `export const a = "plugin"; export default "plugin default";`,
        "main.mjs": `import "./second.cjs"; import lib, { a } from "./lib.cjs"; import * as all from "./lib.cjs"; console.log(a, lib, Object.keys(all).sort().join());`,
      }),
    ],
    options: entry("main.mjs"),
  },
  "a .mjs file whose text becomes CommonJS": {
    files: {
      "main.mjs": `import lib, { a } from "./lib.mjs"; console.log(a, JSON.stringify(lib));`,
      "lib.mjs": `export const a = "disk"; export default "disk default";`,
    },
    plugins: [replace({ "lib.mjs": `module.exports = { a: "plugin", kind: typeof exports };` })],
    options: entry("main.mjs"),
  },
  "onResolve closes a cycle that the disk does not have": {
    files: {
      "main.cjs": `const a = require("./a.cjs"); console.log("main", JSON.stringify(a));`,
      "a.cjs": `exports.early = "a early"; const b = require("./b.cjs"); exports.late = "a late"; exports.b = b;`,
      "b.cjs": `const c = require("./c.cjs"); exports.seen = JSON.stringify(c); exports.read = () => c.late;`,
      "c.cjs": `exports.leaf = true;`,
    },
    plugins: [`build.onResolve({ filter: /^\\.\\/c\\.cjs$/ }, () => ({ path: join(folder, "a.cjs") }));`],
    options: entry("main.cjs"),
    prints: `main {"early":"a early","late":"a late","b":{"seen":"{\\"early\\":\\"a early\\"}"}}\n`,
  },
  "onResolve closes a cycle, and names are read by binding": {
    files: {
      "main.cjs": `const a = require("./a.cjs"); console.log(a.early, a.late, a.fromB(), a.atLoad);`,
      "a.cjs": `exports.early = 1; const b = require("./b.cjs"); exports.late = 2; exports.fromB = () => b.late(); exports.atLoad = b.atLoad;`,
      "b.cjs": `const c = require("./c.cjs"); exports.atLoad = String(c.early) + String(c.late); exports.late = () => String(c.early) + String(c.late);`,
      "c.cjs": `exports.early = "leaf"; exports.late = "leaf";`,
    },
    plugins: [`build.onResolve({ filter: /^\\.\\/c\\.cjs$/ }, () => ({ path: join(folder, "a.cjs") }));`],
    options: entry("main.cjs"),
    prints: "1 2 12 1undefined\n",
  },
  "onResolve opens a cycle that the disk has": {
    files: {
      "main.cjs": `const a = require("./a.cjs"); console.log(JSON.stringify(a));`,
      "a.cjs": `exports.early = 1; exports.b = require("./b.cjs"); exports.late = 2;`,
      "b.cjs": `const a = require("./a.cjs"); exports.seen = JSON.stringify(a);`,
      "leaf.cjs": `exports.leaf = true;`,
    },
    plugins: [
      `build.onResolve({ filter: /^\\.\\/a\\.cjs$/ }, (args: any) => (args.importer.endsWith("b.cjs") ? { path: join(folder, "leaf.cjs") } : undefined));`,
    ],
    options: entry("main.cjs"),
    prints: `{"early":1,"b":{"seen":"{\\"leaf\\":true}"},"late":2}\n`,
  },
  "onLoad closes a cycle with a require that the disk does not have": {
    files: {
      "main.mjs": `import { a, seenByB } from "./a.cjs"; console.log(a, seenByB);`,
      "a.cjs": `exports.a = "a"; exports.seenByB = require("./b.cjs").seen;`,
      "b.cjs": `exports.seen = "nothing";`,
    },
    plugins: [
      replace({ "b.cjs": `const a = require("./a.cjs"); exports.seen = Object.keys(a).join() + ":" + a.seenByB;` }),
    ],
    options: entry("main.mjs"),
    prints: "a a:undefined\n",
  },
  "an ES cycle that onResolve closes": {
    files: {
      "main.mjs": `import { a, readB } from "./a.mjs"; console.log(a, readB());`,
      "a.mjs": `import { b, readA } from "./b.mjs"; export const a = "a"; export const readB = () => b + readA();`,
      "b.mjs": `import { a } from "./c.mjs"; export const b = "b"; export const readA = () => a;`,
      "c.mjs": `export const a = "leaf";`,
    },
    plugins: [`build.onResolve({ filter: /^\\.\\/c\\.mjs$/ }, () => ({ path: join(folder, "a.mjs") }));`],
    options: entry("main.mjs"),
    prints: "a ba\n",
  },
  "a CommonJS module in a namespace": {
    files: {
      "main.cjs": `${describeModule}\nconst lib = require("virtual:lib"); console.log(describe(lib));`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: 'exports.types = [typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname].join(); exports.isThis = this === exports; exports.isModuleExports = module.exports === exports; exports.isMain = require.main === module;', loader: "js" }));`,
    ],
    options: entry("main.cjs"),
  },
  "a CommonJS module in a namespace, imported by names": {
    files: { "main.mjs": `import lib, { one, two } from "virtual:lib"; console.log(one, two(), JSON.stringify(lib));` },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: 'exports.one = 1; exports.two = function () { return exports.one + 1; };', loader: "js" }));`,
    ],
    options: entry("main.mjs"),
    prints: `1 2 {"one":1}\n`,
  },
  "a CommonJS module in a namespace on a cycle with a file": {
    files: {
      "main.cjs": `const a = require("./a.cjs"); console.log(JSON.stringify(a));`,
      "a.cjs": `exports.early = 1; exports.virtual = require("virtual:lib"); exports.late = 2;`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "const a = require(" + JSON.stringify(join(folder, "a.cjs")) + "); exports.seen = JSON.stringify(a);", loader: "js" }));`,
    ],
    options: entry("main.cjs"),
    prints: `{"early":1,"virtual":{"seen":"{\\"early\\":1}"},"late":2}\n`,
  },
  "two modules in a namespace that require each other": {
    files: { "main.cjs": `console.log(JSON.stringify(require("virtual:a")));` },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => ({ contents: args.path === "a" ? 'exports.early = 1; exports.b = require("virtual:b"); exports.late = 2;' : 'exports.seen = JSON.stringify(require("virtual:a"));', loader: "js" }));`,
    ],
    options: entry("main.cjs"),
    prints: `{"early":1,"b":{"seen":"{\\"early\\":1}"},"late":2}\n`,
  },
  "two specifiers that resolve to one file: it runs once": {
    files: {
      "main.cjs": `const one = require("one"), two = require("two"), three = require("./lib.cjs"); console.log(one === two, two === three, one.runs);`,
      "lib.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1; exports.runs = globalThis.runs;`,
    },
    plugins: [`build.onResolve({ filter: /^(one|two)$/ }, () => ({ path: join(folder, "lib.cjs") }));`],
    options: entry("main.cjs"),
    prints: "true true 1\n",
  },
  "one specifier that resolves by its importer": {
    files: {
      "main.cjs": `console.log(require("./a.cjs").dep, require("./b.cjs").dep, require("dep").name);`,
      "a.cjs": `exports.dep = require("dep").name;`,
      "b.cjs": `exports.dep = require("dep").name;`,
      "for-a.cjs": `exports.name = "for a";`,
      "for-b.cjs": `exports.name = "for b";`,
      "for-main.cjs": `exports.name = "for main";`,
    },
    plugins: [
      `build.onResolve({ filter: /^dep$/ }, (args: any) => ({ path: join(folder, "for-" + basename(args.importer)) }));`,
    ],
    options: entry("main.cjs"),
    prints: "for a for b for main\n",
  },
  "the order in which files run is that of the text of the plugin": {
    files: {
      "main.cjs": `console.log("main starts"); require("./a.cjs"); console.log("main ends");`,
      "a.cjs": `console.log("a on the disk"); require("./b.cjs"); require("./c.cjs");`,
      "b.cjs": `console.log("b");`,
      "c.cjs": `console.log("c");`,
      "d.cjs": `console.log("d");`,
    },
    plugins: [
      replace({
        "a.cjs": `require("./c.cjs"); console.log("a from the plugin"); require("./d.cjs"); if (globalThis.never) require("./b.cjs");`,
      }),
    ],
    options: entry("main.cjs"),
    prints: "main starts\nc\na from the plugin\nd\nmain ends\n",
  },
  "a require at the top on the disk, in a function in the text of the plugin": {
    files: {
      "main.cjs": `const a = require("./a.cjs"); console.log("before"); console.log(a.get().name, a.get() === a.get());`,
      "a.cjs": `const b = require("./b.cjs"); exports.get = () => b;`,
      "b.cjs": `console.log("b runs"); exports.name = "b";`,
    },
    plugins: [replace({ "a.cjs": `exports.get = () => require("./b.cjs");` })],
    options: entry("main.cjs"),
    prints: "before\nb runs\nb true\n",
  },
  "a require under try whose file throws in the text of the plugin": {
    files: {
      "main.cjs": `let first; try { require("./a.cjs"); } catch (error) { first = error.message; } let second; try { second = JSON.stringify(require("./a.cjs")); } catch (error) { second = "again: " + error.message; } console.log(first, second);`,
      "a.cjs": `exports.fine = true;`,
    },
    plugins: [replace({ "a.cjs": `exports.partial = true; throw new Error("thrown by the text of the plugin");` })],
    options: entry("main.cjs"),
    prints: `thrown by the text of the plugin {"partial":true}\n`,
    // A module that threw throws the same error when it is required again.
    differs: { stdout: "thrown by the text of the plugin again: thrown by the text of the plugin\n" },
  },
  "the __esModule marker is that of the text of the plugin": {
    files: {
      "main.mjs": `import marked from "./marked.cjs"; import unmarked from "./unmarked.cjs"; console.log(JSON.stringify(marked), JSON.stringify(unmarked));`,
      "marked.cjs": `exports.default = "disk"; exports.other = 1;`,
      "unmarked.cjs": `Object.defineProperty(exports, "__esModule", { value: true }); exports.default = "disk"; exports.other = 1;`,
    },
    plugins: [
      replace({
        "marked.cjs": `Object.defineProperty(exports, "__esModule", { value: true }); exports.default = "plugin"; exports.other = 1;`,
        "unmarked.cjs": `exports.default = "plugin"; exports.other = 1;`,
      }),
    ],
    options: entry("main.mjs"),
    prints: `{"default":"plugin","other":1} {"default":"plugin","other":1}\n`,
    // As `bun run`: the default import of a marked module is its `default`, also in a .mjs file.
    differs: { stdout: `"plugin" {"default":"plugin","other":1}\n` },
  },
  "export * from CommonJS that a plugin supplies": {
    files: {
      "main.mjs": `import * as all from "./barrel.mjs"; import { c } from "./barrel.mjs"; console.log(Object.keys(all).sort().join(), c);`,
      "barrel.mjs": `export * from "./lib.cjs"; export const own = 1;`,
      "lib.cjs": `exports.a = 1; exports.b = 2;`,
    },
    plugins: [replace({ "lib.cjs": `exports.c = 3; exports.d = 4;` })],
    options: entry("main.mjs"),
  },
  "module.exports = require(..) of a file that onResolve picks": {
    files: {
      "main.cjs": `const lib = require("./lib.cjs"); console.log(lib.name, lib === require("./picked.cjs"));`,
      "lib.cjs": `module.exports = require("./written.cjs");`,
      "written.cjs": `exports.name = "written";`,
      "picked.cjs": `exports.name = "picked";`,
    },
    plugins: [`build.onResolve({ filter: /written/ }, () => ({ path: join(folder, "picked.cjs") }));`],
    options: entry("main.cjs"),
    prints: "picked true\n",
  },
  "getters, computed keys and a frozen object in the text of the plugin": {
    files: {
      "main.cjs": `${describeModule}\nconst lib = require("./lib.cjs"); console.log(lib.count, lib.count, lib.computed, Object.isFrozen(lib), describe(lib));`,
      "lib.cjs": `exports.count = 0; exports.computed = "disk";`,
    },
    plugins: [
      replace({
        "lib.cjs": `let reads = 0; Object.defineProperty(exports, "count", { enumerable: true, get() { return ++reads; } }); exports["com" + "puted"] = "plugin"; Object.freeze(exports);`,
      }),
    ],
    options: entry("main.cjs"),
  },
  "a package of type module whose file becomes CommonJS": {
    files: {
      "main.mjs": `import lib, { a } from "pkg"; console.log(a, JSON.stringify(lib));`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "./index.js" }`,
      "node_modules/pkg/index.js": `export const a = "disk"; export default { a };`,
    },
    plugins: [
      `build.onLoad({ filter: /pkg[\\\\/]index\\.js$/ }, () => ({ contents: 'exports.a = "plugin"; exports.default = "the default";', loader: "js" }));`,
    ],
    options: entry("main.mjs"),
  },
  "a package without side effects whose text from the plugin has one": {
    files: {
      "main.mjs": `import "pkg"; import { unused } from "pkg/other.js"; console.log("main", globalThis.effects);`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "sideEffects": false, "main": "./index.js" }`,
      "node_modules/pkg/index.js": `exports.nothing = 1;`,
      "node_modules/pkg/other.js": `exports.unused = 1;`,
    },
    plugins: [
      `build.onLoad({ filter: /pkg[\\\\/](index|other)\\.js$/ }, (args: any) => ({ contents: '(globalThis.effects ??= []).push(' + JSON.stringify(basename(args.path)) + '); exports.unused = 1;', loader: "js" }));`,
    ],
    options: entry("main.mjs"),
  },
  "files required under a computed name get the text of the plugin": {
    files: {
      "main.cjs": `for (const name of process.argv.slice(2)) console.log(require("./mods/" + name + ".cjs").name);`,
      "mods/one.cjs": `exports.name = "one on the disk";`,
      "mods/two.cjs": `exports.name = "two on the disk";`,
    },
    plugins: [
      `build.onLoad({ filter: /mods[\\\\/]\\w+\\.cjs$/ }, (args: any) => { tell("onLoad", args); return { contents: "exports.name = " + JSON.stringify(basename(args.path) + " from the plugin") + ";", loader: "js" }; });`,
    ],
    options: entry("main.cjs"),
    arguments: ["one", "two"],
    prints: "one on the disk\ntwo on the disk\n",
    // Without `aot` the files are not in the executable: it reads them from the disk when it runs.
    differs: {
      stdout: "one.cjs from the plugin\ntwo.cjs from the plugin\n",
      told: ["one", "two"].map(
        name => `onLoad path="<folder>/mods/${name}.cjs" namespace="file" loader="js" defer=function side="server"`,
      ),
    },
  },
  "a module in a namespace required under a computed name": {
    files: {
      "main.cjs": `require("virtual:a"); try { console.log(require("virtual:" + process.argv[2]).name); } catch (error) { console.log("thrown", error.code); }`,
    },
    plugins: [
      `build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, (args: any) => ({ contents: "exports.name = " + JSON.stringify(args.path) + ";", loader: "js" }));`,
    ],
    options: entry("main.cjs"),
    arguments: ["a"],
    interprets: true,
  },
  "JSON and an object from a plugin, required": {
    files: {
      "main.cjs": `const data = require("./data.json"), object = require("./thing.obj"); console.log(data.n, JSON.stringify(data), object.a, JSON.stringify(object));`,
      "data.json": `{ "n": 0, "disk": true }`,
      "thing.obj": "",
    },
    plugins: [
      `build.onLoad({ filter: /data\\.json$/ }, () => ({ contents: '{ "n": 1, "plugin": true }', loader: "json" }));
build.onLoad({ filter: /\\.obj$/ }, () => ({ exports: { a: 1, default: { b: 2 } }, loader: "object" }));`,
    ],
    options: entry("main.cjs"),
  },
  "text that a bundler wrote: wrappers of CommonJS modules": {
    files: {
      "main.cjs": `const lib = require("./bundle.cjs"); console.log(lib.sum, lib.names);`,
      "bundle.cjs": `exports.sum = 0; exports.names = "disk";`,
    },
    plugins: [
      replace({
        "bundle.cjs": `var __commonJS = (cb, mod) => function __require() { return mod || (0, cb[Object.getOwnPropertyNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
var require_a = __commonJS({ "a.js"(exports) { exports.n = 1; exports.b = require_b(); } });
var require_b = __commonJS({ "b.js"(exports, module) { var a = require_a(); module.exports = { n: 2, seen: Object.keys(a).join() }; } });
var a = require_a();
exports.sum = a.n + a.b.n; exports.names = a.b.seen;`,
      }),
    ],
    options: entry("main.cjs"),
    prints: "3 n\n",
  },
  "import = require of CommonJS that a plugin supplies, with the types of the disk": {
    files: {
      "main.cts": `import lib = require("./lib.cjs"); const n: number = lib.n; console.log(typeof n, n, (lib as any).more);`,
      "lib.cjs": `exports.n = 1;`,
      "lib.d.cts": `export const n: number;`,
    },
    plugins: [replace({ "lib.cjs": `exports.n = "a string"; exports.more = "more";` })],
    options: entry("main.cts"),
    prints: "string a string more\n",
  },
  "require.resolve of what onResolve picks": {
    files: {
      "main.cjs": `const path = require("node:path"); console.log(path.basename(require.resolve("./written.cjs")), require("./written.cjs").name);`,
      "written.cjs": `exports.name = "written";`,
      "picked.cjs": `exports.name = "picked";`,
    },
    plugins: [`build.onResolve({ filter: /written/ }, () => ({ path: join(folder, "picked.cjs") }));`],
    options: entry("main.cjs"),
    prints: "written.cjs picked\n",
    // The path of the file that `require` loads.
    differs: { stdout: "picked.cjs picked\n" },
  },
  "the paths that a CommonJS file is told, where onResolve picked it": {
    files: {
      "main.cjs": `const path = require("node:path"); const lib = require("./written.cjs"); console.log(path.basename(lib.filename), path.basename(lib.id), lib.dirname === __dirname, lib.main);`,
      "written.cjs": `exports.filename = "written";`,
      "picked.cjs": `exports.filename = __filename; exports.dirname = __dirname; exports.id = module.id; exports.main = require.main === module;`,
    },
    plugins: [`build.onResolve({ filter: /written/ }, () => ({ path: join(folder, "picked.cjs") }));`],
    options: entry("main.cjs"),
  },
  "an entry point that is CommonJS only in the text of the plugin": {
    files: { "main.js": `export {}; console.log("disk", typeof module);` },
    // TODO: on Windows `require.main === module` is false in an executable built without --aot.
    plugins: [
      replace({
        "main.js": `console.log("plugin", typeof module, typeof exports, process.platform === "win32" || require.main === module, this === exports); exports.a = 1;`,
      }),
    ],
    options: entry("main.js"),
  },
});
