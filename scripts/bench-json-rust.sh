#!/usr/bin/env bash
# Build + run the JSON parser criterion bench (src/parsers/benches/json_parse.rs): compiles the
# native pieces the parser reaches into one archive and points RUSTFLAGS at it. Needs `bun bd` once.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d vendor/mimalloc ] || [ ! -d vendor/highway ]; then
  echo "error: vendor/ not populated — run \`bun bd\` (or \`bun run build\`) once first" >&2
  exit 1
fi

SUP=target/bench-json-cdeps
mkdir -p "$SUP/wtf"
export BUN_CODEGEN_DIR=${BUN_CODEGEN_DIR:-$PWD/build/debug/codegen}
if [ ! -f "$BUN_CODEGEN_DIR/json_byte_class.h" ]; then
  echo "error: $BUN_CODEGEN_DIR/json_byte_class.h not found — run \`bun bd\` once first" >&2
  exit 1
fi
CC=${CC:-cc}
CXX=${CXX:-c++}
SIMDUTF_VERSION=v7.3.6
SIMDUTF_STAMP="$SUP/.simdutf-$SIMDUTF_VERSION"
if [ ! -f "$SIMDUTF_STAMP" ] || [ ! -f "$SUP/simdutf.cpp" ]; then
  curl -fsSL -o "$SUP/simdutf.cpp" "https://github.com/simdutf/simdutf/releases/download/$SIMDUTF_VERSION/simdutf.cpp"
  curl -fsSL -o "$SUP/simdutf.h" "https://github.com/simdutf/simdutf/releases/download/$SIMDUTF_VERSION/simdutf.h"
  rm -f "$SUP"/simdutf*.o "$SUP"/.simdutf-*
  touch "$SIMDUTF_STAMP"
fi
printf '#pragma once\n#include "simdutf.h"\n' > "$SUP/wtf/SIMDUTF.h"

build() {
  local out=$1
  shift
  if [ ! -f "$out" ] || [ "${*: -1}" -nt "$out" ]; then "$@" -o "$out"; fi
}
MI_FLAGS=(-O2 -fPIC -ftls-model=initial-exec -DNDEBUG -D_GNU_SOURCE -DMI_STATIC_LIB
  -DMI_SKIP_COLLECT_ON_EXIT=1 -DMI_DEFAULT_ALLOW_THP=0 -DMI_NO_SET_VMA_NAME=1)
build "$SUP/mimalloc.o" $CC "${MI_FLAGS[@]}" -Ivendor/mimalloc/include -c vendor/mimalloc/src/static.c
build "$SUP/simdutf.o" $CXX -O3 -fPIC -std=c++20 -I"$SUP" -c "$SUP/simdutf.cpp"
build "$SUP/simdutf_shim.o" $CXX -O3 -fPIC -std=c++20 -I"$SUP" -c src/parsers/benches/support/simdutf_shim.cpp
for f in abort targets per_target print timer nanobenchmark aligned_allocator; do
  build "$SUP/hwy_$f.o" $CXX -O3 -fPIC -std=c++17 -Ivendor/highway -c "vendor/highway/hwy/$f.cc"
done
if [ -f src/jsc/bindings/highway_json.cpp ]; then
  $CXX -O3 -fPIC -std=c++17 -Ivendor/highway -Isrc/jsc/bindings -I"$BUN_CODEGEN_DIR" -c src/jsc/bindings/highway_json.cpp -o "$SUP/highway_json.o"
fi
rm -f "$SUP/libbun_bench_cdeps.a"
ar rcs "$SUP/libbun_bench_cdeps.a" "$SUP"/*.o
ranlib "$SUP/libbun_bench_cdeps.a"

export MIMALLOC_PURGE_DELAY=${MIMALLOC_PURGE_DELAY:-2000}
export BUN_JSON_BENCH_FIXTURES=${BUN_JSON_BENCH_FIXTURES:-$PWD/bench/json-corpus}
CXXLIB=stdc++
[ "$(uname -s)" = Darwin ] && CXXLIB=c++
export RUSTFLAGS="${RUSTFLAGS:-} -Clink-arg=$PWD/$SUP/libbun_bench_cdeps.a -Clink-arg=-l$CXXLIB -Clink-arg=-lm -Clink-arg=-ldl -Clink-arg=-lpthread -Clink-arg=-lc"

if [ "${1:-}" = "--test" ]; then
  shift
  exec cargo test -p bun_parsers --lib --release "$@"
fi
exec cargo bench -p bun_parsers --bench json_parse "$@"
