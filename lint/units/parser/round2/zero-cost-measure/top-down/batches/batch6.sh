#!/bin/sh
# one lock: vold2 (vold + the trigger on the error count), raw and default counts, and the A1 harness head vs vold2 and base vs vold2
S=/tmp/zcm-td/seam; B=/workspace/notes/lint/measure/parser; O=/tmp/zcm-td/cg; G=/tmp/zcm-td/gd; R=$G/runs
T=/workspace/notes/lint/units/parser/paren-expr-seam; M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
export OUT=$S/link CACHE=$S/thinlto-cache
mkdir -p $R
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
python3 $T/relink.py vold2 $S/out/vold2/libbun_js_parser-185fe25973f3a1f8.rlib full
if [ -f $S/link/vold2/bun-profile ]; then
  cd $G
  for c in testrows targeted small; do
    for side in base head vold2; do
      bin=$B/$side/bun-profile; [ $side = vold2 ] && bin=$S/link/vold2/bun-profile
      [ -s $R/$side.$c.jsonl.gz ] || { $bin harness.mjs corpus.$c.json $R/$side.$c.jsonl.gz --jobs=4 > $R/$side.$c.log 2>&1; echo "harness $side $c rc=$? $(cat $R/$side.$c.log | tail -1)"; }
    done
    bun diff.mjs $R/head.$c.jsonl.gz $R/vold2.$c.jsonl.gz --causes=causes.empty.mjs --out=$R/diff.head-vold2.$c.jsonl --show=4 > $R/diff.head-vold2.$c.txt 2>&1; echo "diff head vold2 $c rc=$?"; head -3 $R/diff.head-vold2.$c.txt
    bun diff.mjs $R/base.$c.jsonl.gz $R/vold2.$c.jsonl.gz --causes=causes.empty.mjs --out=$R/diff.base-vold2.$c.jsonl --show=4 > $R/diff.base-vold2.$c.txt 2>&1; echo "diff base vold2 $c rc=$?"; head -3 $R/diff.base-vold2.$c.txt
  done
  $M/cgbench-raw.sh $S/link/vold2/bun-profile $O rawvold2 20 > $O/rawvold2.summary.txt 2>&1; echo "raw vold2 rc=$?"
  /workspace/notes/lint/tools/cgbench.sh $S/link/vold2/bun-profile $O vold2 20 > $O/vold2.summary.txt 2>&1; echo "cg vold2 rc=$?"
fi
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
