#!/bin/sh
# The dynamic measurement of the prototype: two bun-profile binaries that differ only in the library of bun_js_parser
# (build-release-rlib.py head|proto, from scratch copies of the crate), linked as the release build links (relink.py),
# and the fixed transpiler benchmark under cachegrind for both (tools/cgbench.sh, 20 iterations, five groups).
# usage: /workspace/tools/lk sh measure.sh [/tmp/b4ec] [/workspace/wt/parser]     output: <scratch>/cg/{head,proto}.summary.txt, cgdiff.<group>.txt, DONE
set -e
S=${1:-/tmp/b4ec}
ROOT=${2:-/workspace/wt/parser}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$S/cg"
for w in head proto; do
  s=$(date +%s)
  python3 "$HERE/relink.py" "$w" "$ROOT" "$S"
  echo "relink $w: $(( $(date +%s) - s )) s; $("$S/$w/bun-profile" --revision)"
done
for w in head proto; do
  s=$(date +%s)
  /workspace/notes/lint/tools/cgbench.sh "$S/$w/bun-profile" "$S/cg" "$w" 20 > "$S/cg/$w.summary.txt" 2>&1
  echo "cgbench $w: $(( $(date +%s) - s )) s"
done
for g in bun-types typescript-lib src-js tsx js-control; do
  python3 /workspace/notes/lint/units/parser/measure/tools/cgdiff.py "$S/cg/head.$g.cg" "$S/cg/proto.$g.cg" --top 60 > "$S/cg/cgdiff.$g.txt" 2>&1 || true
done
cat "$S/cg/head.summary.txt" "$S/cg/proto.summary.txt"
# The summaries and the differences by symbol are kept beside this script: the binaries and the cachegrind files stay in the scratch directory.
mkdir -p "$HERE/cg"
cp "$S/cg/head.summary.txt" "$S/cg/proto.summary.txt" "$S"/cg/cgdiff.*.txt "$HERE/cg/"
touch "$S/cg/DONE"
