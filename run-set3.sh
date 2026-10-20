#!/bin/bash
# usage: run-set3.sh <bun-profile> <out-file> <decl>...
BIN=$1; OUT=$2; shift 2
: > $OUT
i=0
for d in "$@"; do
  ( /tmp/insn/measure.sh "$BIN" "$d" >> $OUT ) &
  i=$((i+1))
  if [ $((i % 6)) -eq 0 ]; then wait; fi
done
wait
