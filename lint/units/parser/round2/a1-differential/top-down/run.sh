#!/bin/bash
# A1 (top-down pass): harvest check, corpora, harness with the base and the head release binary, oracle, diff.
# usage: /workspace/tools/lk bash /tmp/a1td/run.sh   (a step is skipped when its output exists)
set -u
S=/tmp/a1td
G=$S/gd
R=$S/runs
M=/workspace/notes/lint/measure/parser
BASE=$M/base/bun
HEAD=$M/head/bun
cd "$G" || exit 1
step() { echo "== $(date -u +%H:%M:%S) $*"; }
step start
sha256sum "$BASE" "$HEAD"
"$BASE" --revision
"$HEAD" --revision
if [ ! -s "$R/09.base.txt" ]; then
  step "harvest with the base binary"
  "$BASE" harvest.mjs > "$R/09.base.txt" 2> "$R/09.base.log"
  echo "rc $?"
  cat "$R/09.base.log"
  cmp "$R/09.base.txt" targeted/09-checker-grammar.txt && echo "09 unchanged"
fi
if [ ! -s "$R/gen.targeted.log" ]; then
  step "gen targeted"
  bun gen.mjs targeted > "$R/gen.targeted.log" 2>&1
  echo "rc $?"
  cat "$R/gen.targeted.log"
fi
for c in testrows targeted small; do
  for side in base head; do
    bin=$BASE
    [ $side = head ] && bin=$HEAD
    if [ ! -s "$R/$side.$c.jsonl.gz" ]; then
      step "harness $side $c"
      "$bin" harness.mjs "corpus.$c.json" "$R/$side.$c.jsonl.gz" --jobs=4 > "$R/$side.$c.log" 2>&1
      echo "rc $?"
      cat "$R/$side.$c.log"
    fi
  done
done
for c in testrows targeted small; do
  if [ ! -s "$R/oracle.$c.jsonl.gz" ]; then
    step "oracle $c"
    bun oracle.mjs "corpus.$c.json" "$R/oracle.$c.jsonl.gz" > "$R/oracle.$c.log" 2>&1
    echo "rc $?"
    cat "$R/oracle.$c.log"
  fi
done
for c in testrows targeted small; do
  step "diff $c"
  bun diff.mjs "$R/base.$c.jsonl.gz" "$R/head.$c.jsonl.gz" "--oracle=$R/oracle.$c.jsonl.gz" --causes=causes.mjs "--out=$R/diff.$c.jsonl" --show=3 > "$R/diff.$c.txt" 2>&1
  echo "diff $c rc=$?" | tee "$R/diff.$c.rc"
  head -3 "$R/diff.$c.txt"
  tail -1 "$R/diff.$c.txt"
done
step done
echo ALL-DONE
