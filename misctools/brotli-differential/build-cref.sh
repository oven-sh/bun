#!/bin/sh
# Builds the C reference library (google/brotli at the commit Bun pinned) that the harness links.
# -ffp-contract=off: no fused multiply-add, so that floating point matches on every machine.
# One upstream bug is patched, because it is memory corruption that the Rust port cannot reproduce: see cref.patch.
set -e
HERE=$(dirname "$(readlink -f "$0")")
REF=${REF:-$HERE/brotli-ref}
OUT=${OUT:-$HERE/cref}
CC=${CC:-clang}
AR=${AR:-llvm-ar}
rm -rf "$OUT"; mkdir -p "$OUT/src"
cp -r "$REF/c" "$OUT/src/c"
git -C "$OUT/src" apply --unsafe-paths --directory="$OUT/src" "$HERE/cref.patch" 2>/dev/null || (cd "$OUT/src" && git apply "$HERE/cref.patch")
for f in "$OUT"/src/c/common/*.c "$OUT"/src/c/dec/*.c "$OUT"/src/c/enc/*.c; do
  o="$OUT/$(basename "$(dirname "$f")")_$(basename "$f" .c).o"
  $CC -O2 -g -fPIC -ffp-contract=off -I"$OUT/src/c/include" -c "$f" -o "$o"
done
$AR rcs "$OUT/libbrotliref.a" "$OUT"/*.o
echo "built $OUT/libbrotliref.a"
