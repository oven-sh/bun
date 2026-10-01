const t = new Bun.Transpiler({ loader: "ts" });
const cases = [
  // declare context through a declare namespace: the closest thing to an ambient file today
  `declare namespace N { const x: number; }`,
  `declare namespace N { export const x: number; }`,
  `declare namespace N { function f(): void; class C { m(): void; x: number; get a(): number; set a(v: number); constructor(a: number); } }`,
  `declare namespace N { using x: T; }`,
  `declare namespace N { module "m" {} }`,
  `declare module "m" { export default class C { m(): void } }`,
  `declare module "m" { export default function f(): void; }`,
  `declare module "m" { export = x; }`,
  `declare module "m" { import a = require("b"); export import c = a.d; }`,
  `declare module "m" { x; if (a) {} }`,
  `declare module "m" { global { var x: number } }`,
  `declare class C { m(...a: any[], ): void }`,
  `declare function f(...a: any[], ): void;`,
  `declare namespace N { function f(...a: any[], ): void; }`,
  `declare namespace N { class C { m(...a: any[], ): void } }`,
  `declare namespace N { export as namespace X; }`,
  `declare namespace N { enum E { A = f() } const enum F { B } }`,
  `declare namespace N { abstract class C { abstract m(): void; abstract x: number } }`,
  `declare namespace N { break; }`,
  `declare namespace N { return; }`,
  `declare namespace N { declare const y: number; }`,
  `declare namespace N { export default 1; }`,
  `declare namespace N { let x; var y; const z; }`,
  `declare namespace N { const {a, b}: T; const [c]: U; }`,
  `declare namespace N { await using x: T; }`,
  `global {}`,
  `declare global { const x: number }`,
  `module "m" {}`,
  `export const x: number;`,
  `const x;`,
];
for (const src of cases) {
  let out;
  try { out = "ok   " + JSON.stringify(t.transformSync(src)); }
  catch (e) { const list = e?.errors?.length ? e.errors : [e]; out = "ERR  " + list.map(x => x.message).join(" | "); }
  console.log(out.padEnd(60), " <= ", JSON.stringify(src));
}
