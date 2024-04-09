#!/usr/bin/env bash
set -euxo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"

MIMALLOC_OVERRIDE_FLAG=${MIMALLOC_OVERRIDE_FLAG:-}
MIMALLOC_VALGRIND_ENABLED_FLAG=${MIMALLOC_VALGRIND_ENABLED_FLAG:-}

cd $BUN_DEPS_DIR/mimalloc

rm -f libmimalloc.a
rm -rf CMakeCache* CMakeFiles

sed -i '' '/set(mi_basename "${mi_basename/d' CMakeLists.txt

CMAKE_FLAGS_EXTRA=""

if [ "${CMAKE_BUILD_TYPE}x" = "Debugx" ]
then
    CMAKE_FLAGS_EXTRA="-DMI_DEBUG=1 -DMI_TRACK_VALGRIND=ON"
fi

cmake "${CMAKE_FLAGS[@]}" . \
    -DCMAKE_BUILD_TYPE_LC=none \
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
    ${CMAKE_FLAGS_EXTRA} \
    -GNinja

ninja

cp libmimalloc.a $BUN_DEPS_OUT_DIR/libmimalloc.a
cp CMakeFiles/mimalloc-obj.dir/src/static.c.o $BUN_DEPS_OUT_DIR/libmimalloc.o
