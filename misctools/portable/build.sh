#!/bin/sh
# Builds the portable image test on a linux host and runs it.
#
#   build.sh [x86_64|aarch64] [out dir]     default: x86_64, out/<arch>
#
#   <out>/sysroot     musl 1.2.5 with the host table patch (libc/patch_musl.py)
#   <out>/threads.img static-pie image, runs on linux as is (test/threads.c)
#   <out>/linux_paths.img  second image, for test/run.sh (test/linux_paths.c)
#   <out>/host-linux  POSIX host in hosted mode, for testing the host path on linux
# aarch64 only:
#   <out>/builtins    compiler-rt builtins, built from source with the flags of the image
#   the images end with an ad-hoc Apple code signature (tools/apple_sign.py)
#
# An image of another architecture than this machine runs under qemu-<arch> (user mode).
# test/run.sh runs more tests, and each of them several times.
# Environment: LLVM_BIN, JOBS (8), RUNS (1, how often each test runs),
#   MUSL_GIT, LLVM_GIT, LLVM_TAG (where the sources are cloned from).
#   An existing <out>/llvm-project is used as it is.
#
# The Windows and macOS hosts build on their own OS, for the architecture of the image:
#   clang -O2 -o host.exe host/host_win.c -lsynchronization -ladvapi32
#   cc -O2 -o host host/host_posix.c
set -eu
here=$(cd "$(dirname "$0")" && pwd)
arch=x86_64
case "${1:-}" in
  x86_64 | aarch64) arch=$1; shift ;;
esac
out=${1:-$here/out/$arch}
llvm=${LLVM_BIN:-/usr/lib/llvm-current/bin}
jobs=${JOBS:-8}
runs=${RUNS:-1}
mkdir -p "$out"
out=$(cd "$out" && pwd)
sys=$out/sysroot
resource=$("$llvm/clang" -print-resource-dir)

case $arch in
  x86_64)
    # Windows x64 has no red zone.
    image_flags="-mno-red-zone -fno-stack-protector -fPIE"
    ;;
  aarch64)
    # x18 is reserved on Windows (TEB) and macOS: the image never writes it.
    image_flags="-ffixed-x18 -fno-stack-protector -fPIE"
    ;;
esac
target=$arch-linux-musl
cc="$llvm/clang --target=$target"
run=
[ "$(uname -m)" = "$arch" ] || run=qemu-$arch

if [ ! -f "$sys/lib/libc.a" ]; then
  rm -rf "$out/musl"
  git -c advice.detachedHead=false clone -q --depth 1 --branch v1.2.5 "${MUSL_GIT:-https://github.com/kraj/musl}" "$out/musl"
  python3 "$here/libc/patch_musl.py" "$out/musl"
  if [ "$arch" = x86_64 ]; then
    (cd "$out/musl" &&
      CC=$llvm/clang AR=$llvm/llvm-ar RANLIB=$llvm/llvm-ranlib \
        CFLAGS="-O2 -mno-red-zone -fPIE -fno-stack-protector" \
        ./configure --prefix="$sys" --disable-shared >/dev/null &&
      make -j"$jobs" >/dev/null && make install >/dev/null)
  else
    (cd "$out/musl" &&
      CC="$cc" AR=$llvm/llvm-ar RANLIB=$llvm/llvm-ranlib \
        CFLAGS="-O2 $image_flags" \
        ./configure --target=$target --prefix="$sys" --disable-shared >/dev/null &&
      make -j"$jobs" >/dev/null && make install >/dev/null)
  fi
fi

if [ "$arch" = x86_64 ]; then
  rt=$("$llvm/clang" --print-libgcc-file-name --rtlib=compiler-rt)
