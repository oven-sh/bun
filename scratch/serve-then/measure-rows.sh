#!/bin/bash
# Usage: measure-rows.sh <bun-profile> <symbol> <first> <last> modes...
# Prints, for each mode, the minimum and the sorted counts of the window.
BIN=$1; SYM=$2; FIRST=$3; LAST=$4; shift 4
for m in "$@"; do
  OUT=$(timeout 300 /tmp/measure/win.sh "$BIN" /tmp/measure/bench.ts "$m" "$SYM" "$FIRST" "$LAST" "${PROTO:-h1}" 2>&1)
  CODES=$(echo "$OUT" | grep '^codes:' | sed 's/codes: *//')
  NUMS=$(echo "$OUT" | grep -v '^codes:' | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -n | tr '\n' ' ')
  MIN=$(echo $NUMS | cut -d' ' -f1)
  CNT=$(echo $NUMS | wc -w)
  ATMIN=$(echo $NUMS | tr ' ' '\n' | grep -c "^$MIN$")
  echo "$m: min=$MIN ($ATMIN of $CNT at min; median=$(echo $NUMS | tr ' ' '\n' | sed -n "$(( (CNT + 1) / 2 ))p")) http: $CODES"
done
