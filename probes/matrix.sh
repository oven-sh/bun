#!/bin/sh
# usage: matrix.sh <binary> <state...>   prints one line per (stream, state, sequence)
bin="$1"; shift
F=/workspace/bun/test/js/node/process/process-stdio-write-callback-fixture.js
seqs=$(node -e 'const {sequences}=require(process.argv[1]); for (const k of Object.keys(sequences)) console.log(k)' "$F")
for state in "$@"; do
  for stream in child.stdin stdout; do
    echo "$seqs" | while IFS= read -r seq; do
      out=$(timeout 40 "$bin" "$F" "$stream" "$state" "$seq" 2>&1 | tail -1)
      printf '%s | %s | %s | %s\n' "$stream" "$state" "$seq" "$out"
    done
  done
done
