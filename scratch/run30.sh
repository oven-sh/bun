#!/bin/zsh
# Run each inspector-helper-based missing test with a 35s timeout, classify.
set -u
ROOT=/Users/ciro/code/bun/.claude/worktrees/wave-insp
NODE_SRC=/Users/ciro/code/node-v26.3.0/test
LIST=$ROOT/scratch/list30.txt
out=$ROOT/scratch/results.txt
: > $out
while read -r rel; do
  d=${rel%%/*}; f=${rel##*/}
  # Never overwrite or delete a committed test file.
  if git -C $ROOT ls-files --error-unmatch test/js/node/test/$d/$f >/dev/null 2>&1; then
    tracked=1
  else
    tracked=0
    cp $NODE_SRC/$rel $ROOT/test/js/node/test/$d/$f
  fi
  T=$(mktemp -d)
  start=$SECONDS
  timeout 35 env TMPDIR=$T TEST_TMPDIR=$T FORCE_COLOR=0 NO_COLOR=1 \
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_DEBUG_QUIET_LOGS=1 \
    $ROOT/build/release/bun run --config=$ROOT/bunfig.node-test.toml \
    $ROOT/test/js/node/test/$d/$f > $ROOT/scratch/logs/$f.log 2>&1
  rc=$?
  dur=$((SECONDS-start))
  echo "$rc ${dur}s $rel" >> $out
  [ $tracked -eq 0 ] && rm -f $ROOT/test/js/node/test/$d/$f
done < $LIST
