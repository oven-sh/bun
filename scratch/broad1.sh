#!/bin/zsh
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
cd $ROOT
B=$ROOT/build/release/bun
run() { local tag=$1; shift; local T=$(mktemp -d)
  env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
    $B test "$@" > $ROOT/scratch/r4_$tag.txt 2>&1; }
run ws   test/js/bun/websocket test/js/web/websocket
run http test/js/bun/http
run cp   test/js/node/child_process
run wt   test/js/node/worker_threads
run proc test/js/node/process
echo DONE > $ROOT/scratch/l5_broad.done
