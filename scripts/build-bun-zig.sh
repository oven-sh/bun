#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cwd=$(pwd)
zig=

if [[ "$CI" ]]; then
  # Since the zig build depends on files from the zig submodule,
  # make sure to update the submodule before building.
  git submodule update --init --recursive --progress --depth=1 --checkout src/deps/zig

  # Also update the correct version of zig in the submodule.
  $(dirname -- "${BASH_SOURCE[0]}")/download-zig.sh
fi

if [ -f "$cwd/.cache/zig/zig" ]; then
  zig="$cwd/.cache/zig/zig"
else
  zig=$(which zig)
fi

ZIG_OPTIMIZE="${ZIG_OPTIMIZE:-ReleaseFast}"
CANARY="${CANARY:-0}"
GIT_SHA="${GIT_SHA:-$(git rev-parse HEAD)}"

BUILD_MACHINE_ARCH="${BUILD_MACHINE_ARCH:-$(uname -m)}"
DOCKER_MACHINE_ARCH=""
if [[ "$BUILD_MACHINE_ARCH" == "x86_64" || "$BUILD_MACHINE_ARCH" == "amd64" ]]; then
  BUILD_MACHINE_ARCH="x86_64"
  DOCKER_MACHINE_ARCH="amd64"
elif [[ "$BUILD_MACHINE_ARCH" == "aarch64" || "$BUILD_MACHINE_ARCH" == "arm64" ]]; then
  BUILD_MACHINE_ARCH="aarch64"
  DOCKER_MACHINE_ARCH="arm64"
fi

TARGET_OS="${1:-linux}"
TARGET_ARCH="${2:-x64}"
TARGET_CPU="${3:-${CPU_TARGET:-native}}"

BUILDARCH=""
if [[ "$TARGET_ARCH" == "x64" || "$TARGET_ARCH" == "x86_64" || "$TARGET_ARCH" == "amd64" ]]; then
  TARGET_ARCH="x86_64"
  BUILDARCH="amd64"
elif [[ "$TARGET_ARCH" == "aarch64" || "$TARGET_ARCH" == "arm64" ]]; then
  TARGET_ARCH="aarch64"
  BUILDARCH="arm64"
fi

TRIPLET=""
if [[ "$TARGET_OS" == "linux" ]]; then
  TRIPLET="$TARGET_ARCH-linux-gnu"
elif [[ "$TARGET_OS" == "darwin" ]]; then
  TRIPLET="$TARGET_ARCH-macos-none"
elif [[ "$TARGET_OS" == "windows" ]]; then
  TRIPLET="$TARGET_ARCH-windows-msvc"
fi

echo "--- Building identifier-cache"
$zig run src/js_lexer/identifier_data.zig

echo "--- Building node-fallbacks"
cd src/node-fallbacks
bun install --frozen-lockfile
bun run build
cd "$cwd"

echo "--- Building codegen"
bun install --frozen-lockfile
make runtime_js fallback_decoder bun_error

echo "--- Building modules"
mkdir -p build
bun run src/codegen/bundle-modules.ts --debug=OFF build

echo "--- Building zig"
cd build
cmake .. \
  -GNinja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_LTO=ON \
  -DZIG_OPTIMIZE="${ZIG_OPTIMIZE}" \
  -DGIT_SHA="${GIT_SHA}" \
  -DARCH="${TARGET_ARCH}" \
  -DBUILDARCH="${BUILDARCH}" \
  -DCPU_TARGET="${TARGET_CPU}" \
  -DZIG_TARGET="${TRIPLET}" \
  -DASSERTIONS="OFF" \
  -DWEBKIT_DIR="omit" \
  -DNO_CONFIGURE_DEPENDS=1 \
  -DNO_CODEGEN=1 \
  -DBUN_ZIG_OBJ_DIR="$cwd/build" \
  -DCANARY="$CANARY" \
  -DZIG_LIB_DIR=src/deps/zig/lib
ONLY_ZIG=1 ninja "$cwd/build/bun-zig.o" -v
