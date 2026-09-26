#!/bin/bash
# Step 1b: compiler-rt builtins (+crtbegin/crtend) for x86_64-linux-musl, portable ABI flags.
# Installed into a private clang resource dir inside the sysroot so that the driver never
# picks the host's glibc/red-zone libclang_rt.builtins-x86_64.a.
set -euo pipefail
. /tmp/portable/jsc/scripts/env.sh
RES=$SYSROOT/clang-resource-dir
HOSTRES=$($LLVM_BIN/clang -print-resource-dir)
mkdir -p $RES
rm -rf $RES/include; cp -aL $HOSTRES/include $RES/include
B=$JSCDIR/build/compiler-rt
rm -rf "$B"; mkdir -p "$B"
cmake -G Ninja -S $JSCDIR/src/llvm-project/compiler-rt/lib/builtins -B "$B" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=$LLVM_BIN/clang -DCMAKE_CXX_COMPILER=$LLVM_BIN/clang++ -DCMAKE_ASM_COMPILER=$LLVM_BIN/clang \
  -DCMAKE_AR=$LLVM_BIN/llvm-ar -DCMAKE_RANLIB=$LLVM_BIN/llvm-ranlib -DCMAKE_NM=$LLVM_BIN/llvm-nm \
  -DCMAKE_C_COMPILER_TARGET=$PTARGET -DCMAKE_CXX_COMPILER_TARGET=$PTARGET -DCMAKE_ASM_COMPILER_TARGET=$PTARGET \
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
  -DCMAKE_SYSROOT=$SYSROOT \
  -DCMAKE_C_FLAGS="$PORTABLE_ABI_FLAGS" -DCMAKE_CXX_FLAGS="$PORTABLE_ABI_FLAGS" -DCMAKE_ASM_FLAGS="$PORTABLE_ABI_FLAGS" \
  -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
  -DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON \
  -DCOMPILER_RT_BUILD_CRT=ON \
  -DCOMPILER_RT_BUILTINS_HIDE_SYMBOLS=ON \
  -DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=ON \
  -DLLVM_CMAKE_DIR=$JSCDIR/src/llvm-project/llvm/cmake/modules \
  -DCMAKE_INSTALL_PREFIX=$RES \
  -DCOMPILER_RT_INSTALL_PATH=$RES
ninja -C "$B" -j$JOBS
ninja -C "$B" install
find $RES/lib -type f | sort
