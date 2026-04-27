#!/usr/bin/env bash
# Build h3blast against Bun's already-compiled vendor objects.
# Requires that `bun run build:release` (or `bun bd`) has been run once so
# the lsquic/boringssl/hdrhistogram .o files exist under build/<profile>/obj.
set -euo pipefail

cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)

PROFILE=${PROFILE:-release}
OBJ=$ROOT/build/$PROFILE/obj/vendor
OUT=${OUT:-$PWD/build}
mkdir -p "$OUT"

CC=${CC:-clang}
AR=${AR:-llvm-ar}

if [[ ! -d "$OBJ/lsquic" ]]; then
  echo "error: $OBJ/lsquic not found — run 'bun run build:$PROFILE' first" >&2
  exit 1
fi

pack() {
  local name=$1; shift
  local lib=$OUT/lib$name.a
  rm -f "$lib"
  # shellcheck disable=SC2068
  "$AR" rcs "$lib" $@
}

echo "▸ archiving vendor objects ($PROFILE)"
pack lsquic   "$OBJ"/lsquic/src/liblsquic/*.o "$OBJ"/lsquic/*.o 2>/dev/null || \
pack lsquic   $(find "$OBJ/lsquic" -name '*.o')
pack lsqpack  $(find "$OBJ/lsqpack" -name '*.o')
pack lshpack  $(find "$OBJ/lshpack" -name '*.o')
pack ssl_all  $(find "$OBJ/boringssl" -name '*.o')
pack hdr      $(find "$OBJ/hdrhistogram" -name '*.o')
pack z        $(find "$OBJ/zlib" -name '*.o')

CFLAGS=(
  -O3 -g -std=gnu11 -Wall -Wextra -Wno-unused-parameter
  -I"$ROOT/vendor/lsquic/include"
  -I"$ROOT/vendor/boringssl/include"
  -I"$ROOT/vendor/hdrhistogram/include"
)

LDFLAGS=(
  -L"$OUT"
  -llsquic -llsqpack -llshpack -lssl_all -lhdr -lz
  -lpthread -lm -lstdc++
)

echo "▸ compiling h3blast"
"$CC" "${CFLAGS[@]}" src/h3blast.c "${LDFLAGS[@]}" -o "$OUT/h3blast"

echo "▸ done → $OUT/h3blast"
