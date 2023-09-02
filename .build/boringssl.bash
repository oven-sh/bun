#!/usr/bin/env bash

set -euxo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
CMAKE_FLAGS=${CMAKE_FLAGS:-}
BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd $SCRIPT_DIR && cd ../ && pwd)}
BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/src/deps/}
BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps}
CCACHE_CC_FLAG=${CCACHE_CC_FLAG:-}
CFLAGS=${CFLAGS:-}

mkdir -p $BUN_DEPS_OUT_DIR
cd $BUN_DEPS_DIR/boringssl
rm -rf build
mkdir -p build
cd build
CFLAGS="$CFLAGS" cmake $CMAKE_FLAGS -DCMAKE_EXE_LINKER_FLAGS="-fuse-ld=lld" -GNinja ..
ninja libcrypto.a libssl.a libdecrepit.a
cp **/libcrypto.a $BUN_DEPS_OUT_DIR/libcrypto.a
cp **/libssl.a $BUN_DEPS_OUT_DIR/libssl.a
cp **/libdecrepit.a $BUN_DEPS_OUT_DIR/libdecrepit.a
