// bun probe2.mjs <sources.txt> <key>: base, head and tsc for one api key of one.mjs (ts | tsx | deco), one line per source.
import { spawnSync } from "node:child_process";
import { check, parseAs } from "/tmp/gdr1a/gd/oracle.mjs";
const file = process.argv[2];
const key = process.argv[3] ?? "ts";
const BASE = "/workspace/notes/lint/measure/parser/base/bun";
const HEAD = process.env.HEAD_BIN ?? "/workspace/notes/lint/measure/parser/head/bun";
const run = bin => spawnSync(bin, ["/tmp/gdr1a/an/one.mjs", file], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout.split("\n").filter(Boolean).map(l => JSON.parse(l));
const b = run(BASE);
const h = run(HEAD);
const dialect = key === "tsx" ? "tsx" : "ts";
const short = v => (v[0] === "e" ? "R " + JSON.stringify(v[1][0]) : "A");
for (let i = 0; i < b.length; i++) {
  const src = b[i].src;
  const p = parseAs(src, dialect);
  let tsc;
  if (p.length) tsc = "parse " + p.map(d => `TS${d[0]}@${d[1]}`).join(",");
  else {
    const c = check(src, dialect, key === "deco");
    tsc = c.grammar.length ? "grammar " + c.grammar.map(d => `TS${d[0]}@${d[1]}`).join(",") : "valid" + (c.other.length ? " (other " + c.other.join(",") + ")" : "");
  }
  const cls = `${b[i][key][0] === "e" ? "R" : "A"}>${h[i][key][0] === "e" ? "R" : "A"}`;
  const bad = cls === "R>A" && !tsc.startsWith("valid") ? "!!" : cls === "A>R" ? "XX" : "  ";
  console.log(`${bad} ${cls} ${JSON.stringify(src)} || base ${short(b[i][key])} || head ${short(h[i][key])} || tsc ${tsc}`);
}
