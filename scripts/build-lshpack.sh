#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/ls-hpack


rm -rf CMakeCache* CMakeFiles

cmake "${CMAKE_FLAGS[@]}" . \
    -DCMAKE_BUILD_TYPE=Release \
    -DLSHPACK_XXH=ON \
    -DSHARED=0 \
    -GNinja

ninja

cp ./libls-hpack.a $BUN_DEPS_OUT_DIR/liblshpack.a
