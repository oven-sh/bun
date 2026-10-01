// Lint-parses every TypeScript file of a set of directories with the tree before the prototype and with the prototype, and lists the
// files whose result changed, with the first parse diagnostic of tsc 6.0.2 for each.
// usage: node sweep.cjs <out.txt> <dir>...       (binaries: HEAD=/tmp/smph/out/bun_js_parser, PROTO=/tmp/erased-types/scratch/out/bun_js_parser)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ts = require("/workspace/wt/parser/node_modules/typescript");
const [outFile, ...dirs] = process.argv.slice(2);
const files = [];
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) files.push(p);
  }
};
dirs.forEach(walk);
files.sort();
const kindOf = f => (/\.d\.(ts|mts|cts)$/.test(f) ? "dts" : /\.tsx$/.test(f) ? "tsx" : "ts");
const dir = fs.mkdtempSync("/tmp/erased-sweep-");
const texts = files.map(f => fs.readFileSync(f));
fs.writeFileSync(dir + "/in.hex", files.map((f, i) => `${i} ${kindOf(f)} ${texts[i].toString("hex")}`).join("\n") + "\n");
function probe(bin, prefix, extra) {
  const env = { ...process.env, [prefix + "_INPUTS"]: dir + "/in.hex", [prefix + "_OUT"]: dir + `/${prefix}.tsv`, ...extra };
  const p = spawnSync(bin, ["zz_probe"], { env, maxBuffer: 1 << 28 });
  if (p.status !== 0) throw new Error(prefix + " probe failed " + p.status + " " + String(p.stderr).slice(-800));
  const out = [];
  for (const line of fs.readFileSync(dir + `/${prefix}.tsv`, "utf8").split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    out[+f[0]] = f;
  }
  return out;
}
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const head = probe(process.env.HEAD || "/tmp/smph/out/bun_js_parser", "SMPH", {});
const proto = probe(process.env.PROTO || "/tmp/erased-types/scratch/out/bun_js_parser", "ZZ", {});
const status = f => (!f ? "missing" : f[1]);
const describe = (f, old) => {
  if (!f) return "missing";
  if (f[1] === "ok") return "ok";
  if (f[1] !== "err" && f[1] !== "init") return f[1];
  const texts = f.slice(old ? 8 : 7);
  return f[4] === "0" ? `nocode @${f[2]}+${f[3]} ${unhex(texts[0])}` : `TS${f[4]} [${f[5]},${f[6]}) ${unhex(texts[1])}`;
};
const counts = { files: files.length, headOk: 0, protoOk: 0, bothOk: 0, bothErr: 0, newlyRejected: 0, newlyAccepted: 0, errChanged: 0, panics: 0, records: 0 };
const lines = [];
files.forEach((f, i) => {
  const h = status(head[i]), p = status(proto[i]);
  if (h === "ok") counts.headOk++;
  if (p === "ok") { counts.protoOk++; counts.records += +proto[i][2]; }
  if (p === "panic" || p === "missing") counts.panics++;
  if (h === "ok" && p === "ok") { counts.bothOk++; return; }
  const tscOf = () => {
    const sf = ts.createSourceFile(kindOf(f) === "dts" ? "/a.d.ts" : "/a." + kindOf(f), texts[i].toString("utf8"), ts.ScriptTarget.Latest, true);
    const d = sf.parseDiagnostics[0];
    return d ? `TS${d.code} [${d.start},${d.start + d.length}) ${ts.flattenDiagnosticMessageText(d.messageText, " ")}` : "parses";
  };
  if (h !== "ok" && p !== "ok") {
    counts.bothErr++;
    const a = describe(head[i], true), b = describe(proto[i], false);
    if (a !== b) { counts.errChanged++; lines.push(`ERR-CHANGED ${f}\n   head : ${a}\n   proto: ${b}\n   tsc  : ${tscOf()}`); }
    return;
  }
  if (h === "ok") { counts.newlyRejected++; lines.push(`NEWLY-REJECTED ${f}\n   proto: ${describe(proto[i], false)}\n   tsc  : ${tscOf()}`); }
  else { counts.newlyAccepted++; lines.push(`NEWLY-ACCEPTED ${f}\n   head : ${describe(head[i], true)}\n   tsc  : ${tscOf()}`); }
});
fs.writeFileSync(outFile, JSON.stringify(counts) + "\n" + lines.join("\n") + "\n");
console.log(JSON.stringify(counts));
