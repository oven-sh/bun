#!/bin/bash
# Under the machine lock, once: in the scratch clone /tmp/corpus-glue-1b/repo (corpus + binding laid over 3110ce85cf)
#  1. sweep.ts of HEAD (its own glue) beside sweep.ts of the tree on the default check with the debug build, conformance/types/tuple/, --jobs 4
#  2. the test file under the installed release build, and the candidate test of the binding (zz-corpus.test.ts)
#  3. the same two under the debug build of the worktree with the leak check of CI, default time limits
tree=/tmp/corpus-glue-1b/repo
out=/tmp/corpus-glue-1b/out
home=$tree/test/cli/lint/conformance
debug=/workspace/wt/conformance/build/debug/bun-debug
mkdir -p "$out"
cd "$tree" || exit 1
echo "start $(date +%T) loadavg $(cat /proc/loadavg)" > "$out/progress"
git show HEAD:test/cli/lint/conformance/sweep.ts > "$home/sweep_before.ts"
export TIMEFORMAT='TIME real %R user %U sys %S'
for side in before after; do
  script=sweep.ts; [ "$side" = before ] && script=sweep_before.ts
  rm -f "$out/report-$side.json"
  ( time bun "test/cli/lint/conformance/$script" --bin "$debug" --jobs 4 --report "$out/report-$side.json" conformance/types/tuple/; echo "exit $?" ) > "$out/tuple-$side.txt" 2>&1
  echo "tuple $side done $(date +%T)" >> "$out/progress"
done
rm -f "$home/sweep_before.ts"
( time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts; echo "exit $?" ) > "$out/test-release.txt" 2>&1
( time USE_SYSTEM_BUN=1 bun test ./test/cli/lint/zz-corpus.test.ts; echo "exit $?" ) > "$out/zz-release.txt" 2>&1
echo "release tests done $(date +%T) loadavg $(cat /proc/loadavg)" >> "$out/progress"
leak() {
  env BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 \
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
    LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$tree/test/leaksan.supp \
    "$debug" test "$@"
}
( time leak ./test/cli/lint/zz-corpus.test.ts; echo "exit $?" ) > "$out/zz-debug-leak.txt" 2>&1
echo "debug leak zz done $(date +%T) loadavg $(cat /proc/loadavg)" >> "$out/progress"
( time leak test/cli/lint/conformance.test.ts; echo "exit $?" ) > "$out/test-debug-leak.txt" 2>&1
echo "debug leak test done $(date +%T) loadavg $(cat /proc/loadavg)" >> "$out/progress"
echo end >> "$out/progress"
