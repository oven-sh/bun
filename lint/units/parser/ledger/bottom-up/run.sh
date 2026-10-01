#!/bin/bash
# The whole ledger pipeline of this directory, stage by stage. No build of bun is started.
#
# usage: run.sh <bun binary under test> [work dir, default /tmp/ledger-bu/run] [stage...]
#   stages, default "corpus stage1 stage2 report metadata":
#     oracle    build the parse oracle of typescript-go when <go work dir>/parsediag-bu is missing (tsgo-oracle/build.sh)
#     pins      record the Bun.Transpiler calls and itBundled files of the existing tests with the binary
#               (needs /workspace/wt/parser; writes pins/recorded/*.jsonl.gz)
#     corpus    merge every surviving input into <work dir>/corpus.jsonl (corpus/build-corpus.mjs); without this
#               stage the saved corpus/corpus.jsonl.gz is unpacked
#     stage1    bun side, tsc parse diagnostics, typescript-go parse diagnostics   (about 2 minutes, release build)
#     stage2    checker codes and JavaScript check for set A                        (about 4 minutes)
#     report    tables into <work dir>/out
#     metadata  decorator metadata of the binary against tsc                        (about 1 minute)
#     progress  compare the verdicts of the binary with the saved table of the base (corpus/out/table.jsonl.gz)
# The base of every saved table is the release build of e3566be889 (sha256 62ee58fa...), kept git-ignored in
# /workspace/notes/lint/units/parser/measure/base/bin/bun. With a debug build run only: run.sh <bun-debug> <dir> focus
# ("focus": bun side alone over corpus.focus.jsonl.gz, then progress).
set -e
BIN=${1:?usage: run.sh <bun binary> [work dir] [stage...]}
WORK=${2:-/tmp/ledger-bu/run}
shift || true
shift || true
STAGES=${*:-corpus stage1 stage2 report metadata}
HERE=$(cd "$(dirname "$0")" && pwd)
GO=${LEDGER_GO_DIR:-/tmp/rr}
JOBS=${LEDGER_JOBS:-6}
export BUN_ENABLE_CRASH_REPORTING=0 BUN_DEBUG_QUIET_LOGS=1
mkdir -p "$WORK"
unpack() { [ -f "$WORK/$1" ] || gunzip -c "$HERE/corpus/$1.gz" > "$WORK/$1"; }
for stage in $STAGES; do
  case $stage in
    oracle)
      [ -x "$GO/parsediag-bu" ] || bash "$HERE/tsgo-oracle/build.sh" "$GO" "$GO/parsediag-bu"
      ;;
    pins)
      mkdir -p "$WORK/pins" "$HERE/pins/recorded"
      for t in test/bundler/transpiler/transpiler.test.js test/bundler/transpiler/decorators.test.ts test/bundler/transpiler/es-decorators.test.ts \
        test/bundler/transpiler/ts-enum-redecl-panic.test.ts test/bundler/transpiler/ts-use-define-for-class-fields.test.ts \
        test/bundler/transpiler/scope-mismatch-panic.test.ts test/bundler/transpiler/jsx-tsconfig-react-jsx.test.ts \
        test/bundler/transpiler/react-compiler.test.ts test/js/bun/transpiler/repl-transform.test.ts test/js/bun/resolve/import-defer.test.ts \
        test/js/bun/resolve/lower-using-bun-target.test.ts test/regression/issue/012039.test.ts test/regression/issue/03830.test.ts \
        test/regression/issue/09748.test.ts test/regression/issue/13251.test.ts test/regression/issue/14477/14477.test.ts \
        test/regression/issue/24709.test.ts test/regression/issue/27575.test.ts test/bundler/transpiler/decorator-metadata.test.ts \
        test/js/bun/typescript/type-export.test.ts; do
        n=$(echo "$t" | sed 's|/|__|g')
        rm -f "$WORK/pins/$n.jsonl"
        (cd /workspace/wt/parser && USE_SYSTEM_BUN=1 PIN_LOG="$WORK/pins/$n.jsonl" "$BIN" test --preload "$HERE/pins/record-pins.js" --timeout 180000 "$t" > "$WORK/pins/$n.log" 2>&1) || true
      done
      for t in test/bundler/esbuild/ts.test.ts test/bundler/bundler_decorator_metadata.test.ts; do
        n=$(echo "$t" | sed 's|/|__|g')
        rm -f "$WORK/pins/$n.jsonl"
        (cd /workspace/wt/parser && USE_SYSTEM_BUN=1 PIN_LOG="$WORK/pins/$n.jsonl" PIN_EXPECT_BUNDLED=/workspace/wt/parser/test/bundler/expectBundled.ts \
          "$BIN" test --preload "$HERE/pins/record-pins.js" --timeout 180000 "$t" > "$WORK/pins/$n.log" 2>&1) || true
      done
      for f in "$WORK"/pins/*.jsonl; do [ -s "$f" ] && gzip -9 -c "$f" > "$HERE/pins/recorded/$(basename "$f").gz"; done
      ;;
    corpus)
      bun "$HERE/corpus/build-corpus.mjs" --out "$WORK/corpus.jsonl"
      ;;
    stage1)
      unpack corpus.jsonl
      "$BIN" "$HERE/corpus/classify.mjs" stage1 "$WORK/corpus.jsonl" "$WORK/full" --jobs "$JOBS" $([ -x "$GO/parsediag-bu" ] && echo --tsgo "$GO/parsediag-bu")
      ;;
    stage2)
      "$BIN" "$HERE/corpus/classify.mjs" stage2 "$WORK/corpus.jsonl" "$WORK/full" --jobs "$JOBS"
      ;;
    report)
      bun "$HERE/corpus/report.mjs" "$WORK/corpus.jsonl" "$WORK/full" "$WORK/out"
      ;;
    metadata)
      "$BIN" "$HERE/corpus/metadata.mjs" "$WORK/corpus.jsonl" "$WORK/full" "$WORK/out"
      ;;
    progress)
      unpack corpus.jsonl
      [ -f "$WORK/full/bun.0.jsonl" ] || "$BIN" "$HERE/corpus/classify.mjs" stage1 "$WORK/corpus.jsonl" "$WORK/full" --jobs "$JOBS" --only bun
      bun "$HERE/corpus/progress.mjs" "$WORK/corpus.jsonl" "$WORK/full" "$HERE/corpus/out/table.jsonl.gz"
      ;;
    focus)
      unpack corpus.focus.jsonl
      "$BIN" "$HERE/corpus/classify.mjs" stage1 "$WORK/corpus.focus.jsonl" "$WORK/focus" --jobs "$JOBS" --only bun
      bun "$HERE/corpus/progress.mjs" "$WORK/corpus.focus.jsonl" "$WORK/focus" "$HERE/corpus/out/table.jsonl.gz"
      ;;
    *)
      echo "unknown stage: $stage" >&2
      exit 2
      ;;
  esac
done
