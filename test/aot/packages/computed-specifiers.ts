// `require()` and `import()` of something that is not a string literal.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "variable",
    differs: "A name that is made at run time brings nothing into the executable: what no file of the program names is not there, and the load says so.",
    files: {
      ...pkg("dyn", {
        "index.js": `exports.load = (name) => require("./locale/" + name + ".js");
exports.loadT = (name) => require(\`./locale/\${name}.js\`);
exports.loadNoExt = (name) => require("./locale/" + name);
exports.loadAny = (p) => require(p);
exports.table = { en: () => require("./locale/en.js"), fr: () => require("./locale/fr.js") };
exports.cond = (x) => require(x ? "./locale/en.js" : "./locale/fr.js");
exports.tryLoad = (name) => { try { return require("./locale/" + name + ".js"); } catch (e) { return { hello: "fallback:" + e.code }; } };
`,
        "index.mjs": `export const load = (name) => import("./locale/" + name + ".js");
export const loadT = (name) => import(\`./locale/\${name}.js\`);
export const loadAny = (p) => import(p);
export const table = { en: () => import("./locale/en.js"), fr: () => import("./locale/fr.js") };
export const cond = (x) => import(x ? "./locale/en.js" : "./locale/fr.js");
`,
        "locale/en.js": `module.exports = { hello: "hello" };
`,
        "locale/fr.js": `module.exports = { hello: "bonjour" };
`,
      }, {"main": "index.js", "exports": {".": {"import": "./index.mjs", "require": "./index.js"}, "./locale/*": "./locale/*"}}),
    },
    importers: {
      "req_concat.cjs": `${js}const d = require("dyn");
t("x", () => d.load("en").hello);
`,
      "req_template.cjs": `${js}const d = require("dyn");
t("x", () => d.loadT("fr").hello);
`,
      "req_noext.cjs": `${js}const d = require("dyn");
t("x", () => d.loadNoExt("fr").hello);
`,
      "req_table.cjs": `${js}const d = require("dyn");
t("x", () => [d.table.en().hello, d.table["fr"]().hello]);
`,
      "req_cond.cjs": `${js}const d = require("dyn");
t("x", () => [d.cond(true).hello, d.cond(false).hello]);
`,
      "req_try.cjs": `${js}const d = require("dyn");
t("x", () => [d.tryLoad("en").hello, d.tryLoad("zz").hello]);
`,
      "req_any_builtin.cjs": `${js}const d = require("dyn");
t("x", () => [typeof d.loadAny("node:path").join, typeof d.loadAny("fs").readFileSync, typeof d.loadAny("bun").version]);
`,
      "req_any_bundled.cjs": `${js}const d = require("dyn");
require("dyn/locale/en.js");
t("x", () => d.loadAny("dyn/locale/en.js").hello);
t("y", () => d.loadAny("./locale/en.js").hello);
`,
      "imp_concat.mjs": `import { load } from "dyn";
${js}await ta("x", () => load("en").then((m) => m.default.hello));
`,
      "imp_template.mjs": `import { loadT } from "dyn";
${js}await ta("x", () => loadT("fr").then((m) => m.default.hello));
`,
      "imp_table.mjs": `import { table } from "dyn";
${js}await ta("x", () => table.en().then((m) => m.default.hello));
await ta("y", () => table["fr"]().then((m) => m.hello));
`,
      "imp_cond.mjs": `import { cond } from "dyn";
${js}await ta("x", () => cond(true).then((m) => m.default.hello));
await ta("y", () => cond(false).then((m) => m.default.hello));
`,
      "imp_any_builtin.mjs": `import { loadAny } from "dyn";
${js}await ta("x", () => loadAny("node:path").then((m) => [typeof m.join, typeof m.default.join]));
await ta("y", () => loadAny("bun").then((m) => typeof m.version));
await ta("z", () => loadAny("node:nothing"));
`,
      "imp_any_bundled.mjs": `import { loadAny } from "dyn";
import "dyn/locale/en.js";
${js}await ta("x", () => loadAny("dyn/locale/en.js").then((m) => m.default.hello));
`,
      "imp_data_url.mjs": `${js}await ta("x", () => import("data:text/javascript,export default 5").then((m) => m.default));
const u = "data:text/javascript,export default 6";
await ta("y", () => import(u).then((m) => m.default));
`,
      "imp_non_string.mjs": `${js}await ta("obj", () => import({ toString() { return "node:path"; } }).then((m) => typeof m.join));
await ta("undefined", () => import(undefined));
await ta("throws", () => import({ toString() { throw new RangeError("x"); } }));
`,
      "entry_variable.ts": `${ts}const name: string = ["node:os"][0]!;
await ta("x", () => import(name).then((m) => typeof m.cpus));
t("y", () => typeof require(name).cpus);
export {};
`,
    },
  },
];
