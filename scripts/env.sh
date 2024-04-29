#!/usr/bin/env bash
# this is the environment script for building bun's dependencies
# it sets c compiler and flags
export SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
export BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd $SCRIPT_DIR && cd .. && pwd)}
export BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps/}
export BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/src/deps/}

# this compiler detection could be better
export CC=${CC:-$(which clang-16 || which clang || which cc)}
export CXX=${CXX:-$(which clang++-16 || which clang++ || which c++)}
export AR=${AR:-$(which llvm-ar || which ar)}
export CPUS=${CPUS:-$(nproc || sysctl -n hw.ncpu || echo 1)}

export CMAKE_CXX_COMPILER=${CXX}
export CMAKE_C_COMPILER=${CC}

export CFLAGS='-O3 -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden'
export CXXFLAGS='-O3 -fno-exceptions -fno-rtti -fvisibility=hidden -fvisibility-inlines-hidden'

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

if [[ $(uname -s) == 'Linux' ]]; then
    # Ensure we always use -std=gnu++20 on Linux
    export CMAKE_FLAGS+=( -DCMAKE_CXX_EXTENSIONS=ON )
fi

if [[ $(uname -s) == 'Darwin' ]]; then
    export CMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET:-12.0}

    CMAKE_FLAGS+=(-DCMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET})
    export CFLAGS="$CFLAGS -mmacosx-version-min=${CMAKE_OSX_DEPLOYMENT_TARGET}"
    export CXXFLAGS="$CXXFLAGS -mmacosx-version-min=${CMAKE_OSX_DEPLOYMENT_TARGET}"
fi

mkdir -p $BUN_DEPS_OUT_DIR

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "C Compiler: ${CC}"
    echo "C++ Compiler: ${CXX}"
    if [[ $(uname -s) == 'Darwin' ]]; then
        echo "OSX Deployment Target: ${CMAKE_OSX_DEPLOYMENT_TARGET}"
    fi
fi
