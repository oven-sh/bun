// `require()` of an ES module.
import { js, pkg, type Case } from "./run-packages";

const differs =
  "`require()` of a module with top-level await cannot work and throws a TypeError. What `require()` returns for an ES module is its namespace object, which cannot be written to.";

export const cases: Case[] = [
  {
    name: "require-esm",
    differs,
    files: {
      ...pkg("resm", {
        "plain.mjs": `export const a = 1;
export function f() { return "f"; }
`,
        "dflt.mjs": `export default function main() { return "main"; }
export const a = 1;
`,
        "only_default.mjs": `export default { tag: "only" };
`,
        "me.mjs": `const value = function me() { return "me"; };
export { value as "module.exports" };
export const a = 1;
`,
        "tla.mjs": `export const a = await Promise.resolve(1);
`,
        "tla_dep.mjs": `export { a } from "./tla.mjs";
export const b = 2;
`,
        "flagged.mjs": `export const __esModule = true;
export default "flagged default";
export const a = 1;
`,
        "live.mjs": `export let n = 0;
export const inc = () => ++n;
`,
        "empty.mjs": ``,
        "effects.mjs": `globalThis.__ran = (globalThis.__ran || 0) + 1;
`,
        "js_esm/package.json": `{ "type": "module" }`,
        "js_esm/x.js": `export const a = "js in type module";
export default "d";
`,
        "star.mjs": `export * from "./plain.mjs";
export * as inner from "./dflt.mjs";
`,
      }),
    },
    importers: {
      "plain_mjs.cjs": `${js}t("req", () => { const r = require("resm/plain.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "plain_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/plain.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "plain_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/plain.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "dflt_mjs.cjs": `${js}t("req", () => { const r = require("resm/dflt.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "dflt_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/dflt.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "dflt_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/dflt.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "only_default_mjs.cjs": `${js}t("req", () => { const r = require("resm/only_default.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "only_default_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/only_default.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "only_default_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/only_default.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "me_mjs.cjs": `${js}t("req", () => { const r = require("resm/me.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "me_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/me.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "me_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/me.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "tla_mjs.cjs": `${js}t("req", () => { const r = require("resm/tla.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "tla_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/tla.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "tla_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/tla.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "tla_dep_mjs.cjs": `${js}t("req", () => { const r = require("resm/tla_dep.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "tla_dep_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/tla_dep.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "tla_dep_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/tla_dep.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "flagged_mjs.cjs": `${js}t("req", () => { const r = require("resm/flagged.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "flagged_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/flagged.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "flagged_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/flagged.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "empty_mjs.cjs": `${js}t("req", () => { const r = require("resm/empty.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "empty_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/empty.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "empty_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/empty.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "js_esm_x_js.cjs": `${js}t("req", () => { const r = require("resm/js_esm/x.js"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "js_esm_x_js.in_esm.mjs": `${js}t("req", () => { const r = require("resm/js_esm/x.js"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "js_esm_x_js.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/js_esm/x.js"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "star_mjs.cjs": `${js}t("req", () => { const r = require("resm/star.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "star_mjs.in_esm.mjs": `${js}t("req", () => { const r = require("resm/star.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "star_mjs.ts": `// @ts-nocheck
${js}t("req", () => { const r = require("resm/star.mjs"); return [typeof r, typeof r === "function" ? r() : keys(r), r.a, r.default, r.__esModule, Object.prototype.toString.call(r)]; });
`,
      "live.cjs": `${js}const m = require("resm/live.mjs");
const { n, inc } = m;
t("x", () => [n, inc(), n, m.n, inc(), m.n]);
t("same", () => require("resm/live.mjs") === m);
import("resm/live.mjs").then((ns) => t("import", () => [ns.n, ns === m, ns.inc(), m.n]));
`,
      "effects.cjs": `${js}require("resm/effects.mjs"); require("resm/effects.mjs");
t("ran", () => globalThis.__ran);
import("resm/effects.mjs").then(() => t("ran", () => globalThis.__ran));
`,
      "destructured.cjs": `${js}const { a, f, nothing } = require("resm/plain.mjs");
t("x", () => [a, f(), nothing]);
`,
      "write.cjs": `${js}const m = require("resm/plain.mjs");
t("write", () => { "use strict"; m.a = 5; return m.a; });
t("add", () => { "use strict"; m.z = 5; return m.z; });
`,
    },
  },
];
