#!/bin/sh
# Assembles the one scratch package of this pass in a work directory:
#   the node table prototype (../../node-table-id-contract/bottom-up: tscore, ast, testimport, the generated files),
#   the diagnostics scratch (../../diagnostics-scratch/crate: message table, Diagnostic, collection, writer),
#   and the files of this directory (crate/: the checker data model and the translated functions).
# py/adapt.py then applies the edits that the foreign files need; every edit names its pattern and fails when it is absent.
# usage: assemble.sh [work dir, default /tmp/cdm-td]      result: <work dir>/crate
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
NT=$HERE/../../node-table-id-contract/bottom-up
DG=$HERE/../../diagnostics-scratch
W=${1:-${CDM_WORK:-/tmp/cdm-td}}
C=$W/crate
rm -rf "$C"
mkdir -p "$C/src"
# 1. node table prototype: generated files are checked against the generator first
(cd "$NT/gen" && bun generate.ts ../crate/src/ast --check >/dev/null)
cp -r "$NT/crate/src/tscore" "$NT/crate/src/ast" "$NT/crate/src/testimport" "$C/src/"
cp "$NT/crate/src/bindprobe.rs" "$NT/crate/src/native_test_shims.rs" "$C/src/"
cp "$NT/crate/src/tests.rs" "$C/src/nodetable_tests.rs"
cp -r "$NT/crate/testdata" "$C/"
# 2. diagnostics scratch: the generated table is rebuilt when it is missing
if [ ! -f "$DG/crate/diagnostics/diagnostics_generated.rs" ]; then (cd "$DG" && sh run.sh >/dev/null); fi
mkdir -p "$C/src/diagnostics" "$C/src/compiler" "$C/src/diagnosticwriter"
cp "$DG/crate/diagnostics/mod.rs" "$DG/crate/diagnostics/diagnostics_generated.rs" "$DG/crate/diagnostics/tests.rs" "$C/src/diagnostics/"
cp "$DG/crate/ast/diagnostic.rs" "$C/src/ast/diagnostic.rs"
cp "$DG/crate/compiler/program.rs" "$C/src/compiler/program.rs"
cp "$DG/crate/diagnosticwriter/mod.rs" "$C/src/diagnosticwriter/mod.rs"
cp "$DG/crate/core/mod.rs" "$C/src/tscore/lines.rs"
cp "$DG/crate/slices.rs" "$C/src/tscore/slices.rs"
cp "$DG/crate/tests.rs" "$C/src/diagnostics_tests.rs"
# 3. the files of this pass
cp -r "$HERE/crate/." "$C/"
# 4. the edits to the foreign files
python3 "$HERE/py/adapt.py" "$C"
cp /workspace/wt/typecheck/Cargo.lock "$C/Cargo.lock"
echo "assembled $C"
