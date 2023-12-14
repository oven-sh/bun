#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cd $BUN_DEPS_DIR/base64

rm -rf build
mkdir -p build
cd build

cmake "${CMAKE_FLAGS[@]}" .. -GNinja -B .
ninja

cp libbase64.a $BUN_DEPS_OUT_DIR/libbase64.a
