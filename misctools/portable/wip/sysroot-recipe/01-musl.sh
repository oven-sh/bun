#!/bin/bash
# Step 1a: musl 1.2.5, static only, clang, portable ABI flags.
set -euo pipefail
. /tmp/portable/jsc/scripts/env.sh
B=$JSCDIR/build/musl
rm -rf "$B"; mkdir -p "$B"; cd "$B"
CC="$LLVM_BIN/clang --target=$PTARGET" \
AR=$LLVM_BIN/llvm-ar RANLIB=$LLVM_BIN/llvm-ranlib \
CFLAGS="$PORTABLE_ABI_FLAGS" \
$JSCDIR/src/musl/configure --prefix=$SYSROOT/usr --syslibdir=$SYSROOT/lib \
   --disable-shared --enable-static --target=$PTARGET
make -j$JOBS
make install
# Linux kernel headers from the host.
mkdir -p $SYSROOT/usr/include
cp -a /usr/include/linux $SYSROOT/usr/include/
cp -a /usr/include/asm-generic $SYSROOT/usr/include/
cp -aL /usr/include/x86_64-linux-gnu/asm $SYSROOT/usr/include/asm
