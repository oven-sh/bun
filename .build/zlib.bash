#!/usr/bin/env bash

set -euxo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
CMAKE_FLAGS=${CMAKE_FLAGS:-}
BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd $SCRIPT_DIR && cd ../ && pwd)}
BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/src/deps/}
BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps}
CCACHE_CC_FLAG=${CCACHE_CC_FLAG:-}
CPUS=${CPUS:-$(nproc || sysctl -n hw.ncpu || echo 1)}

mkdir -p $BUN_DEPS_OUT_DIR
cd $BUN_DEPS_DIR/zlib
make clean
$CCACHE_CC_FLAG CFLAGS="$CFLAGS" ./configure --static
make -j${CPUS}
cp ./libz.a $BUN_DEPS_OUT_DIR/libz.a
