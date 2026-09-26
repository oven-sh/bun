#!/bin/sh
# Builds the portable image test (x86-64) on a linux host:
#   out/sysroot     musl 1.2.5 with the host table patch
#   out/threads.img static-pie image, runs on linux as is
#   out/host-linux  POSIX host in hosted mode, for testing the host path on linux
# The Windows and macOS hosts build on their own OS:
#   clang -O2 -o host.exe host/host_win.c -lsynchronization -ladvapi32
#   cc -O2 -o host host/host_posix.c
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/out}
llvm=${LLVM_BIN:-/usr/lib/llvm-current/bin}
mkdir -p "$out"
if [ ! -f "$out/sysroot/lib/libc.a" ]; then
  rm -rf "$out/musl"
  git clone -q --depth 1 --branch v1.2.5 https://github.com/kraj/musl "$out/musl"
  python3 "$here/libc/patch_musl.py" "$out/musl"
  (cd "$out/musl" &&
    CC=$llvm/clang AR=$llvm/llvm-ar RANLIB=$llvm/llvm-ranlib \
      CFLAGS="-O2 -mno-red-zone -fPIE -fno-stack-protector" \
      ./configure --prefix="$out/sysroot" --disable-shared >/dev/null &&
    make -j8 >/dev/null && make install >/dev/null)
fi
sys=$out/sysroot
rt=$($llvm/clang --print-libgcc-file-name --rtlib=compiler-rt)
$llvm/clang -O2 --target=x86_64-linux-musl -nostdinc -isystem "$sys/include" \
  -isystem "$($llvm/clang -print-resource-dir)/include" \
  -femulated-tls -mno-red-zone -fno-stack-protector -fPIE -c -o "$out/threads.o" "$here/test/threads.c"
$llvm/ld.lld -static -pie --no-dynamic-linker -z noexecstack -o "$out/threads.img" \
  "$sys/lib/rcrt1.o" "$sys/lib/crti.o" "$out/threads.o" -L"$sys/lib" -lc "$rt" -lc "$sys/lib/crtn.o"
cc -O2 -o "$out/host-linux" "$here/host/host_posix.c" -lpthread
echo "direct:" && "$out/threads.img" "$out/probe.tmp" || [ $? -eq 42 ]
echo "hosted:" && "$out/host-linux" "$out/threads.img" "$out/probe.tmp" || [ $? -eq 42 ]
