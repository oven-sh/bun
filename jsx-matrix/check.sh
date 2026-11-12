#!/bin/bash
# Checks of the JSX configuration change. Run after `bun bd`.
# usage: [STAGE=a|b] [PARTS="unit matrix special suites"] bash check.sh
M=/workspace/jsx-matrix
REPO=/workspace/bun
BUN=$REPO/build/debug/bun-debug
STAGE="${STAGE:-b}"
PARTS="${PARTS:-unit matrix special suites}"
fail=0
part() { if [ "$2" = 0 ]; then echo "PASS  $1"; else echo "FAIL  $1 (exit $2)"; fail=1; fi; }
cd "$REPO" || exit 2

if [[ " $PARTS " == *" unit "* ]]; then
  for spec in "bun_options_types jsx" "bun_resolver jsx" "bun_bundler jsx" "bun_sema config"; do
    set -- $spec
    out=$(cargo test -p "$1" --lib "$2" 2>&1); st=$?
    echo "$out" | grep -E "^test result|FAILED|panicked|error(\[|:)" | head -12
    part "cargo test -p $1 --lib $2" "$st"
  done
fi

if [[ " $PARTS " == *" matrix "* ]]; then
  "$M/bun-main" "$M/matrix.ts" "$BUN" "$M/pr.jsonl" --conc=6 --root="$M/fx-pr" | tail -1
  python3 "$M/diff.py" "$M/main.jsonl" "$M/pr.jsonl" --stage="$STAGE" --show=12
  part "matrix, stage $STAGE" "$?"
fi

if [[ " $PARTS " == *" special "* ]]; then
  "$M/bun-main" "$M/special.ts" "$BUN" "$M/pr-special.jsonl" --conc=6 --root="$M/fx-special-pr" | tail -1
  if [ "$STAGE" = b ]; then twin="--twin=$M/main-special-twin.jsonl"; else twin=""; fi
  python3 "$M/diff.py" "$M/main-special.jsonl" "$M/pr-special.jsonl" --stage="$STAGE" $twin --show=12
  part "special matrix, stage $STAGE" "$?"
fi

if [[ " $PARTS " == *" suites "* ]]; then
  for t in \
    test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts \
    test/bundler/bundler_jsx.test.ts \
    test/bundler/esbuild/tsconfig.test.ts \
    test/bundler/transpiler/jsx-production.test.ts \
    test/js/bun/transpiler/transpiler-tsconfig-uaf.test.ts \
    test/cli/run/tsconfig-override.test.ts \
    test/cli/test/parallel.test.ts \
    test/bundler/bundler_compile_autoload.test.ts \
    test/aot/build-flags.test.ts \
    test/aot/jsx-and-decorators-by-working-directory.test.ts; do
    out=$(AOT_PROGRAMS_JOBS=3 BUN_DEBUG_QUIET_LOGS=1 "$BUN" test "$t" --timeout 180000 2>&1); st=$?
    echo "$out" | grep -E "^\s*[0-9]+ (pass|fail|skip)|^\(fail\)" | head -12
    part "bun test $t" "$st"
  done
fi
[ "$fail" = 0 ] && echo "ALL CHECKS PASS" || echo "CHECKS FAILED"
exit $fail
