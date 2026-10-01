#!/bin/sh
# A1: the harness with the base and the head release binaries, four workers at a time.
M=/workspace/notes/lint/measure/parser
G=/tmp/a1bu/gd
R=/tmp/a1bu/runs
mkdir -p "$R"
date -u
sha256sum "$M/base/bun" "$M/head/bun"
for c in targeted targeted-ext small; do
  for b in base head; do
    echo "== $b $c"
    "$M/$b/bun" "$G/harness.mjs" "$G/corpus.$c.json" "$R/$b.$c.jsonl.gz" --jobs=4
    echo "rc=$?"
  done
done
date -u
echo ALL-DONE
