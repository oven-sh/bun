// `export *`: names that collide, local exports that win, chains, cycles, CommonJS re-exported by `export *`.
import { js, pkg, type Case } from "./run-packages";

const differs =
  "A name that two `export *` bring from two ES modules is ambiguous, and importing it is a build error. Where both are CommonJS, --aot takes the first.";

export const cases: Case[] = [
  {
    name: "export-star",
    differs,
    files: {
      ...pkg("stars", {
        "a.mjs": `export const a = "a.a";
export const both = "a.both";
export default "a.default";
export const shadowed = "a.shadowed";
`,
        "b.mjs": `export const b = "b.b";
export const both = "b.both";
export default "b.default";
`,
        "same1.mjs": `export { a as one } from "./a.mjs";
`,
        "same2.mjs": `export { a as one } from "./a.mjs";
`,
        "collide.mjs": `export * from "./a.mjs";
export * from "./b.mjs";
`,
        "local_wins.mjs": `export * from "./a.mjs";
export const shadowed = "local";
`,
        "same_binding.mjs": `export * from "./same1.mjs";
export * from "./same2.mjs";
`,
        "deep.mjs": `export * from "./deep1.mjs";
`,
        "deep1.mjs": `export * from "./deep2.mjs";
export const d1 = 1;
`,
        "deep2.mjs": `export * from "./a.mjs";
export const d2 = 2;
`,
        "as_ns.mjs": `export * as A from "./a.mjs";
export * as B from "./b.mjs";
export * as default from "./b.mjs";
`,
        "from_cjs.mjs": `export * from "./c.cjs";
export const own = "own";
`,
        "c.cjs": `exports.c1 = "c1";
exports.c2 = "c2";
exports.default = "c.default";
`,
        "from_two_cjs.mjs": `export * from "./c.cjs";
export * from "./d.cjs";
`,
        "d.cjs": `exports.c2 = "d.c2";
exports.d1 = "d1";
`,
        "cjs_and_esm.mjs": `export * from "./c.cjs";
export * from "./a.mjs";
export const c1 = "local over cjs";
`,
        "cycle1.mjs": `export * from "./cycle2.mjs";
export const x1 = 1;
`,
        "cycle2.mjs": `export * from "./cycle1.mjs";
export const x2 = 2;
`,
        "rename.mjs": `import { a } from "./a.mjs";
export { a as "string name", a as default, a as if, a };
`,
        "let_later.mjs": `export * from "./later.mjs";
`,
        "later.mjs": `export let v = 1;
export const bump = () => ++v;
`,
      }),
    },
    importers: {
      "collide.names.mjs": `import { a, b } from "stars/collide.mjs";
${js}t("x", () => [a, b]);
`,
      "collide.namespace.mjs": `import * as ns from "stars/collide.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.a, ns.b]);
`,
      "collide.require.cjs": `${js}t("x", () => { const ns = require("stars/collide.mjs"); return [keys(ns), ns.both, ns.default, ns.a, ns.b]; });
`,
      "local_wins.names.mjs": `import { a, shadowed } from "stars/local_wins.mjs";
${js}t("x", () => [a, shadowed]);
`,
      "local_wins.namespace.mjs": `import * as ns from "stars/local_wins.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.a, ns.shadowed]);
`,
      "local_wins.require.cjs": `${js}t("x", () => { const ns = require("stars/local_wins.mjs"); return [keys(ns), ns.both, ns.default, ns.a, ns.shadowed]; });
`,
      "same_binding.names.mjs": `import { one } from "stars/same_binding.mjs";
${js}t("x", () => [one]);
`,
      "same_binding.namespace.mjs": `import * as ns from "stars/same_binding.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.one]);
`,
      "same_binding.require.cjs": `${js}t("x", () => { const ns = require("stars/same_binding.mjs"); return [keys(ns), ns.both, ns.default, ns.one]; });
`,
      "deep.names.mjs": `import { a, d1, d2 } from "stars/deep.mjs";
${js}t("x", () => [a, d1, d2]);
`,
      "deep.namespace.mjs": `import * as ns from "stars/deep.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.a, ns.d1, ns.d2]);
`,
      "deep.require.cjs": `${js}t("x", () => { const ns = require("stars/deep.mjs"); return [keys(ns), ns.both, ns.default, ns.a, ns.d1, ns.d2]; });
`,
      "from_cjs.names.mjs": `import { c1, c2, own } from "stars/from_cjs.mjs";
${js}t("x", () => [c1, c2, own]);
`,
      "from_cjs.namespace.mjs": `import * as ns from "stars/from_cjs.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.c1, ns.c2, ns.own]);
`,
      "from_cjs.require.cjs": `${js}t("x", () => { const ns = require("stars/from_cjs.mjs"); return [keys(ns), ns.both, ns.default, ns.c1, ns.c2, ns.own]; });
`,
      "from_two_cjs.names.mjs": `import { c1, c2, d1 } from "stars/from_two_cjs.mjs";
${js}t("x", () => [c1, c2, d1]);
`,
      "from_two_cjs.namespace.mjs": `import * as ns from "stars/from_two_cjs.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.c1, ns.c2, ns.d1]);
`,
      "from_two_cjs.require.cjs": `${js}t("x", () => { const ns = require("stars/from_two_cjs.mjs"); return [keys(ns), ns.both, ns.default, ns.c1, ns.c2, ns.d1]; });
`,
      "cjs_and_esm.names.mjs": `import { c1, c2, a } from "stars/cjs_and_esm.mjs";
${js}t("x", () => [c1, c2, a]);
`,
      "cjs_and_esm.namespace.mjs": `import * as ns from "stars/cjs_and_esm.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.c1, ns.c2, ns.a]);
`,
      "cjs_and_esm.require.cjs": `${js}t("x", () => { const ns = require("stars/cjs_and_esm.mjs"); return [keys(ns), ns.both, ns.default, ns.c1, ns.c2, ns.a]; });
`,
      "cycle1.names.mjs": `import { x1, x2 } from "stars/cycle1.mjs";
${js}t("x", () => [x1, x2]);
`,
      "cycle1.namespace.mjs": `import * as ns from "stars/cycle1.mjs";
${js}t("x", () => [keys(ns), ns.both, ns.default, ns.x1, ns.x2]);
`,
      "cycle1.require.cjs": `${js}t("x", () => { const ns = require("stars/cycle1.mjs"); return [keys(ns), ns.both, ns.default, ns.x1, ns.x2]; });
`,
      "collide_named.mjs": `import { both } from "stars/collide.mjs";
console.log(both);
`,
      "collide_dyn.mjs": `${js}await ta("x", () => import("stars/collide.mjs").then((m) => [keys(m), m.both, "both" in m]));
`,
      "as_namespace.mjs": `import d, { A, B } from "stars/as_ns.mjs";
${js}t("x", () => [A.a, B.b, d.b, keys(A), d === B, A.default]);
`,
      "rename.mjs": `import d, { "string name" as s, if as i, a } from "stars/rename.mjs";
import * as ns from "stars/rename.mjs";
${js}t("x", () => [d, s, i, a, keys(ns), ns["string name"]]);
`,
      "let_later.mjs": `import { v, bump } from "stars/let_later.mjs";
${js}t("x", () => [v, bump(), v]);
`,
    },
  },
];
