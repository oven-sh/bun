// Transpiles every input with the `bun` that runs this script: what the parse pass accepts and prints today.
// usage: bun probe.mjs inputs.json
import { readFileSync } from "fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const { name, file, text } of inputs) {
  const t = new Bun.Transpiler({ loader: "ts", target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: true } } });
  let out;
  try { out = "OK   " + JSON.stringify(t.transformSync(text).trim()); }
  catch (e) { out = "FAIL " + JSON.stringify(String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]); }
  console.log(name.padEnd(30), out);
}
