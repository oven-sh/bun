#!/usr/bin/env bash
# One hold of the machine lock: /workspace/tools/lk bash /tmp/test-budget-1a/probes/batch2.sh
# The tree "knobs": the test file with the flag `whole` (the whole corpus in the release builds of CI only) and a time limit
# on every test that needs seconds in a debug build. Release cold and warm by hand, release as a lane of CI runs it
# (CI set, the environment that scripts/runner.node.ts gives a test file), then the debug build of the worktree: as
# `bun bd test` runs it, with the leak check of CI, with the leak check and the exception checks, and with the whole
# environment of scripts/runner.node.ts.
set -u
B=/tmp/test-budget-1a
out=$B/out/batch2
mkdir -p "$out"
H=test/cli/lint/conformance
T=test/cli/lint/conformance.test.ts
RELLINT=/workspace/wt/parser/build/release/bun
DBG=/workspace/wt/conformance/build/debug/bun-debug
TIMEFORMAT='TIME real %R user %U sys %S'
state() { echo "load $(cut -d' ' -f1-3 /proc/loadavg) cpu.pressure $(head -1 /sys/fs/cgroup/cpu.pressure | cut -d' ' -f2-3) memory $(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) MB disk $(df -h / | tail -1 | awk '{print $4}')"; }
summary() { # <label>
  local log=$out/$1.log
  echo "$1 | $(grep -m1 '^STATE' $log | cut -c7-) | $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ')| $(grep -E '^Ran ' $log) | $(grep '^TIME' $log) | $(grep -m1 '^exit' $log) | sanitizer lines $(grep -c 'LeakSanitizer\|AddressSanitizer\|SUMMARY: \|Unchecked exception\|ERROR: Unchecked\|simulated throw' $log) | ENOSPC $(grep -c ENOSPC $log)"
}
one() { # <tree> <label> <command...>
  local tree=$1 label=$2 log=$out/$2.log
  shift 2
  ( cd $B/$tree && echo "STATE $(state)" && { time "$@" ; } ; echo "exit $?" ; echo "STATE-AFTER $(state)" ) > $log 2>&1
  summary $label
}
leak="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1"
lsan() { echo "LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$B/$1/test/leaksan.supp"; }
validate="BUN_JSC_validateExceptionChecks=1 BUN_JSC_dumpSimulatedThrows=1"
# What spawnBun of scripts/runner.node.ts (lines 1967 to 1988) and spawnBunTest (2187 to 2206) put into the environment of a test file.
runner_env() { # <tmp directory>
  echo "TMPDIR=$1 BUN_TMPDIR=$1 TEST_TMPDIR=$1 BUN_INSTALL_CACHE_DIR=$1 FORCE_COLOR=1 GITHUB_ACTIONS=true BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_DEBUG_QUIET_LOGS=1 BUN_DISABLE_SLOW_FILESYSTEM_WARNING=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_JSC_randomIntegrityAuditRate=1.0 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 BUN_ENABLE_CRASH_REPORTING=0"
}

echo "### $(date -u +%FT%TZ) start; installed bun $(bun --revision); release with --lint $($RELLINT --revision); debug $($DBG --revision 2>/dev/null); $(state)"
echo "### release (installed bun), tree knobs, cold"
for k in 1 2; do python3 $B/probes/evict.py $B/repo/$H/corpus; one knobs K-rel-cold-$k env USE_SYSTEM_BUN=1 bun test $T; done
echo "### release (installed bun), tree knobs, warm"
find $B/repo/$H/corpus -type f -print0 | xargs -0 cat > /dev/null
for k in 1 2 3; do one knobs K-rel-warm-$k env USE_SYSTEM_BUN=1 bun test $T; done
echo "### release with --lint as a release lane of CI runs the file: CI set, the environment of scripts/runner.node.ts, --timeout=90000"
for k in 1 2 3; do d=$(mktemp -d /tmp/buntmp-XXXXXX); one knobs K-ci-rel-$k env CI=true $(runner_env $d) $RELLINT test --timeout=90000 $T; rm -rf $d; done
echo "### the same with the corpus cold"
python3 $B/probes/evict.py $B/repo/$H/corpus
d=$(mktemp -d /tmp/buntmp-XXXXXX); one knobs K-ci-rel-cold env CI=true $(runner_env $d) $RELLINT test --timeout=90000 $T; rm -rf $d
echo "### $(date -u +%FT%TZ) debug build as bun bd test runs it"
one knobs K-dbg-plain env BUN_DEBUG_QUIET_LOGS=1 $DBG test $T
echo "### $(date -u +%FT%TZ) debug build, the leak check of CI; the memory of the cgroup and the number of bun-debug processes are read twice a second"
( while :; do echo "$(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) $(ps -eo comm | grep -c '^bun-debug$')"; sleep 0.5; done ) > $out/K-dbg-leak.mem &
sampler=$!
one knobs K-dbg-leak env BUN_DEBUG_QUIET_LOGS=1 $leak $(lsan knobs) $DBG test $T
kill $sampler 2> /dev/null; wait $sampler 2> /dev/null
echo "K-dbg-leak memory of the cgroup, MB: least $(sort -n $out/K-dbg-leak.mem | head -1 | cut -d' ' -f1), most $(sort -n $out/K-dbg-leak.mem | tail -1 | cut -d' ' -f1); bun-debug processes at one time, most: $(cut -d' ' -f2 $out/K-dbg-leak.mem | sort -n | tail -1)"
echo "### $(date -u +%FT%TZ) debug build, the leak check and the exception checks"
one knobs K-dbg-leak-validate env BUN_DEBUG_QUIET_LOGS=1 $validate $leak $(lsan knobs) $DBG test $T
echo "### $(date -u +%FT%TZ) debug build with the whole environment of scripts/runner.node.ts for a run by hand (not CI): --timeout=90000"
d=$(mktemp -d /tmp/buntmp-XXXXXX); one knobs K-dbg-runner env $(runner_env $d) $validate $leak $(lsan knobs) $DBG test --timeout=90000 $T; rm -rf $d
echo "### $(date -u +%FT%TZ) done; $(state)"
