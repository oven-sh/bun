#!/bin/bash
# Runs the test files that exercise the matcher walk on the debug build and prints one summary line per file.
cd /workspace/bun
for f in \
  test/js/bun/test/expect.test.js \
  test/js/bun/test/vitest-apis.test.ts \
  test/js/bun/test/expect-deferred.test.ts \
  test/js/bun/bun-object/deep-match.spec.ts \
  test/js/bun/test/vitest-flavor.test.ts \
  test/js/bun/test/printing/dom-nodes.test.ts \
  test/js/bun/test/printing/diffexample.test.ts \
  test/js/bun/test/snapshot-tests/bun-snapshots.test.ts \
  test/js/bun/test/jest-extended.test.js \
  test/js/bun/test/expect-extend.test.js \
  test/js/bun/test/spyMatchers.test.ts \
  test/js/bun/test/mock-fn.test.js \
  test/js/bun/test/snapshot-tests/snapshots/snapshot.test.ts \
  test/aot/a-match-that-failed-asks-the-matchers-beside-a-private-field-that-differs.test.ts \
  test/cli/test/test-aot-deep-equality.test.ts ; do
  if [ ! -f "$f" ]; then echo "MISSING $f"; continue; fi
  out=$(env BUN_DEBUG_QUIET_LOGS=1 FORCE_COLOR=1 $EXTRA_ENV timeout 1700 ./build/debug/bun-debug test "$f" $EXTRA_ARGS 2>&1)
  code=$?
  summary=$(echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ *[0-9]+ (pass|fail|skip|todo)" | tr '\n' ' ')
  echo "exit=$code $f :: $summary"
  if [ $code -ne 0 ]; then echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^\(fail\)|error:|panic|ASSERT" | head -20; fi
done
echo DONE
