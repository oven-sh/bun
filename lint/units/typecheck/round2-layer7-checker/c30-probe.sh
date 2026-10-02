#!/bin/sh
# Probe of src/typecheck/checker/c30_type_keys.rs with rustc and clippy-driver alone (no cargo). One small crate compiles
# the real c30_type_keys.rs in place, beside the real checker/types.rs, core/golang.rs, the flag and id files of ast/ and
# the collections that types.rs names. Everything else is a stand-in with the signature that the tree has at the time of
# the run (c30-probe-gen.py): the tree context, the checker record with the fields that the two files read, the methods
# and functions that they call, and bun_core::hash::xxhash64. A program then drives the functions that need no checker
# (the builder and its writes, the keys of type lists, tuples, template literal types and node lists) against a plain
# byte stream. What the probe cannot say: whether the stand-in signatures still match when the tree changes after the
# run, and anything about the functions that read the checker beyond their types and borrows.
# usage: sh c30-probe.sh      work directory: $C30_WORK (default /tmp/c30probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${C30_WORK:-/tmp/c30probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/c30-probe-gen.py" "$W"
cd "$W"
# 0. The stand-in of bun_core.
rustc --edition 2024 --crate-type rlib --crate-name bun_core -o libbun_core.rlib bun_core.rs
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type rlib --crate-name c30probe --extern bun_core=libbun_core.rlib -o libc30probe.rlib lib.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name c30probe --extern bun_core=libbun_core.rlib --emit=metadata -o c30probe_clippy.rmeta lib.rs -A dead_code -A unreachable_pub -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
# 3. The functions that need no checker, run against a plain byte stream.
rustc --edition 2024 --crate-name c30run --extern bun_core=libbun_core.rlib --extern c30probe=libc30probe.rlib -o c30run run.rs
./c30run
rustfmt --edition 2024 --check /workspace/wt/typecheck/src/typecheck/checker/c30_type_keys.rs
echo "c30_type_keys.rs: probe ok"
