#!/usr/bin/env bash

set -euxo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
CMAKE_FLAGS=${CMAKE_FLAGS:-}
BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd $SCRIPT_DIR && cd ../ && pwd)}
BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/src/deps/}
BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps}
CCACHE_CC_FLAG=${CCACHE_CC_FLAG:-}
CPUS=${CPUS:-$(nproc || sysctl -n hw.ncpu || echo 1)}
CFLAGS=${CFLAGS:-}

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/libarchive
make clean || echo ""
./build/clean.sh || echo ""
./build/autogen.sh
CFLAGS="$CFLAGS" $CCACHE_CC_FLAG ./configure --disable-shared --enable-static --with-pic --disable-bsdtar --disable-bsdcat --disable-rpath --enable-posix-regex-lib --without-xml2 --without-expat --without-openssl --without-iconv --without-zlib
make -j$CPUS
cp ./.libs/libarchive.a $BUN_DEPS_OUT_DIR/libarchive.a
