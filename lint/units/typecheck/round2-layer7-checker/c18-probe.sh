#!/bin/sh
# Probe of src/typecheck/checker/c18_identifiers_property_access_this.rs with rustc and clippy-driver alone (no cargo).
# One small crate compiles the real file in place, beside the real checker/{types,c01_data}.rs and the leaf files they
# stand on. Everything else is a stand-in whose signature c18-probe-gen.py reads from the file of the tree that
# defines it; a callee that no file of the tree defines is written by hand in that script (block MISSING). The
# consumers of the file are in the same crate: the calls that other files of checker/ make into its functions.
# core/golang.rs imports the map of the crate bun_collections: c18-probe-bun-collections.rs stands for that crate.
# usage: sh c18-probe.sh      work directory: $C18_WORK (default /tmp/c18probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${C18_WORK:-/tmp/c18probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/c18-probe-gen.py" "$W"
cd "$W"
rustc --edition 2024 --crate-type lib --crate-name bun_collections --emit=metadata -o libbun_collections.rmeta "$HERE/c18-probe-bun-collections.rs"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name c18probe --emit=metadata --extern bun_collections=libbun_collections.rmeta -o c18probe.rmeta c18-probe.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//; s/-D dead[-_]code//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name c18probe --emit=metadata --extern bun_collections=libbun_collections.rmeta -o c18probe_clippy.rmeta c18-probe.rs -A dead_code -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
rustfmt --edition 2024 --config skip_children=true --check /workspace/wt/typecheck/src/typecheck/checker/c18_identifiers_property_access_this.rs
echo "c18_identifiers_property_access_this.rs: probe ok"
