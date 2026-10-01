// usage: bun check-rows.mjs   the oracle over rows.mjs: prints one line per row and what is wrong with it
import { groups } from "./rows.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const flat = [];
for (const [group, rows] of Object.entries(groups)) for (const [which, src, expected] of rows) flat.push({ group, which, src, expected });
writeFileSync(new URL("rows.json", import.meta.url), JSON.stringify(flat));
const here = new URL(".", import.meta.url).pathname;
const r = spawnSync(process.execPath, [here + "oracle.mjs", here + "rows.json", here + "rows.oracle.json"], { stdio: "inherit" });
if (r.status !== 0) process.exit(1);
const { rows, bun } = JSON.parse(readFileSync(here + "rows.oracle.json", "utf8"));
const plain = new Bun.Transpiler({ loader: "ts" });
let bad = 0;
for (const r of rows) {
  const flags = [];
  if (r.tsc.parse.length) flags.push("TSC-PARSE " + r.tsc.parse.join(","));
  if (r.tsc.grammar.length) flags.push("TSC-GRAMMAR " + r.tsc.grammar.join(","));
  if (r.own.ok) flags.push("INSTALLED-ACCEPTS" + (r.own.out === r.expected ? " (same output: row would pass)" : " other output " + JSON.stringify(r.own.out)));
  let via = r.viaTsc?.ok ? r.viaTsc.out : null;
  if (r.which === "deco" && /\baccessor\b/.test(r.src)) {
    try { via = plain.transformSync(r.src); } catch (e) { via = null; }
  }
  const structural = r.tsc.other.filter(c => c !== 2304 && c !== 2307 && c !== 7006 && c !== 7031 && c !== 2318 && c !== 7008 && c !== 2322 && c !== 2564 && c !== 7019 && c !== 7010);
  const note = structural.length ? "  tsc also " + structural.join(",") : "";
  const exp = r.expected === null ? "(null)" : via === r.expected ? "expected=tsc-as-bun-prints" : "EXPECTED-DIFFERS tsc-as-bun-prints=" + JSON.stringify(via);
  if (flags.length) bad++;
  console.log(`${flags.length ? "!! " : "ok "}[${r.group}] ${r.which} ${JSON.stringify(r.src)}  installed: ${r.own.ok ? "OK" : r.own.message}  ${exp}${note}${flags.length ? "  <<< " + flags.join("; ") : ""}`);
}
console.log(`${rows.length} rows, ${bad} flagged, bun ${bun}`);
