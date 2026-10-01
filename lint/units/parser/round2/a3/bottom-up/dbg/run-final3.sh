#!/bin/sh
# The proposed lines as they are, in a relinked debug binary: the draft of the test, once plain and once with the leak check of CI.
echo "lock acquired $(date -u +%H:%M:%S) pressure $(head -1 /sys/fs/cgroup/cpu.pressure)"
python3 /tmp/a3-seam/relink_debug.py final3 /tmp/a3-seam/out-debug/final3/libbun_js_parser-8337f9633b1f3cf3.rlib || exit 1
DX=/tmp/a3-seam/link-debug/final3/bun-debug
cd /tmp/a3-seam/t/dry
s=$(date +%s)
A3_ROOT=/workspace/wt/parser BUN_DEBUG_QUIET_LOGS=1 $DX test ./lint-parse-visit.test.ts > /tmp/a3-seam/dbg3/dry-test.out 2>&1
echo "dry test rc=$? $(( $(date +%s) - s ))s"
s=$(date +%s)
A3_ROOT=/workspace/wt/parser BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/parser/test/leaksan.supp $DX test ./lint-parse-visit.test.ts > /tmp/a3-seam/dbg3/dry-test-leak.out 2>&1
echo "dry test with the leak check rc=$? $(( $(date +%s) - s ))s"
echo "done $(date -u +%H:%M:%S)"
