// Compares tsc 6.0.2 (targeted-tsc.jsonl) with typescript-go (targeted-tsgo.jsonl) on the JavaScript file kinds.
// usage: bun targeted-oracles.mjs
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(f, import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const tsc = read("./targeted-tsc.jsonl"), go = read("./targeted-tsgo.jsonl");
const key = l => l.map(d => `TS${d.code}@${d.start}+${d.length}`).join(" ") || "-";
const counts = {};
const bump = k => { counts[k] = (counts[k] || 0) + 1; };
for (let i = 0; i < tsc.length; i++) {
  const t = tsc[i], g = go[i];
  if (t.src !== g.src) throw new Error("order");
  for (const name of ["a.js", "a.jsx", "a.mjs", "a.cjs"]) {
    const same = key(t[name].parse) === key(g[name].parse) && key(t[name].js) === key(g[name].js);
    bump(`${name}: ${same ? "same codes and spans" : "DIFFERS"}`);
    if (!same && name === "a.js") {
      const codesOnly = l => l.map(d => d.code).join(",");
      const kind = codesOnly(t[name].parse) === codesOnly(g[name].parse) && codesOnly(t[name].js) === codesOnly(g[name].js) ? "spans" : "codes";
      bump(`a.js differs in ${kind}`);
      console.log(`[${t.group}] ${JSON.stringify(t.src)}  (${kind})\n    tsc:  parse ${key(t[name].parse)} | js ${key(t[name].js)}\n    tsgo: parse ${key(g[name].parse)} | js ${key(g[name].js)}${g[name].panic ? " PANIC " + g[name].panic : ""}`);
    }
  }
}
console.log("\nSUMMARY");
for (const k of Object.keys(counts).sort()) console.log(String(counts[k]).padStart(5), k);
