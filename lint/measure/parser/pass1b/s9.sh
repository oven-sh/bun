#!/bin/bash
# instruction and branch counts of the fixed transpiler bench, base then head, and the per-symbol difference per group
O=/workspace/notes/lint/measure/parser/cg; mkdir -p $O
B=/workspace/notes/lint/measure/parser
s=$(date +%s); /workspace/notes/lint/tools/cgbench.sh $B/base/bun-profile $O base 20 > $O/base.summary.txt 2>&1; echo "cgbench base rc=$? $(( $(date +%s) - s ))s"
s=$(date +%s); /workspace/notes/lint/tools/cgbench.sh $B/head/bun-profile $O head 20 > $O/head.summary.txt 2>&1; echo "cgbench head rc=$? $(( $(date +%s) - s ))s"
for g in bun-types typescript-lib src-js tsx js-control; do
  python3 /workspace/notes/lint/units/parser/measure/tools/cgdiff.py $O/base.$g.cg $O/head.$g.cg --top 80 > $O/cgdiff.$g.txt 2>&1
  head -2 $O/cgdiff.$g.txt | sed "s/^/$g: /"
done
cat $O/base.summary.txt $O/head.summary.txt
