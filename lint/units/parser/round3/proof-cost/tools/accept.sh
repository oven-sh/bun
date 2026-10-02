#!/bin/sh
# Proof of cost of round 3: sizes, the JavaScript pre-check, the counts in both VEX modes, one table.
# usage: /workspace/tools/lk accept.sh [<head bun-profile>] [<out dir>] [<nolint bun-profile>]
# The transpiler cache of the run time is off: the bench script (5,471 bytes) is above its minimum of 4 KiB, and a hit
# or a miss of it differs from process to process (measure/a2: parsed in base tsx, head bun-types and head tsx only).
BASE=/workspace/base/bun-profile.f4d755a9c
HEAD=${1:-/workspace/bun/build/release/bun-profile}
O=${2:-/workspace/notes/lint/measure/r3}
NOLINT=$3
T=/workspace/notes/lint/units/parser/round3/proof-cost/tools
L=/workspace/notes/lint/tools
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
mkdir -p "$O"
[ -d /tmp/proofcost/base-src/src/js_parser ] || sh $T/mkbase.sh
# 1. sizes
python3 $L/symsizes.py $BASE > $O/base.sym.txt; python3 $L/symsizes.py $HEAD > $O/head.sym.txt
python3 /workspace/notes/lint/units/parser/measure/grammar-syms.py $BASE > $O/base.grammar-syms.txt
python3 /workspace/notes/lint/units/parser/measure/grammar-syms.py $HEAD > $O/head.grammar-syms.txt
stat -c '%s %n' /workspace/base/bun.f4d755a9c "$(dirname $HEAD)/bun" > $O/stripped.txt
# 2. what JavaScript runs, without cachegrind
python3 $T/fncmp.py $BASE $HEAD > $O/fncmp.js.txt
python3 $T/fnclass.py $BASE $HEAD > $O/fnclass.js.txt
python3 $T/fncmp.py $BASE $HEAD --inst 'P<true, true>' > $O/fncmp.ts-scan.txt
python3 $T/fncmp.py $BASE $HEAD --inst 'skip_type_?script|skip_typescript' > $O/fncmp.skipper.txt
# 3. counts: default VEX (the numbers of measure/a2) and one Bc per executed conditional jump
$L/cgbench.sh $BASE $O base 20 > $O/base.jsonl
$L/cgbench.sh $HEAD $O head 20 > $O/head.jsonl
$T/cgbench-raw.sh $BASE $O rawbase 20 > $O/rawbase.jsonl
$T/cgbench-raw.sh $HEAD $O rawhead 20 > $O/rawhead.jsonl
if [ -n "$NOLINT" ]; then
  $L/cgbench.sh $NOLINT $O nolint 20 > $O/nolint.jsonl
  $T/cgbench-raw.sh $NOLINT $O rawnolint 20 > $O/rawnolint.jsonl
fi
# 4. the table, and what it rests on
python3 $T/r3table.py $O base head --raw ${NOLINT:+--nolint nolint} > $O/table.txt
for g in bun-types typescript-lib src-js tsx js-control; do
  python3 /workspace/notes/lint/units/parser/measure/tools/cgdiff.py $O/rawbase.$g.cg $O/rawhead.$g.cg --top 60 > $O/cgdiff.raw.$g.txt
  python3 $T/newlines.py $O/rawhead.$g.cg --srcb /workspace/bun --tests > $O/newlines.$g.txt
  python3 $T/cgsites.py $O/rawhead.$g.cg --src /workspace/bun > $O/cgsites.$g.txt
done
python3 $T/outside.py $O rawbase rawhead --ev bc --strip-p > $O/outside.bc.txt
python3 $T/outside.py $O rawbase rawhead --ev ir --strip-p --min 1000 > $O/outside.ir.txt
cat $O/base.sym.txt $O/head.sym.txt $O/stripped.txt $O/table.txt; head -1 $O/fncmp.js.txt; tail -1 $O/fncmp.js.txt; tail -1 $O/newlines.js-control.txt
