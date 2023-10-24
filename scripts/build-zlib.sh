#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR
cd $BUN_DEPS_DIR/zlib
CFLAGS="-O3" ./configure --static
make -j${CPUS}
cp ./libz.a $BUN_DEPS_OUT_DIR/libz.a
