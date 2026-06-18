#!/bin/bash
#===============================================================================
# build-bun-ohos.sh — 本地编译 Bun (OHOS aarch64) 脚本
#
# 用法:
#   ./scripts/ohos/build-bun-ohos.sh              # 编译全部
#   ./scripts/ohos/build-bun-ohos.sh sync-only    # 仅同步源码，不编译
#   ./scripts/ohos/build-bun-ohos.sh ninja-only   # 仅运行 ninja（假设源码已同步）
#
# 说明:
#   1. 从 DEV_SRC 同步源码到 CI_SRC（绕过 git push 网络限制）
#   2. 在 CI 工作目录下运行 ninja 编译
#   3. 编译产物（bun binary）复制到 SHARED_DIR
#
# 环境变量（可覆盖）:
#   DEV_SRC, CI_SRC, BUILD_DIR, SHARED_DIR
#===============================================================================

set -euo pipefail

# ─── 路径配置 ────────────────────────────────────────────────────────────────
DEV_SRC="${DEV_SRC:-/home/user/sources/bun}"
CI_SRC="${CI_SRC:-/home/user/actions-runner/_work/bun/bun}"
BUILD_DIR="${BUILD_DIR:-${CI_SRC}/build/release-ohos}"
SHARED_DIR="${SHARED_DIR:-/mnt/linux_share/ci-test/bun}"

BUN="${BUN:-/home/user/.bun/bin/bun}"
NINJA="${NINJA:-/usr/bin/ninja}"

# OHOS 交叉编译工具链
OHOS_SYSROOT="${OHOS_SYSROOT:-/home/user/setup-ohos-sdk/ohos/native/sysroot}"
OHOS_CROSS_LIBS="${OHOS_CROSS_LIBS:-${CI_SRC}/build/ohos-cross-libs}"
OHOS_ICU="${OHOS_ICU:-${CI_SRC}/build/ohos-icu}"

# ─── 色彩输出 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── 前置检查 ────────────────────────────────────────────────────────────────
pre_check() {
    local fail=0
    for d in "$DEV_SRC" "$CI_SRC" "$BUILD_DIR" "$SHARED_DIR"; do
        if [ ! -d "$d" ]; then
            err "目录不存在: $d"
            fail=1
        fi
    done
    for cmd in "$BUN" "$NINJA" cp tar; do
        if ! command -v "$cmd" &>/dev/null && [ ! -x "$cmd" ]; then
            err "命令不可用: $cmd"
            fail=1
        fi
    done
    if [ ! -f "${BUILD_DIR}/configure.json" ]; then
        warn "build 目录未配置（缺少 configure.json）"
        warn "请先运行: cd $CI_SRC && $BUN scripts/build.ts --config-file=$BUILD_DIR/configure.json"
    fi
    return "$fail"
}

# ─── 同步源码 ────────────────────────────────────────────────────────────────
sync_source() {
    info "同步源码: ${DEV_SRC} → ${CI_SRC}"

    # 使用 tar 流式同步目录，支持排除模式（rsync 不可用时替代方案）
    local excludes=(
        --exclude='.git'
        --exclude='build'
        --exclude='node_modules'
        --exclude='vendor/WebKit'
        --exclude='vendor/boringssl'
        --exclude='target'
        --exclude='.cargo'
    )

    # src/ 目录
    (cd "$DEV_SRC" && tar cf - "${excludes[@]}" src/) | (cd "$CI_SRC" && tar xf -)

    # scripts/ 目录
    (cd "$DEV_SRC" && tar cf - "${excludes[@]}" scripts/) | (cd "$CI_SRC" && tar xf -)

    # packages/ 目录（bun-usockets、bun-uws 等，大小写敏感）
    (cd "$DEV_SRC" && tar cf - "${excludes[@]}" packages/) | (cd "$CI_SRC" && tar xf -)

    # 单个配置文件
    cp "$DEV_SRC/Cargo.toml" "$CI_SRC/Cargo.toml" 2>/dev/null || true
    cp "$DEV_SRC/Cargo.lock" "$CI_SRC/Cargo.lock" 2>/dev/null || true
    cp "$DEV_SRC/package.json" "$CI_SRC/package.json" 2>/dev/null || true
    cp "$DEV_SRC/configure.json" "$CI_SRC/configure.json" 2>/dev/null || true
    cp "$DEV_SRC/bun.lock" "$CI_SRC/bun.lock" 2>/dev/null || true
    cp "$DEV_SRC/scripts/ohos/build-bun-ohos.sh" "$CI_SRC/scripts/ohos/build-bun-ohos.sh" 2>/dev/null || true

    ok "源码同步完成"
}

