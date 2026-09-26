#!/bin/sh
# Compile checks of the hosts for the systems that this machine cannot run.
# They show that the sources compile (and, for Windows, link). They do not run anything.
#
#   test/compile_hosts.sh [directory of llvm-mingw]      after build.sh x86_64 and build.sh aarch64
#
# Windows: host_win.c is compiled and linked for x86_64 and aarch64 with
#   llvm-mingw (clang, mingw-w64 headers and libraries). Without the argument
#   the release below is downloaded to out/llvm-mingw.
# macOS: there is no SDK here. The macOS branches of host_posix.c are compiled
#   to Mach-O objects with the musl headers of the sysroots and test/mac_shim.h
#   in place of the SDK. That checks syntax, types and the assembly only.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
llvm=${LLVM_BIN:-/usr/lib/llvm-current/bin}
mingw=${1:-$here/out/llvm-mingw}
release=https://github.com/mstorsjo/llvm-mingw/releases/download/20260922/llvm-mingw-20260922-ucrt-ubuntu-22.04-x86_64.tar.xz
work=$here/out/compile-check
warnings="-Wall -Wextra -Wno-unused-parameter"
mkdir -p "$work"
if [ ! -x "$mingw/bin/aarch64-w64-mingw32-clang" ]; then
  mkdir -p "$mingw"
  curl -sS -L --max-time 900 -o "$work/llvm-mingw.tar.xz" "$release"
  tar -xJf "$work/llvm-mingw.tar.xz" -C "$mingw" --strip-components=1
  rm -f "$work/llvm-mingw.tar.xz"
fi
for arch in x86_64 aarch64; do
  "$mingw/bin/$arch-w64-mingw32-clang" -O2 $warnings -o "$work/host-$arch.exe" "$here/host/host_win.c" -lsynchronization -ladvapi32
  echo "host_win.c for $arch windows: compiled and linked, $(file -b "$work/host-$arch.exe")"
  if [ $arch = aarch64 ]; then
    # x18 is the TEB: the host may read it, nothing may write it.
    writes=$("$llvm/llvm-objdump" -d --no-show-raw-insn "$work/host-$arch.exe" | grep -E '\b[xw]18\b' | grep -c -v -E '	mov	x[0-9]+, x18$' || true)
    echo "host_win.c for aarch64 windows: $writes instructions use x18 in another way than reading it"
    [ "$writes" -eq 0 ]
  fi
done
resource=$("$llvm/clang" -print-resource-dir)
for pair in arm64:aarch64 x86_64:x86_64; do
  apple=${pair%%:*}
  arch=${pair##*:}
  "$llvm/clang" --target=$apple-apple-macos11 -O2 $warnings -Wno-missing-field-initializers -nostdinc \
    -isystem "$here/out/$arch/sysroot/include" -isystem "$resource/include" -include "$here/test/mac_shim.h" \
    -c -o "$work/host_posix.$apple.o" "$here/host/host_posix.c"
  echo "host_posix.c, macOS branches, for $apple: compiled, $(file -b "$work/host_posix.$apple.o")"
done
uses=$("$llvm/llvm-objdump" -d --no-show-raw-insn "$work/host_posix.arm64.o" | grep -c -E '\b[xw]18\b' || true)
echo "host_posix.c for arm64 macOS: $uses instructions use x18"
[ "$uses" -eq 0 ]
