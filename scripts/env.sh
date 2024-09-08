#!/usr/bin/env bash

set -euo pipefail

export CI=${CI:-0}
export USE_LTO=${USE_LTO:-0}
export FORCE_PIC=${FORCE_PIC:-}
UNAME_OS="$(uname -s)"
UNAME_ARCH="$(uname -m)"

export CMAKE_FLAGS="${CMAKE_FLAGS:-}"

# Hack for buildkite sometimes not having the right path
if [[ "${CI:-}" == "1" || "${CI:-}" == "true" ]]; then
  if [ -f ~/.bashrc ]; then
    source ~/.bashrc
  fi
fi

if [[ $UNAME_OS == 'Darwin' ]]; then
  export LLVM_VERSION=18
else
  export LLVM_VERSION=16
fi

# this is the environment script for building bun's dependencies
# it sets c compiler and flags
export SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
export BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd "$SCRIPT_DIR" && cd .. && pwd)}
export BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps}
export BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/build/bun-deps}

# Silence a perl script warning
export LC_CTYPE="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"

if [[ $UNAME_OS == 'Darwin' ]]; then
  export CXX="$(brew --prefix llvm)@$LLVM_VERSION/bin/clang++"
  export CC="$(brew --prefix llvm)@$LLVM_VERSION/bin/clang"
  export AR="$(brew --prefix llvm)@$LLVM_VERSION/bin/llvm-ar"
  export RANLIB="$(brew --prefix llvm)@$LLVM_VERSION/bin/llvm-ranlib"
  export LIBTOOL="$(brew --prefix llvm)@$LLVM_VERSION/bin/llvm-libtool-darwin"
  export PATH="$(brew --prefix llvm)@$LLVM_VERSION/bin:$PATH"
  ln -sf $LIBTOOL "$(brew --prefix llvm)@$LLVM_VERSION/bin/libtool" || true
elif [[ "$CI" != "1" && "$CI" != "true" ]]; then
  if [[ -f $SCRIPT_DIR/env.local ]]; then
    echo "Sourcing $SCRIPT_DIR/env.local"
    source $SCRIPT_DIR/env.local
  fi
fi

# this compiler detection could be better
export CC=${CC:-$(which clang-$LLVM_VERSION || which clang || which cc)}
export CXX=${CXX:-$(which clang++-$LLVM_VERSION || which clang++ || which c++)}
export AR=${AR:-$(which llvm-ar || which ar)}
export CPUS=${CPUS:-$(nproc || sysctl -n hw.ncpu || echo 1)}
export RANLIB=${RANLIB:-$(which llvm-ranlib-$LLVM_VERSION || which llvm-ranlib || which ranlib)}

# on Linux, force using lld as the linker
if [[ $UNAME_OS == 'Linux' ]]; then
  export LD=${LD:-$(which ld.lld-$LLVM_VERSION || which ld.lld || which ld)}
  export LDFLAGS="${LDFLAGS:-} -fuse-ld=lld "
fi

export CMAKE_CXX_COMPILER=${CXX}
export CMAKE_C_COMPILER=${CC}

export FILE_PREFIX_MAP=" -ffile-prefix-map='${BUN_BASE_DIR}'=. -ffile-prefix-map='${BUN_DEPS_DIR}'=src/deps -ffile-prefix-map='${BUN_DEPS_OUT_DIR}'=src/deps "

export CFLAGS="-O3 -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden -mno-omit-leaf-frame-pointer -fno-omit-frame-pointer -fno-asynchronous-unwind-tables -fno-unwind-tables $FILE_PREFIX_MAP "
export CXXFLAGS="-O3 -fno-exceptions -fno-rtti -fvisibility=hidden -fvisibility-inlines-hidden -mno-omit-leaf-frame-pointer -fno-omit-frame-pointer -fno-asynchronous-unwind-tables -fno-unwind-tables -fno-c++-static-destructors $FILE_PREFIX_MAP "

# libarchive requires zlib headers for gzip compression support. without them, it will attempt to spawn a gzip process
export CFLAGS="$CFLAGS -I$BUN_DEPS_DIR/zlib "

