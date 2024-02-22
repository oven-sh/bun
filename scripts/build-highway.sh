#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cd $BUN_DEPS_DIR/highway

rm -rf build
mkdir -p build
cd build

cmake -DHWY_ENABLE_TESTS=OFF -DHWY_ENABLE_CONTRIB=OFF -DHWY_ENABLE_EXAMPLES=OFF -DHWY_ENABLE_INSTALL=ON "${CMAKE_FLAGS[@]}" .. -GNinja -B .
ninja

cp libhwy.a $BUN_DEPS_OUT_DIR/libhwy.a
