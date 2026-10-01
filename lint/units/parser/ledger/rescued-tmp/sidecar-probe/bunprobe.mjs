import { readFileSync } from "fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const { name, file, text } of inputs) {
  const loader = file.endsWith("x") ? "tsx" : "ts";
  const t = new Bun.Transpiler({ loader, target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: name.startsWith("decorator") ? false : false } } });
  let out;
  try { out = "OK  " + JSON.stringify(t.transformSync(text)); } catch (e) { out = "ERR " + JSON.stringify(String(e.errors?.[0]?.message ?? e.message ?? e)) + (e.errors?.[0]?.position ? " @" + e.errors[0].position.offset : ""); }
  console.log(name.padEnd(26), out.slice(0, 200));
}
