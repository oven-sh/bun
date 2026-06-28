#!/usr/bin/env bash
# Build + run the JSON parser criterion bench (src/parsers/benches/json_parse.rs).
#
# A cargo bench binary links the bun Rust crates but not the CMake-built C++
# side, so this script compiles the few native pieces the parser actually
# reaches — mimalloc, simdutf (+ Bun's simdutf__* wrapper), the highway
# runtime, and the highway JSON structural-index kernel — from the repo's own
# vendored sources into one small archive, then points RUSTFLAGS at it.
# Everything else (StackCheck bound, OOM handler, the one legacy lexer highway
# call) is shimmed inside the bench file itself.
#
# Requires `vendor/` and `build/debug/codegen` to exist (run `bun bd` once).
#
#   scripts/bench-json-rust.sh                 # whole corpus
#   scripts/bench-json-rust.sh -- 'drizzle'    # criterion filter
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d vendor/mimalloc ] || [ ! -d vendor/highway ]; then
  echo "error: vendor/ not populated — run \`bun bd\` (or \`bun run build\`) once first" >&2
  exit 1
fi

SUP=target/bench-json-cdeps
mkdir -p "$SUP/wtf"
CC=${CC:-cc}
CXX=${CXX:-c++}
# Pinned simdutf amalgamation for Bun's simdutf__* C wrapper (the real build
# gets simdutf from WebKit's WTF; the version difference is irrelevant here).
SIMDUTF_VERSION=v7.3.6
if [ ! -f "$SUP/simdutf.cpp" ]; then
  curl -fsSL -o "$SUP/simdutf.cpp" "https://github.com/simdutf/simdutf/releases/download/$SIMDUTF_VERSION/simdutf.cpp"
  curl -fsSL -o "$SUP/simdutf.h" "https://github.com/simdutf/simdutf/releases/download/$SIMDUTF_VERSION/simdutf.h"
fi
printf '#pragma once\n#include "simdutf.h"\n' > "$SUP/wtf/SIMDUTF.h"

build() { # build <out.o> <cmd...>
  local out=$1
  shift
  if [ ! -f "$out" ] || [ "$1" = "-f" ]; then "$@" -o "$out"; fi
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
  # Always rebuild the kernel under iteration; it's one small TU.
  $CXX -O3 -fPIC -std=c++17 -Ivendor/highway -Isrc/jsc/bindings -c src/jsc/bindings/highway_json.cpp -o "$SUP/highway_json.o"
fi
rm -f "$SUP/libbun_bench_cdeps.a"
ar rcs "$SUP/libbun_bench_cdeps.a" "$SUP"/*.o
ranlib "$SUP/libbun_bench_cdeps.a"

# A criterion iteration is much slower than a real `bun install` manifest
# parse, so mimalloc's default 10ms purge delay returns the arena pages to
# the OS between iterations and the bench turns into a page-fault storm bun
# never sees in production. Keep pages resident like a busy install process.
export MIMALLOC_PURGE_DELAY=${MIMALLOC_PURGE_DELAY:-2000}
export BUN_CODEGEN_DIR=${BUN_CODEGEN_DIR:-$PWD/build/debug/codegen}
export BUN_JSON_BENCH_FIXTURES=${BUN_JSON_BENCH_FIXTURES:-$PWD/bench/json-corpus}
export RUSTFLAGS="${RUSTFLAGS:-} -Clink-arg=$PWD/$SUP/libbun_bench_cdeps.a -Clink-arg=-lstdc++ -Clink-arg=-lm -Clink-arg=-ldl -Clink-arg=-lpthread -Clink-arg=-lc"

# `--test`: run the crate's unit tests (they need the same native archive).
if [ "${1:-}" = "--test" ]; then
  shift
  exec cargo test -p bun_parsers --lib --release "$@"
fi
exec cargo bench -p bun_parsers --bench json_parse "$@"
