#!/bin/bash
# Builds tools/kernels.cpp and runs it for every target that this machine has, and under qemu for those of arm64.
set -eu
cd "$(dirname "$0")/.."
B=../..
F="-std=c++23 -O2 -fno-exceptions -DHWY_STATIC_DEFINE -DHWY_DISABLED_TARGETS=HWY_ALL_SVE-HWY_SVE2_128 -I$B/vendor/highway -I$B/src/jsc/bindings tools/kernels.cpp $B/src/jsc/bindings/highway_jpeg.cpp $B/vendor/highway/hwy/targets.cc $B/vendor/highway/hwy/abort.cc $B/vendor/highway/hwy/print.cc"
clang++-23 -march=nehalem $F -o kernels
for bit in $(./kernels targets); do ./kernels $((1 << bit)); done
# apt: qemu-user libc6-dev-arm64-cross libstdc++-13-dev-arm64-cross libgcc-13-dev-arm64-cross
if command -v qemu-aarch64 > /dev/null; then
  clang++-23 --target=aarch64-linux-gnu -fuse-ld=lld -static -march=armv8-a+crc $F -o kernels-arm64
  Q="qemu-aarch64 -cpu max,sve-default-vector-length=16"
  for bit in $($Q ./kernels-arm64 targets); do $Q ./kernels-arm64 $((1 << bit)); done
fi
