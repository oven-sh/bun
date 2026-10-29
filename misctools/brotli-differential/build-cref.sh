#!/bin/sh
# Builds the C reference library (google/brotli at the commit Bun pinned) that the harness links.
# -ffp-contract=off: no fused multiply-add, so that floating point matches on every machine.
# CFLAGS replaces -O2. Bun built the library with "-O3 -march=nehalem" on x64.
# Six upstream bugs are patched: memory corruption that the Rust port cannot reproduce, in the encoder and in the decoder, two
# that make streams which do not decode to the input, one that makes streams which no decoder accepts, and a call that is
# refused for no reason. See cref.patch.
set -e
HERE=$(dirname "$(readlink -f "$0")")
REF=${REF:-$HERE/brotli-ref}
OUT=${OUT:-$HERE/cref}
CC=${CC:-clang}
AR=${AR:-llvm-ar}
rm -rf "$OUT"; mkdir -p "$OUT/src"
cp -r "$REF/c" "$OUT/src/c"
# Not as part of the repository this directory is in, where git would skip the patch without an error.
(cd "$OUT/src" && GIT_DIR=/nonexistent git apply "$HERE/cref.patch")
grep -q "As an int it overflows in the last of the" "$OUT/src/c/dec/decode.c"
grep -q "even if it is more than the decoder accepts" "$OUT/src/c/enc/backward_references_hq.c"
grep -q "Upstream leaves next_out_ stale" "$OUT/src/c/enc/encode.c"
grep -q "Upstream takes max_distance for the start of the dictionary" "$OUT/src/c/enc/encode.c"
grep -q "which the caller did not ask for but has to complete" "$OUT/src/c/enc/encode.c"
grep -q "From upstream commit 54f74c7" "$OUT/src/c/enc/hash_longest_match_quickly_inc.h"
for f in "$OUT"/src/c/common/*.c "$OUT"/src/c/dec/*.c "$OUT"/src/c/enc/*.c; do
  o="$OUT/$(basename "$(dirname "$f")")_$(basename "$f" .c).o"
  $CC ${CFLAGS:--O2} -g -fPIC -ffp-contract=off -I"$OUT/src/c/include" -c "$f" -o "$o"
done
$AR rcs "$OUT/libbrotliref.a" "$OUT"/*.o
# For build.rs, which refuses a library that was built with another patch.
cp "$HERE/cref.patch" "$OUT/cref.patch"
echo "built $OUT/libbrotliref.a"
