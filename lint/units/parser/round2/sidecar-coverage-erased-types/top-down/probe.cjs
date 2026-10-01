// Runs the probe binary of the scratch copy over inputs.json and prints what it records, in the format of payload-oracle.cjs.
// usage: node probe.cjs inputs.json [--bin /tmp/erased-types/scratch/out/bun_js_parser] [--no-payloads]
const fs = require("fs");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const file = args[0];
const bin = args.includes("--bin") ? args[args.indexOf("--bin") + 1] : "/tmp/erased-types/scratch/out/bun_js_parser";
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const inputs = raw.map((r, i) => (typeof r === "string" ? { name: String(i), text: r } : r));
const dir = fs.mkdtempSync("/tmp/erased-probe-");
fs.writeFileSync(dir + "/in.hex", inputs.map((r, i) => `${i} ${r.kind || "ts"} ${Buffer.from(r.text, "utf8").toString("hex")}`).join("\n") + "\n");
const env = { ...process.env, ZZ_INPUTS: dir + "/in.hex", ZZ_OUT: dir + "/out.tsv" };
if (args.includes("--no-payloads")) env.ZZ_PAYLOADS = "0";
const p = spawnSync(bin, ["zz_probe"], { env });
if (p.status !== 0) { console.error("probe failed", p.status, String(p.stderr).slice(-2000)); process.exit(1); }
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const res = new Map();
for (const line of fs.readFileSync(dir + "/out.tsv", "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); res.set(+f[0], f); }
inputs.forEach((r, i) => {
  const f = res.get(i) || [i, "missing"];
  console.log(`# ${r.name}: ${JSON.stringify(r.text)}`);
  if (f[1] === "ok") { const lines = unhex(f[3]); if (lines) console.log(lines); }
  else if (f[1] === "err" || f[1] === "init") console.log(`error ${f[4] === "0" ? "nocode" : "TS" + f[4]} [${f[4] === "0" ? f[2] : f[5]},${f[4] === "0" ? +f[2] + +f[3] : f[6]}) ${f[4] === "0" ? unhex(f[7]) : unhex(f[8])}`);
  else console.log(f[1]);
});
