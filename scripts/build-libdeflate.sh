#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR
cd $BUN_DEPS_DIR/libdeflate
rm -rf build CMakeCache.txt CMakeFiles
cmake "${CMAKE_FLAGS[@]}" -DLIBDEFLATE_BUILD_STATIC_LIB=ON -DLIBDEFLATE_BUILD_SHARED_LIB=OFF -DLIBDEFLATE_BUILD_GZIP=OFF -B build -S . -G Ninja
ninja libdeflate.a -C build
cp build/libdeflate.a $BUN_DEPS_OUT_DIR/libdeflate.a
