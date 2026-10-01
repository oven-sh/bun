#!/usr/bin/env bash
# usage: /workspace/tools/lk bash accept.sh [tree] [out directory]     (tree: /workspace/wt/conformance; the lock is held once, so nothing below calls lk)
# The three ways in which test/cli/lint/conformance.test.ts has to pass, in a tree that holds the corpus, the glue and expectations.json:
#   release: the installed bun, one run with the corpus out of the page cache and three with it in, then the form of a release lane of CI
#            (CI set, the whole corpus is enumerated) with a release build that has --lint, when there is one;
#   debug:   bun bd test as it is, with the leak check of CI, and with the leak check and the exception checks.
# Every line of the summary has the load average, the counts, the runner's own time, real/user/sys and the number of lines of a sanitizer.
set -u
tree=$(cd -- "${1:-/workspace/wt/conformance}" && pwd)
out=${2:-/tmp/conformance-accept}
mkdir -p "$out"
T=test/cli/lint/conformance.test.ts
H=test/cli/lint/conformance
RELLINT=${RELLINT:-/workspace/wt/parser/build/release/bun}
TIMEFORMAT='TIME real %R user %U sys %S'
cd "$tree"
# materialise.ts ancestorProjectFile: one of these above the temporary directory makes every written instance "unsupported".
for f in /tmp/node_modules /tmp/package.json /tmp/tsconfig.json /tmp/jsconfig.json /node_modules /package.json /tsconfig.json /jsconfig.json; do
  [ -e "$f" ] && echo "WARNING: $f exists: the tests that write an instance fail with ancestor-has-project-files"
done
echo "disk free: $(df -h /tmp | tail -1 | awk '{print $4}') (a run that meets ENOSPC fails with write-failed: that is the machine)"
echo "files of $H that git does not track or ignores (a clean checkout lacks them): $(git status --short --ignored -- $H | wc -l)"
state() { echo "load $(cut -d' ' -f1-3 /proc/loadavg)"; }
one() { # <label> <command...>
  local label=$1 log=$out/$1.log
  shift
  ( echo "STATE $(state)"; { time "$@" ; } ; echo "exit $?" ) > "$log" 2>&1
  sed -i 's/\x1b\[[0-9;]*m//g' "$log"
  echo "$label | $(grep -m1 '^STATE' "$log" | cut -c7-) | $(grep -E '^ *[0-9]+ (pass|fail|skip)' "$log" | tr -s ' \n' ' ')| $(grep -E '^Ran ' "$log") | $(grep '^TIME' "$log") | $(grep -m1 '^exit' "$log") | sanitizer lines $(grep -c 'LeakSanitizer\|AddressSanitizer\|SUMMARY: \|Unchecked' "$log") | timed out $(grep -c 'timed out after\|did not end within' "$log") | ENOSPC $(grep -c ENOSPC "$log")"
}
leak="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$tree/test/leaksan.supp"
validate="BUN_JSC_validateExceptionChecks=1 BUN_JSC_dumpSimulatedThrows=1"
echo "### release, the installed bun $(bun --revision): cold, then warm three times"
python3 "$(dirname -- "${BASH_SOURCE[0]}")/evict.py" "$tree/$H/corpus"
one release-cold env USE_SYSTEM_BUN=1 bun test $T
for k in 1 2 3; do one release-warm-$k env USE_SYSTEM_BUN=1 bun test $T; done
if [ -x "$RELLINT" ]; then
  echo "### release with --lint $($RELLINT --revision), as a release lane of CI: CI set, --timeout=90000"
  one release-ci env CI=true BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_JSC_randomIntegrityAuditRate=1.0 "$RELLINT" test --timeout=90000 $T
fi
echo "### debug: bun bd test"
one debug bun bd test $T
echo "### debug: bun bd test with the leak check of CI"
one debug-leak env $leak bun bd test $T
echo "### debug: bun bd test with the leak check and the exception checks"
one debug-leak-validate env $validate $leak bun bd test $T
echo "logs in $out"
