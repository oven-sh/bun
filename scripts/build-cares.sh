#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cd $BUN_DEPS_DIR/c-ares

rm -rf build
mkdir -p build

cd build

cmake "${CMAKE_FLAGS[@]}" .. \
  -DCMAKE_INSTALL_LIBDIR=lib \
  -DCARES_STATIC=ON \
  -DCARES_STATIC_PIC=ON \
  -DCARES_SHARED=OFF \
  -G "Ninja"

ninja

cp lib/libcares.a $BUN_DEPS_OUT_DIR/libcares.a
