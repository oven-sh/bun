#!/bin/sh
# Probe of src/typecheck/checker/emitresolver.rs with rustc and clippy-driver alone (no cargo). One small crate
# compiles the real file in place, beside the leaf files it stands on. Everything else is a stand-in whose signature
# emitresolver-probe-gen.py reads from the file of the tree that defines it, or a record that the script copies from
# its file; the callee that no file of the tree defines yet is written by hand in that script (block MISSING).
# usage: sh emitresolver-probe.sh      work directory: $EMITRESOLVER_WORK (default /tmp/emitresolver-probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${EMITRESOLVER_WORK:-/tmp/emitresolver-probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/emitresolver-probe-gen.py" "$W"
cd "$W"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name emitresolverprobe --emit=metadata -o emitresolverprobe.rmeta emitresolver-probe.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//; s/-D dead[-_]code//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name emitresolverprobe --emit=metadata -o emitresolverprobe_clippy.rmeta emitresolver-probe.rs -A dead_code -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
rustfmt --edition 2024 --config skip_children=true --check /workspace/wt/typecheck/src/typecheck/checker/emitresolver.rs
echo "emitresolver.rs: probe ok"
