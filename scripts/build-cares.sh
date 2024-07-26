#!/usr/bin/env bash
set -exo pipefail

export FORCE_PIC=1
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cd $BUN_DEPS_DIR/c-ares

rm -rf build CMakeCache.txt CMakeFiles
mkdir -p build

cd build

cmake "${CMAKE_FLAGS[@]}" .. \
  -DCMAKE_INSTALL_LIBDIR=lib \
  -DCARES_STATIC=ON \
  -DCARES_STATIC_PIC=OFF \
  -DCARES_SHARED=OFF \
  -DCARES_BUILD_TOOLS=ON \
  -G "Ninja"

ninja

cp lib/libcares.a $BUN_DEPS_OUT_DIR/libcares.a
