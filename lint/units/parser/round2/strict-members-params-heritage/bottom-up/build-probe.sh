#!/bin/sh
# Builds a test binary of a scratch copy of bun_js_parser with zz_probe.rs in it. Nothing is written in the worktree.
# It needs the target directory that `cargo test -p bun_js_parser --lib` left in the worktree: the libraries of the
# dependencies are taken from there as they are (the oldest library of each crate: the run that built the tests).
# usage: /workspace/tools/lk sh build-probe.sh [/workspace/wt/parser] [/tmp/smph]     output: <scratch>/out/bun_js_parser
set -e
ROOT=${1:-/workspace/wt/parser}
SCRATCH=${2:-/tmp/smph}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$SCRATCH/src/js_parser" "$SCRATCH/out"
mkdir -p "$SCRATCH/src" "$SCRATCH/out"
cp -r "$ROOT/src/js_parser" "$SCRATCH/src/js_parser"
cp "$HERE/zz_probe.rs" "$SCRATCH/src/js_parser/zz_probe.rs"
printf '\n#[cfg(test)]\nmod zz_probe;\n' >> "$SCRATCH/src/js_parser/lib.rs"
BUILD="$ROOT/target/debug/build"
EXTERNS=""
for name in thiserror bitflags bun_collections strum smallvec bun_react_compiler enumset bun_options_types bun_wyhash bun_core bun_ast bun_base64 bstr bun_url bun_ptr bun_alloc bytemuck scopeguard bun_crash_handler bun_paths bun_highway; do
  lib=$(ls -tr "$BUILD/$name"/*/out/lib"$name"-*.rlib | head -1)
  # The libraries hold a stub of their metadata: the file beside each holds all of it.
  EXTERNS="$EXTERNS --extern $name=$lib --extern $name=${lib%.rlib}.rmeta"
done
SEARCH=""
for dir in "$BUILD"/*/*/out; do SEARCH="$SEARCH -L dependency=$dir"; done
cd "$ROOT"
# shellcheck disable=SC2086
rustc --crate-name bun_js_parser --edition=2024 "$SCRATCH/src/js_parser/lib.rs" --test --emit=link \
  -C debuginfo=0 -C codegen-units=16 --cap-lints allow -o "$SCRATCH/out/bun_js_parser" \
  -C linker=/usr/lib/llvm-23/bin/clang++ -C link-arg=-fuse-ld=lld -C link-arg=-Qunused-arguments \
  $SEARCH $EXTERNS
ls -la "$SCRATCH/out/bun_js_parser"
