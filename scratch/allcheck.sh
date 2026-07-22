#!/bin/zsh
# Full regression sweep. Usage: allcheck.sh <tag>
set -u
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
NODE=/Users/ciro/code/node-v26.3.0/out/Release/node
BIN=$ROOT/build/release/bun
TAG=${1:-run}
cd $ROOT
echo "===== verify.mjs (JSC + CDP harness) ====="
timeout 300 $NODE scratch/verify.mjs $BIN 2>&1 | tail -30
for m in matrix_l5 matrix_l5b matrix_l5c matrix_l5d matrix_l5e; do
  echo "===== $m ====="
  timeout 900 $NODE scratch/$m.mjs $BIN 2>&1 | grep -Ei 'RESULT|exited=|FAIL|PASS|^ROW|hang' | tail -40
done
