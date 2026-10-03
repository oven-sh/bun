#!/bin/bash
# Round 3, R4, pass 1a: makes src/js_parser/parse/grammar_rows_tests.rs and the section of API.md again, outside the worktree.
# Light steps only (about two minutes). The compiler runs through build.sh, one lock each.
# Needs: ../top-down (run.sh, tools/, data/), ../bottom-up (rows.facts2.json, results*/), ../../tests-known-differences/bottom-up
# (rows.json, runs/, gen/), typescript 6.0.2 in /workspace/wt/parser/node_modules, the base binary /workspace/base/bun.f4d755a9c.
# The four test files are not read: rows.json holds their 366 rows (extract-rows.mjs made it while they stood).
# usage: bash run.sh [state]      state: head (round 1 as it stands) | w (parse_path as on main) | z (w and the seam proposal) | all
set -eu
H=$(cd "$(dirname "$0")" && pwd)
N=/workspace/notes/lint/units/parser/round3
STATE=${1:-w}
case $STATE in
  head) ARGS="--keeps=298:s_export_from,299:s_export_star,301:s_export_star"; LISTS="" ;;
  w)    ARGS="--as-without-lint=124,296,297,300,308"; LISTS="--as-without-lint=124,296,297,300,308" ;;
  z)    ARGS="--as-without-lint=209,212,124,296,297,300,308"; LISTS="--as-without-lint=209,212,124,296,297,300,308" ;;
  all)  ARGS=""; LISTS="" ;;
  *)    echo "no state $STATE"; exit 2 ;;
esac
# 1. The scratch of the top-down pass: main of today on the rows, tsc, the facts, the scratch copies root (helpers visible) and root2 (import type).
bash "$N/lint-grammar-tests-r4/top-down/run.sh" > /tmp/r4td-run.log 2>&1 || { tail -20 /tmp/r4td-run.log; exit 1; }
grep -E 'rows differ|rows: |metadata cases' /tmp/r4td-run.log
T=/tmp/r4td
# 2. root3: root2 with parse_path as on main.
rm -rf "$T/root3" && cp -r "$T/root2" "$T/root3"
( cd "$T/root3/src/js_parser" && patch -s parse/mod.rs < "$N/lint-grammar-tests-r4/bottom-up/results-2102fb058f/m.parse_path.diff" && rm -f parse/mod.rs.orig )
# 3. The Rust file of the state, formatted outside the worktree, and the section of API.md.
O=/tmp/r4bu/gen; mkdir -p "$O"
node "$H/gen/rust5.mjs" --rows="$T/bu/rows.facts2.json" $ARGS --out="$O/$STATE.rs"
cp "$O/$STATE.rs" "$O/grammar_rows_tests.$STATE.rs" && ( cd "$O" && rustfmt --edition 2024 "grammar_rows_tests.$STATE.rs" )
cp "$H/gen/lists3.mjs" "$T/bu/gen/lists3.mjs"
( cd "$T/bu" && node gen/lists3.mjs $LISTS --out="api3.$STATE.txt" )
cat <<EOF
the file:            $O/grammar_rows_tests.$STATE.rs          (copy it to src/js_parser/parse/grammar_rows_tests.rs)
the section:         $T/bu/api3.$STATE.txt
the checks, scratch: sh $H/build.sh clippy <root2|root3> $O/$STATE.rs <tag>      then /tmp/r4bu/run/<tag>.clippy.txt
                     sh $H/build.sh link   <root2|root3> $O/$STATE.rs <tag>      then /tmp/r4bu/run/<tag>.run.txt
the cases that fail: node $T/tools/failed-cases.mjs <log of the test> $T/data/cases.tsv       (give them to --as-without-lint)
EOF
