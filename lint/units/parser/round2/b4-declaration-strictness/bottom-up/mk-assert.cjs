const g = "TS2880 assert";
const rows = [
  // import declarations
  'import a from "m" assert { type: "json" };',
  'import a from "m" with { type: "json" };',
  'import "m" assert { type: "json" };',
  'import * as a from "m" assert { type: "json" };',
  'import { a } from "m" assert { type: "json" };',
  'import {} from "m" assert {};',
  'import a from "m" assert {};',
  'import a from "m"\nassert { type: "json" };',
  'import a from "m"\nwith { type: "json" };',
  'import a from "m" assert\n{ type: "json" };',
  'import type a from "m" assert { type: "json" };',
  'import type { a } from "m" assert { "resolution-mode": "import" };',
  'import a = require("m") assert { type: "json" };',
  // export declarations
  'export * from "m" assert { type: "json" };',
  'export * as ns from "m" assert { type: "json" };',
  'export { a } from "m" assert { type: "json" };',
  'export { a } from "m" with { type: "json" };',
  'export {} from "m" assert {};',
  'export * from "m"\nassert { type: "json" };',
  'export * from "m"\nwith { type: "json" };',
  'export { a } from "m"\nwith { type: "json" };',
  'export type { a } from "m" assert { type: "json" };',
  'export type * from "m" assert { type: "json" };',
  'export { a } assert { type: "json" };',
  // import types
  'type T = import("m", { assert: { type: "json" } });',
  'type T = import("m", { with: { type: "json" } });',
  'type T = typeof import("m", { assert: { type: "json" } });',
  'type T = import("m", { assert: {} }).A<B>;',
  'let x: import("m", { assert: { "resolution-mode": "import" } }).A;',
  'x as import("m", { assert: { type: "json" } });',
  'type T = import("m", { foo: { type: "json" } });',
  'type T = import("m", { assert });',
  'type T = import("m", { assert: { type: "json" }, });',
  'function f(a: import("m", { assert: {} })) {}',
  'class C { @d x: import("m", { assert: {} }); }',
  // dynamic import: no check in the parser
  'import("m", { assert: { type: "json" } });',
  'const x = await import("m", { with: { type: "json" } });',
  // assert as a name
  'import assert from "m";',
  'import { assert } from "m";',
  'import a from "m"; assert(a);',
  'import a from "m"\nassert(a);',
  'export * from "m"; assert;',
  // escaped assert
  'import a from "m" \\u0061ssert { type: "json" };',
  // two errors: which is first
  'import a from "m" assert { type: };',
  'import a from "m" assert { 1: "json" };',
  'import a from "m" assert',
  'import a from "m" assert;',
  'import a from "m" assert { type: "json" }; import b from "n" assert { type: "json" };',
];
const out = rows.map(s => ({ s, g }));
for (const s of ['import a from "m" assert { type: "json" };', 'export * from "m" assert { type: "json" };', 'import a from "m"\nwith { type: "json" };']) out.push({ s, l: "js", g: g + " (js)" });
for (const s of ['import a from "m" assert { type: "json" };', 'export * from "m" assert { type: "json" };', 'declare module "x" { import a from "m" assert { type: "json" }; }', 'type T = import("m", { assert: { type: "json" } });']) out.push({ s, l: "dts", g: g + " (d.ts)" });
process.stdout.write(JSON.stringify(out));
