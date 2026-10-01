#!/bin/bash
# Under the lock, for the fourth form of the describe("repository") (every name in every build, path functions by slice):
# alone under the release build, and twice under the debug build with the leak check of CI.
set -uo pipefail
cd /tmp/rh1a/repo || exit 1
out=/tmp/rh1a/observed-v4
mkdir -p "$out"
file=./test/cli/lint/repository-v4.test.ts
dbg=/workspace/wt/conformance/build/debug/bun-debug
echo "got the lock $(date -u +%H:%M:%S), loadavg $(cat /proc/loadavg)"
cp /tmp/rh1a/candidate.v4.formatted.ts "$file"
( time env CI=true USE_SYSTEM_BUN=1 bun test "$file" > "$out/alone-release.log" 2>&1; echo "exit $?" >> "$out/alone-release.log" ) 2>&1 | grep real
grep -E '^\((pass|fail|skip)\)|^ *[0-9]+ (pass|fail|skip)|^Ran |^exit|^error' "$out/alone-release.log"
for k in 1 2; do
  echo "== alone, debug build with the leak check of CI, run $k $(date -u +%H:%M:%S), loadavg $(cut -d' ' -f1 /proc/loadavg)"
  ( time env CI=true BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 \
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
    LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/rh1a/repo/test/leaksan.supp \
    "$dbg" test "$file" --timeout 180000 > "$out/alone-debug-leak-$k.log" 2>&1; echo "exit $?" >> "$out/alone-debug-leak-$k.log" ) 2>&1 | grep real
  grep -E '^\((pass|fail|skip)\)|^ *[0-9]+ (pass|fail|skip)|^Ran |^exit|^error' "$out/alone-debug-leak-$k.log"
done
rm -f "$file"
echo "done $(date -u +%H:%M:%S)"
