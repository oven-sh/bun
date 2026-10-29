#!/bin/bash
# usage: mktree.sh <git ref in /tmp/recut/bun> <outdir> <number of entries of lsquic.ts to apply>
# Pinned lsquic (f812ceb9) + the first <n> patches that <ref>:scripts/build/deps/lsquic.ts lists, applied the way the build does.
set -euo pipefail
REF=$1; OUT=$2; N=$3
rm -rf "$OUT"; mkdir -p "$OUT"
git -C /tmp/work/u/lsquic.git archive f812ceb9 | tar -x -C "$OUT"
cd "$OUT"
n=0
for p in $(git -C /tmp/recut/bun show "$REF:scripts/build/deps/lsquic.ts" | grep -o '"patches/lsquic/[^"]*"' | tr -d '"' | head -n "$N"); do
  git -C /tmp/recut/bun show "$REF:$p" | tr -d '\r' | git apply --ignore-whitespace --ignore-space-change --no-index - || { echo "FAILED $p"; exit 1; }
  n=$((n+1))
done
echo "$OUT: $n patches applied (last: $(basename $p))"
