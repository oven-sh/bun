#!/bin/bash
# The closing gates of the parser unit, one step per call, each with its log under $OUT.
# usage: /workspace/tools/lk bash gates.sh <step>      (give the call a timeout of 3600000 ms; `commentcop`, `audit` and `surface` need no lock)
# steps, in the order of the final report:
#   check clippy fmt commentcop cargotest miri tests-plain tests-leak release a1 cg symsizes sizes audit surface source-lints
# env: WT (worktree), OUT (log directory), BASE_REV, M (directory of the two release builds), GD (the differential harness)
set -u
WT=${WT:-/workspace/wt/parser}
N=/workspace/notes/lint/units/parser
M=${M:-/workspace/notes/lint/measure/parser}
OUT=${OUT:-$M/final}
BASE_REV=${BASE_REV:-e3566be889}
GD=${GD:-$N/grammar-diff}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
cd "$WT" || exit 9
head_rev=$(git rev-parse --short=10 HEAD)
say() { echo "$*" | tee -a "$OUT/summary.txt"; }
run() {
  # run <name> <command...>: the log of the command, its exit code and its time
  local name=$1; shift
  local s; s=$(date +%s)
  "$@" > "$OUT/$name.log" 2>&1; local rc=$?
  say "$name rc=$rc $(( $(date +%s) - s ))s HEAD=$head_rev :: $*"
  return $rc
}
# The twelve files of parser.md P1.6 and of round 1, then every lint-parse file that the tree has.
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
test/bundler/transpiler/transpiler.test.js
$(ls test/bundler/transpiler/lint-parse*.test.ts 2>/dev/null)"
tests() {
  # tests <plain|leak>: one `bun bd test` per file; a file that fails runs once more with --timeout 180000
  local mode=$1 overall=0
  ulimit -c 0
  mkdir -p "$OUT/tests-$mode"
  one() {
    local log=$1; shift
    if [ "$mode" = leak ]; then
      BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
        LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$PWD/test/leaksan.supp bun bd test "$@" > "$log" 2>&1
    else
      bun bd test "$@" > "$log" 2>&1
    fi
  }
  for f in $FILES; do
    local n; n=$(basename "$f")
    local s; s=$(date +%s)
    one "$OUT/tests-$mode/$n.log" "$f"; local rc=$?
    say "$mode $f rc=$rc $(( $(date +%s) - s ))s | $(grep -aE '^ *[0-9]+ (pass|fail|skip|todo)$|^Ran ' "$OUT/tests-$mode/$n.log" | tr -s ' ' | tr '\n' ';')"
    if [ $rc -ne 0 ]; then
      s=$(date +%s)
      one "$OUT/tests-$mode/$n.timeout180000.log" "$f" --timeout 180000; rc=$?
      say "$mode $f --timeout 180000 rc=$rc $(( $(date +%s) - s ))s | $(grep -aE '^ *[0-9]+ (pass|fail|skip|todo)$|^Ran ' "$OUT/tests-$mode/$n.timeout180000.log" | tr -s ' ' | tr '\n' ';')"
      [ $rc -ne 0 ] && overall=1
    fi
  done
  return $overall
}
case "${1:-}" in
  check)
    run check cargo check -p bun_ast -p bun_js_parser --message-format=short
    run check-all-targets cargo check -p bun_ast -p bun_js_parser --all-targets --message-format=short ;;
  clippy)
    run clippy cargo clippy -p bun_ast -p bun_js_parser --no-deps --keep-going --message-format=short
    run clippy-all-targets cargo clippy -p bun_ast -p bun_js_parser --no-deps --all-targets --keep-going --message-format=short ;;
  fmt)
    run fmt cargo fmt -p bun_ast -p bun_js_parser -- --check
    run prettier bun --bun ./node_modules/.bin/prettier --plugin=prettier-plugin-organize-imports --config .prettierrc --check test/bundler/transpiler/typescript-grammar*.test.ts $(ls test/bundler/transpiler/lint-parse*.test.ts 2>/dev/null) ;;
  commentcop)
    run commentcop python3 /workspace/notes/lint/tools/commentcop.py "$BASE_REV...HEAD" --all
    head -1 "$OUT/commentcop.log" ;;
  cargotest)
    run cargo-test cargo test -p bun_js_parser --lib
    grep -a '^test result' "$OUT/cargo-test.log" | tee -a "$OUT/summary.txt"
    cargo test -p bun_js_parser --lib -- --list > "$OUT/cargo-test-list.txt" 2>&1 ;;
  miri)
    run miri-bun_ast bun run rust:miri -p bun_ast
    grep -a '^test result' "$OUT/miri-bun_ast.log" | tee -a "$OUT/summary.txt" ;;
  tests-plain) tests plain ;;
  tests-leak) tests leak ;;
  release)
    # The binary names the commit it was built from: commit first.
    [ -z "$(git status --porcelain --untracked-files=no)" ] || say "release: the worktree has uncommitted changes"
    run release bun run build:release -j8 || exit 1
    mkdir -p "$M/head"
    cp build/release/bun build/release/bun-profile "$M/head/"
    echo "$(git rev-parse HEAD) built in $WT (bun run build:release -j8), $("$M/head/bun" --revision)" > "$M/head/REVISION"
    say "release: $(cat "$M/head/REVISION")"
    (cd "$M" && sha256sum base/bun base/bun-profile head/bun head/bun-profile | tee -a "$OUT/summary.txt") ;;
  a1)
    # The base run of a corpus is kept: only the head runs again. diff.mjs exits with 1 for an A>R, a crash, a hang or a record without a cause.
    R=$OUT/a1; mkdir -p "$R"; cd "$GD" || exit 9
    for corpus in corpus.*.json; do
      c=${corpus#corpus.}; c=${c%.json}
      [ -s "$R/base.$c.jsonl.gz" ] || "$M/base/bun" harness.mjs "$corpus" "$R/base.$c.jsonl.gz" --jobs=4 > "$R/base.$c.log" 2>&1
      "$M/head/bun" harness.mjs "$corpus" "$R/head.$c.jsonl.gz" --jobs=4 > "$R/head.$c.log" 2>&1
      oracle=oracle.$c.jsonl.gz
      [ -s "$oracle" ] || { oracle=$R/oracle.$c.jsonl.gz; bun oracle.mjs "$corpus" "$oracle" > "$R/oracle.$c.log" 2>&1; }
      bun diff.mjs "$R/base.$c.jsonl.gz" "$R/head.$c.jsonl.gz" "--oracle=$oracle" --causes=causes.mjs "--out=$R/diff.$c.jsonl" --show=3 > "$R/diff.$c.txt" 2>&1
      say "a1 $c diff rc=$? | $(tail -1 "$R/base.$c.log") | $(tail -1 "$R/head.$c.log") | $(sed -n 3p "$R/diff.$c.txt")"
    done ;;
  cg)
    # Without the cache of the runtime transpiler: with it, the first run of a binary parses the bench script and a later run does not.
    export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
    C=$OUT/cg; mkdir -p "$C"
    for side in base head; do
      /workspace/notes/lint/tools/cgbench.sh "$M/$side/bun-profile" "$C" "$side" 20 > "$C/$side.summary.txt" 2>&1
      say "cgbench $side rc=$?"
    done
    for g in bun-types typescript-lib src-js tsx js-control; do
      python3 "$N/measure/tools/cgdiff.py" "$C/base.$g.cg" "$C/head.$g.cg" --top 80 > "$C/cgdiff.$g.txt" 2>&1
      say "$g: $(sed -n 2p "$C/cgdiff.$g.txt")"
    done ;;
  symsizes)
    for side in base head; do
      python3 /workspace/notes/lint/tools/symsizes.py "$M/$side/bun-profile" > "$OUT/symsizes.$side.txt" 2>&1
      python3 /workspace/notes/lint/tools/symsizes.py "$M/$side/bun-profile" --json > "$OUT/symsizes.$side.json" 2>&1
      # symsizes.py looks for skip_type_script_type_with_opts, which the head no longer has: the bytes by sink are in this table.
      python3 "$N/measure/sizeprobe-a/bysink.py" "$M/$side/bun-profile" > "$OUT/bysink.$side.txt" 2>&1
    done
    python3 "$N/measure/symdiff.py" "$M/base/bun-profile" "$M/head/bun-profile" > "$OUT/symdiff.base-head.txt" 2>&1
    paste "$OUT/symsizes.base.txt" "$OUT/symsizes.head.txt" | tee -a "$OUT/summary.txt" ;;
  sizes)
    run sizes "$N/measure/sizeprobe/run.sh" "$WT" final "$WT/build/debug/codegen" "$OUT/sizes"
    diff "$M/sizes/base.release.sizes.txt" "$OUT/sizes/final.release.sizes.txt" | tee -a "$OUT/summary.txt" ;;
  audit)
    python3 "$HERE/copy_audit.py" "$WT" $(cd "$WT" && ls src/js_parser/parse/comment*.rs src/js_parser/parse/pragma*.rs src/js_parser/parse/directive*.rs 2>/dev/null) | tee "$OUT/audit.txt" ;;
  surface)
    python3 "$HERE/api_surface.py" "$WT" "$N/API.md" $(cd "$WT" && ls src/js_parser/parse/comment*.rs src/js_parser/parse/pragma*.rs src/js_parser/parse/directive*.rs 2>/dev/null) | grep '!!\|public names' | tee "$OUT/surface.txt" ;;
  source-lints)
    # These tests read the sources and start no build of bun: the installed bun runs them, as in CI.
    run source-lints bun test test/internal/source-lints/
    tail -5 "$OUT/source-lints.log" ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
