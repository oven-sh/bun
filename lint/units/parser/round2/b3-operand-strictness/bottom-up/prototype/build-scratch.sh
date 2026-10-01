#!/bin/sh
# Builds the test binary of a scratch COPY of bun_js_parser with the prototype of B3 applied. Nothing is written in the worktree.
# It takes the libraries of the dependencies from the target directory that `cargo test -p bun_js_parser --lib` left in the worktree.
# usage: /workspace/tools/lk sh build-scratch.sh [/workspace/wt/parser] [/tmp/b3/scratch] [plain]     output: <scratch>/out/bun_js_parser
# "plain": the copy gets the probe alone, no prototype.
set -e
ROOT=${1:-/workspace/wt/parser}
SCRATCH=${2:-/tmp/b3/scratch}
MODE=${3:-prototype}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$SCRATCH/src/js_parser"
mkdir -p "$SCRATCH/src" "$SCRATCH/out"
cp -r "$ROOT/src/js_parser" "$SCRATCH/src/js_parser"
if [ "$MODE" = prototype ]; then
  cp "$HERE/operand_checks.rs" "$SCRATCH/src/js_parser/parse/operand_checks.rs"
  python3 "$HERE/apply.py" "$SCRATCH/src/js_parser"
fi
cp /workspace/notes/lint/units/parser/round2/strict-members-params-heritage/bottom-up/zz_probe.rs "$SCRATCH/src/js_parser/zz_probe.rs"
printf '\n#[cfg(test)]\nmod zz_probe;\n' >> "$SCRATCH/src/js_parser/lib.rs"
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
  --error-format=short $SEARCH $EXTERNS
mv "$SCRATCH/out/bun_js_parser.new" "$SCRATCH/out/bun_js_parser"
ls -la "$SCRATCH/out/bun_js_parser"
