#!/bin/sh
# Builds the test binary of a scratch COPY of bun_js_parser (the prototype of this directory applied to it). Nothing is written in the worktree.
# It takes the libraries of the dependencies from the target directory that `cargo test -p bun_js_parser --lib` left in the worktree.
# usage: /workspace/tools/lk sh build-scratch.sh [/workspace/wt/parser] [/tmp/erased-types/scratch]     output: <scratch>/out/bun_js_parser
# The scratch copy is made by hand: cp -r <root>/src/js_parser <scratch>/src/js_parser, then `git apply --directory` of prototype.*.patch, then zz_probe.rs.
set -e
ROOT=${1:-/workspace/wt/parser}
SCRATCH=${2:-/tmp/erased-types/scratch}
BUILD="$ROOT/target/debug/build"
EXTERNS=""
for name in thiserror bitflags bun_collections strum smallvec bun_react_compiler enumset bun_options_types bun_wyhash bun_core bun_ast bun_base64 bstr bun_url bun_ptr bun_alloc bytemuck scopeguard bun_crash_handler bun_paths bun_highway; do
  lib=$(ls -tr "$BUILD/$name"/*/out/lib"$name"-*.rlib | head -1)
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
