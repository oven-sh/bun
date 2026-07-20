#!/usr/bin/env bash
# Regenerates src/jsc/bindings/icu_uts46_override.nrm: a Unicode 16.0 UTS #46
# uts46.nrm in Nrm2 format v4 (readable by the bundled ICU 73/75), swapped in at
# runtime by bun_icu_decompress.cpp. Drop once the WebKit prebuilt ships ICU 76+.
set -euo pipefail

ICU_TOOLCHAIN_TAG=release-75-1   # whose gennorm2 to use (emits Nrm2 format v4)
ICU_TOOLCHAIN_SRC=icu4c-75_1-src.tgz
ICU_TOOLCHAIN_SHA256=cb968df3e4d2e87e8b11c49a5d01c787bd13b9545280fc6642f826527618caef
ICU_DATA_TAG=release-76-1        # whose norm2/uts46.txt to compile
ICU_DATA_SHA256=fda2c1c636d71db2cc685ca7671aff8efa27e83d84ee322cc3ce1375e53300d8

REPO_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
OUT="$REPO_ROOT/src/jsc/bindings/icu_uts46_override.nrm"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fetch() {
  curl -fL --proto '=https' --tlsv1.2 "$1" -o "$2"
  echo "$3  $2" | sha256sum -c -
}

fetch "https://github.com/unicode-org/icu/releases/download/${ICU_TOOLCHAIN_TAG}/${ICU_TOOLCHAIN_SRC}" \
  "$WORK/icu.tgz" "$ICU_TOOLCHAIN_SHA256"
tar -xzf "$WORK/icu.tgz" -C "$WORK"
pushd "$WORK/icu/source" >/dev/null
./configure --enable-static --disable-shared --with-data-packaging=archive \
  --disable-samples --disable-tests --disable-extras --disable-icuio >/dev/null
make -j"$(nproc)" >/dev/null
popd >/dev/null

fetch "https://raw.githubusercontent.com/unicode-org/icu/${ICU_DATA_TAG}/icu4c/source/data/unidata/norm2/uts46.txt" \
  "$WORK/icu/source/data/unidata/norm2/uts46.txt" "$ICU_DATA_SHA256"

LD_LIBRARY_PATH="$WORK/icu/source/lib:$WORK/icu/source/stubdata" \
  "$WORK/icu/source/bin/gennorm2" -o "$OUT" \
  -s "$WORK/icu/source/data/unidata/norm2" nfc.txt uts46.txt

fmt=$(od -An -t u1 -j 16 -N 1 "$OUT" | tr -d ' ')
[ "$fmt" = "4" ] || { echo "error: $OUT has Nrm2 format version $fmt, expected 4" >&2; exit 1; }

echo "wrote $OUT ($(wc -c <"$OUT") bytes, md5 $(md5sum "$OUT" | cut -d' ' -f1))"
