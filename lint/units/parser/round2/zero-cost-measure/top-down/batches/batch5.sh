#!/bin/sh
# one lock: the f1b variant (f1 + an entry of its own for the one call of parse_expr_common at Level::Member), raw then default counts
S=/tmp/zcm-td/seam; O=/tmp/zcm-td/cg
T=/workspace/notes/lint/units/parser/paren-expr-seam; M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
export OUT=$S/link CACHE=$S/thinlto-cache
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
python3 $T/relink.py f1b $S/out/f1b/libbun_js_parser-185fe25973f3a1f8.rlib full
if [ -f $S/link/f1b/bun-profile ]; then
  $M/cgbench-raw.sh $S/link/f1b/bun-profile $O rawf1b 20 > $O/rawf1b.summary.txt 2>&1; echo "raw f1b rc=$?"
  /workspace/notes/lint/tools/cgbench.sh $S/link/f1b/bun-profile $O f1b 20 > $O/f1b.summary.txt 2>&1; echo "cg f1b rc=$?"
fi
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
