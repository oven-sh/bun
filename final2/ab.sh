#!/bin/bash
# usage: ab.sh <outdir> <file>...   runs each test file with base and with m, records failing test names
OUT=$1; shift
mkdir -p "$OUT/base" "$OUT/f"
cd /workspace/bun
for f in "$@"; do
  name=$(echo "$f" | tr '/' '_')
  for v in base f; do
    timeout -k 10 900 /workspace/ee-perf-3/bin/bun-$v test "$f" > "$OUT/$v/$name.txt" 2>&1 < /dev/null
    rc=$?
    pass=$(grep -E "^ *[0-9]+ pass" "$OUT/$v/$name.txt" | tail -1 | tr -d ' ')
    fail=$(grep -E "^ *[0-9]+ fail" "$OUT/$v/$name.txt" | tail -1 | tr -d ' ')
    echo "$v $f rc=$rc $pass $fail" >> "$OUT/summary.txt"
  done
done
echo DONE >> "$OUT/summary.txt"
