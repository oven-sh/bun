// usage: node run.mjs <tag>=<bin> ...   (the first is the baseline to compare the others against the plain bundle)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const bins = Object.fromEntries(process.argv.slice(2).map(a => a.split("=")));
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
const any = Object.values(bins)[0];
const b = (bin, args) => spawnSync(bin, args, { env, encoding: "utf8", maxBuffer: 1 << 30 });
let r = b(any, ["build", "./entry.js", "--target=browser", "--outfile=out.plain.js"]);
if (r.status !== 0) { console.log("plain build failed", r.stderr.slice(-2000)); process.exit(1); }
const plain = JSON.parse(b(any, ["out.plain.js"]).stdout);
const res = {};
for (const [tag, bin] of Object.entries(bins)) {
  r = b(bin, ["build", "./entry.js", "--react-compiler", "--target=browser", `--outfile=out.${tag}.js`]);
  if (r.status !== 0) { console.log("build failed", tag, r.stderr.slice(-2000)); process.exit(1); }
  const run = b(bin, [`out.${tag}.js`]);
  try { res[tag] = JSON.parse(run.stdout); } catch (e) { console.log("run failed", tag, run.stdout.slice(0, 500), run.stderr.slice(-1500)); process.exit(1); }
}
const cls = (tag, name) => {
  const got = res[tag][name], want = plain[name];
  const same = JSON.stringify(got.rows) === JSON.stringify(want.rows);
  if (same) return got.compiled ? "ok" : "asis";
  return got.rows.some(x => x.startsWith("THREW")) && !want.rows.some(x => x.startsWith("THREW")) ? "THROWS" : "WRONG";
};
const tags = Object.keys(bins);
const trans = {}; const samples = {};
for (const name of Object.keys(plain)) {
  const k = tags.map(t => cls(t, name)).join(" -> ");
  trans[k] = (trans[k] || 0) + 1;
  (samples[k] ||= []).push(name);
}
console.log("functions", Object.keys(plain).length, "order:", tags.join(" -> "));
for (const [k, n] of Object.entries(trans).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), k.padEnd(28), samples[k].slice(0, 3).join(" "));
fs.writeFileSync("result." + tags.join("-") + ".json", JSON.stringify({ trans, samples }, null, 1));
