#!/bin/sh
# The scratch variants of results-2102fb058f/. Nothing is written in the worktree. Needs target/ of `cargo test -p bun_js_parser --lib`.
#   a    src/js_parser of 2102fb058f + results/import-type-rest.diff + the generated file with every row read
#   z    a + round3/seam-expressions/top-down/variants/z.diff, generated with the rows 209 and 212 not read
#   m    a + results-2102fb058f/m.parse_path.diff (parse_path as on main), generated with the two families of import attributes not read
#   k0   a + round3/seam-expressions/top-down/variants/k0.diff (no hook at the expression sites), every row read
# usage: sh variants.sh <a|z|m|k0> <generated file>      then: /workspace/tools/lk sh build-scratch.sh /tmp/r4bu/<v> && /tmp/r4bu/<v>/out/bun_js_parser
set -e
V=$1
GEN=$2
N=/workspace/notes/lint/units/parser/round3
S=/tmp/r4bu/$V
rm -rf "$S" && mkdir -p "$S/src" "$S/out" && cp -r /workspace/wt/parser/src/js_parser "$S/src/js_parser"
cd "$S/src/js_parser"
case $V in z|k0) patch -s -p3 < "$N/seam-expressions/top-down/variants/$V.diff";; esac
case $V in m) patch -s parse/mod.rs < "$N/lint-grammar-tests-r4/bottom-up/results-2102fb058f/m.parse_path.diff";; esac
patch -s parse/parse_skip_typescript.rs < "$N/lint-grammar-tests-r4/bottom-up/results/import-type-rest.diff"
cp "$GEN" parse/grammar_rows_tests.rs && rustfmt --edition 2024 parse/grammar_rows_tests.rs
# The three edits of the existing files: the module line, and the helpers that the generated file calls.
sed -i 's/^pub mod generics;$/pub mod generics;\n#[cfg(test)]\nmod grammar_rows_tests;/' parse/mod.rs
sed -i 's/^fn outline(/pub(crate) fn outline(/; s/^fn read_from<E>(/pub(crate) fn read_from<E>(/; s/^fn type_read(/pub(crate) fn type_read(/; s/^fn type_parameters_read(/pub(crate) fn type_parameters_read(/' type_sink_tests.rs
sed -i 's/^fn describe(/pub(super) fn describe(/' parse/erased_tests.rs
