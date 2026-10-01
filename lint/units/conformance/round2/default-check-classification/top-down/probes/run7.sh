#!/bin/sh
cd /tmp/dcc-scratch
echo "=== alternative: release build with --lint, whole file"; date
/workspace/wt/parser/build/release/bun test test/cli/lint/conformance.test.ts > /tmp/dcc/t3-release.log 2>&1; echo "exit=$?"
echo "=== alternative: installed bun, whole file"; date
bun test test/cli/lint/conformance.test.ts > /tmp/dcc/t3-installed.log 2>&1; echo "exit=$?"
echo "=== alternative: debug build, leak env of CI, default check and run"; date
BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/dcc-scratch/test/leaksan.supp /workspace/wt/conformance/build/debug/bun-debug test test/cli/lint/conformance.test.ts -t "default check" > /tmp/dcc/t3-debug-leak.log 2>&1; echo "exit=$?"
date
