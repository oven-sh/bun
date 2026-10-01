#!/bin/sh
# Existing test files with every parse of the process as the lint parse pass (release binary with the switch), against the same binary without it.
X=/tmp/a3-seam/link/exp/bun-profile
O=/tmp/a3-seam/suite
cd /workspace/wt/parser
echo "lock acquired $(date -u +%H:%M:%S)"
for t in test/bundler/transpiler/transpiler.test.js test/bundler/transpiler/decorators.test.ts test/bundler/transpiler/decorator-metadata.test.ts test/bundler/esbuild/ts.test.ts test/js/bun/typescript/type-export.test.ts; do
  n=$(basename $t)
  s=$(date +%s)
  CI=true BUN_DEBUG_QUIET_LOGS=1 timeout 900 $X test $t > $O/$n.normal.out 2>&1; a=$?
  CI=true BUN_DEBUG_QUIET_LOGS=1 BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT=1 timeout 900 $X test $t > $O/$n.lint.out 2>&1; b=$?
  echo "$n: normal rc=$a [$(grep -E '^ *[0-9]+ (pass|fail)' $O/$n.normal.out | tr -s ' \n' ' ')] lint rc=$b [$(grep -E '^ *[0-9]+ (pass|fail)' $O/$n.lint.out | tr -s ' \n' ' ')] $(( $(date +%s) - s ))s"
done
git -C /workspace/wt/parser status --short | head -5
echo "done $(date -u +%H:%M:%S)"
