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
MIMALLOC_OVERRIDE_FLAG=${MIMALLOC_OVERRIDE_FLAG:-}
MIMALLOC_VALGRIND_ENABLED_FLAG=${MIMALLOC_VALGRIND_ENABLED_FLAG:-}

mkdir -p $BUN_DEPS_OUT_DIR

rm -rf $BUN_DEPS_DIR/mimalloc/CMakeCache* $BUN_DEPS_DIR/mimalloc/CMakeFiles
cd $BUN_DEPS_DIR/mimalloc
make clean || echo ""
CFLAGS="$CFLAGS" cmake $CMAKE_FLAGS $MIMALLOC_OVERRIDE_FLAG \
    -DMI_SKIP_COLLECT_ON_EXIT=1 \
    -DMI_BUILD_SHARED=OFF \
    -DMI_BUILD_STATIC=ON \
    -DMI_BUILD_TESTS=OFF \
    -DMI_OSX_ZONE=OFF \
    -DMI_OSX_INTERPOSE=OFF \
    -DMI_BUILD_OBJECT=ON \
    -DMI_USE_CXX=ON \
    -DMI_OVERRIDE=OFF \
    -DMI_OSX_ZONE=OFF \
    -DCMAKE_C_FLAGS="$CFLAGS" \
    -GNinja .

ninja

cp $BUN_DEPS_DIR/mimalloc/libmimalloc.a $BUN_DEPS_OUT_DIR/libmimalloc.a
