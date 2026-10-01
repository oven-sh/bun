import { readFileSync } from "fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const { name, text, loader } of inputs) {
  const t = new Bun.Transpiler({ loader: loader || "ts", target: "bun", tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true } }) });
  let out;
  try { out = "OK   " + JSON.stringify(t.transformSync(text)); } catch (e) { out = "ERR  " + JSON.stringify(String(e.errors ? e.errors.map(x => x.message + "@" + (x.position ? x.position.offset : "?")).join(" | ") : e.message)); }
  console.log(`== ${name}\n   ${out}`);
}
