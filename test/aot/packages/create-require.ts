// `createRequire()` in all its forms.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "create-require",
    differs:
      "createRequire() of a directory: a build follows createRequire(import.meta.url) and createRequire(__filename). What a require made from another text asks for is looked for when the program runs, and the file is not there. `bun build --compile` throws there too, an error of another class.",
    files: {
      ...pkg("creq", {
        "index.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const viaRel = () => require("./lib.cjs").lib;
export const viaPkg = () => require("creq_dep").dep;
export const viaJson = () => require("./package.json").name;
export const viaNode = () => typeof require("node:fs").readFileSync;
export const res = () => require.resolve("./lib.cjs");
export const top = require("./lib.cjs").lib;
`,
        "renamed.mjs": `import { createRequire as cr } from "module";
const req = cr(import.meta.url);
export const v = req("./lib.cjs").lib;
`,
        "ns.mjs": `import * as mod from "node:module";
const r = mod.createRequire(import.meta.url);
export const v = r("./lib.cjs").lib;
`,
        "dflt.mjs": `import mod from "node:module";
const r = mod.createRequire(import.meta.url);
export const v = r("./lib.cjs").lib;
`,
        "by_filename.cjs": `const { createRequire } = require("module");
const r = createRequire(__filename);
exports.v = r("./lib.cjs").lib;
`,
        "by_dir.mjs": `import { createRequire } from "node:module";
const r = createRequire(import.meta.dirname + "/");
export const v = r("./lib.cjs").lib;
`,
        "lib.cjs": `exports.lib = "lib";
`,
      }, {"main": "index.mjs"}),
      ...pkg("creq_dep", {
        "index.js": `exports.dep = "dep";
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "pkg.mjs": `import { viaRel, viaPkg, viaJson, viaNode, res, top } from "creq";
${js}t("top", () => top); t("rel", viaRel); t("pkg", viaPkg); t("json", viaJson); t("node", viaNode); t("res", res);
`,
      "entry.mjs": `import { createRequire } from "node:module";
${js}const require = createRequire(import.meta.url);
t("pkg", () => require("creq_dep").dep); t("rel", () => require("./node_modules/creq/lib.cjs").lib);
`,
      "entry.ts": `import { createRequire } from "node:module";
${ts}const require2 = createRequire(import.meta.url);
t("pkg", () => require2("creq_dep").dep); t("node", () => typeof require2("node:os").cpus);
`,
      "renamed_mjs.mjs": `${js}await ta("v", () => import("creq/renamed.mjs").then((m) => m.v));
`,
      "ns_mjs.mjs": `${js}await ta("v", () => import("creq/ns.mjs").then((m) => m.v));
`,
      "dflt_mjs.mjs": `${js}await ta("v", () => import("creq/dflt.mjs").then((m) => m.v));
`,
      "by_filename_cjs.mjs": `${js}await ta("v", () => import("creq/by_filename.cjs").then((m) => m.v));
`,
      "by_dir_mjs.mjs": `${js}await ta("v", () => import("creq/by_dir.mjs").then((m) => m.v));
`,
    },
  },
];
