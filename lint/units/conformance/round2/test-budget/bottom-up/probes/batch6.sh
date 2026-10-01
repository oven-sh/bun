#!/usr/bin/env bash
# One hold of the machine lock: the tree "final" (the test file exactly as prototype/conformance.test.ts.knobs.patch leaves it): release by hand, release as a lane of CI, and the debug build with the leak check of CI.
set -u
B=/tmp/test-budget-1a
out=$B/out/batch6
mkdir -p "$out"
T=test/cli/lint/conformance.test.ts
RELLINT=/workspace/wt/parser/build/release/bun
DBG=/workspace/wt/conformance/build/debug/bun-debug
TIMEFORMAT='TIME real %R user %U sys %S'
state() { echo "load $(cut -d' ' -f1-3 /proc/loadavg) disk $(df -h / | tail -1 | awk '{print $4}')"; }
one() { # <label> <command...>
  local label=$1 log=$out/$1.log
  shift
  ( cd $B/final && echo "STATE $(state)" && { time "$@" ; } ; echo "exit $?" ) > $log 2>&1
  sed -i 's/\x1b\[[0-9;]*m//g; s/^✓ /(pass) /; s/^✗ /(fail) /; s/^» /(skip) /' $log
  echo "$label | $(grep -m1 '^STATE' $log | cut -c7-) | $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ')| $(grep -E '^Ran ' $log) | $(grep '^TIME' $log) | $(grep -m1 '^exit' $log) | sanitizer lines $(grep -c 'LeakSanitizer\|AddressSanitizer\|SUMMARY: \|Unchecked' $log)"
}
cmp $B/final/$T $B/out/knobs-final.ts && echo "the test file of the tree is the final form"
echo "### $(date -u +%FT%TZ) start; $(state)"
one F-rel env USE_SYSTEM_BUN=1 bun test $T
one F-ci-rel env CI=true BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_JSC_randomIntegrityAuditRate=1.0 $RELLINT test --timeout=90000 $T
one F-dbg-leak env BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$B/final/test/leaksan.supp $DBG test $T
echo "### $(date -u +%FT%TZ) done; $(state)"
