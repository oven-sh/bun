#!/usr/bin/env bash
# usage: run-replay.sh <bun-binary> <label> <from-seed> <to-seed> [parallel] [rounds]
BIN="$1"; LABEL="$2"; FROM="$3"; TO="$4"; PAR="${5:-16}"; ROUNDS="${6:-60}"
OUT=${TMPDIR:-/tmp}/replay29-out-$LABEL
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
run_one() {
  local seed="$1"
  BUN_DEBUG_QUIET_LOGS=1 timeout 900 "$BIN" "$SCRIPT_DIR/replay29.mjs" "$seed" "$ROUNDS" > "$OUT/seed-$seed.log" 2>&1
  echo "seed $seed exit $?" >> "$OUT/summary.txt"
}
export -f run_one
export BIN OUT SCRIPT_DIR ROUNDS PAUSE_MS EPHEMERAL BUN_ASSUME_PERFECT_INCREMENTAL EPH_DELAY_MS NO_H
seq "$FROM" "$TO" | xargs -P "$PAR" -I{} bash -c 'run_one {}'
sort -t' ' -k2 -n "$OUT/summary.txt" | grep -v "exit 0" || echo "all clean"
