#!/bin/bash
# Builds /root/ref/build/libtjref.a from the patched libjpeg-turbo, the way scripts/build/deps/libjpeg-turbo.ts did (x64, release flags).
set -euo pipefail
SRC=/root/ref/libjpeg-turbo-patched
OUT=/root/ref/build
CC=${CC:-clang-23}
EXTRA=${EXTRA:-}
OBJ=$OUT/obj${SUFFIX:-}
rm -rf "$OBJ"
mkdir -p $OBJ
JPEG8="jcapimin jcapistd jccoefct jccolor jcdctmgr jcdiffct jchuff jcicc jcinit jclhuff jclossls jcmainct jcmarker jcmaster jcomapi jcparam jcphuff jcprepct jcsample jctrans jdapimin jdapistd jdatadst jdatasrc jdcoefct jdcolor jddctmgr jddiffct jdhuff jdicc jdinput jdlhuff jdlossls jdmainct jdmarker jdmaster jdmerge jdphuff jdpostct jdsample jdtrans jfdctflt jfdctfst jfdctint jidctflt jidctfst jidctint jidctred jaricom jcarith jdarith jerror jmemmgr jmemnobs jquant1 jquant2 jutils jpeg_nbits"
TJ="turbojpeg transupp jdatadst-tj jdatasrc-tj"
SIMD="jsimdcpu jfdctflt-sse jccolor-sse2 jcgray-sse2 jchuff-sse2 jcphuff-sse2 jcsample-sse2 jdcolor-sse2 jdmerge-sse2 jdsample-sse2 jfdctfst-sse2 jfdctint-sse2 jidctflt-sse2 jidctfst-sse2 jidctint-sse2 jidctred-sse2 jquantf-sse2 jquanti-sse2 jccolor-avx2 jcgray-avx2 jcsample-avx2 jdcolor-avx2 jdmerge-avx2 jdsample-avx2 jfdctint-avx2 jidctint-avx2 jquanti-avx2"
CFLAGS="-march=nehalem -O2 -g -fPIC -fno-omit-frame-pointer -I$SRC/src -I$OUT/include -DBUN_8BIT_ONLY -DUSE_CLZ_INTRINSIC $EXTRA"
for f in $JPEG8 $TJ; do $CC $CFLAGS -c $SRC/src/$f.c -o $OBJ/$f.o & done
$CC $CFLAGS -c $SRC/jbun_stubs.c -o $OBJ/jbun_stubs.o &
$CC $CFLAGS -c $SRC/simd/jsimd.c -o $OBJ/jsimd.o &
for f in $SIMD; do nasm -felf64 -DELF -D__x86_64__ -DPIC -I$SRC/simd/nasm/ -I$SRC/simd/x86_64/ -o $OBJ/$f.o $SRC/simd/x86_64/$f.asm & done
for job in $(jobs -p); do wait $job; done
rm -f $OUT/libtjref${SUFFIX:-}.a
llvm-ar-23 rcs $OUT/libtjref${SUFFIX:-}.a $OBJ/*.o
ls -la $OUT/libtjref${SUFFIX:-}.a
