#!/bin/zsh
# Broad post-L5 regression sweep. Exit-path changes can break things nowhere
# near the inspector, so run the network + process suites, twice each.
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
cd $ROOT
B=$ROOT/build/release/bun
run() {  # run <tag> <rep> <paths...>
  local tag=$1 rep=$2; shift 2
  local T=$(mktemp -d)
  env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 \
    $B test "$@" > $ROOT/scratch/l5_${tag}_$rep.txt 2>&1
}
for rep in 1 2; do
  run ws   $rep test/js/bun/websocket test/js/web/websocket
  run http $rep test/js/bun/http
  run cp   $rep test/js/node/child_process
  run wt   $rep test/js/node/worker_threads
  run proc $rep test/js/node/process
done
echo DONE > $ROOT/scratch/l5_broad.done
