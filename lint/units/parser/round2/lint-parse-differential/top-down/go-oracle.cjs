// usage: node go-oracle.cjs <parsediag-bu> <corpus.json> <out prefix>
// The parse diagnostics of typescript-go 89d5d5b for every source of a corpus, as a.ts and as a.tsx: <out prefix>.go.ts.jsonl and .go.tsx.jsonl,
// one line for each source in the order of expand(corpus): {"i", "d": [[code, start, length, text], ...]} with byte offsets.
// <parsediag-bu> is the binary that ledger/bottom-up/tsgo-oracle/build.sh builds.
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const [bin, corpusPath, prefix] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const srcs = [];
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) srcs.push(template.replace("%T%", () => f.t));
for (const s of corpus.sources) srcs.push(s.src);
for (const dialect of ["ts", "tsx"]) {
  const out = fs.createWriteStream(`${prefix}.go.${dialect}.jsonl`);
  let ok = 0;
  for (let from = 0; from < srcs.length; from += 20000) {
    const input = srcs.slice(from, from + 20000).map((src, k) => JSON.stringify({ id: from + k, name: `a.${dialect}`, src })).join("\n") + "\n";
    const p = spawnSync(bin, [], { input, maxBuffer: 1 << 30 });
    if (p.status !== 0) throw new Error(`parsediag exit ${p.status} in chunk ${from}: ${String(p.stderr).slice(-300)}`);
    const lines = String(p.stdout).split("\n").filter(Boolean);
    if (lines.length !== Math.min(20000, srcs.length - from)) throw new Error(`chunk ${from}: ${lines.length} lines`);
    for (const line of lines) {
      const r = JSON.parse(line);
      if (r.panic) throw new Error(`panic at ${r.id}: ${r.panic}`);
      if (r.ok) ok++;
      out.write(JSON.stringify({ i: r.id, d: r.diags.map(d => [d[0], d[1], d[2], d[5]]) }) + "\n");
    }
  }
  out.end();
  console.log(`${prefix}.go.${dialect}.jsonl: ${srcs.length} sources, ${ok} without a diagnostic`);
}
