#!/bin/zsh
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
cd $ROOT
for r in 3 4; do
  for tag in l4 base52; do
    T=$(mktemp -d)
    env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
      ./scratch/bun-$tag test test/js/bun/http > scratch/ab_http_${tag}_$r.txt 2>&1
  done
done
echo DONE > scratch/ab3.done
