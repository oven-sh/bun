#!/bin/zsh
# Post-fix gauntlet: vendored inspector tests 3x each against the release build.
set -u
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
BIN=$ROOT/build/release/bun
cd $ROOT
fails=0
for f in test/js/node/test/parallel/test-inspector-*.js; do
  for i in 1 2 3; do
    out=$(timeout 120 $BIN "$f" 2>&1); code=$?
    if [ $code -ne 0 ]; then
      fails=$((fails+1))
      echo "FAIL($code) run$i $f"
      echo "$out" | tail -5 | sed 's/^/    /'
    else
      echo "pass  run$i $f"
    fi
  done
done
echo "total failures: $fails"
