// node compare.cjs <tsc.tsv> <probe.tsv> [--show N]
// tsc.tsv: id, ok|diag..., leading, list.   probe.tsv: id, ok, leading, list  |  id, err, message  |  id, init|panic
const fs = require("fs");
const [tscFile, probeFile, ...rest] = process.argv.slice(2);
const show = rest.includes("--show") ? Number(rest[rest.indexOf("--show") + 1]) : 40;
const read = f => new Map(fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => { const c = l.split("\t"); return [c[0], c.slice(1)]; }));
const tsc = read(tscFile), probe = read(probeFile);
const count = {};
const bump = k => (count[k] = (count[k] || 0) + 1);
const lines = [];
let comments = 0;
for (const [id, t] of tsc) {
  const p = probe.get(id);
  if (!p) { bump("missing in probe"); lines.push(`MISSING ${id}`); continue; }
  const tscOk = t[0] === "ok";
  const bunOk = p[0] === "ok";
  if (!tscOk && !bunOk) { bump("both reject"); continue; }
  if (!tscOk) { bump("tsc rejects, lint parse accepts"); lines.push(`TSC-REJECTS ${id} ${t[0]}`); continue; }
  if (!bunOk) { bump("lint parse rejects, tsc accepts"); lines.push(`BUN-REJECTS ${id} ${p.join(" ")}`); continue; }
  const same = (t[2] || "") === (p[2] || "");
  const sameLeading = t[1] === p[1];
  if (same && sameLeading) { bump("same"); comments += t[2] ? t[2].split(",").length : 0; continue; }
  if (same) { bump("same list, other leading count"); lines.push(`LEADING ${id} tsc=${t[1]} bun=${p[1]}`); continue; }
  bump("different list");
  const a = new Set((t[2] || "").split(",").filter(Boolean)), b = new Set((p[2] || "").split(",").filter(Boolean));
  const onlyTsc = [...a].filter(x => !b.has(x)), onlyBun = [...b].filter(x => !a.has(x));
  const dup = (p[2] || "").split(",").filter(Boolean).length - b.size;
  lines.push(`DIFF ${id} only-tsc=[${onlyTsc.slice(0, 8).join(" ")}${onlyTsc.length > 8 ? " ..." + onlyTsc.length : ""}] only-bun=[${onlyBun.slice(0, 8).join(" ")}${onlyBun.length > 8 ? " ..." + onlyBun.length : ""}]${dup ? " duplicates-in-bun=" + dup : ""}`);
}
console.log(JSON.stringify(count), "comments in files that are the same:", comments);
for (const l of lines.slice(0, show)) console.log(l);
if (lines.length > show) console.log(`... ${lines.length - show} more`);
