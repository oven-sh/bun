#!/bin/sh
# Type-checks, lints and tests checker/flow.rs of the worktree in a scratch crate: the real ast, core, collections, stringutil and tspath modules of the worktree by #[path], the data model with the field names of checker-data-model-contract, and stubs for the callees (src/checker/stubs_generated.rs takes their signatures from the worktree).
# Output goes to $OUT (default /tmp/checker-flow-scratch). One rustc at a time, no cargo.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-/tmp/checker-flow-scratch}
FLOW=/workspace/wt/typecheck/src/typecheck/checker/flow.rs
mkdir -p "$OUT"
cd "$HERE"
rustfmt --edition 2024 --check "$FLOW" && echo "rustfmt: ok"
rustc --edition 2024 --crate-type lib --crate-name bun_core -o "$OUT/libbun_core.rlib" stub/bun_core.rs 2>/dev/null
rustc --edition 2024 --crate-type lib --crate-name bun_collections -o "$OUT/libbun_collections.rlib" stub/bun_collections.rs 2>/dev/null
python3 gen_stubs.py "$FLOW"
EXT="--extern bun_core=$OUT/libbun_core.rlib --extern bun_collections=$OUT/libbun_collections.rlib"
# The result type of get_property_name_from_type (checker/utilities.go) is open: the three candidates are three cfgs.
for v in name_vec name_cow name_text; do
  rustc --edition 2024 --crate-type lib --emit=metadata --cfg $v $EXT --error-format=short -o "$OUT/libscratch_$v.rmeta" src/lib.rs > "$OUT/check_$v.log" 2>&1
  echo "check $v: exit $? ($(grep -c '^.*: error' "$OUT/check_$v.log") errors)"
done
FLAGS=$(cat /workspace/notes/lint/units/typecheck/conventions-scratch/data/clippy_flags.txt)
for v in name_vec name_cow; do
  CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --emit=metadata --cfg $v $EXT -o "$OUT/libscratch_clippy.rmeta" src/lib_clippy.rs -D warnings -W clippy::all -D dead_code -D unreachable_pub -D unused_imports -D unused_variables -D unused_mut -D unused_assignments -D unreachable_code -D unreachable_patterns $FLAGS > "$OUT/clippy_$v.log" 2>&1
  echo "clippy $v: exit $?"
done
rustc --edition 2024 --test --cfg name_vec $EXT --error-format=short -o "$OUT/scratch_tests" src/lib.rs > "$OUT/tests_build.log" 2>&1 && "$OUT/scratch_tests" checker::tests 2>&1 | tail -12
