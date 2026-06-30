#!/usr/bin/env bash
# Build + run the JSON parser criterion bench (src/parsers/benches/json_parse.rs).
#
# A cargo bench binary links the bun Rust crates but not the CMake-built C++
# side, so this script compiles the few native pieces the parser actually
# reaches — mimalloc, simdutf (+ Bun's simdutf__* wrapper), the highway
# runtime, and the highway JSON structural-index kernel — from the repo's own
# vendored sources into one small archive, then points RUSTFLAGS at it.
# Everything else (StackCheck bound, OOM handler) is shimmed inside the bench
# binary itself (src/parsers/native_test_shims.rs).
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
# Generated at configure time (`bun bd` / `bun run build`): the byte-class
# tables shared by the Highway kernel and the Rust scalar indexer.
export BUN_CODEGEN_DIR=${BUN_CODEGEN_DIR:-$PWD/build/debug/codegen}
if [ ! -f "$BUN_CODEGEN_DIR/json_byte_class.h" ]; then
  echo "error: $BUN_CODEGEN_DIR/json_byte_class.h not found — run \`bun bd\` once first" >&2
  exit 1
fi
CC=${CC:-cc}
CXX=${CXX:-c++}
# Pinned simdutf amalgamation for Bun's simdutf__* C wrapper (the real build
# gets simdutf from WebKit's WTF; the version difference is irrelevant here).
# The download and its .o are keyed on the version so bumping it rebuilds.
SIMDUTF_VERSION=v7.3.6
SIMDUTF_STAMP="$SUP/.simdutf-$SIMDUTF_VERSION"
if [ ! -f "$SIMDUTF_STAMP" ] || [ ! -f "$SUP/simdutf.cpp" ]; then
  curl -fsSL -o "$SUP/simdutf.cpp" "https://github.com/simdutf/simdutf/releases/download/$SIMDUTF_VERSION/simdutf.cpp"
  curl -fsSL -o "$SUP/simdutf.h" "https://github.com/simdutf/simdutf/releases/download/$SIMDUTF_VERSION/simdutf.h"
  # New header: everything compiled against the old one must rebuild.
  rm -f "$SUP"/simdutf*.o "$SUP"/.simdutf-*
  touch "$SIMDUTF_STAMP"
fi
printf '#pragma once\n#include "simdutf.h"\n' > "$SUP/wtf/SIMDUTF.h"

# build <out.o> <cmd... source>: compile if the object is missing or older
# than its source (the last argument).
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
  build "$SUP/highway_json.o" $CXX -O3 -fPIC -std=c++17 -Ivendor/highway -Isrc/jsc/bindings -I"$BUN_CODEGEN_DIR" -c src/jsc/bindings/highway_json.cpp
fi
rm -f "$SUP/libbun_bench_cdeps.a"
ar rcs "$SUP/libbun_bench_cdeps.a" "$SUP"/*.o
ranlib "$SUP/libbun_bench_cdeps.a"

# A criterion iteration is much slower than a real `bun install` manifest
# parse, so mimalloc's default 10ms purge delay returns the arena pages to
# the OS between iterations and the bench turns into a page-fault storm bun
# never sees in production. Keep pages resident like a busy install process.
export MIMALLOC_PURGE_DELAY=${MIMALLOC_PURGE_DELAY:-2000}
export BUN_JSON_BENCH_FIXTURES=${BUN_JSON_BENCH_FIXTURES:-$PWD/bench/json-corpus}
# Same link line everywhere; only the C++ runtime library name differs.
CXXLIB=stdc++
[ "$(uname -s)" = Darwin ] && CXXLIB=c++
export RUSTFLAGS="${RUSTFLAGS:-} -Clink-arg=$PWD/$SUP/libbun_bench_cdeps.a -Clink-arg=-l$CXXLIB -Clink-arg=-lm -Clink-arg=-ldl -Clink-arg=-lpthread -Clink-arg=-lc"

# `--test`: run the crate's unit tests (they need the same native archive).
if [ "${1:-}" = "--test" ]; then
  shift
  exec cargo test -p bun_parsers --lib --release "$@"
fi
exec cargo bench -p bun_parsers --bench json_parse "$@"
