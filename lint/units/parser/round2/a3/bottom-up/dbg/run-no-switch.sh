#!/bin/sh
# The draft of the test on the debug build of the worktree as it is (no switch): it must fail, at the sentinel.
echo "lock acquired $(date -u +%H:%M:%S)"
cd /tmp/a3-seam/t/dry
s=$(date +%s)
A3_ROOT=/workspace/wt/parser BUN_DEBUG_QUIET_LOGS=1 /workspace/wt/parser/build/debug/bun-debug test ./lint-parse-visit.test.ts > /tmp/a3-seam/dbg0/dry-test.out 2>&1
echo "dry test without the switch rc=$? $(( $(date +%s) - s ))s"
echo "done $(date -u +%H:%M:%S)"
