#!/bin/bash
# One corpus, one classifier: every surviving probe input of the parser unit against a base build of bun,
# the installed bun, tsc 6.0.2 and typescript-go 89d5d5b. Light on the machine (no build, about 25 minutes
# under load, most of it the two bun sides).
#
# usage: run.sh <base bun binary> [work dir, default /tmp/ledger-work] [stage...]
#   stages, default all in this order:
#     calls     record the Bun.Transpiler calls of the existing tests with the base binary (needs /workspace/wt/parser)
#     corpus    merge the inputs                          -> data/corpus.jsonl.gz, data/calls.all.jsonl.gz
#     bun       base binary and installed `bun`           -> data/bun.base.jsonl.gz, data/bun.installed.jsonl.gz
#     tsc       parser of tsc                             -> data/tsc.jsonl.gz
#     tsgo      parser of typescript-go (../tsgo-oracle)  -> data/tsgo.jsonl.gz
#     classify  join, checker pass, pinned tests, tables  -> out/
#     upstream  the test cases of TypeScript (12,444 tests) against the base binary, tsc and typescript-go;
#               units of tests without an error baseline that the binary rejects -> out-upstream/
# The base binary is a release build of the commit that the differential harness compares against
# (e3566be889: /workspace/notes/lint/units/parser/measure/base/bin/bun, a copy of build/release/bun of the
# clean worktree; the directory is git-ignored, rebuild it with `bun run build:release` after a restart).
# The branch under work: <its bun binary> progress.mjs <work dir> runs the 38,719 sources of class A, class B and
# of the pinned tests (18 s with a release build) and prints what changed against the saved base results:
# fixed, lost (exit 1), widened, output, message. With --all it runs the whole corpus.
set -e
BASE=${1:?usage: run.sh <base bun binary> [work dir] [stage...]}
WORK=${2:-/tmp/ledger-work}
shift || true
shift || true
STAGES=${*:-calls corpus bun tsc tsgo classify upstream}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=/workspace/wt/parser
TESTS="test/bundler/transpiler/es-decorators.test.ts test/regression/issue/27575.test.ts test/js/bun/transpiler/repl-transform.test.ts test/js/bun/resolve/lower-using-bun-target.test.ts test/js/bun/transpiler/transpiler-utf16-loader.test.ts test/js/bun/transpiler/transpiler-unsupported-loader.test.ts test/bundler/transpiler/react-compiler.test.ts test/regression/issue/03830.test.ts test/regression/issue/13251.test.ts test/js/bun/transpiler/transpiler-tsconfig-uaf.test.ts test/regression/issue/012039.test.ts test/regression/issue/14477/14477.test.ts test/js/bun/transpiler/transpiler-error-gc-uaf.test.ts test/bundler/transpiler/ts-use-define-for-class-fields.test.ts test/bundler/transpiler/scope-mismatch-panic.test.ts test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts test/regression/issue/24709.test.ts test/regression/issue/09748.test.ts test/js/bun/transpiler/transpiler-truncated-utf8.test.ts test/js/bun/transpiler/transpiler-radix-bigint.test.ts test/js/bun/resolve/import-defer.test.ts test/bundler/transpiler/ts-enum-redecl-panic.test.ts test/bundler/transpiler/decorators.test.ts"
mkdir -p "$WORK/data" "$WORK/out"
for f in "$HERE"/data/*.gz; do [ -e "$WORK/data/$(basename "$f")" ] || cp "$f" "$WORK/data/"; done
for stage in $STAGES; do
  case $stage in
    calls)
      rm -f "$WORK/calls.1.jsonl" "$WORK/calls.2.jsonl"
      (cd "$REPO" && TRANSPILER_LOG="$WORK/calls.1.jsonl" USE_SYSTEM_BUN=1 BUN_DEBUG_QUIET_LOGS=1 "$BASE" test --preload "$HERE/record-transpiler-calls.js" test/bundler/transpiler/transpiler.test.js 2>&1 | tail -6)
      (cd "$REPO" && TRANSPILER_LOG="$WORK/calls.2.jsonl" USE_SYSTEM_BUN=1 BUN_DEBUG_QUIET_LOGS=1 "$BASE" test --preload "$HERE/record-transpiler-calls.js" $TESTS 2>&1 | tail -6)
      cat "$WORK/calls.1.jsonl" "$WORK/calls.2.jsonl" | gzip -9 > "$WORK/data/calls.all.jsonl.gz"
      ;;
    corpus)
      gunzip -c "$WORK/data/calls.all.jsonl.gz" > "$WORK/calls.all.jsonl"
      "$BASE" "$HERE/build-corpus.mjs" "$WORK/corpus.jsonl" --calls="$WORK/calls.all.jsonl"
      gzip -9 -c "$WORK/corpus.jsonl" > "$WORK/data/corpus.jsonl.gz"
      ;;
    bun)
      [ -e "$WORK/corpus.jsonl" ] || gunzip -c "$WORK/data/corpus.jsonl.gz" > "$WORK/corpus.jsonl"
      "$BASE" "$HERE/bun-side.mjs" "$WORK/corpus.jsonl" "$WORK/data/bun.base.jsonl.gz" --jobs=4
      bun "$HERE/bun-side.mjs" "$WORK/corpus.jsonl" "$WORK/data/bun.installed.jsonl.gz" --jobs=4
      ;;
    tsc)
      [ -e "$WORK/corpus.jsonl" ] || gunzip -c "$WORK/data/corpus.jsonl.gz" > "$WORK/corpus.jsonl"
      "$BASE" "$HERE/tsc-side.mjs" "$WORK/corpus.jsonl" "$WORK/data/tsc.jsonl.gz"
      ;;
    tsgo)
      [ -e "$WORK/corpus.jsonl" ] || gunzip -c "$WORK/data/corpus.jsonl.gz" > "$WORK/corpus.jsonl"
      [ -x /tmp/rr/parsediag ] || bash "$HERE/../tsgo-oracle/build.sh" /tmp/rr
      "$BASE" "$HERE/tsgo-side.mjs" "$WORK/corpus.jsonl" "$WORK/data/tsgo.jsonl.gz"
      ;;
    classify)
      "$BASE" "$HERE/join.mjs" "$WORK/data" "$WORK/out"
      "$BASE" "$HERE/check.mjs" "$WORK/out"
      "$BASE" "$HERE/bun-side.mjs" "$WORK/out/a-emit.jsonl" "$WORK/out/a-emit.bun.jsonl.gz" --jobs=2 --configs=js,jsx
      "$BASE" "$HERE/pinned.mjs" "$WORK/data/calls.all.jsonl.gz" "$WORK/pinned.jsonl" "$REPO"
      "$BASE" "$HERE/report.mjs" "$WORK/data" "$WORK/out" "$WORK/pinned.jsonl"
      "$BASE" "$HERE/first-codes.mjs" "$WORK/data" "$WORK/out"
      ;;
    upstream)
      mkdir -p "$WORK/up"
      [ -x /tmp/rr/parsediag ] || bash "$HERE/../tsgo-oracle/build.sh" /tmp/rr
      "$BASE" "$HERE/upstream-corpus.mjs" build "$WORK/up/upstream.jsonl"
      "$BASE" "$HERE/bun-side.mjs" "$WORK/up/upstream.jsonl" "$WORK/up/bun.base.jsonl.gz" --jobs=4
      "$BASE" "$HERE/tsc-side.mjs" "$WORK/up/upstream.jsonl" "$WORK/up/tsc.jsonl.gz"
      "$BASE" "$HERE/tsgo-side.mjs" "$WORK/up/upstream.jsonl" "$WORK/up/tsgo.jsonl.gz"
      "$BASE" "$HERE/upstream-corpus.mjs" report "$WORK/up/upstream.jsonl" "$WORK/up/bun.base.jsonl.gz" "$WORK/up/tsc.jsonl.gz" "$WORK/up/tsgo.jsonl.gz" "$WORK/out-upstream"
      ;;
    *)
      echo "unknown stage $stage"
      exit 2
      ;;
  esac
done
