#!/bin/bash
# Under the lock: mutations of the scratch clone against the describe("repository") alone (release build), then the whole
# conformance.test.ts with the describe in it under the release build and under the debug build with the leak check of CI.
set -uo pipefail
cd /tmp/rh1a/repo || exit 1
out=/tmp/rh1a/observed
mkdir -p "$out"
H=test/cli/lint/conformance
file=./test/cli/lint/repository-candidate.test.ts
dbg=/workspace/wt/conformance/build/debug/bun-debug
echo "got the lock $(date -u +%H:%M:%S), loadavg $(cat /proc/loadavg)"
run() { # name: runs the candidate, keeps its output, prints the summary lines
  (CI=true USE_SYSTEM_BUN=1 bun test "$file" > "$out/mutation-$1.log" 2>&1; echo "exit $?" >> "$out/mutation-$1.log")
  echo "-- $1: $(grep -E '^ *[0-9]+ (pass|fail)|^exit' "$out/mutation-$1.log" | tr '\n' ' ')"
  grep -E '^\(fail\)|^error: ' "$out/mutation-$1.log" | cut -c1-220 | head -6
}
run m0-unchanged
: > $H/corpus/cases/compiler/zz.test.ts; run m1-a-case-named-dot-test; rm $H/corpus/cases/compiler/zz.test.ts
mkdir -p $H/corpus/cases/conformance/js/node/test/parallel; : > $H/corpus/cases/conformance/js/node/test/parallel/a.ts; run m2-a-directory-of-node-tests; rm -r $H/corpus/cases/conformance/js
: > $H/corpus/cases/compiler/zz_test.ts; run m3-a-case-named-underscore-test; rm $H/corpus/cases/compiler/zz_test.ts
cp scripts/runner.node.ts /tmp/rh1a/runner.node.ts.keep
sed -i '/^function isTestStrict/,/^}/ s#/\\.test|spec\\./#/\\.test|spec\\.|Test/#' scripts/runner.node.ts; git diff --stat -- scripts/runner.node.ts | tail -1; run m4-the-runner-takes-more-names; cp /tmp/rh1a/runner.node.ts.keep scripts/runner.node.ts
sed -i 's/^function isHidden(/function isHiddenPath(/' scripts/runner.node.ts; run m5-a-function-of-the-runner-is-renamed; cp /tmp/rh1a/runner.node.ts.keep scripts/runner.node.ts
mv $H/corpus/cases /tmp/rh1a/cases.away; run m6-the-cases-are-not-there; mv /tmp/rh1a/cases.away $H/corpus/cases
printf '!*\n' > $H/corpus/.gitignore; run m7-a-dot-file-directly-in-corpus; rm $H/corpus/.gitignore
mkdir -p $H/corpus/cases/conformance/node_modules; : > $H/corpus/cases/conformance/node_modules/x.ts; run m8-a-directory-that-the-walk-leaves-out; rm -r $H/corpus/cases/conformance/node_modules
git status --porcelain | grep -v 'repository-candidate\|conformance.test.ts\|runner/\|sweep.ts\|expectations.json' | head -5
echo "== whole file, release build $(date -u +%H:%M:%S)"
( time env USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts > "$out/whole-release.log" 2>&1; echo "exit $?" >> "$out/whole-release.log" ) 2>&1 | grep real
grep -E 'repository >|^ *[0-9]+ (pass|fail|skip)|^Ran |^exit' "$out/whole-release.log"
echo "== whole file, debug build with the leak check of CI $(date -u +%H:%M:%S)"
( time env BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 \
  ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
  LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/rh1a/repo/test/leaksan.supp \
  "$dbg" test test/cli/lint/conformance.test.ts > "$out/whole-debug-leak.log" 2>&1; echo "exit $?" >> "$out/whole-debug-leak.log" ) 2>&1 | grep real
grep -E 'repository >|^ *[0-9]+ (pass|fail|skip)|^Ran |^exit' "$out/whole-debug-leak.log"
echo "sanitizer reports: $(grep -c 'LeakSanitizer\|AddressSanitizer' "$out/whole-debug-leak.log")"
echo "done $(date -u +%H:%M:%S)"
