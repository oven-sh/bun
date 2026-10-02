#!/bin/bash
# Round 3, R4, top-down pass: makes the scratch again and every file of generated/ and data/. Nothing is written in the worktree.
# Light steps only. The builds are the commands at the end: each goes through /workspace/tools/lk.
# Needs: ../../tests-known-differences/bottom-up (rows.json, runs/, gen/), and for the builds the directory target/ that one
# `cargo test -p bun_js_parser --lib` leaves in the worktree (data/rustc-js-parser-test.args names its files).
set -eu
H=$(cd "$(dirname "$0")" && pwd)
N=/workspace/notes/lint/units/parser
T=/tmp/r4td
BASE=${BASE:-/workspace/base/bun.f4d755a9c}
rm -rf "$T/bu" "$T/gd"
mkdir -p "$T/tools" "$T/data"
cp -r "$N/round3/tests-known-differences/bottom-up" "$T/bu"
cp -r "$N/grammar-diff" "$T/gd"
cp -r "$N/grammar-diff-oracle-and-causes/for-grammar-diff/"* "$T/gd/"
ln -sfn "$N/probes" "$T/probes"
cp "$H"/gen/*.mjs "$T/bu/gen/"
cp "$H"/tools/* "$T/tools/"
cp "$H/data/rustc-js-parser-test.args" "$T/rustc-js-parser-test.args"
export GD=$T/gd
cd "$T/bu"

# 1. main of today on the 366 rows: the same records as runs/main.f4d755a9c.json (0 of 366 differ).
"$BASE" side.mjs rows.json runs/main.now.json
node -e 'const f=require("fs");const a=JSON.parse(f.readFileSync("runs/main.f4d755a9c.json")),b=JSON.parse(f.readFileSync("runs/main.now.json"));let d=0;a.rows.forEach((r,i)=>{if(JSON.stringify(r)!==JSON.stringify(b.rows[i]))d++});console.log(b.revision,d,"rows differ from",a.revision)'

# 2. tsc, the classes, the facts (those of the bottom-up pass), then the four facts of this pass and the checks.
node tsc-rows.mjs rows.json runs/tsc.json
bun classify.mjs | tail -1
node gen/facts.mjs
node gen/facts2.mjs
node "$T/tools/meta-check.mjs" rows.facts.json
node "$T/tools/cases.mjs" rows.facts2.json "$N/round3/tests-known-differences/top-down/data/rows.table.tsv" > "$T/data/cases.tsv"
node "$T/tools/groups.mjs" > "$T/data/groups.txt"

# 3. The file. D0: every source as tsc reads it. E: seven cases as a parse without lint reads them (the experiment of INDEX.txt).
node gen/rust3.mjs --facts=all --records --out=D0.rs
node gen/rust3.mjs --facts=all --records --as-without-lint=209,212,124,296,297,300,308 --out=E.rs

# 3b. The section of API.md for each of the two: "Known differences of a parse without lint", with the list of the lint grammar at its end.
bun corpus-lists.mjs > runs/corpus-lists.txt
node gen/lists2.mjs --out=api2.txt
node gen/lists2.mjs --as-without-lint=209,212,124,296,297,300,308 --out=api2.pinned.txt

# 4. A scratch copy of the crate with the four helpers visible and the module line, and one with the fix of the import type.
rm -rf "$T/root" "$T/root2"
mkdir -p "$T/root/src" "$T/root/out"
cp -r /workspace/wt/parser/src/js_parser "$T/root/src/js_parser"
( cd "$T/root/src/js_parser"
  sed -i 's/^fn read_from</pub(crate) fn read_from</; s/^fn type_read(/pub(crate) fn type_read(/; s/^fn type_parameters_read(/pub(crate) fn type_parameters_read(/; s/^fn outline(/pub(crate) fn outline(/' type_sink_tests.rs
  sed -i 's/^fn describe(parsed: &ParsedForLint/pub(crate) fn describe(parsed: \&ParsedForLint/' parse/erased_tests.rs
  sed -i 's/^mod erased_tests;$/mod erased_tests;\n#[cfg(test)]\nmod grammar_rows_tests;/' parse/mod.rs )
cp -r "$T/root" "$T/root2"
( cd "$T/root2" && patch -p1 -s < "$H/data/import-type-rest.p1.diff" )

cat <<EOF
scratch in $T. The builds, one lock each:
  /workspace/tools/lk env S=$T/root2 sh $T/tools/build-variant.sh $T/bu/D0.rs D0     then  $T/root2/out/D0/bun_js_parser-*
  /workspace/tools/lk env S=$T/root2 sh $T/tools/clippy-variant.sh $T/bu/D0.rs D0
  node $T/tools/failed-cases.mjs <log of the run> $T/data/cases.tsv                  the cases that are not read as tsc reads them
The seam variants: copy $T/root2 and apply $N/round3/seam-expressions/top-down/variants/<k0|z>.diff with patch -p3 in src/js_parser,
then build with CAP=1.
EOF
