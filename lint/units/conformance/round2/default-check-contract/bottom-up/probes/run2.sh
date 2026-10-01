#!/bin/bash
# Runs the test file of the scratch clone with the debug build: the three describes with the leak check of CI, then the whole file with it.
cd /tmp/dcx1a/scratch || exit 1
D=/workspace/wt/conformance/build/debug/bun-debug
L=/tmp/dcx1a/logs
LEAK="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/dcx1a/scratch/test/leaksan.supp"
echo "### lock acquired $(date -u +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
s=$(date +%s)
env BUN_DEBUG_QUIET_LOGS=1 $LEAK timeout 3000 $D test test/cli/lint/conformance.test.ts --timeout 180000 -t "default check|^run |expectations.json" > $L/debug-leak-three.log 2>&1; echo "debug with the leak check, three describes: rc=$? secs=$(( $(date +%s) - s ))"
s=$(date +%s)
env BUN_DEBUG_QUIET_LOGS=1 $LEAK timeout 3000 $D test test/cli/lint/conformance.test.ts > $L/debug-leak-whole.log 2>&1; echo "debug with the leak check, whole file, default timeouts: rc=$? secs=$(( $(date +%s) - s ))"
echo "### finished $(date -u +%T)"
