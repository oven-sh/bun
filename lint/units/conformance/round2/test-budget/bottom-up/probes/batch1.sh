#!/usr/bin/env bash
# One hold of the machine lock: /workspace/tools/lk bash /tmp/test-budget-1a/probes/batch1.sh
# The test file with the glue of corpus-glue/bottom-up in the scratch clone "repo" (lists empty) and in "listed" (128 names of class C):
# release cold and warm, release with the meter of every test, the release build that has --lint on "listed", then the debug build
# of the worktree as `bun bd test` runs it: plain, with the leak check of CI, with the leak check and the exception checks, and on "listed".
set -u
B=/tmp/test-budget-1a
out=$B/out/batch1
mkdir -p "$out"
H=test/cli/lint/conformance
T=test/cli/lint/conformance.test.ts
RELLINT=/workspace/wt/parser/build/release/bun
DBG=/workspace/wt/conformance/build/debug/bun-debug
TIMEFORMAT='TIME real %R user %U sys %S'
state() { echo "load $(cut -d' ' -f1-3 /proc/loadavg) cpu.pressure $(head -1 /sys/fs/cgroup/cpu.pressure | cut -d' ' -f2-3) memory $(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) MB"; }
summary() { # <label>
  local log=$out/$1.log
  echo "$1 | $(grep -m1 '^STATE' $log | cut -c7-) | $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ')| $(grep -E '^Ran ' $log) | $(grep '^TIME' $log) | $(grep -m1 '^exit' $log) | sanitizer lines $(grep -c 'LeakSanitizer\|AddressSanitizer\|SUMMARY: \|Unchecked exception\|ERROR: Unchecked\|simulated throw' $log)"
}
one() { # <tree> <label> <command...>   (the command runs in the tree; env assignments come through `env`)
  local tree=$1 label=$2 log=$out/$2.log
  shift 2
  ( cd $B/$tree && echo "STATE $(state)" && { time "$@" ; } ; echo "exit $?" ; echo "STATE-AFTER $(state)" ) > $log 2>&1
  summary $label
}
leak="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1"
lsan() { echo "LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$B/$1/test/leaksan.supp"; }

echo "### $(date -u +%FT%TZ) start; installed bun $(bun --revision); release with --lint $($RELLINT --revision); debug $($DBG --revision 2>/dev/null)"
echo "### release (installed bun), tree repo, cold: the data pages of the corpus are put out of the page cache before the run"
python3 $B/probes/evict.py $B/repo/$H/corpus
one repo rel-cold-1 env USE_SYSTEM_BUN=1 bun test $T
python3 $B/probes/evict.py $B/repo/$H/corpus
one repo rel-cold-2 env USE_SYSTEM_BUN=1 bun test $T
echo "### release (installed bun), tree repo, warm"
find $B/repo/$H/corpus -type f -print0 | xargs -0 cat > /dev/null
for k in 1 2 3; do one repo rel-warm-$k env USE_SYSTEM_BUN=1 bun test $T; done
echo "### release (installed bun), tree repo, warm, with the meter of every test"
for k in 1 2; do one repo rel-percpu-$k env USE_SYSTEM_BUN=1 PERCPU_OUT=$out/rel-percpu-$k.json bun test --preload $B/probes/percpu-preload.ts $T; done
echo "### release with --lint, tree repo (lists empty) and tree listed (128 names of class C), warm"
for k in 1 2 3; do one repo rellint-empty-$k $RELLINT test $T; done
for k in 1 2 3; do one listed rellint-listed-$k $RELLINT test $T; done
echo "### $(date -u +%FT%TZ) debug build as bun bd test runs it (BUN_DEBUG_QUIET_LOGS=1, the default time of a test)"
one repo dbg-plain env BUN_DEBUG_QUIET_LOGS=1 $DBG test $T
echo "### $(date -u +%FT%TZ) debug build, the leak check of CI"
one repo dbg-leak env BUN_DEBUG_QUIET_LOGS=1 $leak $(lsan repo) $DBG test $T
echo "### $(date -u +%FT%TZ) debug build, the leak check and the exception checks"
one repo dbg-leak-validate env BUN_DEBUG_QUIET_LOGS=1 BUN_JSC_validateExceptionChecks=1 BUN_JSC_dumpSimulatedThrows=1 $leak $(lsan repo) $DBG test $T
echo "### $(date -u +%FT%TZ) debug build, the leak check, tree listed (a sample of 16 of the 128 names, two batches of 8)"
one listed dbg-leak-listed env BUN_DEBUG_QUIET_LOGS=1 $leak $(lsan listed) $DBG test $T
echo "### $(date -u +%FT%TZ) done"
