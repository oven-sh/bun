#!/bin/sh
# Probe of src/typecheck/checker/symbolaccessibility.rs with rustc and clippy-driver alone (no cargo). One small crate
# compiles the real file in place, beside the leaf files it stands on (core/{arena,linkstore,golang}.rs, five files of
# ast/, printer/emitresolver.rs). Everything else is a stand-in whose signature symbolaccessibility-probe-gen.py reads
# from the file of the tree that defines it, or a record that the script copies from its file.
# core/golang.rs and the file import the map of the crate bun_collections:
# symbolaccessibility-probe-bun-collections.rs stands for that crate.
# usage: sh symbolaccessibility-probe.sh      work directory: $SYMACC_WORK (default /tmp/symbolaccessibility-probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${SYMACC_WORK:-/tmp/symbolaccessibility-probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/symbolaccessibility-probe-gen.py" "$W"
cd "$W"
rustc --edition 2024 --crate-type lib --crate-name bun_collections --emit=metadata -o libbun_collections.rmeta "$HERE/symbolaccessibility-probe-bun-collections.rs"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name symaccprobe --emit=metadata --extern bun_collections=libbun_collections.rmeta -o symaccprobe.rmeta symbolaccessibility-probe.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//; s/-D dead[-_]code//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name symaccprobe --emit=metadata --extern bun_collections=libbun_collections.rmeta -o symaccprobe_clippy.rmeta symbolaccessibility-probe.rs -A dead_code -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
rustfmt --edition 2024 --config skip_children=true --check /workspace/wt/typecheck/src/typecheck/checker/symbolaccessibility.rs
echo "symbolaccessibility.rs: probe ok"
