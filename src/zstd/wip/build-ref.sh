#!/bin/bash
# Builds the reference C zstd exactly as Bun's scripts/build/deps/zstd.ts did (pin f8745da6 + Bun's two patches).
set -e
cd /root/zstd-ref
SRC="common/debug common/entropy_common common/error_private common/fse_decompress common/pool common/threading common/xxhash common/zstd_common compress/fse_compress compress/hist compress/huf_compress compress/zstd_compress compress/zstd_compress_literals compress/zstd_compress_sequences compress/zstd_compress_superblock compress/zstd_double_fast compress/zstd_fast compress/zstd_lazy compress/zstd_ldm compress/zstd_opt compress/zstd_preSplit compress/zstdmt_compress decompress/huf_decompress decompress/zstd_ddict decompress/zstd_decompress decompress/zstd_decompress_block"
build() { # name, extra flags, asm?
  local name=$1; shift; local asm=$1; shift
  mkdir -p build/$name; local objs=""
  for s in $SRC; do o=build/$name/$(basename $s).o; clang-23 -c -O2 -g -fPIC -march=nehalem -DZSTD_MULTITHREAD -DZSTD_LEGACY_SUPPORT=0 -DXXH_NAMESPACE=ZSTD_ -Izstd/lib -Izstd/lib/common "$@" zstd/lib/$s.c -o $o & objs="$objs $o"; done
  if [ $asm = 1 ]; then clang-23 -c -fPIC zstd/lib/decompress/huf_decompress_amd64.S -o build/$name/huf_asm.o; objs="$objs build/$name/huf_asm.o"; fi
  wait
  rm -f build/$name/libzstd.a; llvm-ar-23 rcs build/$name/libzstd.a $objs
}
build ref 1
build noasm 0 -DZSTD_DISABLE_ASM=1 -DDYNAMIC_BMI2=0
