const t = new Bun.Transpiler({ loader: "ts" });
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const td = new Bun.Transpiler({ loader: "ts", tsconfig: DECO });
const show = (s, tr = t) => { try { console.log(JSON.stringify(s), "=>", JSON.stringify(tr.transformSync(s))); } catch (e) { console.log(JSON.stringify(s), "=> ERROR", (e.errors?.length ? e.errors : [e]).map(x => x.message).join(" | ")); } };
for (const s of [
  'namespace N { namespace A { export const x = 1 } export const y = A.x }',
  '{ type T = 1 }',
  'interface A\n{}\nexport const v = 1;',
  'interface as\n{}\nexport const v = 1;',
  'export default interface A {}',
  'declare namespace A.b.c {} export const v = 1;',
  'namespace N { export interface A {} export const v = 1 }',
  'declare module "m" { type A = 1; interface B {} namespace C {} } export const v = 1;',
  'namespace A.satisfies { export const x = 1 }',
  'export namespace A {}',
  'export namespace as {}',
  'for (;;) enum E { a }',
  'while (x) enum E { a }',
  'if (x) {} else enum E { a }',
  'class C { [k: string]: T; static [j: number]: U; m() {} }',
  'export const v = a ? x = b : (c) => d;',
]) show(s);
show('class C { accessor a = 1; m() {} }', t);
show('class C { accessor a = 1; @d m() {} }', td);
show('@d class C { accessor a = 1 }', td);
