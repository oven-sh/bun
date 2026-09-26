#!/bin/bash
# Step 3b: bun's vendored mimalloc (/workspace/bun/vendor/mimalloc, read only) built as one static TU (src/static.c
# compiled as C++, like scripts/build/deps/mimalloc.ts does). Usage: 05-mimalloc.sh portable|native [variant-name [extra flags...]]
set -euo pipefail
. /tmp/portable/jsc/scripts/env.sh
MODE=$1; VARIANT=${2:-default}; shift; shift || true
EXTRA="$*"
SRC=$JSCDIR/src/mimalloc-bun   # copy of /workspace/bun/vendor/mimalloc + patches/mimalloc-theap-null-in-new.diff
OUT=$JSCDIR/mimalloc-$MODE-$VARIANT
rm -rf "$OUT"; mkdir -p "$OUT"
# bun's global dep flags for a release linux build (scripts/build/flags.ts globalFlags), minus debug info
GLOBAL="-O3 -DNDEBUG -march=nehalem -fno-exceptions -fno-rtti -fno-c++-static-destructors -fno-omit-frame-pointer -mno-omit-leaf-frame-pointer -fno-stack-protector -fvisibility=hidden -fvisibility-inlines-hidden -fno-unwind-tables -fno-asynchronous-unwind-tables -ffunction-sections -fdata-sections -faddrsig -fno-semantic-interposition"
# mimalloc.ts defines and cflags
DEFS="-DMI_STATIC_LIB -DMI_SKIP_COLLECT_ON_EXIT=1 -DMI_NO_PROCESS_DETACH=1 -DMI_FREE_USE_PAGEMAP=1 -DMI_BUILD_RELEASE -DMI_DEFAULT_ALLOW_THP=0 -DMI_MALLOC_OVERRIDE -DMI_CMAKE_BUILD_TYPE=release"
MIFLAGS="-Wno-deprecated -Wno-static-in-inline -fno-builtin-malloc"
if [ "$MODE" = portable ]; then
  T="--target=$PTARGET --sysroot=$SYSROOT -resource-dir=$SYSROOT/clang-resource-dir -stdlib++-isystem $SYSROOT/usr/include/c++/v1 -stdlib=libc++ $PORTABLE_ABI_FLAGS"
  DEFS="$DEFS -DMI_LIBC_MUSL=1"
  TLSMODEL="-ftls-model=local-dynamic"
elif [ "$MODE" = glibcabi ]; then
  T="-stdlib=libc++ $PORTABLE_ABI_FLAGS"
  TLSMODEL="-ftls-model=initial-exec"
else
  T="-fPIC"
  TLSMODEL="-ftls-model=initial-exec"
fi
set -x
$LLVM_BIN/clang++ -x c++ -std=c++20 $T $GLOBAL $DEFS $MIFLAGS $TLSMODEL $EXTRA -I$SRC/include -c $SRC/src/static.c -o $OUT/mimalloc.o
$LLVM_BIN/llvm-ar rcs $OUT/libmimalloc.a $OUT/mimalloc.o
set +x
echo "$MODE $VARIANT: $T $GLOBAL $DEFS $MIFLAGS $TLSMODEL $EXTRA" > $OUT/FLAGS.txt
ls -la $OUT
