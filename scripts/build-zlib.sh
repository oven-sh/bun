#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR
cd $BUN_DEPS_DIR/zlib
CFLAGS="${CFLAGS}" ./configure --static
make -j${CPUS} libz.a
cp ./libz.a $BUN_DEPS_OUT_DIR/libz.a
