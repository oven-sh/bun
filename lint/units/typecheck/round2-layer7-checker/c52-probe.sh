#!/bin/sh
# Probe of src/typecheck/checker/c52_symbol_at_location.rs with rustc and clippy-driver alone (no cargo). One small
# crate compiles the real file in place, beside the real checker/{types,c01_data}.rs and the leaf files they stand on.
# Everything else is a stand-in whose signature c52-probe-gen.py reads from the file of the tree that defines it; the
# callees that no file of the tree defines yet are written by hand in that script (block MISSING).
# usage: sh c52-probe.sh      work directory: $C52_WORK (default /tmp/c52probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${C52_WORK:-/tmp/c52probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/c52-probe-gen.py" "$W"
cd "$W"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name c52probe --emit=metadata -o c52probe.rmeta c52-probe.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//; s/-D dead[-_]code//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name c52probe --emit=metadata -o c52probe_clippy.rmeta c52-probe.rs -A dead_code -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
rustfmt --edition 2024 --config skip_children=true --check /workspace/wt/typecheck/src/typecheck/checker/c52_symbol_at_location.rs
echo "c52_symbol_at_location.rs: probe ok"
