#!/usr/bin/env bash
# Build + run the HPACK criterion bench (src/hpack/benches/hpack.rs): compiles the Huffman kernel and
# the part of Highway it needs into one archive and points RUSTFLAGS at it. Needs `bun bd` once.
# `--scalar` leaves the kernel out, as on a CPU without AVX-512 VBMI. Other arguments go to criterion,
# for example `encode/add/text` or `--save-baseline main`.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d vendor/highway ]; then
  echo "error: vendor/ not populated — run \`bun bd\` (or \`bun run build\`) once first" >&2
  exit 1
fi
export BUN_CODEGEN_DIR=${BUN_CODEGEN_DIR:-$PWD/build/debug/codegen}

SUP=target/bench-hpack-cdeps
KERNEL=()
if [ "${1:-}" = "--scalar" ]; then
  shift
  SUP=$SUP-scalar
  KERNEL=(-DHWY_COMPILE_ONLY_STATIC)
fi
mkdir -p "$SUP"
CXX=${CXX:-c++}
# What release builds of Bun are compiled for.
CPU=()
[ "$(uname -m)" = x86_64 ] && CPU=(-march=nehalem) && RUSTFLAGS="${RUSTFLAGS:-} -Ctarget-cpu=nehalem"
for f in abort targets; do
  $CXX -O3 -fPIC -std=c++17 -Ivendor/highway -c "vendor/highway/hwy/$f.cc" -o "$SUP/hwy_$f.o"
done
$CXX -O3 -fPIC -std=c++20 ${CPU[@]+"${CPU[@]}"} ${KERNEL[@]+"${KERNEL[@]}"} -Ivendor/highway -Isrc/jsc/bindings \
  -c src/jsc/bindings/highway_hpack.cpp -o "$SUP/highway_hpack.o"
# Cargo goes by the flags and not by the file, so a changed kernel needs another name to be linked.
LIB=$SUP/libbun_bench_cdeps-$(cksum <"$SUP/highway_hpack.o" | cut -d' ' -f1).a
rm -f "$SUP"/libbun_bench_cdeps*.a
ar rcs "$LIB" "$SUP"/*.o

CXXLIB=stdc++
[ "$(uname -s)" = Darwin ] && CXXLIB=c++
export RUSTFLAGS="${RUSTFLAGS:-} -Clink-arg=$PWD/$LIB -Clink-arg=-l$CXXLIB"
export CARGO_PROFILE_BENCH_LTO=${CARGO_PROFILE_BENCH_LTO:-fat}
exec cargo bench -p bun_hpack --bench hpack -- "$@"