else
  # The machine has the builtins for x86 only. musl's printf needs the 128-bit
  # long double helpers (__addtf3 ...), so build them, with the image flags.
  rt=$out/builtins/lib/linux/libclang_rt.builtins-$arch.a
  if [ ! -f "$rt" ]; then
    src=$out/llvm-project
    if [ ! -d "$src/compiler-rt/lib/builtins" ]; then
      rm -rf "$src"
      git -c advice.detachedHead=false clone -q --depth 1 --filter=blob:none --sparse \
        --branch "${LLVM_TAG:-llvmorg-23.1.2}" "${LLVM_GIT:-https://github.com/llvm/llvm-project}" "$src"
      git -C "$src" sparse-checkout set compiler-rt/lib/builtins compiler-rt/cmake cmake llvm/cmake third-party/siphash
    fi
    flags="-nostdinc -isystem $sys/include -isystem $resource/include $image_flags"
    cmake -G Ninja -S "$src/compiler-rt/lib/builtins" -B "$out/builtins" \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_C_COMPILER="$llvm/clang" -DCMAKE_CXX_COMPILER="$llvm/clang++" -DCMAKE_ASM_COMPILER="$llvm/clang" \
      -DCMAKE_AR="$llvm/llvm-ar" -DCMAKE_RANLIB="$llvm/llvm-ranlib" -DCMAKE_NM="$llvm/llvm-nm" \
      -DCMAKE_C_COMPILER_TARGET=$target -DCMAKE_CXX_COMPILER_TARGET=$target -DCMAKE_ASM_COMPILER_TARGET=$target \
      -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=$arch \
      -DCMAKE_C_FLAGS="$flags" -DCMAKE_CXX_FLAGS="$flags" -DCMAKE_ASM_FLAGS="$flags" \
      -DCMAKE_C_FLAGS_RELEASE="-O2 -DNDEBUG" -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG" -DCMAKE_ASM_FLAGS_RELEASE="-O2 -DNDEBUG" \
      -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
      -DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON \
      -DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF >"$out/builtins-configure.log" 2>&1 ||
      { tail -30 "$out/builtins-configure.log"; exit 1; }
    ninja -C "$out/builtins" -j"$jobs" >"$out/builtins-build.log" 2>&1 ||
      { tail -30 "$out/builtins-build.log"; exit 1; }
  fi
fi

# image <name>: test/<name>.c becomes <out>/<name>.img
image() {
  $cc -O2 -nostdinc -isystem "$sys/include" -isystem "$resource/include" \
    -femulated-tls $image_flags -c -o "$out/$1.o" "$here/test/$1.c"
  "$llvm/ld.lld" -static -pie --no-dynamic-linker -z noexecstack \
    -z max-page-size=65536 -z separate-loadable-segments -o "$out/$1.img" \
    "$sys/lib/rcrt1.o" "$sys/lib/crti.o" "$out/$1.o" -L"$sys/lib" -lc "$rt" -lc "$sys/lib/crtn.o"
  # Apple Silicon maps code from a file only under a code signature. Last step.
  [ "$arch" != aarch64 ] || python3 "$here/tools/apple_sign.py" "$out/$1.img"
}
image threads
image linux_paths

if [ "$arch" = x86_64 ]; then
  cc -O2 -o "$out/host-linux" "$here/host/host_posix.c" -lpthread
else
  # The test host is a static aarch64 linux program. Its libc is the sysroot of
  # the image, which is a normal musl when no host table arrives. The host
  # itself is built WITHOUT -ffixed-x18: see "x18" in host/host_posix.c.
  $cc -O2 -nostdinc -isystem "$sys/include" -isystem "$resource/include" \
    -fno-stack-protector -c -o "$out/host-linux.o" "$here/host/host_posix.c"
  "$llvm/ld.lld" -static -z noexecstack -o "$out/host-linux" \
    "$sys/lib/crt1.o" "$sys/lib/crti.o" "$out/host-linux.o" -L"$sys/lib" -lc "$rt" -lc "$sys/lib/crtn.o"
fi

# Exit code 42 is a pass.
check() {
  name=$1
  shift
  passes=0
  i=0
  while [ $i -lt "$runs" ]; do
    i=$((i + 1))
    status=0
    "$@" "$out/probe.tmp" || status=$?
    if [ $status -eq 42 ]; then passes=$((passes + 1)); else echo "$name: run $i FAILED with exit code $status"; fi
  done
  echo "$name: $passes of $runs runs passed"
  [ $passes -eq "$runs" ]
}
echo "direct:" && check "$arch direct" $run "$out/threads.img"
echo "hosted:" && check "$arch hosted" $run "$out/host-linux" "$out/threads.img"
