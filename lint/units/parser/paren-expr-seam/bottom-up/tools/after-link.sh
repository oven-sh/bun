#!/bin/sh
# usage: after-link.sh <tag> [nocg] : compares /tmp/pes/link/<tag>/bun-profile with the relinked base (/tmp/pes/link/base0).
# Writes /tmp/pes/res/<tag>.{lcmp,symsizes,cg,cgdiff}.txt . The cachegrind baseline is the base run of the unit
# (measure/base/cg-b/b-run1.*.cg): the relinked base has the same .text as that binary, and the counts of parser symbols
# are equal from run to run.
T=$1; B=/tmp/pes/link/$T/bun-profile; N=/workspace/notes/lint/units/parser
[ -x $B ] || { echo "no binary $B"; exit 1; }
python3 $N/build-sink-positions/fnasm.py $B /tmp/pes/fn/$T.json
python3 /tmp/pes/tools/lcmp.py /tmp/pes/fn/base0.json /tmp/pes/fn/$T.json > /tmp/pes/res/$T.lcmp.txt
python3 /workspace/notes/lint/tools/symsizes.py $B > /tmp/pes/res/$T.symsizes.txt
[ "$2" = nocg ] && exit 0
/workspace/notes/lint/tools/cgbench.sh $B /tmp/pes/cg $T 20 > /tmp/pes/res/$T.cg.txt 2>&1
: > /tmp/pes/res/$T.cgdiff.txt
for g in bun-types typescript-lib src-js tsx js-control; do
  echo "### $g" >> /tmp/pes/res/$T.cgdiff.txt
  python3 $N/measure/tools/cgdiff.py $N/measure/base/cg-b/b-run1.$g.cg /tmp/pes/cg/$T.$g.cg --match 'bun_js_parser' --top 14 >> /tmp/pes/res/$T.cgdiff.txt
done
