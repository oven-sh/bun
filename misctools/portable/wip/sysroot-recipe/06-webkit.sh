#!/bin/bash
# Steps 3/4: configure and build the jsc shell. Usage: 06-webkit.sh portable|native [configure|build|all]
set -euo pipefail
. /tmp/portable/jsc/scripts/env.sh
MODE=$1; WHAT=${2:-all}
SRC=$JSCDIR/src/WebKit
B=$JSCDIR/build/webkit-$MODE
MARCH="-march=nehalem"      # scripts/build/flags.ts cpuTargetFlags (x64)

# Same as scripts/build/deps/webkit.ts (local mode), release, no asan, no lto.
COMMON_ARGS=(
  -DPORT=JSCOnly
  -DCMAKE_BUILD_TYPE=Release
  -DENABLE_STATIC_JSC=ON
  -DUSE_THIN_ARCHIVES=OFF
  -DENABLE_FTL_JIT=ON
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
  -DUSE_BUN_JSC_ADDITIONS=ON
  -DUSE_BUN_EVENT_LOOP=ON
  -DUSE_MIMALLOC=ON
  -DUSE_EXTERNAL_MIMALLOC=ON
  -DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON
  -DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON
  -DENABLE_REMOTE_INSPECTOR=ON
  -DENABLE_MEDIA_SOURCE=OFF
  -DENABLE_MEDIA_STREAM=OFF
  -DENABLE_WEB_RTC=OFF
  -DCMAKE_C_COMPILER=$LLVM_BIN/clang
  -DCMAKE_CXX_COMPILER=$LLVM_BIN/clang++
  -DCMAKE_AR=$LLVM_BIN/llvm-ar
  -DCMAKE_RANLIB=$LLVM_BIN/llvm-ranlib
)

if [ "$MODE" = portable ]; then
  T="--target=$PTARGET --sysroot=$SYSROOT -resource-dir=$SYSROOT/clang-resource-dir $PORTABLE_ABI_FLAGS $MARCH"
  MODE_ARGS=(
    "-DCMAKE_C_FLAGS=$T"
    "-DCMAKE_CXX_FLAGS=$T -stdlib++-isystem $SYSROOT/usr/include/c++/v1 -stdlib=libc++"
    "-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld -static-pie -rtlib=compiler-rt -unwindlib=libunwind"
    -DICU_ROOT=$SYSROOT/usr
    -DPORTABLE_SPIKE_MIMALLOC_OBJECT=$JSCDIR/mimalloc-portable-pthreads/mimalloc.o
  )
elif [ "$MODE" = glibcabi ]; then
  # decomposition variant: host glibc (dynamic), host libc++ (static), portable ABI code generation flags, PIE
  T="$PORTABLE_ABI_FLAGS $MARCH"
  MODE_ARGS=(
    "-DCMAKE_C_FLAGS=$T"
    "-DCMAKE_CXX_FLAGS=$T -stdlib=libc++"
    "-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld -pie -stdlib=libc++ -static-libstdc++ -static-libgcc"
    -DICU_ROOT=$JSCDIR/glibcabi-icu
    -DPORTABLE_SPIKE_MIMALLOC_OBJECT=$JSCDIR/mimalloc-glibcabi-pthreads/mimalloc.o
  )
else
  # webkit.ts: -fno-pic -fno-pie -no-pie + CMAKE_POSITION_INDEPENDENT_CODE=OFF; bun links libstdc++/libgcc statically.
  T="$MARCH -fno-pic -fno-pie -no-pie"
  MODE_ARGS=(
    "-DCMAKE_C_FLAGS=$T"
    "-DCMAKE_CXX_FLAGS=$T"
    "-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld -static-libstdc++ -static-libgcc"
    -DCMAKE_POSITION_INDEPENDENT_CODE=OFF
    -DICU_ROOT=$JSCDIR/native-icu
    -DPORTABLE_SPIKE_MIMALLOC_OBJECT=$JSCDIR/mimalloc-native-default/mimalloc.o
  )
fi

if [ "$WHAT" = configure ] || [ "$WHAT" = all ]; then
  rm -rf "$B"; mkdir -p "$B"
  cmake -G Ninja -S "$SRC" -B "$B" "${COMMON_ARGS[@]}" "${MODE_ARGS[@]}"
fi
if [ "$WHAT" = build ] || [ "$WHAT" = all ]; then
  time ninja -C "$B" -j$JOBS jsc
fi
