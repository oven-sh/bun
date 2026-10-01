// usage: bun equiv.mjs   what the bun that runs this prints for another spelling of the same program
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const t = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }) };
const show = (which, src) => {
  let out;
  try { out = JSON.stringify(t[which].transformSync(src)); } catch (e) { out = "ERR " + (e.errors?.[0]?.message ?? e.message); }
  console.log(which.padEnd(4), JSON.stringify(src).padEnd(64), out);
};
for (const [which, src] of [
  ["ts", "namespace QQ.QQ {}"],
  ["ts", "namespace QQ {}"],
  ["ts", "namespace QQ { export const x = 1; }"],
  ["ts", "namespace N { (import(\"x\")); }"],
  ["ts", "namespace N { (import.meta); }"],
  ["ts", "declare abstract class C {}"],
  ["ts", "export declare abstract class C {}"],
  ["ts", "enum E { \"x\" }"],
  ["ts", "enum E { \"x\" = 1 }"],
  ["ts", "enum E { \"x\" = 1, B = E.x }"],
  ["ts", "import A from \"x\" with { type: \"json\" };"],
  ["ts", "import A from \"x\";"],
  ["ts", "export interface A {}"],
  ["ts", "interface A {}"],
  ["ts", "type A = 1"],
  ["ts", "declare type A = 1"],
  ["ts", "class C { m(a) {} }"],
  ["ts", "class C {}"],
  ["ts", "class C { accessor x: T; }"],
  ["ts", "class C { accessor x = 1; }"],
  ["ts", "class C { static accessor x: T; }"],
  ["ts", "class C { accessor #x: T; }"],
  ["ts", "class C { accessor #x = 1; }"],
  ["ts", "abstract class C extends B { abstract accessor x: T; }"],
  ["ts", "class C { accessor accessor; }"],
  ["deco", "class C { x: T; }"],
]) show(which, src);
