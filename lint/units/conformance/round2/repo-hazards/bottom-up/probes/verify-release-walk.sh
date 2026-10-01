#!/bin/bash
# Under the lock, for the third form of the describe("repository") (the walk of every name only in a release build):
# alone under the release build, the mutations of the scratch clone, alone under the debug build with the leak check
# of CI, then the whole conformance.test.ts with the describe in it under both builds.
set -uo pipefail
cd /tmp/rh1a/repo || exit 1
out=/tmp/rh1a/observed-v3
mkdir -p "$out"
H=test/cli/lint/conformance
file=./test/cli/lint/repository-candidate.test.ts
dbg=/workspace/wt/conformance/build/debug/bun-debug
leak() { env BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 \
  ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
  LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/tmp/rh1a/repo/test/leaksan.supp "$@"; }
echo "got the lock $(date -u +%H:%M:%S), loadavg $(cat /proc/loadavg)"
cp /tmp/rh1a/candidate.v3.formatted.ts "$file"
run() {
  (CI=true USE_SYSTEM_BUN=1 bun test "$file" > "$out/mutation-$1.log" 2>&1; echo "exit $?" >> "$out/mutation-$1.log")
  echo "-- $1: $(grep -E '^ *[0-9]+ (pass|fail|skip)|^exit' "$out/mutation-$1.log" | tr '\n' ' ')"
  grep -E '^\(fail\)|^error: ' "$out/mutation-$1.log" | cut -c1-200 | head -6
}
run m0-unchanged
grep -E '^\((pass|fail|skip)\)' "$out/mutation-m0-unchanged.log"
: > $H/corpus/cases/compiler/zz.test.ts; run m1-a-case-named-dot-test; rm $H/corpus/cases/compiler/zz.test.ts
mkdir -p $H/corpus/cases/conformance/js/node/test/parallel; : > $H/corpus/cases/conformance/js/node/test/parallel/a.ts; run m2-a-directory-of-node-tests; rm -r $H/corpus/cases/conformance/js
: > $H/corpus/cases/compiler/zz_test.ts; run m3-a-case-named-underscore-test; rm $H/corpus/cases/compiler/zz_test.ts
cp scripts/runner.node.ts /tmp/rh1a/runner.node.ts.keep
sed -i '/^function isTestStrict/,/^}/ s#/\\.test|spec\\./#/\\.test|spec\\.|Test/#' scripts/runner.node.ts; run m4-the-runner-takes-more-names; cp /tmp/rh1a/runner.node.ts.keep scripts/runner.node.ts
sed -i 's/^function isHidden(/function isHiddenPath(/' scripts/runner.node.ts; run m5-a-function-of-the-runner-is-renamed; cp /tmp/rh1a/runner.node.ts.keep scripts/runner.node.ts
mv $H/corpus/cases /tmp/rh1a/cases.away; run m6-the-cases-are-not-there; mv /tmp/rh1a/cases.away $H/corpus/cases
printf '!*\n' > $H/corpus/.gitignore; run m7-a-dot-file-directly-in-corpus; rm $H/corpus/.gitignore
mkdir -p $H/corpus/cases/conformance/node_modules; : > $H/corpus/cases/conformance/node_modules/x.ts; run m8-a-directory-that-the-walk-leaves-out; rm -r $H/corpus/cases/conformance/node_modules
cp src/runtime/cli/test/Scanner.rs /tmp/rh1a/Scanner.rs.keep
sed -i 's/^pub(crate) const TEST_NAME_SUFFIXES: \[&\[u8\]; 4\] = \[b".test", b"_test", b".spec", b"_spec"\];/pub(crate) const TEST_NAME_SUFFIXES: [\&[u8]; 5] = [b".test", b"_test", b".spec", b"_spec", b"test"];/' src/runtime/cli/test/Scanner.rs; run m9-bun-test-takes-more-names; cp /tmp/rh1a/Scanner.rs.keep src/runtime/cli/test/Scanner.rs
git status --porcelain -- scripts src $H/corpus | head -5
for k in 1 2; do
  echo "== alone, debug build with the leak check of CI, run $k $(date -u +%H:%M:%S)"
  ( time leak env CI=true "$dbg" test "$file" > "$out/alone-debug-leak-$k.log" 2>&1; echo "exit $?" >> "$out/alone-debug-leak-$k.log" ) 2>&1 | grep real
  grep -E '^\((pass|fail|skip)\)|^ *[0-9]+ (pass|fail|skip)|^Ran |^exit' "$out/alone-debug-leak-$k.log"
done
echo "== whole file with the describe in it"
git checkout -q -- test/cli/lint/conformance.test.ts
sed -i 's|^import { dirname, join } from "node:path";$|import { basename, dirname, extname, join, relative, sep } from "node:path";|' test/cli/lint/conformance.test.ts
line=$(grep -n '^describe("directives", () => {$' test/cli/lint/conformance.test.ts | cut -d: -f1)
{ head -n $((line - 1)) test/cli/lint/conformance.test.ts; cat /tmp/rh1a/describe.final.v3.ts; echo; tail -n +$line test/cli/lint/conformance.test.ts; } > /tmp/rh1a/t.new
cat /tmp/rh1a/t.new > test/cli/lint/conformance.test.ts
git diff --stat -- test/cli/lint/conformance.test.ts | tail -1
echo "== whole file, release build $(date -u +%H:%M:%S)"
( time env USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts > "$out/whole-release.log" 2>&1; echo "exit $?" >> "$out/whole-release.log" ) 2>&1 | grep real
grep -E 'repository >|^ *[0-9]+ (pass|fail|skip)|^Ran |^exit|^\(fail\)' "$out/whole-release.log" | sort -u
echo "== whole file, debug build with the leak check of CI $(date -u +%H:%M:%S)"
( time leak "$dbg" test test/cli/lint/conformance.test.ts > "$out/whole-debug-leak.log" 2>&1; echo "exit $?" >> "$out/whole-debug-leak.log" ) 2>&1 | grep real
grep -E 'repository >|^ *[0-9]+ (pass|fail|skip)|^Ran |^exit|^\(fail\)' "$out/whole-debug-leak.log" | sort -u
echo "sanitizer reports: $(grep -c 'LeakSanitizer\|AddressSanitizer' "$out/whole-debug-leak.log")"
echo "done $(date -u +%H:%M:%S)"
