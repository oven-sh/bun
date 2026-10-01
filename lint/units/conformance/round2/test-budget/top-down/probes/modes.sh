#!/usr/bin/env bash
# The ways in which test/cli/lint/conformance.test.ts must pass, each as one function: source this file, then call
#   run_mode <mode> <tree> <log> [more arguments of `bun test`]
# It runs the file of <tree> (a scratch clone of ../../scratch.sh, or the worktree) and appends to <log> the lines
# "TIME wall .. user .. sys .." and "exit <code>". The binary of the debug modes is DBG (default: the build of the worktree).
#   release          USE_SYSTEM_BUN=1 bun test <file>                       the installed release build, as CLAUDE.md says
#   release-ci       the environment that scripts/runner.node.ts gives a file in a release lane of CI (spawnBun, 1966 to
#                    1990; spawnBunTest, 2171): --timeout=90000, collector level 1, integrity audit, no transpiler cache
#   release-ci-exact release-ci with GITHUB_ACTIONS=true and --reporter=dots, the very command line of spawnBunTest
#   debug            BUN_DEBUG_QUIET_LOGS=1 bun-debug test <file>           what `bun bd test <file>` runs after the build
#   debug-leak       debug with the leak check of CI (runner.node.ts 2201 to 2206)
#   debug-ci         debug-leak with the exception checks (2197 to 2199), no orphans (2212), the environment of spawnBun
#                    and --timeout=270000: the ASAN lane of CI, with the debug build standing in for bun-asan
#   debug-local      what `bun run test` (runner.node.ts with --exec-path bun-debug, not in CI) gives: as debug-ci,
#                    but --timeout=90000, because the name of the binary has no "asan" in it
DBG=${DBG:-/workspace/wt/conformance/build/debug/bun-debug}
FILE=${FILE:-test/cli/lint/conformance.test.ts}
TIMEFORMAT='TIME wall %R s user %U s sys %S s'

run_mode() {
  local mode=$1 tree=$2 log=$3
  shift 3
  local tmp
  tmp=$(mktemp -d /tmp/buntmp-XXXXXX)
  local ci=(BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_DEBUG_QUIET_LOGS=1 BUN_DISABLE_SLOW_FILESYSTEM_WARNING=1
    BUN_GARBAGE_COLLECTOR_LEVEL=1 BUN_JSC_randomIntegrityAuditRate=1.0 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
    BUN_ENABLE_CRASH_REPORTING=0 FORCE_COLOR=1 "TMPDIR=$tmp" "BUN_TMPDIR=$tmp" "BUN_INSTALL_CACHE_DIR=$tmp" "TEST_TMPDIR=$tmp")
  local leak=(BUN_DESTRUCT_VM_ON_EXIT=1
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1
    "LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$tree/test/leaksan.supp")
  local validate=(BUN_JSC_validateExceptionChecks=1 BUN_JSC_dumpSimulatedThrows=1)
  (
    cd "$tree" || exit 1
    case $mode in
      release) { time env USE_SYSTEM_BUN=1 bun test "$@" "$FILE"; } ;;
      release-ci) { time env "${ci[@]}" bun test --timeout=90000 "$@" "$FILE"; } ;;
      release-ci-exact) { time env "${ci[@]}" GITHUB_ACTIONS=true bun test --timeout=90000 --reporter=dots "$@" "$FILE"; } ;;
      debug) { time env BUN_DEBUG_QUIET_LOGS=1 "$DBG" test "$@" "$FILE"; } ;;
      debug-leak) { time env BUN_DEBUG_QUIET_LOGS=1 "${leak[@]}" "$DBG" test "$@" "$FILE"; } ;;
      debug-ci) { time env "${ci[@]}" "${leak[@]}" "${validate[@]}" BUN_FEATURE_FLAG_NO_ORPHANS=1 "$DBG" test --timeout=270000 "$@" "$FILE"; } ;;
      debug-local) { time env "${ci[@]}" "${leak[@]}" "${validate[@]}" "$DBG" test --timeout=90000 "$@" "$FILE"; } ;;
      *) echo "no mode $mode"; exit 2 ;;
    esac
    echo "exit $?"
  ) > "$log" 2>&1
  rm -rf "$tmp"
}

# One line of a log: the counts, the runner's own time, wall, user, sys, the exit code, and how often a sanitizer spoke.
summary() {
  local label=$1 log=$2 plain
  plain=$(sed -E 's/\x1b\[[0-9;]*m//g' "$log")
  echo "$label load $(cut -d' ' -f1 /proc/loadavg): $(grep -aE '^ *[0-9]+ (pass|fail|skip)' <<< "$plain" | tr -s ' \n' ' ')$(grep -aE '^Ran ' <<< "$plain") $(grep -a '^TIME' <<< "$plain") $(grep -a '^exit ' <<< "$plain") sanitizer-lines $(grep -acE 'LeakSanitizer|AddressSanitizer|Unchecked JS exception|ERROR: ' <<< "$plain")"
}

# The tests of a log that took longest, and every test that failed.
slowest() {
  local log=$1 n=${2:-12} plain
  plain=$(sed -E 's/\x1b\[[0-9;]*m//g' "$log")
  grep -aE '^(\((pass|fail)\)|✓|✗) ' <<< "$plain" | awk '{ t=$NF; gsub(/[\[\]ms]/, "", t); print t "\t" $0 }' | sort -rn | head -"$n" | cut -f2- | cut -c1-200
  grep -aE '^\(fail\)|^✗|^error:' <<< "$plain" | cut -c1-300 | head -20
}
