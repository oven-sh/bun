// Subpaths and patterns in "exports", the paths that "exports" does not expose, and "imports" (`#name`) of a package and of the program itself.
import { js, pkg, ts, ways, type Case } from "./run-packages";

const differs =
  "A require() or an import() of a path that the package does not export throws where it runs, as under `bun run`. What is thrown is an Error where `bun run` throws a ResolveMessage, and a file that is there but not exported is no part of the executable.";

export const root = {
  "imports": { "#app/*": "./app/*.mjs", "#cfg": "./app/cfg.json", "#one": "./app/one.mjs", "#pk": "hash_dep" },
};

export const cases: Case[] = [
  {
    name: "exports",
    differs,
    files: {
      ...pkg("sub", {
        "index.js": `exports.which = "sub:index";
exports.f = function f() { return "f of " + exports.which; };
`,
        "index.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/a.js": `exports.which = "sub:lib/a";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/a.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/feat/one.js": `exports.which = "sub:feat/one";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/feat/one.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/feat/two.js": `exports.which = "sub:feat/two";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/feat/two.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/feat/deep/three.js": `exports.which = "sub:feat/deep/three";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/feat/deep/three.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/feat/secret.js": `exports.which = "sub:feat/secret";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/ext/e.js": `exports.which = "sub:ext/e";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/ext/e.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/private/p.js": `exports.which = "sub:private/p";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/dual/d.mjs": `export const which = "sub:dual/d.mjs";
export function f() { return "f of " + which; }
`,
        "lib/dual/d.cjs": `exports.which = "sub:dual/d.cjs";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/dual/d.d.mts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/dual/d.d.cts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/mid/m/x.js": `exports.which = "sub:mid/m/x";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/mid/m/x.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/data.json": `{ "which": "sub:data.json", "n": 1 }
`,
        "lib/exact.js": `exports.which = "sub:exact";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/exact.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "lib/feat/exact.js": `exports.which = "sub:feat/exact (the pattern)";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/feat/exact.d.ts": `export declare const which: string;
export declare function f(): string;
`,
      }, {"exports": {".": "./index.js", "./a": "./lib/a.js", "./feat/*": "./lib/feat/*.js", "./feat/secret": null, "./feat/exact": "./lib/exact.js", "./ext/*.js": "./lib/ext/*.js", "./private/*": null, "./dual/*": {"import": "./lib/dual/*.mjs", "require": "./lib/dual/*.cjs"}, "./mid/*/x": "./lib/mid/*/x.js", "./data.json": "./lib/data.json", "./package.json": "./package.json"}}),
    },
    importers: {
      ...ways("sub", ["which", "f"], { hasDefault: false, only: ["names.mjs", "dynamic-import.mjs", "require.cjs", "names.ts"] }),
      ...ways("sub/a", ["which", "f"], { hasDefault: false, only: ["names.mjs", "dynamic-import.mjs", "require.cjs", "names.ts"] }),
      ...ways("sub/feat/one", ["which", "f"], { hasDefault: false }),
      ...ways("sub/feat/deep/three", ["which", "f"], { hasDefault: false, only: ["names.mjs", "dynamic-import.mjs", "require.cjs", "names.ts"] }),
      ...ways("sub/feat/exact", ["which", "f"], { hasDefault: false, only: ["names.mjs", "dynamic-import.mjs", "require.cjs", "names.ts"] }),
      ...ways("sub/ext/e.js", ["which", "f"], { hasDefault: false, only: ["names.mjs", "dynamic-import.mjs", "require.cjs", "names.ts"] }),
      ...ways("sub/dual/d", ["which", "f"], { hasDefault: false }),
      ...ways("sub/mid/m/x", ["which", "f"], { hasDefault: false, only: ["names.mjs", "dynamic-import.mjs", "require.cjs", "names.ts"] }),
      "json.mjs": `import d from "sub/data.json";
import { which } from "sub/data.json";
import p from "sub/package.json";
${js}t("d", () => d); t("which", () => which); t("name", () => p.name);
`,
      "json.cjs": `${js}t("d", () => require("sub/data.json")); t("name", () => require("sub/package.json").name); t("same", () => require("sub/data.json") === require("sub/data.json"));
`,
      "json.ts": `import d from "sub/data.json";
import p from "sub/package.json";
${ts}t("d", () => d); t("n", () => d.n + 1); t("name", () => p.name);
`,
      "closed0.mjs": `${js}const s = ["sub/lib/a.js"][0];
await ta("import", () => import(s).then((m) => m.which));
`,
      "closed0.cjs": `${js}const s = ["sub/lib/a.js"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
`,
      "closed_literal0.cjs": `${js}t("require", () => require("sub/lib/a.js").which);
`,
      "closed_literal0.mjs": `${js}await ta("import", () => import("sub/lib/a.js").then((m) => m.which));
`,
      "closed1.mjs": `${js}const s = ["sub/feat/secret"][0];
await ta("import", () => import(s).then((m) => m.which));
`,
      "closed1.cjs": `${js}const s = ["sub/feat/secret"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
`,
      "closed_literal1.cjs": `${js}t("require", () => require("sub/feat/secret").which);
`,
      "closed_literal1.mjs": `${js}await ta("import", () => import("sub/feat/secret").then((m) => m.which));
`,
      "closed2.mjs": `${js}const s = ["sub/private/p"][0];
await ta("import", () => import(s).then((m) => m.which));
`,
      "closed2.cjs": `${js}const s = ["sub/private/p"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
`,
      "closed_literal2.cjs": `${js}t("require", () => require("sub/private/p").which);
`,
      "closed_literal2.mjs": `${js}await ta("import", () => import("sub/private/p").then((m) => m.which));
`,
      "closed3.mjs": `${js}const s = ["sub/nothing"][0];
await ta("import", () => import(s).then((m) => m.which));
`,
      "closed3.cjs": `${js}const s = ["sub/nothing"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
`,
      "closed_literal3.cjs": `${js}t("require", () => require("sub/nothing").which);
`,
      "closed_literal3.mjs": `${js}await ta("import", () => import("sub/nothing").then((m) => m.which));
`,
      "closed4.mjs": `${js}const s = ["sub/feat/none"][0];
await ta("import", () => import(s).then((m) => m.which));
`,
      "closed4.cjs": `${js}const s = ["sub/feat/none"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
`,
      "closed_literal4.cjs": `${js}t("require", () => require("sub/feat/none").which);
`,
      "closed_literal4.mjs": `${js}await ta("import", () => import("sub/feat/none").then((m) => m.which));
`,
      "closed5.mjs": `${js}const s = ["sub/a.js"][0];
await ta("import", () => import(s).then((m) => m.which));
`,
      "closed5.cjs": `${js}const s = ["sub/a.js"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
`,
      "closed_literal5.cjs": `${js}t("require", () => require("sub/a.js").which);
`,
      "closed_literal5.mjs": `${js}await ta("import", () => import("sub/a.js").then((m) => m.which));
`,
      "closed6.mjs": `${js}const s = ["sub/"][0];
await ta("import", () => import(s).then((m) => m.which));
`,
      "closed6.cjs": `${js}const s = ["sub/"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
`,
      "closed_literal6.cjs": `${js}t("require", () => require("sub/").which);
`,
      "closed_literal6.mjs": `${js}await ta("import", () => import("sub/").then((m) => m.which));
`,
    },
  },
  {
    name: "imports",
    differs,
    files: {
      ...pkg("hash", {
        "index.js": `const i = require("#internal");
const c = require("#cond");
const u = require("#utils/u");
const d = require("#dep");
const s = require("#dep/sub");
module.exports = { internal: i.which, cond: c.which, utils: u.which, dep: d.which, depsub: s.which };
`,
        "index.mjs": `import i from "#internal";
import * as c from "#cond";
import { which as u } from "#utils/u";
import { which as d } from "#dep";
export const all = { internal: i.which, cond: c.which, utils: u, dep: d };
export const late = () => import("#utils/late").then((m) => m.which);
`,
        "index.d.ts": `export declare const all: { internal: string; cond: string; utils: string; dep: string };
export declare const late: () => Promise<string>;
`,
        "lib/internal.js": `exports.which = "hash:internal";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/c.mjs": `export const which = "hash:c.mjs";
export function f() { return "f of " + which; }
`,
        "lib/c.cjs": `exports.which = "hash:c.cjs";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/utils/u.js": `exports.which = "hash:utils/u";
exports.f = function f() { return "f of " + exports.which; };
`,
        "lib/utils/late.js": `exports.which = "hash:utils/late";
exports.f = function f() { return "f of " + exports.which; };
`,
      }, {"main": "./index.js", "exports": {".": {"types": "./index.d.ts", "import": "./index.mjs", "require": "./index.js"}}, "imports": {"#internal": "./lib/internal.js", "#cond": {"import": "./lib/c.mjs", "require": "./lib/c.cjs"}, "#utils/*": "./lib/utils/*.js", "#dep": "hash_dep", "#dep/*": "hash_dep/*"}}),
      ...pkg("hash_dep", {
        "index.js": `exports.which = "hash_dep:index";
exports.f = function f() { return "f of " + exports.which; };
`,
        "index.d.ts": `export declare const which: string;
export declare function f(): string;
`,
        "sub.js": `exports.which = "hash_dep:sub";
exports.f = function f() { return "f of " + exports.which; };
`,
      }, {"main": "index.js", "types": "index.d.ts"}),
      "app/one.mjs": `export const which = "app:one";
export function f() { return "f of " + which; }
`,
      "app/two.mjs": `export const which = "app:two";
export function f() { return "f of " + which; }
`,
      "app/cfg.json": `{ "which": "app:cfg" }
`,
    },
    importers: {
      "pkg.mjs": `import { all, late } from "hash";
${js}t("all", () => all); await ta("late", late);
`,
      "pkg.cjs": `${js}t("all", () => require("hash"));
`,
      "pkg.ts": `import { all, late } from "hash";
${ts}t("all", () => all); await ta("late", late);
`,
      "app.mjs": `import { which as one } from "#one";
import { which as two } from "#app/two";
import cfg from "#cfg";
import { which as pk } from "#pk";
${js}t("one", () => one); t("two", () => two); t("cfg", () => cfg); t("pk", () => pk);
`,
      "app.cjs": `${js}t("cfg", () => require("#cfg")); t("pk", () => require("#pk").which); t("one", () => require("#one").which);
`,
      "app_dyn.mjs": `${js}await ta("two", () => import("#app/two").then((m) => m.which));
const n = ["one"][0];
await ta("variable", () => import("#app/" + n).then((m) => m.which));
await ta("none", () => import("#none"));
`,
    },
  },
];
