#!/bin/zsh
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
cd $ROOT
run() { # $1=binary tag  $2=round
  T=$(mktemp -d)
  env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
    ./scratch/bun-$1 test test/js/bun/websocket test/js/web/websocket > scratch/ab_ws_$1_$2.txt 2>&1
  T=$(mktemp -d)
  env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
    ./scratch/bun-$1 test test/js/bun/http > scratch/ab_http_$1_$2.txt 2>&1
}
# interleaved: base, l4, base, l4
run base52 1; run l4 1; run base52 2; run l4 2
echo DONE > scratch/ab2.done
