#!/bin/sh
# Runs one case of the reference in diag mode and prints the family functions that it executed.
# usage: sh run-one.sh <case file name, e.g. typeCheckExportsVariable.ts> [TestSubmodule|TestLocal] [work dir]
set -e
C=$1
S=${2:-TestSubmodule}
W=${3:-/tmp/ctp}
HERE=$(cd "$(dirname "$0")" && pwd)
(cd "$W/tsgo/internal/testrunner" && CTP_MODE=diag /workspace/tools/lk "$W/testrunner.cover.test" -test.run "^$S\$/^$C\$" -test.count=1 -test.coverprofile="$W/cover.one.out" 2>&1 | tail -3)
python3 "$HERE/../py/cover.py" "$W/fns.json" "$W/family.one.tsv" one="$W/cover.one.out" > /dev/null
awk -F'\t' 'NR>1 && $8>0 {printf "%s:%s-%s %s (%s/%s statements)\n", $2,$3,$4,$1,$8,$7}' "$W/family.one.tsv"
