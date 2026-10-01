#!/bin/sh
# Makes the scratch copy of src/js_parser with the prototype and its tests applied, and the probe in it. Nothing is written in the worktree.
# usage: sh make-scratch.sh [/workspace/wt/parser] [/tmp/erased-types/scratch] [rows.rs]      then: /workspace/tools/lk sh build-scratch.sh
set -e
ROOT=${1:-/workspace/wt/parser}
SCRATCH=${2:-/tmp/erased-types/scratch}
ROWS=${3:-}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$SCRATCH/src/js_parser"
mkdir -p "$SCRATCH/src" "$SCRATCH/out"
cp -r "$ROOT/src/js_parser" "$SCRATCH/src/js_parser"
python3 "$HERE/apply.py" "$SCRATCH/src/js_parser"
python3 "$HERE/apply_tests.py" "$SCRATCH/src/js_parser" $ROWS
cp "$HERE/zz_probe.rs" "$SCRATCH/src/js_parser/zz_probe.rs"
printf '\n#[cfg(test)]\nmod zz_probe;\n' >> "$SCRATCH/src/js_parser/lib.rs"
# The probe prints the lines of the test: only the scratch copy makes the module visible to it.
sed -i 's/^mod erased_tests;$/pub(crate) mod erased_tests;/' "$SCRATCH/src/js_parser/parse/mod.rs"
grep -n 'erased_tests' "$SCRATCH/src/js_parser/parse/mod.rs"
