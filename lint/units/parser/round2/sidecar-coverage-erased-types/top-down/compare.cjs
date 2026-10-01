// Compares, per input, what the prototype records (probe.cjs) with what tsc 6.0.2 builds (payload-oracle.cjs), and with the tree before the prototype.
// usage: node compare.cjs inputs.json [--head /tmp/smph/out/bun_js_parser]
const fs = require("fs");
const { execFileSync, spawnSync } = require("child_process");
const { run } = require("./payload-oracle.cjs");
const args = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(args[0], "utf8"));
const inputs = raw.map((r, i) => (typeof r === "string" ? { name: String(i), text: r } : r));
function probe(bin, prefix, payloads) {
  const dir = fs.mkdtempSync("/tmp/erased-cmp-");
  fs.writeFileSync(dir + "/in.hex", inputs.map((r, i) => `${i} ${r.kind || "ts"} ${Buffer.from(r.text, "utf8").toString("hex")}`).join("\n") + "\n");
  const env = { ...process.env, [prefix + "_INPUTS"]: dir + "/in.hex", [prefix + "_OUT"]: dir + "/out.tsv" };
  const p = spawnSync(bin, ["zz_probe"], { env });
  if (p.status !== 0) throw new Error("probe failed " + String(p.stderr).slice(-500));
  const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
  const out = [];
  for (const line of fs.readFileSync(dir + "/out.tsv", "utf8").split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    let lines;
    if (f[1] === "ok") lines = payloads ? unhex(f[3]).split("\n").filter(Boolean) : ["ok"];
    else if (f[1] === "err" || f[1] === "init") {
      // the old probe has one more column (the count of messages) before the texts
      const [code, s, e] = [f[4], f[5], f[6]];
      const texts = f.slice(7).filter(x => !/^\d+$/.test(x) || x.length > 3);
      lines = [code === "0" ? `error nocode [${f[2]},${+f[2] + +f[3]}) ${unhex(texts[0])}` : `error TS${code} [${s},${e}) ${unhex(texts[texts.length - 1])}`];
    } else lines = [f[1]];
    out[+f[0]] = lines;
  }
  return out;
}
const proto = probe("/tmp/erased-types/scratch/out/bun_js_parser", "ZZ", true);
const head = args.includes("--head") ? probe(args[args.indexOf("--head") + 1], "SMPH", false) : null;
let same = 0;
const classes = {};
inputs.forEach((r, i) => {
  const tsc = run(r);
  const mine = proto[i] || ["missing"];
  const tscErr = tsc[0] && tsc[0].startsWith("error ");
  const mineErr = mine[0] && (mine[0].startsWith("error ") || mine[0] === "panic");
  let cls;
  if (!tscErr && !mineErr) cls = JSON.stringify(tsc) === JSON.stringify(mine) ? "same-tree" : "DIFFERENT-TREE";
  else if (tscErr && mineErr) cls = tsc[0] === mine[0] ? "same-error" : (tsc[0].split(" ").slice(0, 3).join(" ") === mine[0].split(" ").slice(0, 3).join(" ") ? "same-code-and-range" : "other-error");
  else if (tscErr) cls = "LINT-ACCEPTS";
  else cls = "LINT-REJECTS";
  classes[cls] = (classes[cls] || 0) + 1;
  const h = head ? (head[i] || ["missing"])[0] : "";
  if (cls === "same-tree" || cls === "same-error") { same++; if (!args.includes("--all")) return; }
  console.log(`[${cls}] ${JSON.stringify(r.text)}`);
  console.log(`   tsc  : ${tsc.join("\n          ")}`);
  console.log(`   proto: ${mine.join("\n          ")}`);
  if (head) console.log(`   head : ${h}`);
});
console.log(JSON.stringify(classes));
