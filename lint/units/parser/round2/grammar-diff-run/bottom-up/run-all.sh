#!/bin/sh
# A1 run: extended oracle, harness with the base and the head release binary, diff with the cause list.
# usage: /workspace/tools/lk sh /tmp/gdr1a/run-all.sh   (each step is skipped when its output exists)
S=/tmp/gdr1a
GD=$S/gd
R=$S/runs
BASE=/workspace/notes/lint/measure/parser/base/bun
HEAD=${HEAD_BIN:-/workspace/notes/lint/measure/parser/head/bun}
TAG=${HEAD_TAG:-head}
cd "$GD" || exit 1
step() { echo "== $(date +%H:%M:%S) $*"; }
for c in small targeted; do
  if [ ! -s "$R/oracle.$c.jsonl.gz" ]; then
    step "oracle $c"
    bun oracle.mjs "corpus.$c.json" "$R/oracle.$c.jsonl.gz" > "$R/oracle.$c.log" 2>&1 || { echo "oracle $c failed"; cat "$R/oracle.$c.log"; exit 1; }
    cat "$R/oracle.$c.log"
  fi
done
for c in targeted small; do
  if [ ! -s "$R/base.$c.jsonl.gz" ]; then
    step "harness base $c"
    "$BASE" harness.mjs "corpus.$c.json" "$R/base.$c.jsonl.gz" --jobs=4 > "$R/base.$c.log" 2>&1 || { echo "harness base $c failed"; cat "$R/base.$c.log"; exit 1; }
    cat "$R/base.$c.log"
  fi
  if [ ! -s "$R/$TAG.$c.jsonl.gz" ]; then
    step "harness $TAG $c"
    "$HEAD" harness.mjs "corpus.$c.json" "$R/$TAG.$c.jsonl.gz" --jobs=4 > "$R/$TAG.$c.log" 2>&1 || { echo "harness $TAG $c failed"; cat "$R/$TAG.$c.log"; exit 1; }
    cat "$R/$TAG.$c.log"
  fi
  step "diff $c"
  bun diff.mjs "$R/base.$c.jsonl.gz" "$R/$TAG.$c.jsonl.gz" "--oracle=$R/oracle.$c.jsonl.gz" --causes=causes.mjs "--out=$R/diff.$TAG.$c.jsonl" --show=3 > "$R/diff.$TAG.$c.txt" 2>&1
  echo "diff $c rc=$?" | tee "$R/diff.$TAG.$c.rc"
  head -4 "$R/diff.$TAG.$c.txt"
  tail -1 "$R/diff.$TAG.$c.txt"
done
step done
