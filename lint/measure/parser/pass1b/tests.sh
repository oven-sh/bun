#!/bin/bash
# usage: tests.sh <plain|leak>; the twelve files of parser.md P1.6 + the four typescript-grammar files, one bun bd test each
mode=$1
cd /workspace/wt/parser || exit 9
ulimit -c 0
O=/tmp/pbb1b/logs/tests-$mode; mkdir -p $O; : > $O/summary.txt
FILES="test/bundler/transpiler/typescript-grammar.test.ts
test/bundler/transpiler/typescript-grammar-expressions.test.ts
test/bundler/transpiler/typescript-grammar-statements.test.ts
test/bundler/transpiler/typescript-grammar-decorator-metadata.test.ts
test/bundler/transpiler/decorator-metadata.test.ts
test/bundler/bundler_decorator_metadata.test.ts
test/bundler/transpiler/decorators.test.ts
test/bundler/transpiler/transpiler-stack-overflow.test.ts
test/bundler/esbuild/ts.test.ts
test/cli/run/transpiler-cache.test.ts
test/js/bun/typescript/type-export.test.ts
test/bundler/transpiler/transpiler.test.js"
run() {
  # $1 = log, rest = extra args after the file
  local log=$1; shift
  if [ "$mode" = leak ]; then
    BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$PWD/test/leaksan.supp bun bd test "$@" > "$log" 2>&1
  else
    bun bd test "$@" > "$log" 2>&1
  fi
}
overall=0
for f in $FILES; do
  n=$(basename $f)
  s=$(date +%s)
  run $O/$n.log $f; rc=$?
  echo "$mode $n rc=$rc $(( $(date +%s) - s ))s | $(grep -aE '^ *[0-9]+ (pass|fail|skip|todo)$|^Ran ' $O/$n.log | tr -s ' ' | tr '\n' ';')" | tee -a $O/summary.txt
  if [ $rc -ne 0 ]; then
    s=$(date +%s)
    run $O/$n.timeout180.log $f --timeout 180000; rc2=$?
    echo "$mode $n --timeout 180000 rc=$rc2 $(( $(date +%s) - s ))s | $(grep -aE '^ *[0-9]+ (pass|fail|skip|todo)$|^Ran ' $O/$n.timeout180.log | tr -s ' ' | tr '\n' ';')" | tee -a $O/summary.txt
    [ $rc2 -ne 0 ] && overall=1
  fi
done
exit $overall
