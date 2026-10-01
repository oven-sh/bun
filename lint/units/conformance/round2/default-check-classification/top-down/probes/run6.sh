#!/bin/sh
cd /tmp/dcc-scratch2
echo "=== amended sibling patch: installed bun, whole file"; date
bun test test/cli/lint/conformance.test.ts > /tmp/dcc/a-installed.log 2>&1; echo "exit=$?"
echo "=== amended: debug build, leak env of CI, whole file"; date
BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/dcc-scratch2/test/leaksan.supp /workspace/wt/conformance/build/debug/bun-debug test test/cli/lint/conformance.test.ts > /tmp/dcc/a-debug-leak.log 2>&1; echo "exit=$?"
echo "=== amended: release build with --lint, whole file"; date
/workspace/wt/parser/build/release/bun test test/cli/lint/conformance.test.ts > /tmp/dcc/a-release.log 2>&1; echo "exit=$?"
echo "=== amended: sweep with a binary that dies on one file and hangs on another"; date
bun test/cli/lint/conformance/sweep.ts --bin /tmp/dcc/fake/bun-fake --jobs 4 --timeout 4000 --report /tmp/dcc/report-fake2.json "parserRealSource*" > /tmp/dcc/a-sweep-fake.log 2>&1; echo "exit=$?"
date
