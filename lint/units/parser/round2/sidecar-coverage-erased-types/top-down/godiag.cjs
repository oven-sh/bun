// usage: node godiag.cjs inputs.json -> typescript-go parse diagnostics (first 3) per input
const fs = require("fs"); const { spawnSync } = require("child_process");
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const inputs = raw.map((r, i) => typeof r === "string" ? { id: i, kind: "ts", text: r } : { id: i, kind: r.kind || "ts", text: r.text });
const p = spawnSync("/tmp/rr/parsediag", ["-max", "3"], { input: inputs.map(r => JSON.stringify({ id: r.id, name: r.kind === "dts" ? "input.d.ts" : "input." + r.kind, text: r.text })).join("\n") + "\n" });
const go = new Map();
for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r); }
for (const r of inputs) {
  const g = go.get(r.id);
  const d = g?.panic ? "PANIC " + g.panic.slice(0, 80) : (g?.d ?? []).length ? g.d.map(d => `TS${d[0]}@[${d[1]},${d[1] + d[2]}) ${d[3]}`).join(" | ") : "parses";
  console.log(JSON.stringify(r.text), "=> go:", d);
}
