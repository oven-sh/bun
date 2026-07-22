#!/bin/zsh
# CI-style single node test runner. Usage: run-ci-test.sh <bun-binary> <test-file> <out-file>
set -u
BIN="$1"; F="$2"; OUT="$3"
cd /Users/ciro/code/bun/.claude/worktrees/wave-insp
T=$(mktemp -d)
env TMPDIR="$T" TEST_TMPDIR="$T" FORCE_COLOR=0 NO_COLOR=1 \
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_DEBUG_QUIET_LOGS=1 \
  "$BIN" run --config=$PWD/bunfig.node-test.toml "$PWD/test/js/node/test/parallel/$F" > "$OUT" 2>&1
echo "exit=$?"
