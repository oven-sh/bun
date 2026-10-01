import { readFileSync } from "fs";
const cases = JSON.parse(readFileSync("/tmp/eit/elide.json", "utf8"));
for (const { id, text } of cases) {
  const row = [];
  for (const trim of [undefined, true]) {
    const t = new Bun.Transpiler({ loader: "ts", target: "bun", trimUnusedImports: trim, tsconfig: { compilerOptions: { experimentalDecorators: true } } });
    let r;
    try { r = t.transformSync(text).includes('"./x"') ? "KEEPS" : "drops"; } catch (e) { r = "ERR " + String(e?.errors?.[0]?.message ?? e.message).split("\n")[0]; }
    row.push((trim ? "trim=true:" : "default:") + r);
  }
  const t = new Bun.Transpiler({ loader: "ts", target: "bun" });
  let s; try { s = t.scanImports(text).map(i => i.path).join(",") || "(none)"; } catch (e) { s = "ERR"; }
  console.log(id.padEnd(4), row.join("  ").padEnd(60), "scanImports:", s, "  ", JSON.stringify(text).slice(0, 90));
}
