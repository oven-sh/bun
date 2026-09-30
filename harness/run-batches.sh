#!/usr/bin/env bash
# Runs ee-ab.mjs in batches (one per kind and tier), so that a batch that dies costs only itself.
#   run-batches.sh <name> <A> <B> <rounds> <max-rounds> <jobs> [more ee-ab.mjs options]
#   BATCHES="hot:ftl hot:base" run-batches.sh ...        only these batches (kind:tier)
# Output: results/<name>.<batch>.txt and .json. A batch that has its "rows with a verdict" line is not run again.
set -u
cd "$(dirname "$0")" || exit 2
name="$1"; a="$2"; b="$3"; rounds="$4"; max="$5"; jobs="$6"; shift 6
mkdir -p results
for batch in ${BATCHES:-hot:ftl hot:base hot:dfg hot:llint cold:default macro:default macro:ftl hot:default}; do
  out="results/$name.${batch/:/-}"
  if grep -q "rows with a verdict" "$out.txt" 2>/dev/null; then continue; fi
  timeout 14400 bun ee-ab.mjs --a "$a" --b "$b" --cases "${batch%%:*}" --tiers "${batch##*:}" \
    --rounds "$rounds" --max-rounds "$max" --jobs "$jobs" --out "$out.json" "$@" >"$out.txt" 2>"$out.err"
  echo "batch $batch exit $?" >>"results/$name.log"
done
echo "ALL DONE" >>"results/$name.log"
