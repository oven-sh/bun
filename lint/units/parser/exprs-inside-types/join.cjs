// Joins inputs.json, oracle.jsonl (tsc) and bun.jsonl (base build) into one table.
// usage: node join.cjs [site letter] [--emit]
const fs = require("fs");
const dir = __dirname;
const inputs = JSON.parse(fs.readFileSync(dir + "/inputs.json", "utf8"));
const load = f => new Map(fs.readFileSync(dir + "/" + f, "utf8").trim().split("\n").map(l => JSON.parse(l)).map(r => [r.id, r]));
const tsc = load("oracle.jsonl"), bun = load(process.env.BUN_JSONL || "bun.jsonl");
const site = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const showEmit = process.argv.includes("--emit");
const norm = s => s.replace(/^"use strict";\n/, "").replace(/\s+/g, " ").trim();
const count = {};
for (const input of inputs) {
  if (site && input.site !== site) continue;
  const t = tsc.get(input.id), b = bun.get(input.id);
  const tOk = t.parse.length === 0, bOk = b.err === undefined;
  const cls = (tOk ? "tsc-parses" : "tsc-rejects") + "/" + (bOk ? "bun-accepts" : "bun-rejects");
  count[input.site + " " + cls] = (count[input.site + " " + cls] || 0) + 1;
  console.log(`${input.id.padEnd(4)} ${cls.padEnd(24)} ${JSON.stringify(input.text)}`);
  console.log(`       tsc parse: ${t.parse.length ? t.parse.map(p => p.slice(0, 70)).join(" | ") : "-"}   gram: ${t.gram.join(",") || "-"}   sem: ${t.sem.join(",") || "-"}`);
  console.log(`       bun: ${bOk ? "OK" : "ERR " + b.err}${b.scan ? "   scanImports=" + b.scan : ""}${b.scan2 ? "   scan=" + b.scan2 : ""}`);
  if (showEmit) {
    console.log(`       tsc emit: ${JSON.stringify(norm(t.emit))}`);
    if (bOk) console.log(`       bun emit: ${JSON.stringify(norm(b.out))}`);
  }
}
console.error(Object.entries(count).sort().map(([k, v]) => k + ": " + v).join("\n"));
