#!/usr/bin/env bash
#=============================================================================
# 构建 OHOS 交叉编译所需的 libc++ / libc++abi / libunwind (musl-compatible)
# 使用 OHOS SDK 自带的 LLVM 22 编译
#
# 用法:
#   ./scripts/ohos/prepare-cross-libs.sh
#   OHOS_SDK_ROOT=/custom/path ./scripts/ohos/prepare-cross-libs.sh
#
# 输出: build/ohos-cross-libs/{libcxx,libcxxabi,libunwind}/lib/*.a
#=============================================================================
set -euo pipefail

OHOS_SDK_ROOT="${OHOS_SDK_ROOT:-$HOME/setup-ohos-sdk}"
LLVM_DIR="${OHOS_SDK_ROOT}/linux/native/llvm"
SYSROOT="${OHOS_SDK_ROOT}/ohos/native/sysroot"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CROSS_LIBS_DIR="${CROSS_LIBS_DIR:-${REPO_ROOT}/build/ohos-cross-libs}"
LLVM_SRC_DIR="${LLVM_SRC_DIR:-$HOME/llvm-project}"
LLVM_VERSION="22.1.4"
TARGET="aarch64-linux-ohos"

CC="${LLVM_DIR}/bin/clang"
CXX="${LLVM_DIR}/bin/clang++"

CFLAGS="--target=${TARGET} --sysroot=${SYSROOT} -D__MUSL__ -I${SYSROOT}/usr/include -fPIC"
CXXFLAGS="${CFLAGS} -I${LLVM_DIR}/include/libcxx-ohos/include/c++/v1 -nostdinc++"

info()  { echo -e "\033[0;32m[INFO]\033[0m $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*"; exit 1; }

# ─── 检查 ──────────────────────────────────────────────────────────────────
for f in "$CC" "$SYSROOT"; do
  [ -e "$f" ] || error "缺少: $f"
done

# 如果已存在且完整，跳过
if [ -f "${CROSS_LIBS_DIR}/libcxx/lib/libc++.a" ] && \
   [ -f "${CROSS_LIBS_DIR}/libcxxabi/lib/libc++abi.a" ] && \
   [ -f "${CROSS_LIBS_DIR}/libunwind/lib/libunwind.a" ]; then
  info "Cross-libs 已存在，跳过编译"
  exit 0
fi

info "LLVM: $($CC --version 2>&1 | head -1)"
info "目标: ${TARGET}"

# ─── 获取 LLVM 源码 ──────────────────────────────────────────────────────
if [ ! -d "${LLVM_SRC_DIR}/.git" ]; then
  info "克隆 LLVM ${LLVM_VERSION} 源码..."
  git clone --depth 1 --branch "llvmorg-${LLVM_VERSION}" \
    https://github.com/llvm/llvm-project.git "${LLVM_SRC_DIR}"
fi

BUILD_DIR="/tmp/build-ohos-libcxx-$$"
mkdir -p "$BUILD_DIR"

# ─── libunwind ────────────────────────────────────────────────────────────
info "编译 libunwind..."
mkdir -p "${BUILD_DIR}/libunwind" && cd "${BUILD_DIR}/libunwind"
cmake -G Ninja \
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
  -DCMAKE_C_COMPILER=${CC} -DCMAKE_CXX_COMPILER=${CXX} \
  -DCMAKE_AR=${LLVM_DIR}/bin/llvm-ar -DCMAKE_RANLIB=${LLVM_DIR}/bin/llvm-ranlib \
  -DCMAKE_C_FLAGS="${CFLAGS}" -DCMAKE_CXX_FLAGS="${CXXFLAGS}" -DCMAKE_ASM_FLAGS="${CFLAGS}" \
  -DCMAKE_INSTALL_PREFIX="${CROSS_LIBS_DIR}/libunwind" \
  -DLLVM_ENABLE_RUNTIMES="libunwind" -DLIBUNWIND_ENABLE_SHARED=OFF \
  -DLIBUNWIND_USE_COMPILER_RT=ON -DLIBUNWIND_ENABLE_THREADS=ON \
  "${LLVM_SRC_DIR}/runtimes"
ninja -j"$(nproc)" install
info "libunwind ✅"

# ─── libcxxabi ────────────────────────────────────────────────────────────
info "编译 libc++abi..."
mkdir -p "${BUILD_DIR}/libcxxabi" && cd "${BUILD_DIR}/libcxxabi"
cmake -G Ninja \
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
  -DCMAKE_C_COMPILER=${CC} -DCMAKE_CXX_COMPILER=${CXX} \
  -DCMAKE_AR=${LLVM_DIR}/bin/llvm-ar -DCMAKE_RANLIB=${LLVM_DIR}/bin/llvm-ranlib \
  -DCMAKE_C_FLAGS="${CFLAGS}" -DCMAKE_CXX_FLAGS="${CXXFLAGS}" \
  -DCMAKE_INSTALL_PREFIX="${CROSS_LIBS_DIR}/libcxxabi" \
  -DLLVM_ENABLE_RUNTIMES="libcxxabi" -DLIBCXXABI_ENABLE_SHARED=OFF \
  -DLIBCXXABI_USE_COMPILER_RT=ON -DLIBCXXABI_USE_LLVM_UNWINDER=ON \
  -DLIBCXXABI_LIBUNWIND_PATH="${LLVM_SRC_DIR}/libunwind" \
  "${LLVM_SRC_DIR}/runtimes"
ninja -j"$(nproc)" install
info "libc++abi ✅"

# ─── libcxx ───────────────────────────────────────────────────────────────
info "编译 libc++..."
mkdir -p "${BUILD_DIR}/libcxx" && cd "${BUILD_DIR}/libcxx"
cmake -G Ninja \
  -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
  -DCMAKE_C_COMPILER=${CC} -DCMAKE_CXX_COMPILER=${CXX} \
  -DCMAKE_AR=${LLVM_DIR}/bin/llvm-ar -DCMAKE_RANLIB=${LLVM_DIR}/bin/llvm-ranlib \
  -DCMAKE_C_FLAGS="${CFLAGS}" -DCMAKE_CXX_FLAGS="${CXXFLAGS}" \
  -DCMAKE_INSTALL_PREFIX="${CROSS_LIBS_DIR}/libcxx" \
  -DLLVM_ENABLE_RUNTIMES="libcxx" -DLIBCXX_ENABLE_SHARED=OFF \
  -DLIBCXX_CXX_ABI=libcxxabi -DLIBCXX_HAS_MUSL_LIBC=ON \
  -DLIBCXX_CXX_ABI_INCLUDE_PATHS="${LLVM_SRC_DIR}/libcxxabi/include" \
  -DLIBCXX_USE_COMPILER_RT=ON -DLIBCXX_ENABLE_STATIC_ABI_LIBRARY=ON \
  "${LLVM_SRC_DIR}/runtimes"
ninja -j"$(nproc)" install
info "libc++ ✅"

rm -rf "$BUILD_DIR"
info "全部完成: ${CROSS_LIBS_DIR}"
