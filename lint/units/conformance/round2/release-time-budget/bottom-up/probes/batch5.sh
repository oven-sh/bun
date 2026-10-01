#!/bin/bash
# Under the machine lock, once: the tests of "reference" and "enumerator" of V0 and of the final prototype V3 under the debug build of the worktree.
out=/tmp/rtb1a/out/batch5
mkdir -p "$out"
corpus=/tmp/rtb1a/repo/test/cli/lint/conformance/corpus
find "$corpus" -type f -print0 | xargs -0 cat > /dev/null
export TIMEFORMAT='TIME real %R user %U sys %S'
for t in repo:V0 v3:V3; do
  tree=/tmp/rtb1a/${t%%:*}; tag=${t##*:}
  ( cd "$tree" && echo "loadavg $(cat /proc/loadavg)" && time BUN_DEBUG_QUIET_LOGS=1 /workspace/wt/conformance/build/debug/bun-debug test test/cli/lint/conformance.test.ts -t "^(reference|enumerator) " --timeout 180000; echo "exit $?" ) > "$out/$tag-debug.log" 2>&1
done
echo "end $(date +%T)" > "$out/progress"
