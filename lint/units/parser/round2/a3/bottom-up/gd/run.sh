#!/bin/sh
# The grammar-diff corpora through one binary twice: a parse without lint, and the lint parse pass before the visit pass.
X=/tmp/a3-seam/link/exp/bun-profile
G=/workspace/notes/lint/units/parser/grammar-diff
cd /tmp/a3-seam/gd
echo "lock acquired $(date -u +%H:%M:%S)"
for c in targeted small; do
  s=$(date +%s)
  env -u BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 $X $G/harness.mjs $G/corpus.$c.json normal.$c.jsonl.gz --jobs=3
  echo "normal $c rc=$? $(( $(date +%s) - s ))s"
  s=$(date +%s)
  BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 $X $G/harness.mjs $G/corpus.$c.json lint.$c.jsonl.gz --jobs=3
  echo "lint $c rc=$? $(( $(date +%s) - s ))s"
  bun $G/diff.mjs normal.$c.jsonl.gz lint.$c.jsonl.gz --oracle=$G/oracle.$c.jsonl.gz --out=diff.$c.jsonl --show=4 > diff.$c.txt 2>&1
  echo "diff $c rc=$?"
done
echo "done $(date -u +%H:%M:%S)"
