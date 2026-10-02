#!/bin/bash
# usage: node-ab.sh <outdir> <listfile>   runs each node test file with base and m, records exit codes
OUT=$1; LIST=$2
mkdir -p "$OUT"
cd /workspace/bun/test/js/node/test
while read -r f; do
  name=$(echo "$f" | tr '/' '_')
  for v in base f; do
    timeout -k 5 60 /workspace/ee-perf-3/bin/bun-$v "$f" > "$OUT/$v-$name.txt" 2>&1 < /dev/null
    echo "$v $f $?" >> "$OUT/summary.txt"
  done
done < "$LIST"
echo DONE >> "$OUT/summary.txt"
