#!/bin/sh
# one lock: the raw counts (one Bc per executed conditional jump) of v2bh and r1
S=/tmp/zc1a-r/seam; RAW=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down/cgbench-raw.sh
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
$RAW $S/link/r1/bun-profile $S/cg rawr1 20 > $S/cg.rawr1.summary.txt 2>&1; echo "raw r1 rc=$? $(date -u +%T)"
[ -x /tmp/zc1a/seam/link/v2bh/bun-profile ] && { $RAW /tmp/zc1a/seam/link/v2bh/bun-profile $S/cg rawv2bh 20 > $S/cg.rawv2bh.summary.txt 2>&1; echo "raw v2bh rc=$? $(date -u +%T)"; }
date -u +"done %FT%TZ"
D=/workspace/notes/lint/units/parser/round2/zero-cost-measure-1a/r
cp $S/cg.rawr1.summary.txt $S/cg.rawv2bh.summary.txt $D/ 2>/dev/null
python3 $D/tab.py /tmp/zcm-td/cg/rawbase.summary.txt $S/cg.rawv2bh.summary.txt $S/cg.rawr1.summary.txt > $D/raw.base-v2bh-r1.txt 2>&1
cp $S/jobraw.log $D/jobraw.log 2>/dev/null
