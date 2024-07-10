#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cd $BUN_DEPS_DIR/boringssl
mkdir -p build
cd build

cmake "${CMAKE_FLAGS[@]}" -DCMAKE_EXE_LINKER_FLAGS="-fuse-ld=lld" -GNinja ..
ninja libcrypto.a libssl.a libdecrepit.a

cp **/libcrypto.a $BUN_DEPS_OUT_DIR/libcrypto.a
cp **/libssl.a $BUN_DEPS_OUT_DIR/libssl.a
cp **/libdecrepit.a $BUN_DEPS_OUT_DIR/libdecrepit.a
