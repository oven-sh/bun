#!/usr/bin/env bash
# Post-batch: archive result, commit+push, log, generate next batch JSON to stdout.
# Usage: scripts/port-cycle.sh <batch-name> <task-output-file> <next-size>
set -uo pipefail
NAME="$1"; OUT="$2"; NEXT="${3:-100}"
cd "$(dirname "$0")/.."

command cp -f "$OUT" "/tmp/port-results/$NAME.json"
STATS=$(jq -r '.result | "\(.total)\t\(.clean)\t\(.fixed)\t\([.results[]|select(.==null)]|length)\t\(.by_confidence.high)\t\(.by_confidence.medium)\t\(.by_confidence.low)"' "$OUT" 2>/dev/null || echo "?	?	?	?	?	?	?")
DUR=$(jq -r '.usage.duration_ms // "?"' "$OUT" 2>/dev/null)
AG=$(jq -r '.usage.agent_count // "?"' "$OUT" 2>/dev/null)
printf "%s\t%s\t%s\t%s\n" "$NAME" "$STATS" "$DUR" "$AG" >> /tmp/port-results/log.tsv

git -c core.hooksPath=/dev/null add 'src/**/*.rs' src/*.rs 2>/dev/null
N=$(git diff --cached --name-only | wc -l)
if [ "$N" -gt 0 ]; then
  git -c core.hooksPath=/dev/null commit -q -m "phase-a: draft batch $NAME ($N files)"
  git -c core.hooksPath=/dev/null push origin claude/phase-a-port 2>&1 | tail -1 >&2 || {
    git -c core.hooksPath=/dev/null pull --rebase origin claude/phase-a-port >&2 2>&1
    git -c core.hooksPath=/dev/null push origin claude/phase-a-port 2>&1 | tail -1 >&2
  }
fi

bun scripts/port-batch.ts status >&2 2>&1
# decide next batch size: if first pending file >2200 LOC, drop to 6
FIRST_LOC=$(bun scripts/port-batch.ts head 1 2>/dev/null | jq -r '.files[0].loc // 0')
if [ "$FIRST_LOC" -gt 2200 ]; then NEXT=6; fi
echo "── next: head $NEXT (first loc=$FIRST_LOC) ──" >&2
bun scripts/port-batch.ts head "$NEXT" 2>/dev/null
