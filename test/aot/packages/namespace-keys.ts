// `import * as ns` of a CommonJS package in an executable: a real module namespace, with sorted keys and a `default`, as under `bun run`. Bun's bundler differs: it turns a file made only of
// top-level `exports.name = value` into an ES module, whose `ns` is its exports object without a `default` key, and gives every other CommonJS file `default` first.
import { pkg, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "named-exports",
    files: {
      ...pkg("named-exports", { "index.js": `"use strict"
exports.zeta = function () { return 1 }
exports.alpha = Object.create(null)
exports.mid = mid
function mid() { return 2 }
` }, { main: "index.js" }),
      "lib_named-exports.ts": `// @ts-nocheck
export * as ns from "named-exports";
`,
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "named-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_named.ts": `// @ts-nocheck
import * as ns from "named-exports";
import { zeta } from "named-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
`,
      "star_default_member.ts": `// @ts-nocheck
import * as ns from "named-exports";
import d from "named-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof d.zeta);
`,
      "export_star_as.ts": `// @ts-nocheck
import { ns } from "./lib_named-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "named-exports";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
`,
      "star_default_held.ts": `// @ts-nocheck
import * as ns from "named-exports";
import d from "named-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
show("d", Object(d));
console.log(d === ns, d === ns.default);
`,
      "star_require.ts": `// @ts-nocheck
import * as ns from "named-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
const r = require("named-exports");
show("r", Object(r));
console.log(r === ns, r === ns.default);
`,
      "star_dynamic.ts": `// @ts-nocheck
import * as ns from "named-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
const m = await import("named-exports");
show("m", m);
console.log(m === ns);
`,
      "default_spellings.ts": `// @ts-nocheck
import * as ns from "named-exports";
const key = "default";
const { default: taken } = ns as any;
console.log("cast", typeof (ns as any).default, (ns as any).default === ns);
console.log("two casts", typeof (ns as unknown as { default: unknown }).default, typeof (ns as any)!.default, typeof (ns satisfies unknown as any).default);
console.log("literal key", typeof (ns as any)["default"], typeof ns["default"]);
console.log("computed key", typeof (ns as any)[key]);
console.log("destructured", typeof taken);
console.log("optional", typeof (ns as any)?.default, typeof ns?.default);
console.log("member", typeof (ns as any).default?.zeta, typeof ns.default?.zeta);
`,
    },
  },
  {
    name: "marked-without-default",
    files: {
      ...pkg("marked-without-default", { "index.js": `exports.__esModule = true;
exports.zeta = 1;
exports.alpha = 2;
` }, { main: "index.js" }),
      "lib_marked-without-default.ts": `// @ts-nocheck
export * as ns from "marked-without-default";
`,
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "marked-without-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_named.ts": `// @ts-nocheck
import * as ns from "marked-without-default";
import { zeta } from "marked-without-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
`,
      "star_default_member.ts": `// @ts-nocheck
import * as ns from "marked-without-default";
import d from "marked-without-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof d.zeta);
`,
      "export_star_as.ts": `// @ts-nocheck
import { ns } from "./lib_marked-without-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "marked-without-default";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
`,
    },
  },
  {
    name: "own-default",
    files: {
      ...pkg("own-default", { "index.js": `exports.zeta = 1;
exports.default = "own default";
exports.alpha = 2;
` }, { main: "index.js" }),
      "lib_own-default.ts": `// @ts-nocheck
export * as ns from "own-default";
`,
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "own-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_named.ts": `// @ts-nocheck
import * as ns from "own-default";
import { zeta } from "own-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
`,
      "star_default_member.ts": `// @ts-nocheck
import * as ns from "own-default";
import d from "own-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof d.zeta);
`,
      "export_star_as.ts": `// @ts-nocheck
import { ns } from "./lib_own-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "own-default";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
`,
      "star_default_held.ts": `// @ts-nocheck
import * as ns from "own-default";
import d from "own-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
show("d", Object(d));
console.log(d === ns, d === ns.default);
`,
      "star_require.ts": `// @ts-nocheck
import * as ns from "own-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
const r = require("own-default");
show("r", Object(r));
console.log(r === ns, r === ns.default);
`,
      "star_dynamic.ts": `// @ts-nocheck
import * as ns from "own-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
const m = await import("own-default");
show("m", m);
console.log(m === ns);
`,
      "default_spellings.ts": `// @ts-nocheck
import * as ns from "own-default";
const key = "default";
const { default: taken } = ns as any;
console.log("cast", typeof (ns as any).default, (ns as any).default === ns);
console.log("two casts", typeof (ns as unknown as { default: unknown }).default, typeof (ns as any)!.default, typeof (ns satisfies unknown as any).default);
console.log("literal key", typeof (ns as any)["default"], typeof ns["default"]);
console.log("computed key", typeof (ns as any)[key]);
console.log("destructured", typeof taken);
console.log("optional", typeof (ns as any)?.default, typeof ns?.default);
console.log("member", typeof (ns as any).default?.zeta, typeof ns.default?.zeta);
`,
    },
  },
  {
    name: "assigned-twice",
    files: {
      ...pkg("assigned-twice", { "index.js": `exports.zeta = 1;
exports.alpha = 2;
exports.zeta = 3;
` }, { main: "index.js" }),
      "lib_assigned-twice.ts": `// @ts-nocheck
export * as ns from "assigned-twice";
`,
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "assigned-twice";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_named.ts": `// @ts-nocheck
import * as ns from "assigned-twice";
import { zeta } from "assigned-twice";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
`,
      "star_default_member.ts": `// @ts-nocheck
import * as ns from "assigned-twice";
import d from "assigned-twice";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof d.zeta);
`,
      "export_star_as.ts": `// @ts-nocheck
import { ns } from "./lib_assigned-twice";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "assigned-twice";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
`,
    },
  },
  {
    name: "module-dot-exports",
    files: {
      ...pkg("module-dot-exports", { "index.js": `module.exports.zeta = 1;
module.exports.alpha = 2;
` }, { main: "index.js" }),
      "lib_module-dot-exports.ts": `// @ts-nocheck
export * as ns from "module-dot-exports";
`,
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "module-dot-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_named.ts": `// @ts-nocheck
import * as ns from "module-dot-exports";
import { zeta } from "module-dot-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
`,
      "star_default_member.ts": `// @ts-nocheck
import * as ns from "module-dot-exports";
import d from "module-dot-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof d.zeta);
`,
      "export_star_as.ts": `// @ts-nocheck
import { ns } from "./lib_module-dot-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "module-dot-exports";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
`,
    },
  },
  {
    name: "requires-another",
    files: {
      ...pkg("requires-another", { "index.js": `const other = require("object-literal");
exports.zeta = other.zeta;
exports.alpha = other.alpha;
` }, { main: "index.js" }),
      "lib_requires-another.ts": `// @ts-nocheck
export * as ns from "requires-another";
`,
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "requires-another";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_named.ts": `// @ts-nocheck
import * as ns from "requires-another";
import { zeta } from "requires-another";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
`,
      "star_default_member.ts": `// @ts-nocheck
import * as ns from "requires-another";
import d from "requires-another";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof d.zeta);
`,
      "export_star_as.ts": `// @ts-nocheck
