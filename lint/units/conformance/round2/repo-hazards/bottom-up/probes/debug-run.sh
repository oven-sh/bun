#!/bin/bash
# Runs the candidate describe of the scratch clone with the debug build of the worktree: twice plain, once with the leak check of CI.
cd /tmp/rh1a/repo || exit 1
bin=/workspace/wt/conformance/build/debug/bun-debug
file=${1:-./test/cli/lint/repository-candidate.test.ts}
echo "got the lock $(date -u +%H:%M:%S), loadavg $(cat /proc/loadavg)"
sha256sum "$file"
for k in 1 2; do
  echo "== debug run $k"
  ( time env BUN_DEBUG_QUIET_LOGS=1 CI=true "$bin" test "$file" ) 2>&1
  echo "exit $?"
done
echo "== debug run with the leak check of CI"
( time env BUN_DEBUG_QUIET_LOGS=1 CI=true BUN_DESTRUCT_VM_ON_EXIT=1 \
  ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
  LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/rh1a/repo/test/leaksan.supp \
  "$bin" test "$file" ) 2>&1
echo "exit $?"
echo "done $(date -u +%H:%M:%S)"
