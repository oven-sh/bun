#!/bin/sh
# Builds a test binary of the scratch copy of bun_js_parser under $1 (default /tmp/r4bu/root). Nothing is written in the worktree.
# Needs the target directory that `cargo test -p bun_js_parser --lib --no-run` left in the worktree.
# usage: /workspace/tools/lk sh build.sh [/tmp/r4bu/root]      output: <scratch>/out/bun_js_parser
set -e
ROOT=/workspace/wt/parser
SCRATCH=${1:-/tmp/r4bu/root}
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
  -C debuginfo=0 -C codegen-units=16 --cap-lints warn -o "$SCRATCH/out/bun_js_parser.new" \
  -C linker=/usr/lib/llvm-23/bin/clang++ -C link-arg=-fuse-ld=lld -C link-arg=-Qunused-arguments \
  $SEARCH $EXTERNS
mv "$SCRATCH/out/bun_js_parser.new" "$SCRATCH/out/bun_js_parser"
ls -la "$SCRATCH/out/bun_js_parser"
