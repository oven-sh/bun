#!/bin/sh
# Rebuilds and checks the scratch of the checker data model contract.
# Needs: go, python3, rustfmt, the reference clone /workspace/ref/typescript-go (89d5d5b), the node table prototype
# ../../node-table-id-contract/bottom-up/crate (its ast, bindprobe, testimport and tests are compiled in by path), the
# diagnostics block ../../diagnostics-scratch/crate (copied in by py/import_diagnostics.py), the crates
# of /workspace/wt/typecheck after `bun run build --configure-only`, the cargo registry of the machine, and for the layer
# tables the call graph /tmp/k3a/fns.json (made by ../../checker-core-scratch/run.sh).
# Heavy steps go through /workspace/tools/lk. Target directory: $CDM_TARGET (default /tmp/cdm/target).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/workspace/wt/typecheck
T=${CDM_TARGET:-/tmp/cdm/target}
M=$HERE/crate/Cargo.toml
O=${TMPDIR:-/tmp}/cdm-check
mkdir -p "$O"
cp $W/Cargo.lock $HERE/crate/Cargo.lock
# 1. The analyses of the reference give the stored tables.
(cd $HERE/goanal && go build -o "$O/goanal" .)
for mode in slicewrites same funcvalues; do "$O/goanal" $mode checker 2>/dev/null | cmp - $HERE/data/$mode.tsv; done
{ "$O/goanal" loops checker 2>/dev/null; "$O/goanal" loops binder 2>/dev/null; } | cmp - $HERE/data/loops.tsv
"$O/goanal" structs checker 2>/dev/null | cmp - $HERE/data/structs.tsv
(cd $HERE/goprobe && go run .) | cmp - $HERE/data/go-slice-probe.txt
echo "analyses ok"
# 2. The diagnostics block is what its import makes of ../../diagnostics-scratch/crate; the generated files are what the
#    generators write; every function has one layer and one landing step.
(cd $HERE/py && python3 import_diagnostics.py ../crate/src --check)
(cd $HERE/py && python3 genflags.py ../crate/src/checker/flags_generated.rs --check)
(cd $HERE/py && python3 genchecker.py ../crate/src/checker/c02_checker_generated.rs ../data/checker-fields.tsv --check)
(cd $HERE/py && python3 settle.py ../data --check)
(cd $HERE/py && python3 k4path.py ../data --check)
# 3. The workspace lints (copied into crate/Cargo.toml from Cargo.toml:181-321), clippy.toml of the worktree, rustfmt.
/workspace/tools/lk cargo check --offline --manifest-path $M --target-dir $T
CLIPPY_CONF_DIR=$W /workspace/tools/lk cargo clippy --offline --manifest-path $M --target-dir $T --all-targets
cargo fmt --manifest-path $M -- --check
# 4. The unit tests, linked by cargo against bun_collections, bun_wyhash and bun_core.
/workspace/tools/lk cargo test --offline --manifest-path $M --target-dir $T
echo "scratch ok"
