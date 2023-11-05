#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cd $BUN_DEPS_DIR/SDL

rm -rf build
./configure && make

cp build/.libs/libSDL2.a $BUN_DEPS_OUT_DIR/libSDL2.a