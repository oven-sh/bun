#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/tinycc
${MAKE} clean    

CFLAGS="${CFLAGS} -DTCC_LIBTCC1=\\\"\0\\\"" ./configure --enable-static --cc="$CC" --ar="$AR" --config-predefs=yes

${MAKE} libtcc.a -j$CPUS

cp libtcc.a $BUN_DEPS_OUT_DIR
