// bun probe.mjs <sources.txt> [--full]: base, head and tsc side by side for each line.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { check, parseAs } from "/tmp/gdr1a/gd/oracle.mjs";
const file = process.argv[2];
const full = process.argv.includes("--full");
const BASE = "/workspace/notes/lint/measure/parser/base/bun";
const HEAD = process.env.HEAD_BIN ?? "/workspace/notes/lint/measure/parser/head/bun";
const run = bin => spawnSync(bin, ["/tmp/gdr1a/an/one.mjs", file], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout.split("\n").filter(Boolean).map(l => JSON.parse(l));
const b = run(BASE);
const h = run(HEAD);
const short = v => (v[0] === "e" ? "R " + JSON.stringify(v[1][0]) : "A" + (full ? " " + JSON.stringify(v[1]) : ""));
for (let i = 0; i < b.length; i++) {
  const src = b[i].src;
  const p = parseAs(src, "ts");
  let tsc;
  if (p.length) tsc = "parse " + p.map(d => `TS${d[0]}@${d[1]}`).join(",");
  else {
    const c = check(src, "ts", false);
    tsc = c.grammar.length ? "grammar " + c.grammar.map(d => `TS${d[0]}@${d[1]}`).join(",") : "valid" + (c.other.length ? " (other " + c.other.join(",") + ")" : "");
  }
  const cls = k => `${b[i][k][0] === "e" ? "R" : "A"}>${h[i][k][0] === "e" ? "R" : "A"}`;
  console.log(`${cls("ts")} ${JSON.stringify(src)}\n     base ${short(b[i].ts)}\n     head ${short(h[i].ts)}\n     tsc  ${tsc}${cls("tsx") !== cls("ts") ? "\n     tsx " + cls("tsx") : ""}${cls("deco") !== cls("ts") ? "\n     deco " + cls("deco") : ""}`);
}
