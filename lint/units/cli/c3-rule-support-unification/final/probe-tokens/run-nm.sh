#!/bin/sh
# Tokens of the final scanner against espree's tokens over the node_modules list, in chunks. cwd: the worktree.
cd /workspace/wt/cli
for f in /tmp/c3final/corpus/nm.00 /tmp/c3final/corpus/nm.01 /tmp/c3final/corpus/nm.02 /tmp/c3final/corpus/nm.03 /tmp/c3final/corpus/nm.04; do
  echo "== $f"
  node --max-old-space-size=8000 /tmp/c3tok/tokens-diff.cjs "$f" 2>&1 | tail -6
done
