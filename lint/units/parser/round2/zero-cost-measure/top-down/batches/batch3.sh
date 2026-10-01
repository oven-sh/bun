#!/bin/sh
# one lock: the f1 variant (stack-bound seam at "("), its counts in both modes, and the decorator bench on the inputs that both builds transform alike
S=/tmp/zcm-td/seam; B=/workspace/notes/lint/measure/parser; O=/tmp/zcm-td/cg
T=/workspace/notes/lint/units/parser/paren-expr-seam; M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
export OUT=$S/link CACHE=$S/thinlto-cache
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
deco() { # deco <tag> <binary> <iterations> <extra valgrind flag or empty> <suffix>
  BUN_JSC_useJIT=0 BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/vg --tool=cachegrind --cache-sim=no --branch-sim=yes $4 --cachegrind-out-file=$O/$1.decoc$3$5.cg $2 $M/deco-bench-common.mjs $M/deco-bench.common.json --iterations=$3 > $O/$1.decoc$3$5.log 2>&1
}
for t in base head; do deco $t $B/$t/bun-profile 1 "" "" & deco $t $B/$t/bun-profile 3 "" "" & done; wait; echo "deco default done"
for t in base head; do deco $t $B/$t/bun-profile 1 --vex-guest-chase=no raw & deco $t $B/$t/bun-profile 3 --vex-guest-chase=no raw & done; wait; echo "deco raw done"
python3 $T/relink.py f1 $S/out/f1/libbun_js_parser-185fe25973f3a1f8.rlib full
if [ -f $S/link/f1/bun-profile ]; then
  /workspace/notes/lint/tools/cgbench.sh $S/link/f1/bun-profile $O f1 20 > $O/f1.summary.txt 2>&1; echo "cg f1 rc=$?"
  $M/cgbench-raw.sh $S/link/f1/bun-profile $O rawf1 20 > $O/rawf1.summary.txt 2>&1; echo "raw f1 rc=$?"
fi
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
