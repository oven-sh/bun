#!/bin/sh
# Prints, for each source of a JSON array: the first parse diagnostic of tsc 6.0.2, of typescript-go 89d5d5b (/tmp/rr/parsediag-bu,
# built by ledger/bottom-up/tsgo-oracle/build.sh) and what a lint parse does (the probe test binary /tmp/smph/out/bun_js_parser,
# built by round2/strict-members-params-heritage/bottom-up/build-probe.sh from a scratch copy of the worktree: nothing is written in it).
HERE=$(cd "$(dirname "$0")" && pwd); W=${W:-/tmp/etp}; mkdir -p "$W"
# usage: sh run3.sh inputs.json [ext=ts]  -> prints: index, source, tsc first diag, tsgo first diag, bun lint-parse result (HEAD probe binary)
IN=$1; EXT=${2:-ts}
node "$HERE/tsc.cjs" "$IN" "$EXT" > "$W"/_tsc.txt
node -e '
const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const ext = process.argv[2];
process.stdout.write(a.map((s, i) => JSON.stringify({id: i, name: "a." + ext, src: s})).join("\n") + "\n");
' "$IN" "$EXT" > "$W"/_go.in.jsonl
/tmp/rr/parsediag-bu < "$W"/_go.in.jsonl > "$W"/_go.out.jsonl 2>"$W"/_go.err
node -e '
const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const ext = process.argv[2] === "d.ts" ? "dts" : process.argv[2];
process.stdout.write(a.map((s, i) => i + " " + ext + " " + Buffer.from(s, "utf8").toString("hex")).join("\n") + "\n");
' "$IN" "$EXT" > "$W"/_bun.hex
SMPH_INPUTS="$W"/_bun.hex SMPH_OUT="$W"/_bun.tsv /tmp/smph/out/bun_js_parser zz_probe >"$W"/_bun.log 2>&1
W="$W" node -e '
const fs = require("fs");
const tsc = fs.readFileSync(process.env.W+"/_tsc.txt", "utf8").trim().split("\n").map(l => l.split("\t"));
const go = fs.readFileSync(process.env.W+"/_go.out.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l));
const bun = fs.readFileSync(process.env.W+"/_bun.tsv", "utf8").trim().split("\n").map(l => l.split("\t"));
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
tsc.forEach((t, i) => {
  const g = go[i];
  const gd = g.ok ? "ok" : `TS${g.diags[0][0]} [${g.diags[0][1]},+${g.diags[0][2]}) ${g.diags[0][5]} (n=${g.n})`;
  const b = bun[i];
  let bd;
  if (b[1] === "ok") bd = "ok";
  else if (b[1] === "panic") bd = "PANIC";
  else bd = `${b[1]} bun@[${b[2]},+${b[3]}) "${unhex(b[8])}" code=${b[4]} ref@[${b[5]},${b[6]}) "${unhex(b[9])}" msgs=${b[7]}`;
  const tscd = t[2];
  const same = tscd.replace(/ \(n=\d+\)/, "") === gd.replace(/ \(n=\d+\)/, "");
  console.log(`${i}\t${t[1]}\n\ttsc : ${tscd}\n\ttsgo: ${same ? "= tsc" + (g.ok ? "" : " (n=" + g.n + ")") : gd}\n\tlint: ${bd}`);
});
'
