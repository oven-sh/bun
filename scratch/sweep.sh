#!/bin/sh
# Interleaved A/B sweep over vendored node tests.
# usage: sweep.sh <binA> <binB> <listfile> <outdir>
# Each line of listfile = path relative to repo root.
A="$1"; B="$2"; LIST="$3"; OUT="$4"
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-tls
mkdir -p "$OUT"
: > "$OUT/results.tsv"
while IFS= read -r t; do
  [ -z "$t" ] && continue
  timeout 45 env -u FORCE_COLOR "$A" "$ROOT/$t" > "$OUT/A.last" 2>&1; ea=$?
  sleep 0.2
  timeout 45 env -u FORCE_COLOR "$B" "$ROOT/$t" > "$OUT/B.last" 2>&1; eb=$?
  sleep 0.2
  printf '%s\t%s\t%s\n' "$t" "$ea" "$eb" >> "$OUT/results.tsv"
  if [ "$ea" != "$eb" ]; then
    cp "$OUT/A.last" "$OUT/$(basename $t).A.txt"
    cp "$OUT/B.last" "$OUT/$(basename $t).B.txt"
    echo "DIFF $t A=$ea B=$eb"
  fi
done < "$LIST"
awk -F'\t' '{ta+= ($2==0); tb+= ($3==0); n++} END {printf "total=%d A_pass=%d B_pass=%d\n", n, ta, tb}' "$OUT/results.tsv"
