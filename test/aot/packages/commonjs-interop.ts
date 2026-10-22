// What `default`, the names and the namespace of a CommonJS module are: with and without `__esModule`, for exports that are a function, a class, a primitive, a Proxy, and by the kind of file that imports it.
import { js, pkg, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "flag-and-default",
    files: {
      ...pkg("i_flag_and_default", {
        "index.js": `Object.defineProperty(exports, "__esModule", { value: true });
exports.default = function main() { return "main"; };
exports.named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_flag_and_default.mjs": `export * from "i_flag_and_default";
export { default } from "i_flag_and_default";
`,
    },
    importers: {
      "default.mjs": `import d from "i_flag_and_default";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_flag_and_default";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_flag_and_default";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_flag_and_default";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_flag_and_default"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_flag_and_default"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_flag_and_default"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_flag_and_default.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "flag-no-default",
    files: {
      ...pkg("i_flag_no_default", {
        "index.js": `Object.defineProperty(exports, "__esModule", { value: true });
exports.named = "named";
exports.other = 2;
`,
      }, {"main": "index.js"}),
      "reexport_of_flag_no_default.mjs": `export * from "i_flag_no_default";
export { default } from "i_flag_no_default";
`,
    },
    importers: {
      "default.mjs": `import d from "i_flag_no_default";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_flag_no_default";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_flag_no_default";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_flag_no_default";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_flag_no_default"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_flag_no_default"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_flag_no_default"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_flag_no_default.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "flag-plain-assign",
    files: {
      ...pkg("i_flag_plain_assign", {
        "index.js": `exports.__esModule = true;
exports.default = { tag: "the default" };
exports.named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_flag_plain_assign.mjs": `export * from "i_flag_plain_assign";
export { default } from "i_flag_plain_assign";
`,
    },
    importers: {
      "default.mjs": `import d from "i_flag_plain_assign";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_flag_plain_assign";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_flag_plain_assign";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_flag_plain_assign";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_flag_plain_assign"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_flag_plain_assign"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_flag_plain_assign"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_flag_plain_assign.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "flag-in-literal",
    files: {
      ...pkg("i_flag_in_literal", {
        "index.js": `module.exports = { __esModule: true, default: "the default", named: "named" };
`,
      }, {"main": "index.js"}),
      "reexport_of_flag_in_literal.mjs": `export * from "i_flag_in_literal";
export { default } from "i_flag_in_literal";
`,
    },
    importers: {
      "default.mjs": `import d from "i_flag_in_literal";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_flag_in_literal";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_flag_in_literal";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_flag_in_literal";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_flag_in_literal"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_flag_in_literal"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_flag_in_literal"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_flag_in_literal.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "flag-false",
    files: {
      ...pkg("i_flag_false", {
        "index.js": `exports.__esModule = false;
exports.default = "the default";
exports.named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_flag_false.mjs": `export * from "i_flag_false";
export { default } from "i_flag_false";
`,
    },
    importers: {
      "default.mjs": `import d from "i_flag_false";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_flag_false";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_flag_false";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_flag_false";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_flag_false"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_flag_false"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_flag_false"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_flag_false.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "flag-late",
    files: {
      ...pkg("i_flag_late", {
        "index.js": `exports.named = "named";
exports.default = "the default";
Object.defineProperty(exports, "__esModule", { value: true });
`,
      }, {"main": "index.js"}),
      "reexport_of_flag_late.mjs": `export * from "i_flag_late";
export { default } from "i_flag_late";
`,
    },
    importers: {
      "default.mjs": `import d from "i_flag_late";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_flag_late";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_flag_late";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_flag_late";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_flag_late"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_flag_late"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_flag_late"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_flag_late.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "flag-by-helper",
    files: {
      ...pkg("i_flag_by_helper", {
        "index.js": `var __defProp = Object.defineProperty;
var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
var __toCommonJS = (mod) => __defProp(mod, "__esModule", { value: true });
var src = {};
__export(src, { default: () => dflt, named: () => named });
module.exports = __toCommonJS(src);
var dflt = "the default";
var named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_flag_by_helper.mjs": `export * from "i_flag_by_helper";
export { default } from "i_flag_by_helper";
`,
    },
    importers: {
      "default.mjs": `import d from "i_flag_by_helper";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_flag_by_helper";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_flag_by_helper";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_flag_by_helper";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_flag_by_helper"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_flag_by_helper"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_flag_by_helper"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_flag_by_helper.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "default-is-undefined",
    files: {
      ...pkg("i_default_is_undefined", {
        "index.js": `Object.defineProperty(exports, "__esModule", { value: true });
exports.default = undefined;
exports.named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_default_is_undefined.mjs": `export * from "i_default_is_undefined";
export { default } from "i_default_is_undefined";
`,
    },
    importers: {
      "default.mjs": `import d from "i_default_is_undefined";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_default_is_undefined";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_default_is_undefined";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_default_is_undefined";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_default_is_undefined"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_default_is_undefined"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_default_is_undefined"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_default_is_undefined.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "default-only-no-flag",
    files: {
      ...pkg("i_default_only_no_flag", {
        "index.js": `exports.default = "a property called default";
exports.named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_default_only_no_flag.mjs": `export * from "i_default_only_no_flag";
export { default } from "i_default_only_no_flag";
`,
    },
    importers: {
      "default.mjs": `import d from "i_default_only_no_flag";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_default_only_no_flag";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_default_only_no_flag";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_default_only_no_flag";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_default_only_no_flag"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_default_only_no_flag"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_default_only_no_flag"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_default_only_no_flag.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "function-with-default",
    files: {
      ...pkg("i_function_with_default", {
        "index.js": `function f() { return "f"; }
f.default = f;
f.named = "named";
module.exports = f;
`,
      }, {"main": "index.js"}),
      "reexport_of_function_with_default.mjs": `export * from "i_function_with_default";
export { default } from "i_function_with_default";
`,
    },
    importers: {
      "default.mjs": `import d from "i_function_with_default";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_function_with_default";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_function_with_default";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_function_with_default";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_function_with_default"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_function_with_default"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_function_with_default"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_function_with_default.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "function-flagged",
    files: {
      ...pkg("i_function_flagged", {
        "index.js": `function f() { return "f"; }
f.__esModule = true;
f.default = "inner default";
f.named = "named";
module.exports = f;
`,
      }, {"main": "index.js"}),
      "reexport_of_function_flagged.mjs": `export * from "i_function_flagged";
export { default } from "i_function_flagged";
`,
    },
    importers: {
      "default.mjs": `import d from "i_function_flagged";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_function_flagged";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_function_flagged";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_function_flagged";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_function_flagged"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_function_flagged"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_function_flagged"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_function_flagged.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "primitive",
    files: {
      ...pkg("i_primitive", {
        "index.js": `module.exports = "a string";
`,
      }, {"main": "index.js"}),
      "reexport_of_primitive.mjs": `export * from "i_primitive";
export { default } from "i_primitive";
`,
    },
    importers: {
      "default.mjs": `import d from "i_primitive";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_primitive";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "namespace.mjs": `import * as ns from "i_primitive";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_primitive"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_primitive"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_primitive"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_primitive.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "null-exports",
    files: {
      ...pkg("i_null_exports", {
        "index.js": `module.exports = null;
`,
      }, {"main": "index.js"}),
      "reexport_of_null_exports.mjs": `export * from "i_null_exports";
export { default } from "i_null_exports";
`,
    },
    importers: {
      "default.mjs": `import d from "i_null_exports";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_null_exports";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "namespace.mjs": `import * as ns from "i_null_exports";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_null_exports"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_null_exports"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_null_exports"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_null_exports.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "number",
    files: {
      ...pkg("i_number", {
        "index.js": `module.exports = 42;
`,
      }, {"main": "index.js"}),
      "reexport_of_number.mjs": `export * from "i_number";
export { default } from "i_number";
`,
    },
    importers: {
      "default.mjs": `import d from "i_number";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_number";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "namespace.mjs": `import * as ns from "i_number";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_number"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_number"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_number"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_number.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "array",
    files: {
      ...pkg("i_array", {
        "index.js": `module.exports = ["a", "b"];
module.exports.named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_array.mjs": `export * from "i_array";
export { default } from "i_array";
`,
    },
    importers: {
      "default.mjs": `import d from "i_array";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_array";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_array";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_array";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_array"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_array"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_array"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_array.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "class-statics",
    files: {
      ...pkg("i_class_statics", {
        "index.js": `class K { static named = "named"; static make() { return new K(); } hi() { return "hi"; } }
module.exports = K;
`,
      }, {"main": "index.js"}),
      "reexport_of_class_statics.mjs": `export * from "i_class_statics";
export { default } from "i_class_statics";
`,
    },
    importers: {
      "default.mjs": `import d from "i_class_statics";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_class_statics";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_class_statics";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_class_statics";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_class_statics"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_class_statics"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_class_statics"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_class_statics.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "proto-members",
    // A named import that the CommonJS module does not export is a SyntaxError under `bun run` too.
    fails: true,
    files: {
      ...pkg("i_proto_members", {
        "index.js": `function Base() {}
Base.prototype.named = "from the prototype";
module.exports = new Base();
module.exports.own = "own";
`,
      }, {"main": "index.js"}),
      "reexport_of_proto_members.mjs": `export * from "i_proto_members";
export { default } from "i_proto_members";
`,
    },
    importers: {
      "default.mjs": `import d from "i_proto_members";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_proto_members";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_proto_members";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_proto_members";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_proto_members"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_proto_members"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_proto_members"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_proto_members.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "non-enumerable",
    files: {
      ...pkg("i_non_enumerable", {
        "index.js": `Object.defineProperty(exports, "named", { value: "hidden", enumerable: false });
exports.seen = "seen";
`,
      }, {"main": "index.js"}),
      "reexport_of_non_enumerable.mjs": `export * from "i_non_enumerable";
export { default } from "i_non_enumerable";
`,
    },
    importers: {
      "default.mjs": `import d from "i_non_enumerable";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_non_enumerable";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_non_enumerable";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_non_enumerable";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_non_enumerable"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_non_enumerable"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_non_enumerable"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_non_enumerable.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "frozen",
    files: {
      ...pkg("i_frozen", {
        "index.js": `module.exports = Object.freeze({ named: "named", f() { return "f"; } });
`,
      }, {"main": "index.js"}),
      "reexport_of_frozen.mjs": `export * from "i_frozen";
export { default } from "i_frozen";
`,
    },
    importers: {
      "default.mjs": `import d from "i_frozen";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_frozen";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_frozen";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_frozen";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_frozen"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_frozen"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_frozen"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_frozen.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "proxy",
    files: {
      ...pkg("i_proxy", {
        "index.js": `module.exports = new Proxy({ named: "named" }, { get(t, k) { return k in t ? t[k] : typeof k === "string" ? "made:" + k : undefined; } });
`,
      }, {"main": "index.js"}),
      "reexport_of_proxy.mjs": `export * from "i_proxy";
export { default } from "i_proxy";
`,
    },
    importers: {
      "default.mjs": `import d from "i_proxy";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_proxy";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_proxy";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_proxy";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_proxy"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_proxy"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_proxy"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_proxy.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "getter-throws",
    files: {
      ...pkg("i_getter_throws", {
        "index.js": `Object.defineProperty(exports, "named", { enumerable: true, get() { throw new RangeError("not yet"); } });
exports.fine = "fine";
`,
      }, {"main": "index.js"}),
      "reexport_of_getter_throws.mjs": `export * from "i_getter_throws";
export { default } from "i_getter_throws";
`,
    },
    importers: {
      "default.mjs": `import d from "i_getter_throws";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_getter_throws";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_getter_throws";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_getter_throws";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_getter_throws"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_getter_throws"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_getter_throws"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_getter_throws.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "keywords",
    files: {
      ...pkg("i_keywords", {
        "index.js": `exports.class = "class";
exports.delete = "delete";
exports["a-b"] = "a-b";
exports["0"] = "zero";
exports.named = "named";
exports.await = "await";
exports.then = undefined;
`,
      }, {"main": "index.js"}),
      "reexport_of_keywords.mjs": `export * from "i_keywords";
export { default } from "i_keywords";
`,
    },
    importers: {
      "default.mjs": `import d from "i_keywords";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_keywords";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_keywords";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_keywords";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_keywords"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_keywords"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_keywords"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_keywords.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "thenable",
    files: {
      ...pkg("i_thenable", {
        "index.js": `exports.then = function (resolve) { resolve("thenable resolved"); };
exports.named = "named";
`,
      }, {"main": "index.js"}),
      "reexport_of_thenable.mjs": `export * from "i_thenable";
export { default } from "i_thenable";
`,
    },
    importers: {
      "default.mjs": `import d from "i_thenable";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_thenable";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_thenable";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_thenable";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_thenable"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_thenable"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_thenable"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_thenable.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "symbol-keys",
    files: {
      ...pkg("i_symbol_keys", {
        "index.js": `exports[Symbol.for("s")] = "symbol";
exports.named = "named";
exports[Symbol.toStringTag] = "Tagged";
`,
      }, {"main": "index.js"}),
      "reexport_of_symbol_keys.mjs": `export * from "i_symbol_keys";
export { default } from "i_symbol_keys";
`,
    },
    importers: {
      "default.mjs": `import d from "i_symbol_keys";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "default.ts": `// @ts-nocheck
import d from "i_symbol_keys";
${js}t("default", () => d); t("default.named", () => d && d.named); t("default.default", () => d && d.default);
`,
      "named.mjs": `import { named } from "i_symbol_keys";
${js}t("named", () => named);
`,
      "namespace.mjs": `import * as ns from "i_symbol_keys";
${js}t("keys", () => keys(ns)); t("named", () => ns.named); t("default", () => ns.default); t("flag", () => ns.__esModule); t("module.exports", () => ns["module.exports"]);
`,
      "dynamic-import.mjs": `${js}await ta("dyn", async () => { const ns = await import("i_symbol_keys"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "dynamic-import.cjs": `${js}ta("dyn", async () => { const ns = await import("i_symbol_keys"); return typeof ns === "object" ? [keys(ns), ns.named, ns.default, ns.__esModule] : ns; });
`,
      "require.cjs": `${js}t("req", () => { const r = require("i_symbol_keys"); return [typeof r, r, r && r.named, r && r.default, r && r.__esModule]; });
`,
      "re-exported.mjs": `import * as again from "./reexport_of_symbol_keys.mjs";
${js}t("re-exported", () => [keys(again), again.named, again.default]);
`,
    },
  },
  {
    name: "keywords2",
    // A named import that the CommonJS module does not export is a SyntaxError under `bun run` too.
    fails: true,
    files: {
    },
    importers: {
      "names.mjs": `import { class as c, delete as d, "a-b" as ab, "0" as zero, await as aw } from "i_keywords";
${js}t("x", () => [c, d, ab, zero, aw]);
`,
      "symbols.mjs": `import * as ns from "i_symbol_keys";
import d from "i_symbol_keys";
${js}t("x", () => [ns[Symbol.for("s")], d[Symbol.for("s")], Object.prototype.toString.call(ns), Object.prototype.toString.call(d)]);
`,
      "proxy_names.mjs": `import { named, anything } from "i_proxy";
${js}t("x", () => [named, anything]);
`,
      "proto_names.mjs": `import { named, own } from "i_proto_members";
${js}t("x", () => [named, own]);
`,
      "hidden_names.mjs": `import { named, seen } from "i_non_enumerable";
${js}t("x", () => [named, seen]);
`,
      "missing_name.mjs": `import { nothing } from "i_flag_no_default";
${js}t("x", () => nothing);
`,
      "class_names.mjs": `import { named, make } from "i_class_statics";
${js}t("x", () => [named, make().hi()]);
`,
      "getter_fine.mjs": `import { fine } from "i_getter_throws";
${js}t("x", () => fine);
`,
    },
  },
  {
    name: "importer-kind",
    files: {
      "tm/package.json": `{ "type": "module" }`,
      "tc/package.json": `{ "type": "commonjs" }`,
      "tm/i_flag_and_default.js": `import d from "i_flag_and_default";
import * as ns from "i_flag_and_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
      "tc/i_flag_and_default.js": `import d from "i_flag_and_default";
import * as ns from "i_flag_and_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
      "tm/i_flag_no_default.js": `import d from "i_flag_no_default";
import * as ns from "i_flag_no_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
      "tc/i_flag_no_default.js": `import d from "i_flag_no_default";
import * as ns from "i_flag_no_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
      "tm/i_default_only_no_flag.js": `import d from "i_default_only_no_flag";
import * as ns from "i_default_only_no_flag";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
      "tc/i_default_only_no_flag.js": `import d from "i_default_only_no_flag";
import * as ns from "i_default_only_no_flag";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
      "tm/i_function_with_default.js": `import d from "i_function_with_default";
import * as ns from "i_function_with_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
      "tc/i_function_with_default.js": `import d from "i_function_with_default";
import * as ns from "i_function_with_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
`,
    },
    importers: {
      "tm_i_flag_and_default.mjs": `import { seen } from "./tm/i_flag_and_default.js";
console.log(JSON.stringify(seen));
`,
      "tc_i_flag_and_default.mjs": `import { seen } from "./tc/i_flag_and_default.js";
console.log(JSON.stringify(seen));
`,
      "mts_i_flag_and_default.mts": `// @ts-nocheck
import d from "i_flag_and_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "cts_i_flag_and_default.cts": `// @ts-nocheck
import d from "i_flag_and_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "js_i_flag_and_default.js": `import d from "i_flag_and_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "jsx_i_flag_and_default.jsx": `import d from "i_flag_and_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "tsx_i_flag_and_default.tsx": `// @ts-nocheck
import d from "i_flag_and_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "tm_i_flag_no_default.mjs": `import { seen } from "./tm/i_flag_no_default.js";
console.log(JSON.stringify(seen));
`,
      "tc_i_flag_no_default.mjs": `import { seen } from "./tc/i_flag_no_default.js";
console.log(JSON.stringify(seen));
`,
      "mts_i_flag_no_default.mts": `// @ts-nocheck
import d from "i_flag_no_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "cts_i_flag_no_default.cts": `// @ts-nocheck
import d from "i_flag_no_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "js_i_flag_no_default.js": `import d from "i_flag_no_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "jsx_i_flag_no_default.jsx": `import d from "i_flag_no_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "tsx_i_flag_no_default.tsx": `// @ts-nocheck
import d from "i_flag_no_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "tm_i_default_only_no_flag.mjs": `import { seen } from "./tm/i_default_only_no_flag.js";
console.log(JSON.stringify(seen));
`,
      "tc_i_default_only_no_flag.mjs": `import { seen } from "./tc/i_default_only_no_flag.js";
console.log(JSON.stringify(seen));
`,
      "mts_i_default_only_no_flag.mts": `// @ts-nocheck
import d from "i_default_only_no_flag";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "cts_i_default_only_no_flag.cts": `// @ts-nocheck
import d from "i_default_only_no_flag";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "js_i_default_only_no_flag.js": `import d from "i_default_only_no_flag";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "jsx_i_default_only_no_flag.jsx": `import d from "i_default_only_no_flag";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "tsx_i_default_only_no_flag.tsx": `// @ts-nocheck
import d from "i_default_only_no_flag";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "tm_i_function_with_default.mjs": `import { seen } from "./tm/i_function_with_default.js";
console.log(JSON.stringify(seen));
`,
      "tc_i_function_with_default.mjs": `import { seen } from "./tc/i_function_with_default.js";
console.log(JSON.stringify(seen));
`,
      "mts_i_function_with_default.mts": `// @ts-nocheck
import d from "i_function_with_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "cts_i_function_with_default.cts": `// @ts-nocheck
import d from "i_function_with_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "js_i_function_with_default.js": `import d from "i_function_with_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "jsx_i_function_with_default.jsx": `import d from "i_function_with_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
      "tsx_i_function_with_default.tsx": `// @ts-nocheck
import d from "i_function_with_default";
console.log(typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name));
`,
    },
  },
];
