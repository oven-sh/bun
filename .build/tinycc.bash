#!/usr/bin/env bash

set -euxo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
CMAKE_FLAGS=${CMAKE_FLAGS:-}
BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd $SCRIPT_DIR && cd ../ && pwd)}
BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/src/deps/}
BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps}
CCACHE_CC_FLAG=${CCACHE_CC_FLAG:-}
CPUS=${CPUS:-$(nproc || sysctl -n hw.ncpu || echo 1)}
AR=${AR:-ar}
CC=${CC:-cc}
CFLAGS=${CFLAGS:-}

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/tinycc
make clean
AR=$AR CC=$CC CFLAGS="$CFLAGS" ./configure --enable-static --cc=$CC --ar=$AR --config-predefs=yes
make -j10
cp *.a $BUN_DEPS_OUT_DIR
