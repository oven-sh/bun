#!/usr/bin/env bash
# Regenerates src/jsc/bindings/icu_uts46_override.nrm.
#
# The bundled ICU prebuilts (ICU 75.1 on Linux/musl, ICU 73.2 on Windows) ship
# uts46.nrm data derived from Unicode 15.x's IdnaMappingTable.txt, which marks
# several late-casefolded capitals as "disallowed" (U+04C0, U+10A0..10C5,
# U+2132, U+2183, ...). Unicode 16.0's IdnaMappingTable.txt changed these to
# "mapped". This script produces a uts46.nrm carrying the Unicode 16.0 mappings
# in Nrm2 format version 4 (the format ICU 73/75's Normalizer2 reads), which
# bun_icu_decompress.cpp swaps in at runtime via the udata hook.
#
# Delete the override once the oven-sh/WebKit prebuilt bundles ICU 76 or later.
set -euo pipefail

ICU_TOOLCHAIN_TAG=release-75-1   # whose gennorm2 to use (emits Nrm2 format v4)
ICU_TOOLCHAIN_SRC=icu4c-75_1-src.tgz
ICU_DATA_TAG=release-76-1        # whose norm2/uts46.txt to compile

cd "$(dirname "$0")/.."
OUT="src/jsc/bindings/icu_uts46_override.nrm"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fL "https://github.com/unicode-org/icu/releases/download/${ICU_TOOLCHAIN_TAG}/${ICU_TOOLCHAIN_SRC}" \
  | tar -xz -C "$WORK"
pushd "$WORK/icu/source" >/dev/null
./configure --enable-static --disable-shared --with-data-packaging=archive \
  --disable-samples --disable-tests --disable-extras --disable-icuio >/dev/null
make -j"$(nproc)" >/dev/null
popd >/dev/null

curl -fL "https://raw.githubusercontent.com/unicode-org/icu/${ICU_DATA_TAG}/icu4c/source/data/unidata/norm2/uts46.txt" \
  -o "$WORK/icu/source/data/unidata/norm2/uts46.txt"

LD_LIBRARY_PATH="$WORK/icu/source/lib:$WORK/icu/source/stubdata" \
  "$WORK/icu/source/bin/gennorm2" -o "$OUT" \
  -s "$WORK/icu/source/data/unidata/norm2" nfc.txt uts46.txt

# Format-version sanity check: byte 16 must be 4.
fmt=$(od -An -t u1 -j 16 -N 1 "$OUT" | tr -d ' ')
if [ "$fmt" != "4" ]; then
  echo "error: generated $OUT has Nrm2 format version $fmt, expected 4" >&2
  exit 1
fi

echo "wrote $OUT ($(wc -c <"$OUT") bytes)"
