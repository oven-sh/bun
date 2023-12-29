#!/usr/bin/env bash
set -euxo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"

MIMALLOC_OVERRIDE_FLAG=${MIMALLOC_OVERRIDE_FLAG:-}
MIMALLOC_VALGRIND_ENABLED_FLAG=${MIMALLOC_VALGRIND_ENABLED_FLAG:-}

cd $BUN_DEPS_DIR/mimalloc

rm -rf CMakeCache* CMakeFiles

cmake "${CMAKE_FLAGS[@]}" . \
    -DCMAKE_BUILD_TYPE=Debug \
    -DMI_DEBUG=1 \
    -DMI_SKIP_COLLECT_ON_EXIT=1 \
    -DMI_BUILD_SHARED=OFF \
    -DMI_BUILD_STATIC=ON \
    -DMI_BUILD_TESTS=OFF \
    -DMI_OSX_ZONE=OFF \
    -DMI_OSX_INTERPOSE=OFF \
    -DMI_TRACK_VALGRIND=ON \
    -DMI_BUILD_OBJECT=ON \
    -DMI_USE_CXX=ON \
    -DMI_OVERRIDE=OFF \
    -DMI_OSX_ZONE=OFF \
    -GNinja

ninja

cp libmimalloc-debug.a $BUN_DEPS_OUT_DIR/libmimalloc-debug.a
cp CMakeFiles/mimalloc-obj.dir/src/static.c.o $BUN_DEPS_OUT_DIR/libmimalloc-debug.o
