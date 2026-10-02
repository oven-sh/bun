#!/bin/sh
# Probe of src/typecheck/checker/c40_type_nodes_conditional_tuples.rs with rustc and clippy-driver alone (no cargo). One
# small crate compiles the real file in place, beside the real checker/types.rs, core/golang.rs, the flag and id files of
# ast/ and the collections that types.rs names. Everything else is a stand-in with the signature that the tree has at the
# time of the run (c40-probe-gen.py): the tree context, the checker record with the fields that the two files read, and
# the methods and functions that they call. What the probe cannot say: whether the stand-in signatures still match when
# the tree changes after the run, whether a callee that the tree does not define yet will have the signature that the
# script writes for it, and anything about what the functions compute.
# usage: sh c40-probe.sh      work directory: $C40_WORK (default /tmp/c40probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${C40_WORK:-/tmp/c40probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/c40-probe-gen.py" "$W"
cd "$W"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name c40probe --emit=metadata -o c40probe.rmeta lib.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name c40probe --emit=metadata -o c40probe_clippy.rmeta lib.rs -A dead_code -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
rustfmt --edition 2024 --check /workspace/wt/typecheck/src/typecheck/checker/c40_type_nodes_conditional_tuples.rs
echo "c40_type_nodes_conditional_tuples.rs: probe ok"
