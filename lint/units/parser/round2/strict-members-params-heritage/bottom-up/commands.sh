#!/bin/sh
# How the results in results/ were made. tsc 6.0.2, typescript-go 89d5d5b (/tmp/rr/parsediag-bu, built by
# ledger/bottom-up/tsgo-oracle/build.sh), the release build of be1ebe5295 in /workspace/wt/parser/build/release/bun,
# and a test binary of a scratch copy of bun_js_parser with zz_probe.rs in it (a lint parse, one process).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
BUN=${BUN:-/workspace/wt/parser/build/release/bun}
S=${S:-/tmp/smph}
mkdir -p "$S"
cd "$HERE"
# 1. the lint-parse probe (one rustc of one crate: through the lock)
[ -x "$S/out/bun_js_parser" ] || /workspace/tools/lk sh ./build-probe.sh /workspace/wt/parser "$S"
lint() { SMPH_INPUTS="$1" SMPH_OUT="$2" "$S/out/bun_js_parser" zz_probe >/dev/null 2>&1; }
# 2. the hand-written inputs
node targeted.cjs > targeted.json
for name in targeted extra1 extra2 extra3; do
  "$BUN" probe.cjs "$name.json" --hex "$S/$name.hex" > /dev/null
  lint "$S/$name.hex" "$S/lint.$name.tsv"
  "$BUN" probe.cjs "$name.json" --go /tmp/rr/parsediag-bu --lint "$S/lint.$name.tsv" > "results/$name.out.txt"
done
node condense.cjs results/targeted.out.txt > results/targeted.condensed.txt
# 3. the mutation probe: every seed with one token changed
node gen.cjs "$S/inputs.jsonl"
rm -f "$S/bun.head.jsonl"; "$BUN" bunrun.mjs "$S/inputs.jsonl" "$S/bun.head.jsonl"
node -e 'const fs=require("fs");const o=fs.createWriteStream(process.argv[2]);for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){if(!l)continue;const r=JSON.parse(l);o.write(r.i+" ts "+Buffer.from(r.s,"utf8").toString("hex")+"\n")}o.end()' "$S/inputs.jsonl" "$S/fuzz.hex"
lint "$S/fuzz.hex" "$S/lint.fuzz.tsv"
node analyze-lint.cjs "$S/inputs.jsonl" "$S/bun.head.jsonl" "$S/lint.fuzz.tsv" LX 400 > results/fuzz.tsc-rejects.lint-parses.txt
