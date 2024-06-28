#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

mkdir -p $BUN_DEPS_OUT_DIR
cd $BUN_DEPS_DIR/zlib
export CFLAGS="-O3"
if [[ $(uname -s) == 'Darwin' ]]; then
  export CFLAGS="$CFLAGS -mmacosx-version-min=${CMAKE_OSX_DEPLOYMENT_TARGET}"
fi
CFLAGS="${CFLAGS}" ./configure --static
make -j${CPUS}
cp ./libz.a $BUN_DEPS_OUT_DIR/libz.a
