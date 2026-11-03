// Which file of a package an executable holds, and what a name that stands for no module does, with `compile: { aot: true }` and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const both = {
  "node_modules/both/package.json": `{ "name": "both", "version": "1.0.0", "main": "./lib/umd/main.js", "module": "./lib/esm/main.js", "types": "./lib/main.d.ts" }`,
  "node_modules/both/lib/main.d.ts": `export declare function which(): string;`,
  "node_modules/both/lib/esm/main.js": `import { name } from "./name.js";\nexport function which() { return name; }`,
  "node_modules/both/lib/esm/name.js": `export const name = "module";`,
  "node_modules/both/lib/umd/main.js": `(function (factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    var v = factory(require, exports);
    if (v !== undefined) module.exports = v;
  } else if (typeof define === "function" && define.amd) define(["require", "exports"], factory);
})(function (require, exports) {
  "use strict";
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.which = function () { return "main"; };
});`,
};

buildBothWays("compile/aot/which file of a package", {
  'import of a package with "main" and "module"': {
    files: {
      "main.ts": `import { which } from "both";
console.log(which(), (await import("both")).which());`,
      ...both,
    },
    prints: "module module\n",
  },
  'require of a package with "main" and "module"': {
    files: {
      "main.ts": `const { which } = require("both") as typeof import("both");
console.log(which());`,
      ...both,
    },
    prints: "main\n",
  },
  // The program holds the package once: "main", since something requires it.
  "both in one program": {
    files: {
      "main.ts": `import { which } from "both";
import { required } from "./required.cjs";
console.log(which(), required());`,
      "required.cjs": `exports.required = () => require("both").which();`,
      ...both,
    },
    prints: "main main\n",
  },
  'a package with "module" alone, and one with "main" alone': {
    files: {
      "main.ts": `import { a } from "only-module";
import { b } from "only-main";
console.log(a, b, require("only-module").a, require("only-main").b);`,
      "node_modules/only-module/package.json": `{ "name": "only-module", "version": "1.0.0", "module": "./esm.js", "types": "./index.d.ts" }`,
      "node_modules/only-module/index.d.ts": `export declare const a: string;`,
      "node_modules/only-module/esm.js": `export const a = "a";`,
      "node_modules/only-main/package.json": `{ "name": "only-main", "version": "1.0.0", "main": "./cjs.js", "types": "./index.d.ts" }`,
      "node_modules/only-main/index.d.ts": `export declare const b: string;`,
      "node_modules/only-main/cjs.js": `exports.b = "b";`,
    },
    prints: "a b a b\n",
  },
});

buildBothWays("compile/aot/a file of the `files` option", {
  "an import that spells its key, from another folder": {
    files: {
      "main.ts": `import { table } from "./deep/er/reader";
console.log(JSON.stringify(await table()));`,
      "deep/er/reader.ts": `export function table(): Promise<unknown> {
  // @ts-ignore
  return import("generated-table.ts").then(module => module.default).catch(() => null);
}`,
    },
    options: `files: { "generated-table.ts": "export default { made: 'by the build' };" }`,
    prints: `{"made":"by the build"}\n`,
  },
  "the same import without the file": {
    files: {
      "main.ts": `// @ts-ignore
console.log(await import("generated-table.ts").then(module => module.default).catch(() => null));`,
    },
    prints: "null\n",
  },
  "a key that is also the name of a package": {
    files: {
      "main.ts": `import { from } from "shadowed.js";
console.log(from);`,
      "node_modules/shadowed.js/package.json": `{ "name": "shadowed.js", "version": "1.0.0", "main": "./index.js", "types": "./index.d.ts" }`,
      "node_modules/shadowed.js/index.d.ts": `export declare const from: string;`,
      "node_modules/shadowed.js/index.js": `exports.from = "the package";`,
    },
    options: `files: { "shadowed.js": "export const from = 'the files option';" }`,
    prints: "the files option\n",
  },
});

const outcome = `function outcome(error) { return error.name + " " + error.code; }`;

buildBothWays("compile/aot/a name with node: that stands for no module", {
  "behind a test of the run time": {
    files: {
      "main.ts": `import { byVariable, byProperty, byTypeof } from "./backend.js";
console.log(await byVariable(), await byProperty(), await byTypeof());`,
      "backend.js": `var isBun = typeof process !== "undefined" && typeof process.versions === "object" && process.versions !== null && typeof process.versions.bun === "string";
export async function byVariable() { if (isBun) return "bun"; return await import("node:no-such-module"); }
export async function byProperty() { if (typeof process !== "undefined" && "bun" in process.versions) return "bun"; return require("node:no-such-module"); }
export async function byTypeof() { if (typeof Bun === "undefined") return await import("node:no-such-module"); return "bun"; }`,
    },
    prints: "bun bun bun\n",
  },
  "where the line runs": {
    files: {
      "main.ts": `import { imported, required, made } from "./backend.js";
console.log(await imported(), required(), made());`,
      "backend.js": `import { createRequire } from "node:module";
${outcome}
const requireModule = createRequire(import.meta.url);
export async function imported() { try { return await import("node:no-such-module"); } catch (error) { return outcome(error); } }
export function required() { try { return require("node:no-such-module"); } catch (error) { return outcome(error); } }
export function made() { try { return requireModule("node:no-such-module"); } catch (error) { return outcome(error); } }`,
    },
  },
});
