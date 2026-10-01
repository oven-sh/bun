import { readFileSync } from "fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [name, file, src] of inputs) {
  const loader = file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : "js";
  const t = new Bun.Transpiler({ loader });
  let out;
  try { out = "OK   " + JSON.stringify(t.transformSync(src)); } catch (e) { out = "ERR  " + String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]; }
  console.log(name.padEnd(24), JSON.stringify(src).padEnd(70), out);
}
