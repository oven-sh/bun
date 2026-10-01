#!/bin/sh
# Checks the files of K3 steps 6 to 8 (symbol merging, name resolution, aliases and modules) of /workspace/wt/typecheck with
# rustc, clippy-driver and rustfmt alone (no cargo, no build of bun). One crate compiles in place: the real core,
# collections, stringutil, tspath, jsnum, ast, evaluator and binder/nameresolver.rs of src/typecheck, the data model of the
# checker (checker/c01_data.rs, c02_program_checker.rs, types.rs, mapper.rs, links.rs), checker/c04, c21, c22 to c27 and
# module/. scratch/stubs stands in for what the tree does not have yet: List, Map and the other Go values of crate::core
# (golang.rs), crate::internal, crate::diagnostics (ids without texts), ast/diagnostic.rs (ast_diag.rs), and the functions
# of other steps that these files and the data model call (other_steps.rs). Then the tests of scratch/stubs run the ported
# functions on symbols of an open store and on files that are built and bound by hand.
# usage: run.sh      work directory: $K3SYM_WORK (default /tmp/k3sym-check). K3SYM_COVERAGE=1 adds the coverage of the tests.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=/workspace/wt/typecheck/src/typecheck
W=${K3SYM_WORK:-/tmp/k3sym-check}
rm -rf "$W"
mkdir -p "$W/out"
cp -r "$HERE/scratch/." "$W/"
sed -i "s#@SCRATCH@#$W#g" "$W/lib.rs"
python3 "$HERE/gen_diagnostics.py" "$HERE/../checker-data-model-contract/bottom-up/crate/src/diagnostics/diagnostics_generated.rs" > "$W/stubs/diagnostics.rs"
cd "$W"
rustc --edition 2024 --crate-type rlib --crate-name bun_core -o out/libbun_core.rlib ext/bun_core.rs
rustc --edition 2024 --crate-type rlib --crate-name bun_collections -o out/libbun_collections.rlib ext/bun_collections.rs
EXT="-L out --extern bun_core=out/libbun_core.rlib --extern bun_collections=out/libbun_collections.rlib"
DENY="-D warnings -A dead_code -D unused_imports -D unused_variables -D unused_mut -D unused_assignments -D unused_macros -D unreachable_code -D unreachable_patterns"
# 1. Types, borrows and the deny set of the workspace.
rustc --edition 2024 --crate-type lib --crate-name tc --emit=metadata -o out/libtc.rmeta $DENY $EXT lib.rs
# 2. The clippy table of the workspace, without unreachable_pub (the scratch root re-exports modules that export no name).
#    The eight notes about clippy.toml name functions of the real bun_core.
FLAGS=$(sed 's/-D unreachable[-_]pub//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name tc --emit=metadata -o out/libtc_clippy.rmeta $EXT lib.rs -A dead_code -A unreachable_pub -W clippy::all $FLAGS > out/clippy.txt 2>&1
if grep -n "^error\|^warning" out/clippy.txt | grep -v "does not refer to a reachable\|warnings emitted"; then exit 1; fi
# 3. The tests: 16 on an open store, 11 on hand-bound files, 3 of module/, 1 of core/nodemodules.rs. The test binary also
#    holds the tests of the modules that are compiled in; one of them (a_mapper_maps_as_its_kind_of_upstream_does of the
#    data model) needs the real is_this_type_parameter and is not run here.
COV=""
if [ -n "$K3SYM_COVERAGE" ]; then COV="-C instrument-coverage"; fi
rustc --edition 2024 --test --crate-name tc -C opt-level=0 $COV -o out/tc_tests -A warnings $EXT lib.rs
LLVM_PROFILE_FILE=out/tc.profraw ./out/tc_tests runtime_tests e2e_tests module:: nodemodules
if [ -n "$K3SYM_COVERAGE" ]; then
  BIN=$(ls -d "$(rustc --print sysroot)"/lib/rustlib/*/bin | head -1)
  "$BIN/llvm-profdata" merge -sparse out/tc.profraw -o out/tc.profdata
  "$BIN/llvm-cov" export --format=lcov --instr-profile=out/tc.profdata ./out/tc_tests > out/tc.lcov 2>/dev/null
  python3 "$HERE/py/coverage.py" out/tc.lcov "$HERE/py/functions.txt"
fi
# 4. Format, the comment rule of comment-cop.yml, and every function of the three steps against upstream's calls.
FILES="$SRC/checker/c04_name_resolution_hooks.rs $SRC/checker/c21_resolved_symbols_diagnostics.rs $SRC/checker/c22_symbols_merge.rs $SRC/checker/c23_alias_targets.rs $SRC/checker/c24_external_modules.rs $SRC/checker/c25_entity_names.rs $SRC/checker/c26_exports_late_binding.rs $SRC/checker/c27_resolve_alias.rs $SRC/module/mod.rs $SRC/module/types.rs $SRC/module/util.rs $SRC/core/nodemodules.rs $SRC/core/mod.rs"
rustfmt --edition 2024 --check $FILES
python3 "$HERE/py/commentcop.py" $FILES
(cd "$SRC" && python3 "$HERE/py/callseq.py") | tail -1
echo "k3 steps 6 to 8: scratch ok"
