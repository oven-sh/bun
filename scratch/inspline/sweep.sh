#!/bin/zsh
# Sweep the 15 inspector-helper-gated tests against a bun binary.
# Usage: sweep.sh <bun-binary> <tag>
set -u
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
BIN=$1; TAG=$2
LOGDIR=$ROOT/scratch/inspline/logs_$TAG; mkdir -p $LOGDIR
LIST=(
  test-inspect-async-hook-setup-at-inspect.js
  test-inspector-async-hook-setup-at-inspect-brk.js
  test-inspector-async-stack-traces-set-interval.js
  test-inspector-console.js
  test-inspector-esm.js
  test-inspector-invalid-protocol.js
  test-inspector-multisession-ws.js
  test-inspector-scriptparsed-context.js
  test-inspector-stop-profile-after-done.js
  test-inspector-wait.mjs
  test-inspector-worker-target.js
  test-inspector.js
  test-esm-loader-hooks-inspect-brk.js
  test-esm-loader-hooks-inspect-wait.js
  test-runner-inspect.mjs
)
for f in $LIST; do
  T=$ROOT/scratch/inspline/tmp/$TAG-$f; rm -rf $T; mkdir -p $T
  timeout 90 env TMPDIR=$T TEST_TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 \
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_DEBUG_QUIET_LOGS=1 \
    $BIN run --config=$ROOT/bunfig.node-test.toml $ROOT/test/js/node/test/parallel/$f > $LOGDIR/$f.log 2>&1
  echo "$? $f"
done
