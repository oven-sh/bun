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
  // A bundle holds one of the two files, "main", once anything requires the package. With `aot` each way of asking gets its own file.
  "both in one program": {
    files: {
      "main.ts": `import { which } from "both";
import { required } from "./required.cjs";
console.log(which(), required());`,
      "required.cjs": `exports.required = () => require("both").which();`,
      ...both,
    },
    prints: "main main\n",
    differs: { stdout: "module main\n" },
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
