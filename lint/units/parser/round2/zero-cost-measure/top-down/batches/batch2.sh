#!/bin/sh
# one lock: relink of the unpatched head (cache fill and validation), the two variants, their counts, and the raw-jump counts
S=/tmp/zcm-td/seam; B=/workspace/notes/lint/measure/parser; O=/tmp/zcm-td/cg
T=/workspace/notes/lint/units/parser/paren-expr-seam; M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
export OUT=$S/link CACHE=$S/thinlto-cache
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
if [ ! -d $CACHE ] && [ -d /tmp/zc1a/seam/thinlto-cache ] && [ -f /tmp/zc1a/seam/link/head0/bun-profile ]; then cp -r /tmp/zc1a/seam/thinlto-cache $CACHE; echo "cache seeded from /tmp/zc1a ($(ls $CACHE | wc -l) files)"; fi
python3 $T/relink.py head0 full
for s in .text; do
  llvm-objcopy -O binary --only-section=$s $S/link/head0/bun-profile /tmp/zcm-td/head0$s.bin; llvm-objcopy -O binary --only-section=$s $B/head/bun-profile /tmp/zcm-td/head$s.bin
  cmp /tmp/zcm-td/head0$s.bin /tmp/zcm-td/head$s.bin && echo "head0 $s identical to head/bun-profile ($(stat -c %s /tmp/zcm-td/head$s.bin) bytes)"
done
python3 $T/relink.py nolintbt $S/out/nolintbt/libbun_js_parser-185fe25973f3a1f8.rlib full
python3 $T/relink.py nolint $S/out/nolint/libbun_js_parser-185fe25973f3a1f8.rlib full
for v in nolintbt nolint; do
  [ -f $S/link/$v/bun-profile ] && /workspace/notes/lint/tools/cgbench.sh $S/link/$v/bun-profile $O $v 20 > $O/$v.summary.txt 2>&1; echo "cg $v rc=$?"
done
$M/cgbench-raw.sh $B/base/bun-profile $O rawbase 20 > $O/rawbase.summary.txt 2>&1; echo "raw base rc=$?"
$M/cgbench-raw.sh $B/head/bun-profile $O rawhead 20 > $O/rawhead.summary.txt 2>&1; echo "raw head rc=$?"
[ -f $S/link/nolintbt/bun-profile ] && $M/cgbench-raw.sh $S/link/nolintbt/bun-profile $O rawnolintbt 20 > $O/rawnolintbt.summary.txt 2>&1; echo "raw nolintbt rc=$?"
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
