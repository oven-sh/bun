// usage: bun aadiff.mjs <out.jsonl>   rows that tsc parses clean and Bun accepts, whose outputs differ after normalization
import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const rows = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const t = new Bun.Transpiler({ loader: "js" });
// Print the tsc output with Bun's printer, so that only the reading is compared.
const viaBun = js => { try { return t.transformSync(js).trim().replace(/\s+/g, " "); } catch (e) { return "UNPRINTABLE " + js; } };
for (const r of rows) {
  if (r.cls === "REJ" || !r.bun.startsWith("OK")) continue;
  const want = viaBun(r.js.replace(/^"use strict"; ?/, "").replace(/(^| )export \{\};$/, ""));
  const got = r.bun.slice(4).trim();
  if (want === got) continue;
  console.log(r.cls.padEnd(5), JSON.stringify(r.src));
  console.log("      tsc", JSON.stringify(want), r.grammar.join(","), r.other.join(","));
  console.log("      bun", JSON.stringify(got));
}
