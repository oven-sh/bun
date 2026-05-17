#!/usr/bin/env bash
#=============================================================================
# Bun OHOS 一键构建脚本
# 从环境检查 → cross-libs → WebKit → Bun → 打包发布
#
# 用法:
#   ./scripts/ohos/build.sh
#   OHOS_SDK_ROOT=/path ./scripts/ohos/build.sh
#
# 环境变量:
#   OHOS_SDK_ROOT    OHOS SDK 路径 (默认 ~/setup-ohos-sdk)
#   BUN_REPO         仓库 (默认 springmin/bun)
#   BUN_BRANCH       分支 (默认 ohos-aarch64)
#   NINJA_JOBS       并行数 (默认 nproc)
#   SKIP_CROSS_LIBS  跳过 cross-libs 编译 (默认 false)
#   SKIP_BUILD       跳过 Bun 构建 (默认 false)
#=============================================================================
set -euo pipefail

# ─── 配置 ──────────────────────────────────────────────────────────────────
OHOS_SDK_ROOT="${OHOS_SDK_ROOT:-$HOME/setup-ohos-sdk}"
BUN_REPO="${BUN_REPO:-springmin/bun}"
BUN_BRANCH="${BUN_BRANCH:-ohos-aarch64}"
WORK_DIR="${WORK_DIR:-$(pwd)}"
BUILD_DIR="${BUILD_DIR:-${WORK_DIR}/bun}"
NINJA_JOBS="${NINJA_JOBS:-$(nproc)}"
SKIP_CROSS_LIBS="${SKIP_CROSS_LIBS:-false}"
SKIP_BUILD="${SKIP_BUILD:-false}"
DATE_TAG=$(date +%Y%m%d_%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── 颜色 ───────────────────────────────────────────────────────────────────
info()  { echo -e "\033[0;32m[INFO]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*"; exit 1; }

# ─── 阶段1: 环境检查 ──────────────────────────────────────────────────────
info "=== 阶段1: 环境检查 ==="

[ -d "${OHOS_SDK_ROOT}/ohos/native/sysroot" ] || error "OHOS SDK 未找到: ${OHOS_SDK_ROOT}"

for cmd in git ninja bun clang++; do
  command -v "$cmd" >/dev/null 2>&1 || error "缺少: $cmd"
done

MEM=$(free -m | awk '/^Mem:/{print $2}')
[ "$MEM" -lt 8000 ] && warn "内存不足 8GB (${MEM}MB)，可能 OOM"
info "环境检查通过 ✅ ($(nproc) cores, ${MEM}MB RAM)"

# ─── 阶段2: 准备 cross-libs ──────────────────────────────────────────────
if [ "$SKIP_CROSS_LIBS" != "true" ]; then
  info "=== 阶段2: 准备交叉编译 libc++ ==="
  if [ -f "${SCRIPT_DIR}/prepare-cross-libs.sh" ]; then
    bash "${SCRIPT_DIR}/prepare-cross-libs.sh"
  fi
  # 验证
  for lib in libcxx/lib/libc++.a libcxxabi/lib/libc++abi.a libunwind/lib/libunwind.a; do
    [ -f "${BUILD_DIR}/build/ohos-cross-libs/${lib}" ] || warn "缺少 cross-lib: ${lib}"
  done
  info "Cross-libs 检查完成 ✅"
fi

# ─── 阶段3: 拉取源码 ──────────────────────────────────────────────────────
info "=== 阶段3: 拉取源码 ==="
mkdir -p "$WORK_DIR"

if [ -d "${BUILD_DIR}/.git" ]; then
  cd "$BUILD_DIR" && git fetch origin "$BUN_BRANCH" 2>/dev/null || true
  cd "$BUILD_DIR" && git checkout "$BUN_BRANCH" 2>/dev/null || true
else
  git clone "https://github.com/${BUN_REPO}" "$BUILD_DIR" --branch "$BUN_BRANCH" --depth 1
fi

cd "$BUILD_DIR"
BUN_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
info "Bun commit: ${BUN_COMMIT}"

# WebKit fork
if [ ! -d "vendor/WebKit/.git" ]; then
  info "克隆 WebKit fork..."
  git clone https://github.com/springmin/WebKit vendor/WebKit --branch ohos-aarch64 --depth 1
fi

# ─── 阶段4: 配置 ──────────────────────────────────────────────────────────
info "=== 阶段4: 配置构建 ==="

OHOS_SYSROOT="${OHOS_SDK_ROOT}/ohos/native/sysroot"
[ -d "$OHOS_SYSROOT" ] || error "sysroot 不存在: $OHOS_SYSROOT"

bun run build:release \
  --os=ohos --arch=aarch64 \
  --webkit=local \
  --ohos-sysroot="$OHOS_SYSROOT" \
  --configure-only 2>&1 | tail -1

info "配置完成 ✅"

# ─── 阶段5: 编译 WebKit ─────────────────────────────────────────────────
info "=== 阶段5: 编译 WebKit ==="
ninja -C build/release configure-WebKit -j1 2>&1 | tail -1
ninja -C build/release/deps/WebKit jsc -j"$NINJA_JOBS" 2>&1 | tail -1
[ -f build/release/deps/WebKit/lib/libJavaScriptCore.a ] || error "WebKit 编译失败"
info "WebKit ✅"

# ─── 阶段6: 编译 Bun ─────────────────────────────────────────────────────
info "=== 阶段6: 编译 Bun ==="
ninja -C build/release bun -j"$NINJA_JOBS" 2>&1 | tail -1

BINARY="build/release/bun"
[ -f "$BINARY" ] || error "Bun 编译失败"
BINARY_SIZE=$(du -sh "$BINARY" | awk '{print $1}')
file "$BINARY" | grep -q "ELF" || error "不是有效的 ELF 文件"
info "Bun 编译完成: ${BINARY_SIZE} ✅"

# ─── 阶段7: 打包 ─────────────────────────────────────────────────────────
info "=== 阶段7: 打包 ==="

VERSION=$("$BINARY" --version 2>/dev/null || echo "1.3.14")
PKG_NAME="bun-ohos-aarch64-${VERSION}-${BUN_COMMIT}-${DATE_TAG}"
PKG_DIR="/tmp/bun-release/${PKG_NAME}"
mkdir -p "$PKG_DIR"

cp "$BINARY" "$PKG_DIR/bun"

cat > "$PKG_DIR/README.md" << EOF
# Bun for HarmonyOS (OHOS)

**Version**: ${VERSION} | **Commit**: ${BUN_COMMIT} | **Build**: ${DATE_TAG}
**Arch**: ARM64 (aarch64) | **Size**: ${BINARY_SIZE}

## Quick Start
\`\`\`bash
binary-sign-tool sign -inFile bun -outFile bun-signed -selfSign "1"
./bun-signed test_all_in_one.js
\`\`\`

## Known Limitations
- Bun.spawnSync blocked by OHOS seccomp
- /tmp is read-only on OHOS

## Links
- https://github.com/springmin/bun/tree/ohos-aarch64
EOF

# 复制测试文件 (如果存在)
cp test_all_in_one.js "$PKG_DIR/" 2>/dev/null || true
cp test_perf.js "$PKG_DIR/" 2>/dev/null || true

cd /tmp/bun-release
tar czf "${PKG_NAME}.tar.gz" "$PKG_NAME"
info "包: /tmp/bun-release/${PKG_NAME}.tar.gz ($(du -sh "/tmp/bun-release/${PKG_NAME}.tar.gz" | awk '{print $1}'))"

# ─── 阶段8: 发布到共享目录 ──────────────────────────────────────────────
if [ -d /mnt/linux_share ]; then
  cp "${PKG_NAME}.tar.gz" /mnt/linux_share/ 2>/dev/null && \
    info "已发布: /mnt/linux_share/${PKG_NAME}.tar.gz ✅"
fi

info "=== 全部完成 🎉 ==="
echo "  解压: tar xzf ${PKG_NAME}.tar.gz"
echo "  签名: binary-sign-tool sign -inFile bun -outFile bun-signed -selfSign \"1\""
echo "  测试: ./bun-signed test_all_in_one.js"
