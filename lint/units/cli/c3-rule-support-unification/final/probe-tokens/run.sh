#!/bin/sh
# Tokens of the final scanner against espree's tokens. cwd: the worktree (the node_modules list is relative to it).
cd /workspace/wt/cli
N=/workspace/notes/lint/units/cli
for f in $N/c3-rule-support-unification/results/corpus.txt $N/c3-rule-support-unification/results/corpus2.txt /tmp/c3tok/corpus3.list $N/rule-support-unification-bottomup/logs/corpus-big.list $N/rule-support-unification-bottomup/logs/corpus-node_modules.list; do
  echo "== $f"
  node --max-old-space-size=8000 /tmp/c3tok/tokens-diff.cjs "$f" 2>&1 | tail -12
done