import { ns } from "./lib_requires-another";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "requires-another";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
`,
    },
  },
  {
    name: "single-export",
    files: {
      ...pkg("single-export", { "index.js": `exports.only = 1;
` }, { main: "index.js" }),
      "lib_single-export.ts": `// @ts-nocheck
export * as ns from "single-export";
`,
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "single-export";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_default_member.ts": `// @ts-nocheck
import * as ns from "single-export";
import d from "single-export";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof d.zeta);
`,
      "export_star_as.ts": `// @ts-nocheck
import { ns } from "./lib_single-export";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "single-export";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
`,
    },
  },
  {
    name: "marked-with-default",
    files: {
      ...pkg("marked-with-default", { "index.js": `exports.__esModule = true;
exports.zeta = 1;
exports.default = function d() {};
exports.alpha = 2;
` }, { main: "index.js" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "marked-with-default";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
    },
  },
  {
    name: "emitted-by-typescript",
    files: {
      ...pkg("emitted-by-typescript", { "index.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alpha = exports.zeta = void 0;
exports.zeta = 1;
exports.alpha = 2;
exports.default = "d";
` }, { main: "index.js" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "emitted-by-typescript";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
    },
  },
  {
    name: "object-literal",
    files: {
      ...pkg("object-literal", { "index.js": `module.exports = { zeta: 1, alpha: 2 };
` }, { main: "index.js" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "object-literal";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "default_spellings.ts": `// @ts-nocheck
import * as ns from "object-literal";
const key = "default";
const { default: taken } = ns as any;
console.log("cast", typeof (ns as any).default, (ns as any).default === ns);
console.log("two casts", typeof (ns as unknown as { default: unknown }).default, typeof (ns as any)!.default, typeof (ns satisfies unknown as any).default);
console.log("literal key", typeof (ns as any)["default"], typeof ns["default"]);
console.log("computed key", typeof (ns as any)[key]);
console.log("destructured", typeof taken);
console.log("optional", typeof (ns as any)?.default, typeof ns?.default);
console.log("member", typeof (ns as any).default?.zeta, typeof ns.default?.zeta);
`,
    },
  },
  {
    name: "reads-its-own-exports",
    files: {
      ...pkg("reads-its-own-exports", { "index.js": `exports.zeta = 1;
exports.alpha = function () { return exports.zeta + exports.late; };
exports.late = 5;
` }, { main: "index.js" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "reads-its-own-exports";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
    },
  },
  {
    name: "conditional-export",
    files: {
      ...pkg("conditional-export", { "index.js": `exports.zeta = 1;
if (typeof process === "object") exports.alpha = 2;
` }, { main: "index.js" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "conditional-export";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
    },
  },
  {
    name: "chained-assignment",
    files: {
      ...pkg("chained-assignment", { "index.js": `exports.alpha = exports.zeta = void 0;
exports.zeta = 1;
exports.alpha = 2;
` }, { main: "index.js" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "chained-assignment";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
    },
  },
  {
    name: "unwrapped-by-name",
    files: {
      ...pkg("react", {
        "index.js": `"use strict";
if (process.env.NODE_ENV === "production") {
  module.exports = require("./cjs/react.production.min.js");
} else {
  module.exports = require("./cjs/react.development.js");
}
`,
        "cjs/react.production.min.js": `"use strict";
(function () {
  function zeta() { return 1; }
  exports.zeta = zeta;
  exports.alpha = 2;
})();
`,
        "cjs/react.development.js": `"use strict";
(function () {
  function zeta() { return 1; }
  exports.zeta = zeta;
  exports.alpha = 2;
})();
`,
      }, { main: "index.js", version: "18.3.1" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "react";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "react";
console.log(Object.keys({ ...ns }).join(), Object.keys(Object.assign({}, ns)).join());
for (const k in ns) console.log(k);
`,
    },
  },
  {
    name: "same-files-other-names",
    files: {
      ...pkg("scheduler", { "index.js": `"use strict";
if (process.env.NODE_ENV === "production") {
  module.exports = require("./cjs/inner.js");
} else {
  module.exports = require("./cjs/inner.js");
}
`, "cjs/inner.js": `exports.zeta = function (a, b) { return a + b; };
exports.alpha = function (a) { return a; };
` }, { main: "index.js" }),
      ...pkg("react-is", { "index.js": `"use strict";
if (process.env.NODE_ENV === "production") {
  module.exports = require("./cjs/inner.js");
} else {
  module.exports = require("./cjs/inner.js");
}
`, "cjs/inner.js": `exports.zeta = function (a, b) { return a + b; };
exports.alpha = function (a) { return a; };
` }, { main: "index.js" }),
      ...pkg("not-on-any-list", { "index.js": `"use strict";
if (process.env.NODE_ENV === "production") {
  module.exports = require("./cjs/inner.js");
} else {
  module.exports = require("./cjs/inner.js");
}
`, "cjs/inner.js": `exports.zeta = function (a, b) { return a + b; };
exports.alpha = function (a) { return a; };
` }, { main: "index.js" }),
    },
    importers: {
      "scheduler.ts": `// @ts-nocheck
import * as ns from "scheduler";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "react-is.ts": `// @ts-nocheck
import * as ns from "react-is";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "not-on-any-list.ts": `// @ts-nocheck
import * as ns from "not-on-any-list";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
    },
  },
  {
    name: "re-exported-whole",
    files: {
      ...pkg("re-exported-whole", { "index.js": `module.exports = require("./cjs/inner.js");
`, "cjs/inner.js": `exports.zeta = function (a, b) { return a + b; };
exports.alpha = function (a) { return a; };
` }, { main: "index.js" }),
    },
    importers: {
      "star.ts": `// @ts-nocheck
import * as ns from "re-exported-whole";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof ns.default, ns.default === ns);
`,
      "star_named.ts": `// @ts-nocheck
import * as ns from "re-exported-whole";
import { zeta } from "re-exported-whole";
function show(name: string, ns: any) { console.log(name, Object.keys(ns).join(), "|", "default" in ns, typeof ns.default, ns.default === ns, "__esModule" in ns, Object.entries(ns).map(([k, v]) => k + ":" + typeof v).join()); }
show("ns", ns);
console.log(typeof zeta);
`,
      "spread.ts": `// @ts-nocheck
import * as ns from "re-exported-whole";
console.log(Object.keys({ ...ns }).join());
for (const k in ns) console.log(k);
`,
    },
  },
];
