#!/bin/bash

set -euo pipefail

export CMAKE_FLAGS=""
source "$(dirname "$0")/env.sh"

if [[ -n "$CMAKE_FLAGS" ]]; then
  echo "CMAKE_FLAGS should not be empty"
  exit 1
fi

function assert_target() {
  local arch="${2-$(uname -m)}"
  case "$(echo "$arch" | tr '[:upper:]' '[:lower:]')" in
  x64 | x86_64 | amd64)
    export ZIG_ARCH="x86_64"
    if [[ "$BUILDKITE_STEP_KEY" == *"baseline"* ]]; then
      export ZIG_CPU_TARGET="nehalem"
    else
      export ZIG_CPU_TARGET="haswell"
    fi
    ;;
  aarch64 | arm64)
    export ZIG_ARCH="aarch64"
    export ZIG_CPU_TARGET="native"
    ;;
  *)
    echo "error: Unsupported architecture: $arch" 1>&2
    exit 1
    ;;
  esac
  local os="${1-$(uname -s)}"
  case "$(echo "$os" | tr '[:upper:]' '[:lower:]')" in
  linux)
    export ZIG_OS="linux"
    export ZIG_TARGET="$ZIG_ARCH-linux-gnu"
    ;;
  darwin)
    export ZIG_OS="macos"
    export ZIG_TARGET="$ZIG_ARCH-macos-none"
    ;;
  windows)
    export ZIG_OS="windows"
    export ZIG_TARGET="$ZIG_ARCH-windows-msvc"
    ;;
  *)
    echo "error: Unsupported operating system: $os" 1>&2
    exit 1
    ;;
  esac
}

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

assert_target "$@"

# Since the zig build depends on files from the zig submodule,
# make sure to update the submodule before building.
run_command git submodule update --init --recursive --progress --depth=1 --checkout src/deps/zig

# TODO: Move these to be part of the CMake build
source "$(dirname "$0")/build-old-js.sh"

cwd="$(pwd)"
mkdir -p build
cd build

# in buildkite this script to compile for windows is run on a macos machine
# so the cmake windows detection for this logic is not ran
ZIG_OPTIMIZE="ReleaseFast"
if [[ "$ZIG_OS" == "windows" ]]; then
  ZIG_OPTIMIZE="ReleaseSafe"
fi

run_command cmake .. "${CMAKE_FLAGS[@]}" \
  -GNinja \
  -DNO_CONFIGURE_DEPENDS="1" \
  -DNO_CODEGEN="0" \
  -DWEBKIT_DIR="omit" \
  -DBUN_ZIG_OBJ_DIR="$cwd/build" \
  -DZIG_LIB_DIR="$cwd/src/deps/zig/lib" \
  -DCMAKE_BUILD_TYPE="$CMAKE_BUILD_TYPE" \
  -DARCH="$ZIG_ARCH" \
  -DCPU_TARGET="$ZIG_CPU_TARGET" \
  -DZIG_TARGET="$ZIG_TARGET" \
  -DUSE_LTO="$USE_LTO" \
  -DUSE_DEBUG_JSC="$USE_DEBUG_JSC" \
  -DCANARY="$CANARY" \
  -DZIG_OPTIMIZE="$ZIG_OPTIMIZE" \
  -DGIT_SHA="$GIT_SHA"

export ONLY_ZIG="1"
run_command ninja "$cwd/build/bun-zig.o" -v -j "$CPUS"

cd ..
source "$(dirname "$0")/upload-artifact.sh" "build/bun-zig.o"
