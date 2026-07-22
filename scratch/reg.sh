#!/bin/zsh
set -u
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
tag=$1
out=$ROOT/scratch/reg_$tag.txt
: > $out
T=$(mktemp -d)
echo "=== bun test test/js/node/inspector" >> $out
env TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 $ROOT/build/release/bun test $ROOT/test/js/node/inspector >> $out 2>&1
echo "=== vendored" >> $out
for f in parallel/test-inspector-connect-to-main-thread.js parallel/test-inspector-enabled.js parallel/test-inspector-open-coverage.js parallel/test-inspector-open-port-integer-overflow.js parallel/test-inspector-open.js sequential/test-inspector-open-dispose.mjs; do
  T2=$(mktemp -d)
  timeout 60 env TMPDIR=$T2 TEST_TMPDIR=$T2 FORCE_COLOR=0 NO_COLOR=1 \
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_DEBUG_QUIET_LOGS=1 \
    $ROOT/build/release/bun run --config=$ROOT/bunfig.node-test.toml $ROOT/test/js/node/test/$f > $ROOT/scratch/logs/reg_${tag}_${f##*/}.log 2>&1
  echo "$? $f" >> $out
done
