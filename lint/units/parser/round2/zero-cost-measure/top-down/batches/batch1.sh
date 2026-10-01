#!/bin/sh
# one lock: 1-iteration runs (startup share), a second 20-iteration run (reproducibility), the decorator bench
B=/workspace/notes/lint/measure/parser
O=/tmp/zcm-td/cg
mkdir -p $O
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
/workspace/notes/lint/tools/cgbench.sh $B/base/bun-profile $O base1 1 > $O/base1.summary.txt 2>&1; echo "base1 rc=$?"
/workspace/notes/lint/tools/cgbench.sh $B/head/bun-profile $O head1 1 > $O/head1.summary.txt 2>&1; echo "head1 rc=$?"
for t in base head; do
  ( BUN_JSC_useJIT=0 BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/vg --tool=cachegrind --cache-sim=no --branch-sim=yes --cachegrind-out-file=$O/$t.deco.cg $B/$t/bun-profile /workspace/notes/lint/units/parser/measure/deco-bench.mjs --iterations=20 > $O/$t.deco.log 2>&1 ) &
  ( BUN_JSC_useJIT=0 BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/vg --tool=cachegrind --cache-sim=no --branch-sim=yes --cachegrind-out-file=$O/$t.deco1.cg $B/$t/bun-profile /workspace/notes/lint/units/parser/measure/deco-bench.mjs --iterations=1 > $O/$t.deco1.log 2>&1 ) &
done
wait; echo "deco done"
/workspace/notes/lint/tools/cgbench.sh $B/base/bun-profile $O base20b 20 > $O/base20b.summary.txt 2>&1; echo "base20b rc=$?"
/workspace/notes/lint/tools/cgbench.sh $B/head/bun-profile $O head20b 20 > $O/head20b.summary.txt 2>&1; echo "head20b rc=$?"
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
