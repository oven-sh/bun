#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/zstd
rm -rf Release CMakeCache.txt CMakeFiles
cmake "${CMAKE_FLAGS[@]}" -DZSTD_BUILD_STATIC=ON -B Release -S build/cmake -G Ninja
ninja -C Release
cp Release/lib/libzstd.a $BUN_DEPS_OUT_DIR/libzstd.a
