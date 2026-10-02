#!/bin/bash
# The EIGHT older test files of parser.md P1.6 with the debug build of the worktree, one `bun bd test` each.
# (P1.6 names nine files: the ninth is typescript-grammar.test.ts, which round 1 wrote and R4 turns into tests of the lint grammar.)
# Each of the eight is byte-identical to main: the first line of the summary checks it. They pass unchanged, as on main.
#   /workspace/tools/lk bash older-tests.sh <plain|leak> [out dir, default /tmp/parser-older-tests]
#   plain   bun bd test <file> --timeout 180000
#   leak    the same under the leak check of CI (BUN_DESTRUCT_VM_ON_EXIT, ASAN detect_leaks, test/leaksan.supp: scripts/runner.node.ts).
#           CI leaves it off for ts.test.ts, type-export.test.ts and transpiler-cache.test.ts (test/no-validate-leaksan.txt): here all eight run with it.
# The runner gets BUN_RUNTIME_TRANSPILER_CACHE_PATH=0, as in CI: with EXPECTED_VERSION at 33 a cache entry that another build of
# this branch wrote for a test file (~/.bun/install/cache/@t@, *.debug.pile) would be read as if it were of this build.
# A test of type-export.test.ts and of transpiler-cache.test.ts takes longer than 5 s in a debug build: the timeout is given at once.
# Exit code 0 only when every file ends with rc=0, "0 fail" and the counts of main (recorded with the debug builds of
# e3566be889 and be1ebe5295; the eight files did not change from e3566be889 to bc7a813b10).
set -u
mode=${1:?usage: older-tests.sh <plain|leak> [out dir]}
out=${2:-/tmp/parser-older-tests}/$mode
W=${W:-/workspace/wt/parser}
cd "$W" || exit 9
mkdir -p "$out"
ulimit -c 0
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
# file | what the summary of bun test has to say
LIST="test/bundler/transpiler/decorator-metadata.test.ts|5 pass;0 fail
test/bundler/bundler_decorator_metadata.test.ts|2 pass;0 fail
test/bundler/transpiler/decorators.test.ts|24 pass;0 fail
test/bundler/transpiler/transpiler-stack-overflow.test.ts|1 pass;0 fail
test/bundler/esbuild/ts.test.ts|59 pass;16 todo;0 fail
test/cli/run/transpiler-cache.test.ts|20 pass;0 fail
test/js/bun/typescript/type-export.test.ts|70 pass;18 skip;0 fail
test/bundler/transpiler/transpiler.test.js|237 pass;1 skip;21 todo;0 fail"
summary=$out/summary.txt
changed=$(echo "$LIST" | cut -d'|' -f1 | xargs git diff --stat origin/main -- | tail -1)
echo "# $mode  HEAD $(git rev-parse --short=10 HEAD)  $(date -u +%FT%TZ)  the eight files against origin/main: ${changed:-identical}" | tee "$summary"
bad=0
[ -z "$changed" ] || bad=1
while IFS='|' read -r f want; do
  name=$(basename "$f")
  log=$out/$name.log
  s=$(date +%s)
  if [ "$mode" = leak ]; then
    BUN_DESTRUCT_VM_ON_EXIT=1 \
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
    LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$PWD/test/leaksan.supp \
    bun bd test "$f" --timeout 180000 > "$log" 2>&1 < /dev/null
  else
    bun bd test "$f" --timeout 180000 > "$log" 2>&1 < /dev/null
  fi
  rc=$?
  got=$(grep -aE '^ *[0-9]+ (pass|skip|todo|fail)$' "$log" | sed -E 's/^ +//' | tr '\n' ';' | sed 's/;$//')
  mark=ok
  [ $rc -eq 0 ] && [ "$got" = "$want" ] || { mark=FAIL; bad=1; }
  echo "$mark  $f  rc=$rc  $(( $(date +%s) - s )) s  $got  (main: $want)" | tee -a "$summary"
done <<< "$LIST"
[ $bad -eq 0 ] && echo "RESULT  the eight older files pass as on main ($mode)" | tee -a "$summary" || echo "RESULT  FAIL ($mode)" | tee -a "$summary"
exit $bad
