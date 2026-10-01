#!/bin/sh
# one lock: vold3 (vold + the trigger on the error count), raw and default counts, and the A1 harness head vs vold3 and base vs vold3
S=/tmp/zcm-td/seam; B=/workspace/notes/lint/measure/parser; O=/tmp/zcm-td/cg; G=/tmp/zcm-td/gd; R=$G/runs
T=/workspace/notes/lint/units/parser/paren-expr-seam; M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
export OUT=$S/link CACHE=$S/thinlto-cache
mkdir -p $R
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
python3 $T/relink.py vold3 $S/out/vold3/libbun_js_parser-185fe25973f3a1f8.rlib full
if [ -f $S/link/vold3/bun-profile ]; then
  cd $G
  for c in testrows targeted small; do
    for side in base head vold3; do
      bin=$B/$side/bun-profile; [ $side = vold3 ] && bin=$S/link/vold3/bun-profile
      [ -s $R/$side.$c.jsonl.gz ] || { $bin harness.mjs corpus.$c.json $R/$side.$c.jsonl.gz --jobs=4 > $R/$side.$c.log 2>&1; echo "harness $side $c rc=$? $(cat $R/$side.$c.log | tail -1)"; }
    done
    bun diff.mjs $R/head.$c.jsonl.gz $R/vold3.$c.jsonl.gz --causes=causes.empty.mjs --out=$R/diff.head-vold3.$c.jsonl --show=4 > $R/diff.head-vold3.$c.txt 2>&1; echo "diff head vold3 $c rc=$?"; head -3 $R/diff.head-vold3.$c.txt
    bun diff.mjs $R/base.$c.jsonl.gz $R/vold3.$c.jsonl.gz --causes=causes.empty.mjs --out=$R/diff.base-vold3.$c.jsonl --show=4 > $R/diff.base-vold3.$c.txt 2>&1; echo "diff base vold3 $c rc=$?"; head -3 $R/diff.base-vold3.$c.txt
  done
  $M/cgbench-raw.sh $S/link/vold3/bun-profile $O rawvold3 20 > $O/rawvold3.summary.txt 2>&1; echo "raw vold3 rc=$?"
  /workspace/notes/lint/tools/cgbench.sh $S/link/vold3/bun-profile $O vold3 20 > $O/vold3.summary.txt 2>&1; echo "cg vold3 rc=$?"
fi
cp -p $O/vold3.* $O/rawvold3.* /workspace/notes/lint/measure/parser/cg-td/ 2>/dev/null
mkdir -p $M/harness
for c in testrows targeted small; do for p in head-vold3 base-vold3; do head -80 $R/diff.$p.$c.txt > $M/harness/diff.$p.$c.head80.txt 2>/dev/null; done; done
{ echo "vold3 = the type grammar of the base reads first for the Discard sink; fallback when it returned Err or the count of errors moved (one jump). Parser symbols (bun_js_parser|bun_ast), 20 passes."; echo "-- raw (one Bc per executed conditional jump)"; python3 $M/summary.py $O rawbase rawhead rawvold rawvold3; echo "-- default"; python3 $M/summary.py $O base20b head20b vold vold3; echo "-- A1 harness, head vs vold3 (required: 0 records differ), then base vs vold3"; for c in testrows targeted small; do echo "== $c"; sed -n 3p $R/diff.head-vold3.$c.txt; grep -E '^(!!|\?\?) ' $R/diff.head-vold3.$c.txt | cut -c1-110; sed -n 3p $R/diff.base-vold3.$c.txt; grep -E '^(!!|\?\?) ' $R/diff.base-vold3.$c.txt | cut -c1-110; done; echo "-- raw Bc by cause, base -> vold3"; python3 $M/buckets.py $O rawbase rawvold3; } > $M/results.vold3.txt 2>&1
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
