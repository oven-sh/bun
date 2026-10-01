#!/bin/sh
# The sweep on the debug build with the switch: both modes, four children at a time; then the lint mode with the leak check of CI; then the draft of the test.
DX=/tmp/a3-seam/link-debug/exp/bun-debug
S=/tmp/a3-seam/sweep
O=/tmp/a3-seam/dbg
cd $S
echo "lock acquired $(date -u +%H:%M:%S) load $(cut -d' ' -f1 /proc/loadavg) pressure $(head -1 /sys/fs/cgroup/cpu.pressure)"
s=$(date +%s)
for h in 0 1; do
  python3 /tmp/a3-seam/rss.py $DX worker.js half$h.list.json $O/half$h.normal.jsonl > $O/half$h.normal.time 2>&1 &
  python3 /tmp/a3-seam/rss.py BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT=1 $DX worker.js half$h.list.json $O/half$h.lint.jsonl > $O/half$h.lint.time 2>&1 &
done
wait
echo "sweep four children: $(( $(date +%s) - s ))s"
for f in $O/half*.time; do echo "$f: $(tail -1 $f)"; done
s=$(date +%s)
for h in 0 1; do
  python3 /tmp/a3-seam/rss.py BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/parser/test/leaksan.supp BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT=1 $DX worker.js half$h.list.json $O/half$h.lint-leak.jsonl > $O/half$h.lint-leak.out 2>&1 &
  python3 /tmp/a3-seam/rss.py BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/parser/test/leaksan.supp $DX worker.js half$h.list.json $O/half$h.normal-leak.jsonl > $O/half$h.normal-leak.out 2>&1 &
done
wait
echo "leak check four children: $(( $(date +%s) - s ))s"
for f in $O/half*-leak.out; do echo "$f: $(tail -1 $f) lines $(wc -l < $f)"; done
s=$(date +%s)
cd /tmp/a3-seam/t/dry
A3_ROOT=/workspace/wt/parser BUN_DEBUG_QUIET_LOGS=1 $DX test ./lint-parse-visit.test.ts > $O/dry-test.out 2>&1
echo "dry test rc=$? $(( $(date +%s) - s ))s"
echo "done $(date -u +%H:%M:%S)"
