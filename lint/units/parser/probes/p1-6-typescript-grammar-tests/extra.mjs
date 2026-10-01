const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const t = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }) };
const run = (which, src) => { try { return "OK  " + JSON.stringify(t[which].transformSync(src)); } catch (e) { return "ERR " + (e.errors?.[0]?.message ?? e.message); } };
const parse = src => ts.createSourceFile("/i.ts", src, ts.ScriptTarget.ESNext, true).parseDiagnostics.map(d => "TS" + d.code).join(",") || "ok";
for (const src of process.argv.slice(2).length ? process.argv.slice(2) : [
  "declare class C { accessor x: T; }",
  "class C { static accessor #x = 1; }",
  "class C { accessor x\n= 1; }",
  "namespace as {}",
  "type X = { get #a(): A };",
  "class C { m(public a: A) {} }",
  "class C implements a() {}",
  "let x: [a: A, ...if: B[]];",
]) {
  console.log(JSON.stringify(src), " tsc:", parse(src));
  console.log("   ts  ", run("ts", src));
  console.log("   deco", run("deco", src));
}