# Add flags for LTO
# We cannot enable LTO on macOS for dependencies because it requires -fuse-ld=lld and lld causes many segfaults on macOS (likely related to stack size)
if [ "$USE_LTO" == "1" ] || [ "$USE_LTO" == "ON" ]; then
  export CFLAGS="$CFLAGS -flto=full "
  export CXXFLAGS="$CXXFLAGS -flto=full -fwhole-program-vtables -fforce-emit-vtables "
  export LDFLAGS="${LDFLAGS:-} -flto=full -fwhole-program-vtables -fforce-emit-vtables "
fi

if [[ $UNAME_OS == 'Linux' ]]; then
  export CFLAGS="$CFLAGS -ffunction-sections -fdata-sections -faddrsig "
  export CXXFLAGS="$CXXFLAGS -ffunction-sections -fdata-sections -faddrsig "
  export LDFLAGS="${LDFLAGS} -Wl,-z,norelro"
fi

# Clang 18 on macOS needs to have -fno-define-target-os-macros to fix a zlib build issue
# https://gitlab.kitware.com/cmake/cmake/-/issues/25755
if [[ $UNAME_OS == 'Darwin' && $LLVM_VERSION == '18' ]]; then
  export CFLAGS="$CFLAGS -fno-define-target-os-macros "
  export CXXFLAGS="$CXXFLAGS -fno-define-target-os-macros -D_LIBCXX_ENABLE_ASSERTIONS=0 -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE "
fi

# libarchive needs position-independent executables to compile successfully
if [ -n "$FORCE_PIC" ]; then
  export CFLAGS="$CFLAGS -fPIC "
  export CXXFLAGS="$CXXFLAGS -fPIC "
elif [[ $UNAME_OS == 'Linux' ]]; then
  export CFLAGS="$CFLAGS -fno-pie -fno-pic "
  export CXXFLAGS="$CXXFLAGS -fno-pie -fno-pic "
fi

if [[ $UNAME_OS == 'Linux' && ($UNAME_ARCH == 'aarch64' || $UNAME_ARCH == 'arm64') ]]; then
  export CFLAGS="$CFLAGS -march=armv8-a+crc -mtune=ampere1 "
  export CXXFLAGS="$CXXFLAGS -march=armv8-a+crc -mtune=ampere1 "
fi

export CMAKE_FLAGS=(
  -DCMAKE_C_COMPILER="${CC}"
  -DCMAKE_CXX_COMPILER="${CXX}"
  -DCMAKE_C_FLAGS="$CFLAGS"
  -DCMAKE_CXX_FLAGS="$CXXFLAGS"
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_CXX_STANDARD=20
  -DCMAKE_C_STANDARD=17
  -DCMAKE_CXX_STANDARD_REQUIRED=ON
  -DCMAKE_C_STANDARD_REQUIRED=ON
)

CCACHE=$(which ccache || which sccache || echo "")
if [ -f "$CCACHE" ]; then
  CMAKE_FLAGS+=(
    -DCMAKE_C_COMPILER_LAUNCHER="$CCACHE"
    -DCMAKE_CXX_COMPILER_LAUNCHER="$CCACHE"
  )
fi

if [[ $UNAME_OS == 'Linux' ]]; then
  # Ensure we always use -std=gnu++20 on Linux
  CMAKE_FLAGS+=(-DCMAKE_CXX_EXTENSIONS=ON)
fi

if [[ $UNAME_OS == 'Darwin' ]]; then
  export CMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET:-13.0}
  CMAKE_FLAGS+=(-DCMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET})
  export CFLAGS="$CFLAGS -mmacos-version-min=${CMAKE_OSX_DEPLOYMENT_TARGET} -D__DARWIN_NON_CANCELABLE=1 "
  export CXXFLAGS="$CXXFLAGS -mmacos-version-min=${CMAKE_OSX_DEPLOYMENT_TARGET} -D__DARWIN_NON_CANCELABLE=1 "
fi

mkdir -p $BUN_DEPS_OUT_DIR

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "C Compiler: ${CC}"
  echo "C++ Compiler: ${CXX}"
  if [ -n "$CCACHE" ]; then
    echo "Ccache: ${CCACHE}"
  fi
  if [[ $UNAME_OS == 'Darwin' ]]; then
    echo "OSX Deployment Target: ${CMAKE_OSX_DEPLOYMENT_TARGET}"
  fi
fi
