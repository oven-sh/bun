# this is the environment script for building bun's dependencies
# it sets c compiler and flags
export SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
export BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd $SCRIPT_DIR && cd ../.. && pwd)}
export BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps/}
export BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/src/deps/}

# this compiler detection could be better
export CC=${CC:-$(which clang-16 || which clang || which cc)}
export CXX=${CXX:-$(which clang++-16 || which clang++ || which c++)}
export AR=${AR:-$(which llvm-ar || which ar)}
export CPUS=${CPUS:-$(nproc || sysctl -n hw.ncpu || echo 1)}

export CMAKE_CXX_COMPILER=${CXX}
export CMAKE_C_COMPILER=${CC}

if ! [[ $(uname -m) == 'arm64' ]]; then
    export CMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET:-10.14}
else
    export CMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET:-11.0}
fi

export CFLAGS='-O3 -flto=full'
export CXXFLAGS='-O3 -flto=full'

export CMAKE_FLAGS=(
  -DCMAKE_C_COMPILER="${CC}"
  -DCMAKE_CXX_COMPILER="${CXX}"
  -DCMAKE_C_FLAGS="$CFLAGS"
  -DCMAKE_CXX_FLAGS="$CXXFLAGS"
  -DCMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET}
  -DCMAKE_BUILD_TYPE=Release
)

mkdir -p $BUN_DEPS_OUT_DIR

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "C Compiler: ${CC}"
    echo "C++ Compiler: ${CXX}"
fi
