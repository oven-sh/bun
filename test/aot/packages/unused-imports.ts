// Which imports load a module that has side effects: imports used only as types, unused imports, `import type`, re-exports, dead code.
import { pkg, type Case } from "./run-packages";

const differs =
  "`export { T } from` where T is only a type: --aot knows that it is a type and drops it, as tsc does; plain Bun looks for a value.";

export const cases: Case[] = [
  {
    name: "elision",
    differs,
    files: {
      ...pkg("loud", {
        "index.js": `globalThis.__loaded = (globalThis.__loaded || []).concat("loud");
exports.value = 1;
exports.K = class K {};
exports.default = "d";
`,
        "index.d.ts": `export declare const value: number;
export declare class K { x: number }
export interface T { a: number }
export type U = string;
declare const d: string;
export default d;
`,
      }, {"main": "index.js", "types": "index.d.ts"}),
      ...pkg("loud_esm", {
        "index.mjs": `globalThis.__loaded = (globalThis.__loaded || []).concat("loud_esm");
export const value = 1;
export class K {}
export default "d";
`,
        "index.d.mts": `export declare const value: number;
export declare class K { x: number }
export interface T { a: number }
export type U = string;
declare const d: string;
export default d;
`,
      }, {"exports": {".": {"types": "./index.d.mts", "default": "./index.mjs"}}}),
    },
    importers: {
      "loud.type_used_as_type.ts": `import { T } from "loud";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.class_used_as_type.ts": `import { K } from "loud";
let k: K | undefined; console.log(typeof k);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.value_unused.ts": `import { value } from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.default_unused.ts": `import d from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.ns_unused.ts": `import * as ns from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.ns_used_as_type.ts": `import * as ns from "loud";
let k: ns.K | undefined; console.log(typeof k);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.bare.ts": `import "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.import_type.ts": `import type { T } from "loud";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.inline_type.ts": `import { type T } from "loud";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.inline_type_and_unused_value.ts": `import { type T, value } from "loud";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.inline_type_and_used_value.ts": `import { type T, value } from "loud";
const x: T = { a: value }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.typeof_only.ts": `import { value } from "loud";
let v: typeof value | undefined; console.log(typeof v);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.reexport_type.ts": `export { T } from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.reexport_type_marked.ts": `export type { T } from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.reexport_value.ts": `export { value } from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.reexport_star.ts": `export * from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.import_equals_unused.ts": `import r = require("loud");
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.import_equals_type.ts": `import r = require("loud");
let k: r.K | undefined; console.log(typeof k);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.import_equals_used.ts": `import r = require("loud");
console.log(r.value);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.used_in_dead_code.ts": `import { value } from "loud";
if (false) console.log(value);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.used_in_unused_function.ts": `import { value } from "loud";
function never() { return value; }
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.shadowed.ts": `import { value } from "loud";
{ const value = 2; console.log(value); }
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud.value_unused.mjs": `import { value } from "loud";
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud.default_unused.mjs": `import d from "loud";
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud.ns_unused.mjs": `import * as ns from "loud";
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud.used_in_dead_code.mjs": `import { value } from "loud";
if (false) console.log(value);
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud.require_unused.cjs": `require("loud");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud.require_unused_var.cjs": `const unused = require("loud");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud.require_in_dead_code.cjs": `if (false) require("loud");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud.require_void.cjs": `void require("loud");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.type_used_as_type.ts": `import { T } from "loud_esm";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.class_used_as_type.ts": `import { K } from "loud_esm";
let k: K | undefined; console.log(typeof k);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.value_unused.ts": `import { value } from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.default_unused.ts": `import d from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.ns_unused.ts": `import * as ns from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.ns_used_as_type.ts": `import * as ns from "loud_esm";
let k: ns.K | undefined; console.log(typeof k);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.bare.ts": `import "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.import_type.ts": `import type { T } from "loud_esm";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.inline_type.ts": `import { type T } from "loud_esm";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.inline_type_and_unused_value.ts": `import { type T, value } from "loud_esm";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.inline_type_and_used_value.ts": `import { type T, value } from "loud_esm";
const x: T = { a: value }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.typeof_only.ts": `import { value } from "loud_esm";
let v: typeof value | undefined; console.log(typeof v);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.reexport_type.ts": `export { T } from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.reexport_type_marked.ts": `export type { T } from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.reexport_value.ts": `export { value } from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.reexport_star.ts": `export * from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.used_in_dead_code.ts": `import { value } from "loud_esm";
if (false) console.log(value);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.used_in_unused_function.ts": `import { value } from "loud_esm";
function never() { return value; }
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.shadowed.ts": `import { value } from "loud_esm";
{ const value = 2; console.log(value); }
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
`,
      "loud_esm.value_unused.mjs": `import { value } from "loud_esm";
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.default_unused.mjs": `import d from "loud_esm";
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.ns_unused.mjs": `import * as ns from "loud_esm";
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.used_in_dead_code.mjs": `import { value } from "loud_esm";
if (false) console.log(value);
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.require_unused.cjs": `require("loud_esm");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.require_unused_var.cjs": `const unused = require("loud_esm");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.require_in_dead_code.cjs": `if (false) require("loud_esm");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
      "loud_esm.require_void.cjs": `void require("loud_esm");
console.log(JSON.stringify(globalThis.__loaded ?? null));
`,
    },
  },
];
