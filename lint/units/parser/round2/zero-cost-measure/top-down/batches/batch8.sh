#!/bin/sh
# one lock: f3b (the named-like cast decided at the word of the cast, on the path a statement really takes), the A1 harness head vs f3b, raw and default counts
S=/tmp/zcm-td/seam; B=/workspace/notes/lint/measure/parser; O=/tmp/zcm-td/cg; G=/tmp/zcm-td/gd; R=$G/runs
T=/workspace/notes/lint/units/parser/paren-expr-seam; M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
export OUT=$S/link CACHE=$S/thinlto-cache
mkdir -p $R $M/harness
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
python3 $T/relink.py f3b $S/out/f3b/libbun_js_parser-185fe25973f3ba1f8.rlib full
if [ -f $S/link/f3b/bun-profile ]; then
  $S/link/f3b/bun-profile /tmp/zcm-td/smoke5.mjs > /tmp/zcm-td/s5.f3b.hash 2>&1; echo "smoke5 f3b $(cat /tmp/zcm-td/s5.f3b.hash) (head 1b78vj3rk7jbw 44, base 275pxx25kh4ef 44)"
  cd $G
  for c in testrows targeted small; do
    for side in head f3b; do
      bin=$B/$side/bun-profile; [ $side = f3b ] && bin=$S/link/f3b/bun-profile
      [ -s $R/$side.$c.jsonl.gz ] || { $bin harness.mjs corpus.$c.json $R/$side.$c.jsonl.gz --jobs=4 > $R/$side.$c.log 2>&1; echo "harness $side $c rc=$? $(cat $R/$side.$c.log | tail -1)"; }
    done
    bun diff.mjs $R/head.$c.jsonl.gz $R/f3b.$c.jsonl.gz --causes=causes.empty.mjs --out=$R/diff.head-f3b.$c.jsonl --show=6 > $R/diff.head-f3b.$c.txt 2>&1; echo "diff head f3b $c rc=$?"; head -3 $R/diff.head-f3b.$c.txt
    head -80 $R/diff.head-f3b.$c.txt > $M/harness/diff.head-f3b.$c.head80.txt
  done
  $M/cgbench-raw.sh $S/link/f3b/bun-profile $O rawf3b 20 > $O/rawf3b.summary.txt 2>&1; echo "raw f3b rc=$?"
  /workspace/notes/lint/tools/cgbench.sh $S/link/f3b/bun-profile $O f3b 20 > $O/f3b.summary.txt 2>&1; echo "cg f3b rc=$?"
  cp -p $O/f3b.* $O/rawf3b.* /workspace/notes/lint/measure/parser/cg-td/ 2>/dev/null
  { echo "f3b = the named-like cast decided at the word of the cast (one jump per cast), nothing before the expression of a statement. Parser symbols (bun_js_parser|bun_ast), 20 passes."; echo "-- raw (one Bc per executed conditional jump)"; python3 $M/summary.py $O rawbase rawhead rawf3b; echo "-- default"; python3 $M/summary.py $O base20b head20b f3b; echo "-- A1 harness, head vs f3b (required: 0 records differ)"; for c in testrows targeted small; do echo "== $c"; sed -n 3p $R/diff.head-f3b.$c.txt; grep -E '^(!!|\?\?) ' $R/diff.head-f3b.$c.txt | cut -c1-110; done; echo "-- raw Bc by cause, head -> f3b"; python3 $M/buckets.py $O rawhead rawf3b; } > $M/results.f3b.txt 2>&1
fi
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
