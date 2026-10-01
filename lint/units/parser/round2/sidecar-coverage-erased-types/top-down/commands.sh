#!/bin/sh
# How the files of this directory were made. Nothing here writes in a worktree: the prototype lives in a scratch copy of src/js_parser.
# Needs: the target directory that `cargo test -p bun_js_parser --lib` left in /workspace/wt/parser (be1ebe5295), tsc 6.0.2 in its
# node_modules, typescript-go 89d5d5b as /tmp/rr/parsediag (ledger/bottom-up/tsgo-oracle/build.sh builds it), and for the column "head"
# the probe of the tree before the prototype, /tmp/smph/out/bun_js_parser (round2/strict-members-params-heritage/bottom-up/build-probe.sh).
set -e
cd "$(dirname "$0")"
# 1. What tsc 6.0.2 builds: the lines of the payload test and the rows of the rejection test.
node payload-oracle.cjs inputs.json > expected.txt
node payload-oracle.cjs --rust inputs.json > rows.rs
node -e '
const { run } = require("./payload-oracle.cjs");
const inputs = JSON.parse(require("fs").readFileSync("inputs-rejections.json", "utf8"));
const out = inputs.map(t => { const m = /^error TS(\d+) \[(\d+),(\d+)\) (.*)$/.exec(run({ text: t })[0]); if (!m) throw new Error("parses: " + t); return `        (b${JSON.stringify(t)}, ${m[1]}, ${m[2]}, ${m[3]}, ${JSON.stringify(m[4])}),`; });
require("fs").writeFileSync("rejection-rows.rs", out.join("\n") + "\n");'
node godiag.cjs inputs-rejections.json > godiag.rejections.txt
# 2. The test that fails first: the tree as it is, with only the rejection test added (24 of its 29 rows fail).
S2=/tmp/erased-types/scratch-head
rm -rf "$S2" && mkdir -p "$S2/src" "$S2/out" && cp -r /workspace/wt/parser/src/js_parser "$S2/src/js_parser"
python3 apply_head_test.py "$S2/src/js_parser" rejection-rows.rs
/workspace/tools/lk sh build-scratch.sh /workspace/wt/parser "$S2"
"$S2/out/bun_js_parser" an_erased_statement > head-test-run.txt 2>&1 || true
# 3. The prototype: apply.py (the change), apply_tests.py (its tests), zz_probe.rs (the probe), built and run (75 tests pass), clippy.
sh make-scratch.sh
S=/tmp/erased-types/scratch/src/js_parser
(cd /workspace/wt/parser && rustfmt --edition 2024 $S/parse/erased.rs $S/parse/erased_tests.rs $S/parse/generics.rs $S/parse/type_sink.rs $S/parse/parse_property.rs $S/parse/parse_stmt.rs $S/parse/parse_skip_typescript.rs $S/typescript.rs $S/type_sink_tests.rs)
/workspace/tools/lk sh -c 'sh build-scratch.sh && sh clippy-scratch.sh'
/tmp/erased-types/scratch/out/bun_js_parser > prototype-test-run.txt 2>&1
# 4. The prototype against tsc: the payload lines, the rejections, two sets of probes, and two corpora.
node probe.cjs inputs.json | diff expected.txt -
node compare.cjs inputs-rejections.json --head /tmp/smph/out/bun_js_parser --all > compare.rejections.txt
node compare.cjs inputs-rejections1.json --head /tmp/smph/out/bun_js_parser > compare.probe1.txt
node compare.cjs inputs-rejections2.json --head /tmp/smph/out/bun_js_parser > compare.probe2.txt
(cd /workspace/wt/parser && node "$OLDPWD/sweep.cjs" "$OLDPWD/sweep.bun.txt" test src/js packages/bun-types)
(cd /workspace/ref/typescript-go/_submodules/TypeScript/tests/cases && node "$OLDPWD/sweep.cjs" "$OLDPWD/sweep.typescript-cases.txt" compiler conformance)
# 5. The patch: the same edits on a clean copy, formatted. `patch --dry-run -p1 < prototype.be1ebe5295.patch` in the worktree says it applies.
P=/tmp/erased-types/patch
rm -rf "$P" && mkdir -p "$P/a/src" "$P/b/src" && cp -r /workspace/wt/parser/src/js_parser "$P/a/src/js_parser" && cp -r /workspace/wt/parser/src/js_parser "$P/b/src/js_parser"
python3 apply.py "$P/b/src/js_parser" && python3 apply_tests.py "$P/b/src/js_parser" rows.rs rejection-rows.rs
B=$P/b/src/js_parser
(cd /workspace/wt/parser && rustfmt --edition 2024 $B/parse/erased.rs $B/parse/erased_tests.rs $B/parse/generics.rs $B/parse/type_sink.rs $B/parse/parse_property.rs $B/parse/parse_stmt.rs $B/parse/parse_skip_typescript.rs $B/typescript.rs $B/type_sink_tests.rs)
(cd "$P" && diff -ruN a b > "$OLDPWD/prototype.be1ebe5295.patch" || true)
