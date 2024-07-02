#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/libarchive
# Libarchive has a "build" folder which we must not use
rm -rf libarchive-build
mkdir -p libarchive-build
cd libarchive-build
cmake $CMAKE_FLAGS \
  -DBUILD_SHARED_LIBS=0 \
  -DENABLE_BZIP2=0 \
  -DENABLE_CAT=0 \
  -DENABLE_EXPAT=0 \
  -DENABLE_ICONV=0 \
  -DENABLE_INSTALL=0 \
  -DENABLE_LIBB2=0 \
  -DENABLE_LibGCC=0 \
  -DENABLE_LIBXML2=0 \
  -DENABLE_LZ4=0 \
  -DENABLE_LZMA=0 \
  -DENABLE_LZO=0 \
  -DENABLE_MBEDTLS=0 \
  -DENABLE_NETTLE=0 \
  -DENABLE_OPENSSL=0 \
  -DENABLE_PCRE2POSIX=0 \
  -DENABLE_PCREPOSIX=0 \
  -DENABLE_TEST=0 \
  -DENABLE_WERROR=0 \
  -DENABLE_ZLIB=0 \
  -DENABLE_ZSTD=0 \
  -GNinja \
  -B . -S ..
cmake --build . --target libarchive.a --config Release -- -j$CPUS

cp ./libarchive/libarchive.a $BUN_DEPS_OUT_DIR/libarchive.a
