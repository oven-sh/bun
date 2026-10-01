#!/bin/sh
# One iteration of the prototype: compile the scratch copy of src/js_parser with the rustc command of the debug build,
# link bun-debug again with that rlib, run the harness on corpus.check.json with it, and diff against the base run.
# usage: /workspace/tools/lk sh /tmp/gdr1a/proto/iter.sh <tag>      (nothing is written into the worktree)
TAG=$1
P=/tmp/gdr1a/proto
R=/tmp/gdr1a/runs
cd "$P" || exit 9
date -u +"lock acquired %FT%TZ"
OUT=$P/out-debug python3 tools/run_debug.py "$TAG" "$P/root" > "$P/compile.$TAG.log" 2>&1
rc=$?
tail -c 6000 "$P/compile.$TAG.log"
[ $rc -eq 0 ] || { echo "compile failed rc=$rc"; exit 1; }
rlib=$(ls "$P"/out-debug/"$TAG"/libbun_js_parser-*.rlib | head -1)
OUT=$P/link-debug python3 tools/relink_debug.py "$TAG" "$rlib" > "$P/link.$TAG.log" 2>&1
rc=$?
tail -3 "$P/link.$TAG.log"
[ $rc -eq 0 ] || { echo "link failed rc=$rc"; exit 2; }
BIN=$P/link-debug/$TAG/bun-debug
"$BIN" --revision
cd /tmp/gdr1a/gd || exit 9
rm -f "$R/$TAG.check.jsonl.gz"
BUN_DEBUG_QUIET_LOGS=1 "$BIN" harness.mjs "$R/corpus.check.json" "$R/$TAG.check.jsonl.gz" --jobs=4 > "$R/$TAG.check.log" 2>&1
echo "harness rc=$?"; tail -2 "$R/$TAG.check.log"
bun diff.a1.mjs "$R/base.check.jsonl.gz" "$R/$TAG.check.jsonl.gz" "--oracle=$R/oracle.check.jsonl.gz" --causes=causes.a1.mjs "--out=$R/diff.$TAG.check.jsonl" --show=2 > "$R/diff.$TAG.check.txt" 2>&1
echo "diff base>$TAG rc=$?"; head -3 "$R/diff.$TAG.check.txt"; tail -1 "$R/diff.$TAG.check.txt"
bun diff.mjs "$R/head.check.jsonl.gz" "$R/$TAG.check.jsonl.gz" "--oracle=$R/oracle.check.jsonl.gz" "--out=$R/diff.head-$TAG.check.jsonl" --show=0 > "$R/diff.head-$TAG.check.txt" 2>&1
echo "diff head>$TAG rc=$?"; head -3 "$R/diff.head-$TAG.check.txt"
( cd /workspace/wt/parser && BUN_DEBUG_QUIET_LOGS=1 CI=true GITHUB_ACTIONS= timeout 1800 "$BIN" test \
    test/bundler/transpiler/typescript-grammar.test.ts test/bundler/transpiler/typescript-grammar-expressions.test.ts \
    test/bundler/transpiler/typescript-grammar-statements.test.ts test/bundler/transpiler/typescript-grammar-decorator-metadata.test.ts \
    test/bundler/transpiler/decorator-metadata.test.ts test/bundler/transpiler/decorators.test.ts \
    test/bundler/transpiler/transpiler-stack-overflow.test.ts test/bundler/transpiler/transpiler.test.js \
    test/bundler/bundler_decorator_metadata.test.ts test/bundler/esbuild/ts.test.ts --timeout 180000 > "$P/tests.$TAG.log" 2>&1; echo "tests rc=$?" )
grep -aE '^ *[0-9]+ (pass|fail|skip|todo)$|^Ran [0-9]+ tests|^\(fail\)|expect\(\) calls' "$P/tests.$TAG.log" | head -40
git -C /workspace/wt/parser status --short | head -5
date -u +"done %FT%TZ"
