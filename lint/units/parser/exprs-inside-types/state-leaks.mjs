// Checks, with the running bun, that code read inside type syntax and dropped leaves nothing behind.
// Each case pairs an input with the same input whose type holds no expression: both must give the same output,
// the same import scan and the same decorator metadata. usage: <bun> state-leaks.mjs
const cases = [
  // [label, with expression inside the type, without, options]
  ["scopes: arrow with a block body in an initializer", "type T = { m(a = () => { let q = 1; return q }): void };\nfunction real() { let z = 2; return z }\nconsole.log(real());", "type T = { m(a): void };\nfunction real() { let z = 2; return z }\nconsole.log(real());"],
  ["scopes: class and function in an initializer", "let g: new (a = class K { m() { var v } }, b = function f() { let w }) => F;\n{ let block = 1; console.log(block) }", "let g: new (a, b) => F;\n{ let block = 1; console.log(block) }"],
  ["scopes: parenthesized expression that is no arrow", "type T = { m(a = (1, (2))): void };\nconst k = (x) => x;", "type T = { m(a): void };\nconst k = (x) => x;"],
  ["scopes: accessor body", "type T = { get x() { var a; function g() {} class K {} return 1 } };\nfunction real(p) { return p }", "type T = { get x() };\nfunction real(p) { return p }"],
  ["scopes: enum in an accessor body", "type T = { get x() { enum E { A } return E.A } };\nenum Real { A = 1 }\nconsole.log(Real.A);", "type T = { get x() };\nenum Real { A = 1 }\nconsole.log(Real.A);"],
  ["top level await", "declare const p: any;\nlet g: new (a = await p) => F;\nexport {};", "declare const p: any;\nlet g: new (a) => F;\nexport {};"],
  ["import.meta", "let g: new (a = import.meta.url) => F;\nconsole.log(1);", "let g: new (a) => F;\nconsole.log(1);"],
  ["dynamic import", 'let g: new (a = import("./nope")) => F;', "let g: new (a) => F;"],
  ["require call", 'let g: new (a = require("./nope")) => F;', "let g: new (a) => F;"],
  ["jsx", "let g: new (a = <div/>) => F;", "let g: new (a) => F;", { tsx: true }],
  ["use of an import", 'import { foo } from "./x";\nlet g: new (a = foo) => F;\nexport { g };', 'import { foo } from "./x";\nlet g: new (a) => F;\nexport { g };'],
  ["use of an import in a property initializer", 'import { foo } from "./x";\ntype T = { a: number = foo };\nexport let t: T;', 'import { foo } from "./x";\ntype T = { a: number };\nexport let t: T;'],
  ["use of an import in an accessor body", 'import { foo } from "./x";\ntype T = { get x() { return foo } };\nexport let t: T;', 'import { foo } from "./x";\ntype T = { get x() };\nexport let t: T;'],
  ["with statement", "let g: new (a = function () { with (x) {} }) => F;\nexport const z = 1;", "let g: new (a) => F;\nexport const z = 1;"],
  ["legal comment before and inside", "let g: /*! before */ new (a = /*! inside */ 1) => F;\nlet z = 1;", "let g: /*! before */ new (a) => F;\nlet z = 1;"],
  ["legal comment and a dynamic import", 'let g: /*! before */ new (a = import("./nope")) => F;\nlet z = 1;', "let g: /*! before */ new (a) => F;\nlet z = 1;"],
  ["legal comment and a block body", "let g: /*! before */ new (a = () => { return 1 }) => F;\nlet z = 1;", "let g: /*! before */ new (a) => F;\nlet z = 1;"],
  ["arrow parameter annotation", "const f = (x: new (a = (q?) => q) => F, y = 2) => x;", "const f = (x: new (a) => F, y = 2) => x;"],
  ["arrow parameter annotation, await inside", "const f = async (x: new (a = await 1) => F) => x;", "const f = async (x: new (a) => F) => x;"],
  ["metadata: function type", "declare const dec: any;\nclass C { @dec p: new (a = 1) => F }", "declare const dec: any;\nclass C { @dec p: new (a) => F }", { deco: true }],
  ["metadata: object type with an initializer", "declare const dec: any;\nclass C { @dec p: { a: number = 1 } }", "declare const dec: any;\nclass C { @dec p: { a: number } }", { deco: true }],
  ["metadata: object type with an accessor body", "declare const dec: any;\nclass C { @dec p: { get x() { return 1 } } }", "declare const dec: any;\nclass C { @dec p: { get x() } }", { deco: true }],
  ["metadata: decorated class inside dropped code", "declare const dec: any;\nimport { Foo } from './foo';\nlet g: new (a = function () { class K { @dec p: Foo } }) => F;\nclass Real { @dec q: Bar }", "declare const dec: any;\nimport { Foo } from './foo';\nlet g: new (a) => F;\nclass Real { @dec q: Bar }", { deco: true }],
  ["constraint expression", "function f<T extends +(() => { var q })>(a: T) { return a }", "function f<T>(a: T) { return a }"],
  ["decorator of a signature parameter", "declare const dec: any;\ntype T = { m(@dec((x) => x) a): void };\nconst k = 1;", "declare const dec: any;\ntype T = { m(a): void };\nconst k = 1;"],
  ["binding pattern with initializers", "type T = { m({ a = () => { var v }, [k]: b }, [c = class {}]): void };\nconst z = (y) => y;", "type T = { m({ a, k: b }, [c]): void };\nconst z = (y) => y;"],
  ["function type after ( ", "let g: (a = () => { let q }) => void;\nconst z = (y) => y;", "let g: (a) => void;\nconst z = (y) => y;"],
  ["computed name that is an expression", "type T = { [a + (() => { let q })()]: number };\nconst z = (y) => y;", "type T = { [a]: number };\nconst z = (y) => y;"],
];
const norm = s => s.replace(/__legacy\w+/g, m => m.replace(/_[a-z0-9]+$/, "")).trim();
let bad = 0;
for (const [label, withExpr, without, opt = {}] of cases) {
  const tsconfig = { compilerOptions: opt.deco ? { experimentalDecorators: true, emitDecoratorMetadata: true } : {} };
  const run = text => {
    const t = new Bun.Transpiler({ loader: opt.tsx ? "tsx" : "ts", target: "bun", tsconfig, trimUnusedImports: true });
    const r = {};
    try { r.out = norm(t.transformSync(text)); } catch (e) { r.out = "ERR " + String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]; }
    try { r.scan = t.scanImports(text).map(i => i.kind + ":" + i.path).join(","); } catch (e) { r.scan = "ERR"; }
    return r;
  };
  const a = run(withExpr), b = run(without);
  const same = a.out === b.out && a.scan === b.scan;
  if (!same) bad++;
  console.log(`${same ? "same " : "DIFF "} ${label}`);
  if (!same) { console.log("   with:    ", JSON.stringify(a)); console.log("   without: ", JSON.stringify(b)); }
}
console.log(bad === 0 ? "all pairs equal" : bad + " pairs differ");
