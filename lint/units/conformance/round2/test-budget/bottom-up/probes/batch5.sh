#!/usr/bin/env bash
# One hold of the machine lock: the tree "knobs2" (the knobs, and the time of one check of "default check" given by the test file: 100 s in a debug build).
# Release by hand and as a lane of CI, once each; then the debug build of the worktree with the leak check of CI twice, with the times of every start
# and end of a test, and once more with the exception checks.
set -u
B=/tmp/test-budget-1a
out=$B/out/batch5
mkdir -p "$out"
H=test/cli/lint/conformance
T=test/cli/lint/conformance.test.ts
RELLINT=/workspace/wt/parser/build/release/bun
DBG=/workspace/wt/conformance/build/debug/bun-debug
TIMEFORMAT='TIME real %R user %U sys %S'
state() { echo "load $(cut -d' ' -f1-3 /proc/loadavg) cpu.pressure $(head -1 /sys/fs/cgroup/cpu.pressure | cut -d' ' -f2-3) memory $(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) MB disk $(df -h / | tail -1 | awk '{print $4}')"; }
one() { # <tree> <label> <command...>
  local tree=$1 label=$2 log=$out/$2.log
  shift 2
  ( cd $B/$tree && echo "STATE $(state)" && { time "$@" ; } ; echo "exit $?" ; echo "STATE-AFTER $(state)" ) > $log 2>&1
  sed -i 's/\x1b\[[0-9;]*m//g; s/^✓ /(pass) /; s/^✗ /(fail) /; s/^» /(skip) /' $log
  echo "$label | $(grep -m1 '^STATE' $log | cut -c7-) | $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ')| $(grep -E '^Ran ' $log) | $(grep '^TIME' $log) | $(grep -m1 '^exit' $log) | sanitizer lines $(grep -c 'LeakSanitizer\|AddressSanitizer\|SUMMARY: \|Unchecked exception\|ERROR: Unchecked\|simulated throw' $log) | ENOSPC $(grep -c ENOSPC $log)"
}
leak="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1"
lsan() { echo "LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$B/$1/test/leaksan.supp"; }
validate="BUN_JSC_validateExceptionChecks=1 BUN_JSC_dumpSimulatedThrows=1"
runner_env() { # <tmp directory>
  echo "TMPDIR=$1 BUN_TMPDIR=$1 TEST_TMPDIR=$1 BUN_INSTALL_CACHE_DIR=$1 FORCE_COLOR=1 GITHUB_ACTIONS=true BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_DEBUG_QUIET_LOGS=1 BUN_DISABLE_SLOW_FILESYSTEM_WARNING=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_JSC_randomIntegrityAuditRate=1.0 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 BUN_ENABLE_CRASH_REPORTING=0"
}
echo "### $(date -u +%FT%TZ) start; $(state)"
find $B/repo/$H/corpus -type f -print0 | xargs -0 cat > /dev/null
one knobs2 K2-rel-warm env USE_SYSTEM_BUN=1 bun test $T
d=$(mktemp -d /tmp/buntmp-XXXXXX); one knobs2 K2-ci-rel env CI=true $(runner_env $d) $RELLINT test --timeout=90000 $T; rm -rf $d
for k in 1 2; do
  echo "### $(date -u +%FT%TZ) debug build, the leak check of CI, with the times of every start and end of a test"
  one knobs2 K2-dbg-leak-$k env BUN_DEBUG_QUIET_LOGS=1 TIMELINE_OUT=$out/K2-dbg-leak-$k.json $leak $(lsan knobs2) $DBG test --preload $B/probes/timeline-preload.ts $T
  bun $B/probes/timeline-show.ts $out/K2-dbg-leak-$k.json $out/K2-dbg-leak-$k.log 1500
done
echo "### $(date -u +%FT%TZ) debug build, the leak check and the exception checks"
one knobs2 K2-dbg-leak-validate env BUN_DEBUG_QUIET_LOGS=1 $validate $leak $(lsan knobs2) $DBG test $T
echo "### $(date -u +%FT%TZ) done; $(state)"
