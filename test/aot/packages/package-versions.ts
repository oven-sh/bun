// Two versions of one package in nested node_modules, each with its own state and classes.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "versions",
    files: {
      ...pkg("uses_v1", {
        "index.js": `const d = require("dep");
exports.seen = () => [d.version, d.inc(), new d.K().who()];
exports.K = d.K;
exports.dep = d;
`,
        "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
        "node_modules/dep/index.js": `let n = 0;
exports.version = "1.0.0";
exports.inc = () => ++n;
exports.K = class K { who() { return "K of 1"; } };
`,
      }, {"main": "index.js"}),
      ...pkg("uses_v2", {
        "index.js": `const d = require("dep");
exports.seen = () => [d.version, d.inc(), new d.K().who()];
exports.K = d.K;
exports.dep = d;
`,
        "node_modules/dep/package.json": `{ "name": "dep", "version": "2.0.0", "main": "index.js" }`,
        "node_modules/dep/index.js": `let n = 100;
exports.version = "2.0.0";
exports.inc = () => ++n;
exports.K = class K { who() { return "K of 2"; } extra() { return 2; } };
`,
      }, {"main": "index.js"}),
      ...pkg("dep", {
        "index.js": `let n = 1000;
exports.version = "3.0.0";
exports.inc = () => ++n;
exports.K = class K { who() { return "K of 3"; } };
`,
        "index.d.ts": `export declare const version: string;
export declare function inc(): number;
export declare class K { who(): string }
`,
      }, {"main": "index.js", "types": "index.d.ts"}),
      ...pkg("uses_top", {
        "index.js": `const d = require("dep");
exports.seen = () => [d.version, d.inc()];
exports.dep = d;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "three.mjs": `import a from "uses_v1";
import b from "uses_v2";
import c from "uses_top";
import * as top from "dep";
${js}t("x", () => [a.seen(), b.seen(), c.seen(), top.inc(), a.seen(), a.K === b.K, new a.K() instanceof b.K, c.dep === top.default, a.dep === b.dep]);
`,
      "three.cjs": `${js}const a = require("uses_v1"), b = require("uses_v2"), c = require("uses_top"), top = require("dep");
t("x", () => [a.seen(), b.seen(), c.seen(), top.inc(), a.seen(), a.K === b.K, c.dep === top]);
`,
      "typed.ts": `import { version, inc, K } from "dep";
${ts}const a = require("uses_v1"), b = require("uses_v2");
t("x", () => [version, inc() + 1, new K().who(), a.seen(), b.seen(), new a.K() instanceof K]);
function who(k: K): string { return k.who(); }
t("foreign K", () => [who(new a.K()), who(new b.K())]);
`,
    },
  },
];
