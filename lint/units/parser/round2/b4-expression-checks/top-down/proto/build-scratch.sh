#!/bin/sh
# Builds the test binary of a scratch COPY of bun_js_parser, with the prototype of B4 applied or as the head is. Nothing is written in the worktree.
# It takes the libraries of the dependencies from the target directory that `cargo test -p bun_js_parser --lib` left in the worktree.
# usage: /workspace/tools/lk sh build-scratch.sh <head|proto|proto-nocomments> [/workspace/wt/parser] [/tmp/b4td/scratch]     output: <scratch>/out/bun_js_parser.<variant>
set -e
VARIANT=${1:-proto}
ROOT=${2:-/workspace/wt/parser}
SCRATCH=${3:-/tmp/b4td/scratch}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$SCRATCH/$VARIANT"
mkdir -p "$SCRATCH/$VARIANT/src" "$SCRATCH/out"
cp -r "$ROOT/src/js_parser" "$SCRATCH/$VARIANT/src/js_parser"
case "$VARIANT" in
  proto) python3 "$HERE/apply.py" "$SCRATCH/$VARIANT/src/js_parser" --comments ;;
  proto-nocomments) python3 "$HERE/apply.py" "$SCRATCH/$VARIANT/src/js_parser" ;;
  head) ;;
esac
cp "$HERE/zz_probe.rs" "$SCRATCH/$VARIANT/src/js_parser/zz_probe.rs"
printf '\n#[cfg(test)]\nmod zz_probe;\n' >> "$SCRATCH/$VARIANT/src/js_parser/lib.rs"
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
rustc --crate-name bun_js_parser --edition=2024 "$SCRATCH/$VARIANT/src/js_parser/lib.rs" --test --emit=link \
  -C debuginfo=0 -C codegen-units=16 --cap-lints allow -o "$SCRATCH/out/bun_js_parser.$VARIANT.new" \
  -C linker=/usr/lib/llvm-23/bin/clang++ -C link-arg=-fuse-ld=lld -C link-arg=-Qunused-arguments \
  $SEARCH $EXTERNS
mv "$SCRATCH/out/bun_js_parser.$VARIANT.new" "$SCRATCH/out/bun_js_parser.$VARIANT"
ls -la "$SCRATCH/out/bun_js_parser.$VARIANT"
