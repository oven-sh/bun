#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/libarchive
make clean || echo ""
./build/clean.sh || echo ""
./build/autogen.sh
./configure --disable-shared --enable-static --with-pic --disable-bsdtar --disable-bsdcat --disable-rpath --enable-posix-regex-lib --without-xml2 --without-expat --without-openssl --without-iconv --without-zlib
make -j$CPUS
cp ./.libs/libarchive.a $BUN_DEPS_OUT_DIR/libarchive.a
