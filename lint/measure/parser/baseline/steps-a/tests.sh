#!/bin/sh
# usage: tests.sh plain|leak   runs the twelve files of the parser unit with the debug build of /workspace/wt/parser, one after another
mode="$1"
out=/workspace/notes/lint/measure/parser/baseline/tests-$mode-a
mkdir -p "$out"
cd /workspace/wt/parser || exit 9
: > "$out/summary.txt"
echo "# HEAD $(git rev-parse --short=10 HEAD) dirty=[$(git status --porcelain --untracked-files=no | tr '\n' ';')] $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)" >> "$out/summary.txt"
run() {
  f="$1"; log="$2"; shift 2
  if [ "$mode" = leak ]; then
    BUN_DESTRUCT_VM_ON_EXIT=1 \
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
    LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$PWD/test/leaksan.supp \
    bun bd test "$f" "$@" > "$log" 2>&1
  else
    bun bd test "$f" "$@" > "$log" 2>&1
  fi
}
sum() { grep -aE '^ *[0-9]+ (pass|fail|skip|todo)$|^Ran [0-9]+ tests|expect\(\) calls' "$1" | tr -s ' ' | tr '\n' ';'; }
all=0
for f in \
  test/bundler/transpiler/typescript-grammar.test.ts \
  test/bundler/transpiler/typescript-grammar-expressions.test.ts \
  test/bundler/transpiler/typescript-grammar-statements.test.ts \
  test/bundler/transpiler/typescript-grammar-decorator-metadata.test.ts \
  test/bundler/transpiler/decorator-metadata.test.ts \
  test/bundler/transpiler/decorators.test.ts \
  test/bundler/transpiler/transpiler-stack-overflow.test.ts \
  test/bundler/transpiler/transpiler.test.js \
  test/bundler/bundler_decorator_metadata.test.ts \
  test/bundler/esbuild/ts.test.ts \
  test/js/bun/typescript/type-export.test.ts \
  test/cli/run/transpiler-cache.test.ts
do
  name=$(basename "$f")
  s=$(date +%s)
  run "$f" "$out/$name.log"; rc=$?
  echo "$mode $f rc=$rc secs=$(( $(date +%s) - s )) :: $(sum "$out/$name.log")" >> "$out/summary.txt"
  if [ $rc -ne 0 ]; then
    all=1
    s=$(date +%s)
    run "$f" "$out/$name.timeout180000.log" --timeout 180000; rc2=$?
    echo "$mode $f --timeout 180000 rc=$rc2 secs=$(( $(date +%s) - s )) timed_out_lines_first_run=$(grep -ac 'timed out after' "$out/$name.log") :: $(sum "$out/$name.timeout180000.log")" >> "$out/summary.txt"
  fi
done
echo "# end $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)" >> "$out/summary.txt"
exit $all
