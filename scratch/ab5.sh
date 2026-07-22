#!/bin/zsh
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
cd $ROOT
for r in 3 4 5; do
  for tag in eval base-b5; do
    T=$(mktemp -d)
    env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
      ./scratch/bun-$tag test test/js/bun/websocket test/js/web/websocket > scratch/ab4_ws_${tag}_$r.txt 2>&1
  done
done
echo DONE > scratch/ab5.done
