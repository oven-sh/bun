#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR

cd $BUN_DEPS_DIR/tinycc

if [ "$(uname -s)" = "FreeBSD" ]; then
    gmake clean
else
    make clean
fi
CFLAGS="${CFLAGS} -DTCC_LIBTCC1=\\\"\0\\\"" ./configure --enable-static --cc="$CC" --ar="$AR" --config-predefs=yes

if [ "$(uname -s)" = "FreeBSD" ]; then
    gmake libtcc.a -j$CPUS
else
    make libtcc.a -j$CPUS
fi
cp libtcc.a $BUN_DEPS_OUT_DIR
