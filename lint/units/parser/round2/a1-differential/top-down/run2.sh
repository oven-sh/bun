#!/bin/bash
set -u
G=/tmp/a1td/gd2; R=/tmp/a1td/runs2; M=/workspace/notes/lint/measure/parser
cd "$G" || exit 1
for c in comments testrows targeted small; do
  for side in base head; do
    if [ ! -s "$R/$side.$c.jsonl.gz" ]; then
      echo "== $(date -u +%H:%M:%S) harness2 $side $c"
      "$M/$side/bun" harness.mjs "corpus.$c.json" "$R/$side.$c.jsonl.gz" --jobs=4 2>&1 | tail -3
    fi
  done
  bun diff.mjs "$R/base.$c.jsonl.gz" "$R/head.$c.jsonl.gz" "--out=$R/diff.$c.jsonl" --show=2 > "$R/diff.$c.txt" 2>&1
  echo "diff $c rc=$?"; head -3 "$R/diff.$c.txt"; grep -E '^(!!|\?\?|  ) +[0-9]+ records' "$R/diff.$c.txt"
done
echo ALL-DONE2
