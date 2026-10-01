import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
const tr = new Bun.Transpiler({ loader: "ts" });
for (const code of process.argv.slice(2)) {
  const out = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
  let bun;
  try { bun = tr.transformSync(code); } catch (e) { bun = "ERR " + (e?.errors?.map(x => x.message).join("|") ?? e.message); }
  console.log(JSON.stringify(code), "\n   tsc:", JSON.stringify(out.outputText), "\n   bun:", JSON.stringify(bun));
}
