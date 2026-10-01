import { readFileSync } from "fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const { name, file, text } of inputs) {
  const loader = (file || "a.ts").endsWith("x") ? "tsx" : "ts";
  const t = new Bun.Transpiler({ loader, target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: false } } });
  let out;
  try { out = "OK   " + JSON.stringify(t.transformSync(text).trim()); }
  catch (e) { out = "FAIL " + JSON.stringify(String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]); }
  console.log(name.padEnd(36), out);
}
