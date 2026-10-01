// Which expressions and bodies, read by Bun's own expression and statement parsers in the same position, are early errors in Bun.
// tsc's parser accepts all of them (its checker reports). usage: <bun> early-errors.mjs
import { createRequire } from "module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript");
const cases = [
  // [label, value-position analogue read by Bun's parsers, tsx?]
  ["top level: await operand (module)", "let g = (a = await p) => 1; export {};"],
  ["top level: await operand (script)", "let g = (a = await p) => 1;"],
  ["top level: computed key await", "let o = { [await x]: 1 }; export {};"],
  ["function: await operand", "function f() { let g = (a = await 1) => 1; }"],
  ["async function: await operand", "async function f() { let g = (a = await 1) => 1; }"],
  ["async function: await as a name", "async function f() { let g = (a = await) => 1; }"],
  ["function: yield operand", "function f() { let g = (a = yield 1) => 1; }"],
  ["generator: yield operand", "function* f() { let g = (a = yield 1) => 1; }"],
  ["generator: computed key yield", "function* g() { let o = { [yield]: 1 }; }"],
  ["top level: new.target", "let g = (a = new.target) => 1;"],
  ["top level: super.x", "let g = (a = super.x) => 1;"],
  ["class field: super.x", "class K extends B { p = (a = super.x) => 1; }"],
  ["class field: this.#x", "class K { p = (a = this.#x) => 1; #x = 1; }"],
  ["top level: this.#x", "let g = (a = this.#x) => 1;"],
  ["top level: arguments", "let g = (a = arguments) => 1;"],
  ["strict function with a with statement", "let g = (a = (0, function () { 'use strict'; with (x) {} })) => 1;"],
  ["sloppy function with a with statement", "let g = (a = (0, function () { with (x) {} })) => 1;"],
  ["body: redeclared let", "({ get x() { let a; let a; return 1 } });"],
  ["body: await operand", "({ get x() { return await 1 } });"],
  ["body: yield operand", "({ get x() { yield 1 } });"],
  ["body: super.x", "({ get x() { return super.x } });"],
  ["body: new.target", "({ get x() { return new.target } });"],
  ["body: import declaration", "({ get x() { import a from 'b'; } });"],
  ["body: export declaration", "({ get x() { export const a = 1; } });"],
  ["body: label", "({ get x() { label: for (;;) { break label } } });"],
  ["body: break without loop", "({ get x() { break; } });"],
  ["body: using", "({ get x() { using a = b; } });"],
  ["body: type, interface, enum, namespace", "({ get x() { type U = 1; interface V {} enum W { A } namespace N { export const q = 1 } return 1 } });"],
  ["body: jsx", "({ get x() { return <div/> } });", true],
  ["unary operand: delete x", "void (delete x);"],
  ["unary operand: super.x", "void (+super.x);"],
  ["unary operand: decorated class", "void (@dec class {});"],
  ["unary operand: private in", "void (#p in x);"],
  ["heritage: class expression", "void (class {});"],
  ["heritage: a.#b", "void (a.#b);"],
  ["heritage: import.meta", "void (import.meta);"],
  ["heritage: tagged template", "void (tag`x`);"],
  ["heritage: optional chain", "void (A?.B);"],
  ["heritage: new Foo", "void (new Foo);"],
  ["decorator: call then member", "class K { m(@dec().x a) {} }"],
  ["decorator: optional chain", "class K { m(@dec?.x a) {} }"],
  ["decorator: parenthesized arrow", "class K { m(@((x) => x) a) {} }"],
  ["computed key: comma", "let o = { [a, b]: 1 };"],
  ["computed key: assignment", "let o = { [a = b]: 1 };"],
  ["computed key: arrow", "let o = { [(x) => x]: 1 };"],
  ["computed key: regex", "let o = { [/re/]: 1 };"],
  ["import attribute value: call", "import('./x', { with: { type: foo() } });"],
  ["initializer: duplicate parameter names", "let g = (a = function (b, b) {}) => 1;"],
  ["initializer: strict mode duplicate", "let g = (a = function (b, b) { 'use strict' }) => 1;"],
  ["initializer: let let", "let g = (a = () => { let let = 1 }) => 1;"],
  ["initializer: invalid assignment target", "let g = (a = (1 = 2)) => 1;"],
  ["initializer: legacy octal in strict", "let g = (a = function () { 'use strict'; return 010 }) => 1;"],
  ["initializer: return outside a function", "let g = (a = (() => { return 1 })()) => 1;"],
];
for (const [label, text, tsx] of cases) {
  const t = new Bun.Transpiler({ loader: tsx ? "tsx" : "ts", target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: true } } });
  const first = e => String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0];
  let bun, pass;
  try { t.transformSync(text); bun = "ok"; } catch (e) { bun = "ERR " + first(e); }
  // scanImports runs the parse pass alone: an error here is an error of the parse pass.
  try { t.scanImports(text); pass = "parse"; } catch (e) { pass = "PARSE-PASS"; }
  if (bun !== "ok" && pass === "parse") pass = "visit-pass";
  const sf = ts.createSourceFile(tsx ? "a.tsx" : "a.ts", text, ts.ScriptTarget.ESNext, true);
  const tsc = sf.parseDiagnostics.length ? "PARSE " + sf.parseDiagnostics.map(d => "TS" + d.code).join(",") : "parses";
  console.log(`${label.padEnd(44)} tsc: ${tsc.padEnd(14)} bun: ${(bun === "ok" ? "ok" : pass).padEnd(11)} ${bun === "ok" ? "" : bun}`);
}
