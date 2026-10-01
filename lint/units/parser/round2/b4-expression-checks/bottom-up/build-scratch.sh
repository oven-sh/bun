#!/bin/sh
# Builds the test binary of a scratch COPY of bun_js_parser with zz_probe.rs in it, with or without the prototype (apply.py).
# Nothing is written in the worktree. The libraries of the dependencies come from the target directory that
# `cargo test -p bun_js_parser --lib` left in the worktree (the oldest library of each crate: the run that built the tests).
# usage: /workspace/tools/lk sh build-scratch.sh <head|proto> [/workspace/wt/parser] [/tmp/b4ec]     output: <scratch>/<head|proto>/out/bun_js_parser
set -e
WHAT=${1:-proto}
ROOT=${2:-/workspace/wt/parser}
SCRATCH=${3:-/tmp/b4ec}/$WHAT
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$SCRATCH/src/js_parser"
mkdir -p "$SCRATCH/src" "$SCRATCH/out"
cp -r "$ROOT/src/js_parser" "$SCRATCH/src/js_parser"
if [ "$WHAT" != head ]; then python3 "$HERE/apply.py" "$SCRATCH/src/js_parser"; fi
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
  -C debuginfo=0 -C codegen-units=16 --cap-lints allow -o "$SCRATCH/out/bun_js_parser.new" \
  -C linker=/usr/lib/llvm-23/bin/clang++ -C link-arg=-fuse-ld=lld -C link-arg=-Qunused-arguments \
  $SEARCH $EXTERNS
mv "$SCRATCH/out/bun_js_parser.new" "$SCRATCH/out/bun_js_parser"
ls -la "$SCRATCH/out/bun_js_parser"
