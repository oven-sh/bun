#!/bin/bash
# Step 2: ICU 78.3 static. Usage: 04-icu.sh portable|native
# portable -> installs into $SYSROOT/usr ; native -> installs into $JSCDIR/native-icu
set -euo pipefail
. /tmp/portable/jsc/scripts/env.sh
MODE=$1
SRC=$JSCDIR/src/icu-src/icu/source
B=$JSCDIR/build/icu-$MODE
rm -rf "$B"; mkdir -p "$B"; cd "$B"
# Same optimisation and codegen flags in both modes (close to oven-sh/WebKit Dockerfile.musl: -Os, sections, no unwind tables).
COMMON="-Os -march=nehalem -ffunction-sections -fdata-sections -fno-unwind-tables -fno-asynchronous-unwind-tables -DU_STATIC_IMPLEMENTATION=1"
if [ "$MODE" = portable ]; then
  RES=$SYSROOT/clang-resource-dir
  T="--target=$PTARGET --sysroot=$SYSROOT -resource-dir=$RES $PORTABLE_ABI_FLAGS"
  export CC="$LLVM_BIN/clang" CXX="$LLVM_BIN/clang++"
  export CFLAGS="$T $COMMON"
  export CXXFLAGS="$T -stdlib++-isystem $SYSROOT/usr/include/c++/v1 -stdlib=libc++ $COMMON -fno-exceptions -fno-c++-static-destructors"
  export LDFLAGS="$T -fuse-ld=lld -rtlib=compiler-rt -unwindlib=libunwind -stdlib=libc++ -static-pie"
  PREFIX=$SYSROOT/usr
elif [ "$MODE" = glibcabi ]; then
  # decomposition variant: host glibc, host libc++ (static), but the portable ABI code generation flags
  export CC="$LLVM_BIN/clang" CXX="$LLVM_BIN/clang++"
  export CFLAGS="$PORTABLE_ABI_FLAGS $COMMON"
  export CXXFLAGS="$PORTABLE_ABI_FLAGS -stdlib=libc++ $COMMON -fno-exceptions -fno-c++-static-destructors"
  export LDFLAGS="-fuse-ld=lld -stdlib=libc++ -static-libstdc++ -pie"
  PREFIX=$JSCDIR/glibcabi-icu
else
  export CC="$LLVM_BIN/clang" CXX="$LLVM_BIN/clang++"
  export CFLAGS="$COMMON"
  export CXXFLAGS="$COMMON -fno-exceptions -fno-c++-static-destructors"
  export LDFLAGS="-fuse-ld=lld"
  PREFIX=$JSCDIR/native-icu
fi
export AR=$LLVM_BIN/llvm-ar RANLIB=$LLVM_BIN/llvm-ranlib
$SRC/configure --prefix=$PREFIX --enable-static --disable-shared --with-data-packaging=static \
   --disable-samples --disable-debug --disable-tests --disable-extras --disable-icuio --disable-layoutex
make -j$JOBS
make install
ls -la $PREFIX/lib | grep -i icu
