#!/bin/bash
# Under the machine lock, once: the scratch clone with the third status (corpus.ts and run.ts.patch of ../bottom-up): the candidate
# test alone and the test file with it inserted (zz-whole.test.ts), under the installed release build and under the debug build of
# the worktree with the leak check of CI.
tree=/tmp/corpus-glue-1b/repo
out=/tmp/corpus-glue-1b/out
debug=/workspace/wt/conformance/build/debug/bun-debug
cd "$tree" || exit 1
export TIMEFORMAT='TIME real %R user %U sys %S'
echo "start $(date +%T) loadavg $(cat /proc/loadavg)" > "$out/progress3"
( time USE_SYSTEM_BUN=1 bun test ./test/cli/lint/zz-corpus.test.ts; echo "exit $?" ) > "$out/r2-zz-release.txt" 2>&1
( time USE_SYSTEM_BUN=1 bun test ./test/cli/lint/zz-whole.test.ts; echo "exit $?" ) > "$out/r2-whole-release.txt" 2>&1
echo "release done $(date +%T) loadavg $(cat /proc/loadavg)" >> "$out/progress3"
leak() {
  env BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 \
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
    LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$tree/test/leaksan.supp \
    "$debug" test "$@"
}
( time leak ./test/cli/lint/zz-corpus.test.ts; echo "exit $?" ) > "$out/r2-zz-debug-leak.txt" 2>&1
( time leak ./test/cli/lint/zz-whole.test.ts; echo "exit $?" ) > "$out/r2-whole-debug-leak.txt" 2>&1
echo "debug leak done $(date +%T) loadavg $(cat /proc/loadavg)" >> "$out/progress3"
echo end >> "$out/progress3"
