#!/bin/sh
# Rebuilds and checks the scratch: rustc, the unit tests, clippy with the workspace lint set, rustfmt.
set -e
cd "$(dirname "$0")/rust"
OUT=${TMPDIR:-/tmp}/tcconv-out
mkdir -p "$OUT"
rustc --edition 2024 --crate-type lib -o "$OUT/libconv.rlib" conv.rs
rustc --edition 2024 --test -o "$OUT/conv_tests" conv.rs
"$OUT/conv_tests"
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib -o "$OUT/libconv_clippy.rlib" conv.rs -D warnings -W clippy::all $(cat ../data/clippy_flags.txt)
rustfmt --edition 2024 --check conv.rs
echo "scratch ok"
