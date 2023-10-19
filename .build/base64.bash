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

cp $BUN_DEPS_DIR/base64
make clean
cmake $CMAKE_FLAGS .
make
cp libbase64.a $BUN_DEPS_OUT_DIR/libbase64.a
