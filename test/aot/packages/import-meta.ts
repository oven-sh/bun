// The fields of `import.meta`, and `__filename`, `module` and `require.main` in CommonJS.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    // prisma: `eval("__dirname")`, to hide the name from bundlers, in a file that also names it outright.
    name: "eval-of-dirname",
    files: {
      ...pkg(
        "evaluates_dirname",
        {
          "index.js": `"use strict";
var named = [typeof __dirname, typeof __filename];
function where() { const dir = eval("__dirname"); return typeof dir + " " + (dir === __dirname); }
function file() { return typeof eval("__filename") + " " + (eval("__filename") === __filename); }
module.exports = { where, file, named };
`,
        },
        { main: "index.js" },
      ),
    },
    importers: {
      "import.mjs": `import it from "evaluates_dirname";
${js}t("x", () => [it.named, it.where(), it.file()]);
`,
      "require.cjs": `${js}t("x", () => { const it = require("evaluates_dirname"); return [it.named, it.where(), it.file()]; });
`,
    },
  },
  {
    name: "import-meta",
    differs:
      "import.meta.require() of a path that only the caller knows: the file is looked for when the program runs, and it is not there. `bun build --compile` throws there too, an error of another class.",
    files: {
      ...pkg("meta", {
        "index.mjs": `const m = import.meta;
export const fields = () => ({ url: m.url, dir: m.dir, dirname: m.dirname, file: m.file, filename: m.filename, path: m.path, main: m.main, env: typeof m.env, resolve: typeof m.resolve, require: typeof m.require, keys: Object.keys(m).sort().join() });
export const resolved = (s) => import.meta.resolve(s);
export const req = (s) => import.meta.require(s);
export const same = () => import.meta === m;
export const isMain = import.meta.main;
`,
        "other.cjs": `exports.other = "other";
exports.main = require.main === module;
exports.names = [typeof __filename, typeof __dirname, typeof module.id, typeof module.filename, typeof module.paths, typeof module.children, typeof module.parent, module.loaded];
exports.file = __filename;
exports.dir = __dirname;
exports.id = module.id;
`,
        "data.txt": `the text
`,
      }),
    },
    importers: {
      "pkg.mjs": `import { fields, same, isMain } from "meta";
${js}t("fields", fields); t("same", same); t("isMain", () => isMain);
`,
      "entry.mjs": `${js}t("x", () => ({ url: import.meta.url, dir: import.meta.dir, file: import.meta.file, path: import.meta.path, main: import.meta.main, dirname: import.meta.dirname, filename: import.meta.filename }));
t("typeof", () => [typeof import.meta, typeof import.meta.env, typeof import.meta.nothing, Object.getPrototypeOf(import.meta) === null]);
t("write", () => { import.meta.mine = 1; return import.meta.mine; });
`,
      "entry.ts": `${ts}t("x", () => ({ url: import.meta.url, dir: import.meta.dir, file: import.meta.file, path: import.meta.path, main: import.meta.main, dirname: import.meta.dirname, filename: import.meta.filename }));
t("len", () => import.meta.url.length > 0);
export {};
`,
      "resolve.mjs": `import { resolved } from "meta";
${js}t("rel", () => resolved("./other.cjs")); t("pkg", () => resolved("meta")); t("node", () => resolved("node:fs")); t("none", () => resolved("nothing-there")); t("own", () => import.meta.resolve("./x.mjs"));
`,
      "meta_require.mjs": `import { req } from "meta";
${js}t("rel", () => req("./other.cjs").other); t("node", () => typeof req("node:path").join);
`,
      "url_file.mjs": `import { readFileSync } from "node:fs";
${js}t("new URL", () => new URL("./node_modules/meta/data.txt", import.meta.url).pathname.split("/").slice(-2).join("/"));
t("read", () => readFileSync(new URL("./node_modules/meta/data.txt", import.meta.url), "utf8"));
`,
      "cjs_names.cjs": `${js}const o = require("meta/other.cjs");
t("x", () => [o.main, o.names, o.file, o.dir, o.id]);
t("entry", () => [require.main === module, __filename, __dirname, module.id, typeof require.cache, typeof require.resolve, typeof require.extensions]);
`,
      "cjs_names_from_esm.mjs": `import o from "meta/other.cjs";
${js}t("x", () => [o.main, o.names, o.file, o.dir, o.id]);
`,
      "main_in_cjs.cjs": `if (require.main === module) console.log("I am main"); else console.log("I am not main");
console.log(typeof module.exports, module.exports === exports, this === exports);
`,
    },
  },
];
