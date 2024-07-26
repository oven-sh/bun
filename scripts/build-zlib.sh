#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR
cd $BUN_DEPS_DIR/zlib
rm -rf build
mkdir build
cd build
cmake $CMAKE_FLAGS -G Ninja -DCMAKE_BUILD_TYPE=Release ..
ninja
cp ./libz.a $BUN_DEPS_OUT_DIR/libz.a
