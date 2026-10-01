#!/bin/bash
# Runs the test file of the scratch clone: the installed bun (whole file), the debug build (two describes), the debug build with the leak check of CI.
cd /tmp/dccbu-scratch || exit 1
D=/workspace/wt/conformance/build/debug/bun-debug
echo "### lock acquired $(date -u +%T)"
s=$(date +%s)
timeout 900 bun test test/cli/lint/conformance.test.ts > /tmp/dccbu/test-system.log 2>&1; echo "system bun: rc=$? secs=$(( $(date +%s) - s ))"
s=$(date +%s)
BUN_DEBUG_QUIET_LOGS=1 timeout 2400 $D test test/cli/lint/conformance.test.ts --timeout 180000 -t "default check" > /tmp/dccbu/test-debug-default.log 2>&1; echo "debug, default check: rc=$? secs=$(( $(date +%s) - s ))"
s=$(date +%s)
BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/dccbu-scratch/test/leaksan.supp timeout 2400 $D test test/cli/lint/conformance.test.ts --timeout 180000 -t "default check" > /tmp/dccbu/test-debug-leak.log 2>&1; echo "debug with the leak check, default check: rc=$? secs=$(( $(date +%s) - s ))"
echo "### finished $(date -u +%T)"
