#!/bin/zsh
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
cd $ROOT
for b in baseline after; do
  T=$(mktemp -d)
  env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
    ./scratch/bun-$b test test/js/bun/http > scratch/httpout_$b.txt 2>&1
done
echo DONE > scratch/abhttp.done
