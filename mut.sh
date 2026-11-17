#!/bin/bash
# mut.sh <n...> : runs the tests of the fix with mutation n and prints which tests fail.
cd /workspace/bun
for n in "$@"; do
  fails=""
  for spec in "test/js/bun/test/expect.test.js|when the match fails" "test/js/bun/test/vitest-apis.test.ts|a toMatchObject that fails" "test/js/bun/test/expect-deferred.test.ts|" "test/aot/a-match-that-failed-asks-the-matchers-beside-a-private-field-that-differs.test.ts|"; do
    f=${spec%%|*}; t=${spec##*|}
    if [ -n "$t" ]; then out=$(BUN_MUT=$n BUN_DEBUG_QUIET_LOGS=1 timeout 900 ./build/debug/bun-debug test "$f" -t "$t" 2>&1); else out=$(BUN_MUT=$n BUN_DEBUG_QUIET_LOGS=1 timeout 900 ./build/debug/bun-debug test "$f" 2>&1); fi
    code=$?
    names=$(echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^\(fail\)" | sed -E 's/^\(fail\) .* > //; s/ \[[0-9.]+ms\]$//' | sort -u | tr '\n' ';')
    [ $code -ne 0 ] && fails="$fails [$(basename $f) exit=$code: ${names:-no (fail) line}]"
  done
  echo "MUT $n: ${fails:- NO TEST FAILED}"
done