# ─── 编译 ─────────────────────────────────────────────────────────────────────
run_build() {
    info "开始编译 (ninja -C ${BUILD_DIR} bun)"
    echo "────────────────────────────────────────────────────────────────"

    # 导出交叉编译环境变量
    export CC="/home/user/.local/bin/clang"
    export CXX="/home/user/.local/bin/clang++"
    export AR="/opt/llvm-22.1.4/bin/llvm-ar"
    export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER="/home/user/.local/bin/clang++"
    export CARGO_HOME="/home/user/.cargo"
    export RUSTUP_HOME="/home/user/.rustup"
    export RUSTUP_TOOLCHAIN="nightly-2026-06-06"

    # ninja 编译
    cd "$CI_SRC"
    "$NINJA" -C "$BUILD_DIR" bun 2>&1 | while IFS= read -r line; do
        echo -e "  ${line}"
    done

    local exit_code=${PIPESTATUS[0]}
    if [ "$exit_code" -ne 0 ]; then
        err "编译失败 (exit code: $exit_code)"
        return "$exit_code"
    fi
    ok "编译成功"
}

# ─── 部署产物 ────────────────────────────────────────────────────────────────
deploy_artifact() {
    local binary="${BUILD_DIR}/bun"
    if [ ! -f "$binary" ]; then
        err "编译产物不存在: $binary"
        return 1
    fi

    # 获取版本信息
    local version_info
    version_info=$(cd "$CI_SRC" && git log --oneline -1 --format="%h %s" 2>/dev/null || echo "unknown")
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)

    # 目标文件名
    local dest_name="bun-ohos-${version_info%% *}-${timestamp}.elf"
    local dest_path="${SHARED_DIR}/${dest_name}"

    # 复制到共享目录
    cp "$binary" "$dest_path"
    chmod +x "$dest_path"

    # 更新 symlink/默认 binary
    cp "$binary" "${SHARED_DIR}/bun"

    local size
    size=$(stat -c%s "$binary" 2>/dev/null || stat -f%z "$binary" 2>/dev/null)
    local size_mb
    size_mb=$((size / 1048576))

    ok "产物部署完成"
    echo ""
    echo "  文件:     ${dest_path}"
    echo "  大小:     ${size_mb} MB"
    echo "  版本:     ${version_info}"
    echo "  默认:     ${SHARED_DIR}/bun"
    echo ""
}

# ─── 打印帮助 ────────────────────────────────────────────────────────────────
print_help() {
    echo "用法: $0 [sync-only|ninja-only|deploy-only|help]"
    echo ""
    echo "  默认      同步源码 → 编译 → 部署产物"
    echo "  sync-only 仅同步源码"
    echo "  ninja-only 仅运行 ninja 编译（需先 sync）"
    echo "  deploy-only 仅复制已有产物到共享目录"
    echo "  help       显示此帮助"
}

# ─── 主流程 ──────────────────────────────────────────────────────────────────
main() {
    local mode="${1:-full}"

    case "$mode" in
        sync-only)
            pre_check
            sync_source
            ;;
        ninja-only)
            pre_check
            run_build
            ;;
        deploy-only)
            deploy_artifact
            ;;
        help|--help|-h)
            print_help
            exit 0
            ;;
        full|"")
            pre_check
            sync_source
            run_build
            deploy_artifact
            ;;
        *)
            err "未知模式: $mode"
            print_help
            exit 1
            ;;
    esac
}

main "$@"
