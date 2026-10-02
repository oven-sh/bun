#!/bin/sh
# Probe of src/typecheck/checker/c47_promised_mapped_template.rs with rustc and clippy-driver alone (no cargo). One small
# crate compiles the real file in place, beside the real checker/types.rs, core/golang.rs, the flag, id and kind files of
# ast/, diagnostics/ and the collections that types.rs names. Everything else is a stand-in with the signature that the
# tree has at the time of the run (c47-probe-gen.py): the tree context, the checker record with the fields that the two
# files read, and the methods and functions that they call. The call sites of the functions that the file brings are
# compiled with it, as the other files of checker/ write them. What the probe cannot say: whether the stand-in
# signatures still match when the tree changes after the run, and anything about what the functions compute.
# usage: sh c47-probe.sh      work directory: $C47_WORK (default /tmp/c47probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${C47_WORK:-/tmp/c47probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/c47-probe-gen.py" "$W"
cd "$W"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name c47probe --emit=metadata -o c47probe.rmeta lib.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//; s/-D dead[-_]code//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name c47probe --emit=metadata -o c47probe_clippy.rmeta lib.rs -A dead_code -A unreachable_pub -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
rustfmt --edition 2024 --check /workspace/wt/typecheck/src/typecheck/checker/c47_promised_mapped_template.rs
echo "c47_promised_mapped_template.rs: probe ok"
