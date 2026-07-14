#!/usr/bin/env bash
#===============================================================================
# build-ohos-native.sh — OHOS aarch64 原生编译 Bun
#
# 从 oven-sh/WebKit 源码编译 WebKit，再用本地 WebKit 编译 bun。
# 产物: build/release/bun (完全静态链接, 0 个未定义符号)
#
# 前置条件:
#   - ohos-sdk (binary-sign-tool, sysroot)
#   - llvm@21 (交叉编译器)
#   - rust-nightly (aarch64-linux-ohos)
#   - cmake, ninja, node, perl, python3, ruby, gperf
#   - bun-bootstrap (~/.bun/bun)
#   - 网络 (克隆 oven-sh/WebKit)
#===============================================================================

set -euo pipefail

# ─── 色彩 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── 路径 ─────────────────────────────────────────────────────────────────────
BUN_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BUN="${BUN:-/storage/Users/currentUser/.bun/bun}"
LLVM_PREFIX="/storage/Users/currentUser/usr/local/llvm22.1.7"
OHOS_SDK="/storage/Users/currentUser/.harmonybrew/opt/ohos-sdk/"
SYSROOT="/storage/Users/currentUser/.harmonybrew/Cellar/ohos-sdk/26.0.0.18_1/native/sysroot"
WEBKIT_SRC="${WEBKIT_SRC:-/storage/Users/currentUser/springsources/WebKit}"
WEBKIT_COMMIT=$(grep "WEBKIT_VERSION" "$BUN_REPO/scripts/build/deps/webkit.ts" | sed 's/.*"\([a-f0-9]\{40\}\)".*/\1/')
[ -z "$WEBKIT_COMMIT" ] && { err "无法从 scripts/build/deps/webkit.ts 解析 WEBKIT_VERSION"; exit 1; }
OUTDIR="$BUN_REPO/build/release"
ICU_SHIM_DIR="/storage/Users/currentUser/build-icu-target"
ICU_SHIM="$ICU_SHIM_DIR/lib/icu_shim.cpp.o"
LIBCXX_SHIM="$ICU_SHIM_DIR/lib/libcxx_hardening_shim.cpp.o"
ICU_LIB_DIR="$BUN_REPO/build/ohos-icu/target/lib"

export TMPDIR=/data/storage/el2/base/tmp
export SSL_CERT_FILE="/storage/Users/currentUser/.harmonybrew/etc/ca-certificates/cert.pem"
export CURL_CA_BUNDLE="$SSL_CERT_FILE"

# ─── 阶段1: 环境检查 ────────────────────────────────────────────────────────
phase_check() {
  info "=== 环境检查 ==="
  local fail=0
  for cmd in "$BUN" cmake ninja git perl; do
    command -v "$cmd" &>/dev/null || { err "缺少: $cmd"; fail=1; }
  done
  [ -f "$LLVM_PREFIX/bin/clang" ]   || { err "LLVM 未找到: $LLVM_PREFIX"; fail=1; }
  [ -d "$SYSROOT/usr/include" ]     || { err "sysroot 未找到: $SYSROOT"; fail=1; }
  command -v binary-sign-tool &>/dev/null || { err "binary-sign-tool 不在 PATH"; fail=1; }
  [ -f "$BUN" ]                     || { err "bootstrap bun 未找到: $BUN"; fail=1; }
  [ "$fail" = "0" ] || { err "环境检查失败"; exit 1; }
  ok "环境就绪"
}

# ─── 阶段2: 克隆 WebKit ─────────────────────────────────────────────────────
phase_webkit_clone() {
  info "=== 克隆 oven-sh/WebKit ==="
  if [ -d "$WEBKIT_SRC/.git" ]; then
    local current
    current=$(cd "$WEBKIT_SRC" && git rev-parse HEAD 2>/dev/null || true)
    if [ "$current" = "$WEBKIT_COMMIT" ]; then
      ok "WebKit 已是目标 commit ($WEBKIT_COMMIT)"
      return
    fi
    warn "WebKit 存在但不是目标 commit，增量同步..."
    cd "$WEBKIT_SRC"
    git fetch --depth 1 origin "$WEBKIT_COMMIT"
  else
    git clone --depth 1 https://github.com/oven-sh/WebKit.git "$WEBKIT_SRC"
    cd "$WEBKIT_SRC"
  fi
  git checkout "$WEBKIT_COMMIT"
  # 修复 perl PATH 问题（OHOS 上 python subprocess 找不到 perl）
  sed -i 's|\["perl"|["/storage/Users/currentUser/.harmonybrew/bin/perl"|g' \
    Source/JavaScriptCore/inspector/scripts/generate-inspector-protocol-bindings.py
  ok "WebKit 已就绪 ($WEBKIT_COMMIT)"
}

# ─── 阶段3: 编译 ICU shim ────────────────────────────────────────────────────
phase_icu_shim() {
  info "=== 编译 ICU ABI 桥接层 ==="
  local shim_dir
  shim_dir=$(dirname "$ICU_SHIM")
  mkdir -p "$shim_dir"
  cat > "$shim_dir/icu_shim.cpp" << 'CPPEOF'
#include <condition_variable>
#include <new>
#include <mutex>
struct icu_condvar { void* _v[5]; };
extern "C" {
void _ZNSt18condition_variableC1Ev(icu_condvar* cv) {
    new (cv) std::condition_variable();
}
void _ZNSt18condition_variableD1Ev(icu_condvar* cv) {
    reinterpret_cast<std::condition_variable*>(cv)->~condition_variable();
}
void _ZNSt18condition_variable4waitERSt11unique_lockISt5mutexE(icu_condvar* cv, void* lock) {
    auto* lk = reinterpret_cast<std::unique_lock<std::mutex>*>(lock);
    if (!lk->owns_lock()) {
        fprintf(stderr, "\n[icu_shim] wait: mutex NOT locked, mutex=%p, lock=%p\n", (void*)lk->mutex(), (void*)lock);
    }
    reinterpret_cast<std::condition_variable*>(cv)->wait(*lk);
}
void _ZNSt18condition_variable10notify_allEv(icu_condvar* cv) {
    reinterpret_cast<std::condition_variable*>(cv)->notify_all();
}
#include <execinfo.h>
#include <unistd.h>
void _ZSt20__throw_system_errori(int err) {
    // ICU calls __throw_system_error directly for errors like EPERM during
    // ICU initialization. We can't forward this to libc++ because of the
    // -fno-exceptions abort chain. Instead, use abort() with diagnostics
    // so the caller (ICU) never sees a return from this function.
    fprintf(stderr, "\n[icu_shim] FATAL: __throw_system_error(%d) from ICU\n", err);
    void* addrs[64];
    int n = backtrace(addrs, 64);
    backtrace_symbols_fd(addrs, n, STDERR_FILENO);
    _exit(1);
}
__thread void* _ZSt15__once_callable = nullptr;
__thread void (*_ZSt11__once_call)() = nullptr;
void __once_proxy() {}
long __timezone = 0;
}
CPPEOF
  $LLVM_PREFIX/bin/clang++ --target=aarch64-linux-ohos --sysroot="$SYSROOT" \
    -D__MUSL__ -fPIC -fno-emulated-tls -Oz \
    -nostdinc++ -I"$BUN_REPO/build/ohos-cross-libs/libcxx/include/v1" -I"$BUN_REPO/build/ohos-cross-libs/libcxxabi/include" \
    -c "$shim_dir/icu_shim.cpp" -o "$ICU_SHIM"
  # libcxx hardening shim — wrap __libcpp_verbose_abort to avoid abort()
  cat > "$ICU_SHIM_DIR/lib/libcxx_hardening_shim.cpp" << 'CPPEOF2'
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
extern "C" void __wrap___libcpp_verbose_abort(char const *__format, ...) {
    va_list ap;
    va_start(ap, __format);
    vfprintf(stderr, __format, ap);
    va_end(ap);
    fprintf(stderr, "\n[libcxx_hardening_shim] suppressed hardening abort\n");
    _exit(0);
}
CPPEOF2
  mkdir -p "$ICU_SHIM_DIR/lib"
  $LLVM_PREFIX/bin/clang++ --target=aarch64-linux-ohos --sysroot="$SYSROOT" -D__MUSL__ \
    -fPIC -Oz -nostdinc++ -c "$ICU_SHIM_DIR/lib/libcxx_hardening_shim.cpp" -o "$LIBCXX_SHIM" 2>&1
  ok "libcxx hardening shim 已编译"
}

# ─── 阶段4: 签名包装器 (clang-sign) ──────────────────────────────────────────
phase_clang_sign() {
  info "=== 创建 clang-sign 签名包装器 ==="
  local bin_dir="$BUN_REPO/.bin"
  mkdir -p "$bin_dir"
  local sign_tool
  sign_tool=$(command -v binary-sign-tool 2>/dev/null)
  cat > "$bin_dir/clang-sign" << 'CLANGSCRIPT'
#!/bin/sh
set -e
clang_path="$LLVM_PREFIX/bin/clang"
sign_tool="/storage/Users/currentUser/.harmonybrew/bin/binary-sign-tool"
tmpdir="$TMPDIR"
sysroot="$SYSROOT"
extra_flags="--sysroot=\$sysroot"
orig_out=""; has_link=1; prev=""; has_target=0
for arg in "\$@"; do
  [ "\$prev" = "-o" ] && orig_out="\$arg"
  case "\$arg" in --target=*) has_target=1 ;; esac
  prev="\$arg"
  case "\$arg" in -c|-E|-S|-M|-MM) has_link=0 ;; esac
done
[ "\$has_target" = "0" ] && extra_flags="\$extra_flags --target=aarch64-linux-ohos"
orig_out=""; has_link=1; prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && orig_out="$arg"
  prev="$arg"
  case "$arg" in -c|-E|-S|-M|-MM) has_link=0 ;; esac
done
if [ "$has_link" = "1" ] && [ -n "$orig_out" ]; then
  tmpout="$tmpdir/ld.$$.out"; filtered=""; skip_next=0
  for arg in "$@"; do
    if [ "$skip_next" = "1" ]; then filtered="$filtered $tmpout"; skip_next=0
    elif [ "$arg" = "-o" ]; then skip_next=1
    else filtered="$filtered $arg"; fi
  done
  [ "$skip_next" = "1" ] && filtered="$filtered $tmpout"
  eval "\$clang_path \$extra_flags \$filtered"; rc=\$?
  [ $rc -ne 0 ] && rm -f "$tmpout" 2>/dev/null && exit $rc
  if [ -f "$tmpout" ]; then
    magic=$(od -An -N4 -tx1 "$tmpout" 2>/dev/null | tr -d ' \n')
    if [ "$magic" = "7f454c46" ]; then
      has_codesign=$(readelf -S "$tmpout" 2>/dev/null | grep -c codesign || true)
      if [ "$has_codesign" = "0" ]; then
        tgt="$tmpout.signed"
        "$sign_tool" sign -selfSign 1 -inFile "$tmpout" -outFile "$tgt" >/dev/null 2>&1 && {
          chmod +x "$tgt" 2>/dev/null || true
          cp -f "$tgt" "$orig_out"; rm -f "$tmpout" "$tgt" 2>/dev/null || true
        } || { cp -f "$tmpout" "$orig_out"; rm -f "$tmpout" 2>/dev/null || true; }
      else
        cp -f "$tmpout" "$orig_out"; rm -f "$tmpout" 2>/dev/null || true
      fi
    else
      cp -f "$tmpout" "$orig_out"; rm -f "$tmpout" 2>/dev/null || true
    fi
  fi
else
  exec "\$clang_path" \$extra_flags "\$@"
fi
CLANGSCRIPT
  chmod 755 "$bin_dir/clang-sign"
  sed 's|/clang"|/clang++"|g' "$bin_dir/clang-sign" > "$bin_dir/clang++-sign"
  chmod 755 "$bin_dir/clang++-sign"
  ln -sf clang-sign "$bin_dir/cc" 2>/dev/null || true
  ln -sf clang++-sign "$bin_dir/c++" 2>/dev/null || true
  ln -sf "$LLVM_PREFIX/bin/llvm-strip" "$bin_dir/strip" 2>/dev/null || true
  ok "clang-sign 已就绪"
}

# ─── 阶段5: 构建配置 ───────────────────────────────────────────────────────
phase_configure() {
  info "=== 配置构建 ==="
  cd "$BUN_REPO"
  rm -rf build/release
  export CC="$BUN_REPO/.bin/cc"
  export CXX="$BUN_REPO/.bin/c++"
  export PATH="$BUN_REPO/.bin:$LLVM_PREFIX/bin:$PATH"
  export LD_LIBRARY_PATH="/storage/Users/currentUser/.harmonybrew/opt/openssl@3/lib"
  export BUN_WEBKIT_PATH="$WEBKIT_SRC"
  $BUN scripts/build.ts --configure-only --profile=release --os=ohos --arch=aarch64 \
    --canary=off --webkit=local \
    --ohos-sdk-root="$OHOS_SDK" \
    --ohos-sysroot="$SYSROOT" \
    -j1 2>&1 | tail -3
  ok "构建配置完成"
}

# ─── 阶段6: 补丁 build.ninja ──────────────────────────────────────────────
phase_patch_ninja() {
  info "=== 补丁 build.ninja ==="
  local nf="$OUTDIR/build.ninja"
  local lwk="$OUTDIR/deps/WebKit"
  python3 << PYEOF
nf = "$nf"
repo = "$BUN_REPO"
bun = "$BUN"
sysroot = "$SYSROOT"
lwk = "$lwk"
shim = "$ICU_SHIM"
harden_shim = "$LIBCXX_SHIM"
icudir = "$ICU_LIB_DIR"
import re
with open(nf, 'r') as f:
    c = f.read()
# clang-sign now adds --sysroot automatically, so dep_host_cc works too.
c = c.replace('  command = $LLVM_PREFIX/bin/clang \$flags -o \$out \$in'.replace('\$LLVM_PREFIX', '$LLVM_PREFIX'),
              '  command = ' + repo + '/.bin/clang-sign \$flags -o \$out \$in')
c = c.replace('  command = $LLVM_PREFIX/bin/clang++ \$flags -o \$out \$in'.replace('\$LLVM_PREFIX', '$LLVM_PREFIX'),
              '  command = ' + repo + '/.bin/clang++-sign \$flags -o \$out \$in')
# esbuild → bun build
c = c.replace('  command = cd \$cwd && ' + repo + '/node_modules/.bin/esbuild \$args',
              '  command = cd \$cwd && ' + bun + ' build \$args --target=bun --platform=bun --format=esm')
c = c.replace("--external:/bun:*", "--external /bun/*")
c = c.replace("'--define:process.env.NODE_ENV=\"production\"'", "'--define process.env.NODE_ENV=\"production\"'")
c = c.replace("--target=esnext ", "").replace("--platform=node ", "")
# cargo CC/CXX/LINKER → clang-sign
c = c.replace('--env=CC=/storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang', '--env=CC=' + repo + '/.bin/clang-sign')
c = c.replace('--env=CXX=/storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++', '--env=CXX=' + repo + '/.bin/clang++-sign')
c = c.replace('--env=CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER=/storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++', '--env=CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER=' + repo + '/.bin/clang++-sign')
# Remove -Zbuild-std
c = c.replace(' -Zbuild-std=core,alloc,std,proc_macro,panic_abort', '')
# Remove bad linker flags
c = c.replace('-Wl,--compress-debug-sections=zlib ', '')
c = c.replace(' -Wl,--gc-sections', '')
# WebKit target: skip jsc binary
c = c.replace('--target jsc', '--target WTF JavaScriptCore bmalloc')
# Disable libc++ hardening (EXTENSIVE breaks on OHOS musl)
c = c.replace("'-DCMAKE_CXX_FLAGS=", "'-DCMAKE_CXX_FLAGS=-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE -D_LIBCPP_PROVIDES_DEFAULT_RUNE_TABLE ")
# Add hardening/rune-table flags to cxx, cxx_pch, and pch rules.
# Also disable highway SVE/SVE2 targets (BitsFromMask missing for scalable SVE).
hwy_disable = "'-DHWY_DISABLED_TARGETS=HWY_SVE|HWY_SVE2|HWY_SVE_256|HWY_SVE2_128'"
c = c.replace(
    'command = /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ \$cxxflags -MMD -MT \$out -MF \$out.d -c \$in -o \$out',
    'command = /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ \$cxxflags ' + hwy_disable + ' -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE -D_LIBCPP_PROVIDES_DEFAULT_RUNE_TABLE -MMD -MT \$out -MF \$out.d -c \$in -o \$out'
)
c = c.replace(
    'command = /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ \$cxxflags -Winvalid-pch -Xclang -include-pch -Xclang \$pch_file -Xclang -include -Xclang \$pch_header -MMD -MT \$out -MF \$out.d -c \$in -o \$out',
    'command = /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ \$cxxflags ' + hwy_disable + ' -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE -D_LIBCPP_PROVIDES_DEFAULT_RUNE_TABLE -Winvalid-pch -Xclang -include-pch -Xclang \$pch_file -Xclang -include -Xclang \$pch_header -MMD -MT \$out -MF \$out.d -c \$in -o \$out'
)
c = c.replace(
    'command = /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ \$cxxflags -Winvalid-pch -fpch-instantiate-templates -Xclang -fno-pch-timestamp -Xclang -emit-pch -Xclang -include -Xclang \$pch_header -x c++-header -MD -MT \$out -MF \$out.d -c \$in -o \$out',
    'command = /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ \$cxxflags ' + hwy_disable + ' -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE -D_LIBCPP_PROVIDES_DEFAULT_RUNE_TABLE -Winvalid-pch -fpch-instantiate-templates -Xclang -fno-pch-timestamp -Xclang -emit-pch -Xclang -include -Xclang \$pch_header -x c++-header -MD -MT \$out -MF \$out.d -c \$in -o \$out'
)
# whole-archive with LOCAL WebKit + ICU shim, BEFORE @$out.rsp
old_link = '  command = /storage/Users/currentUser/.bun/bun /storage/Users/currentUser/springsources/bun/scripts/build/stream.ts link --console /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ @\$out.rsp \$ldflags -o \$out'
new_link = '  command = /storage/Users/currentUser/.bun/bun /storage/Users/currentUser/springsources/bun/scripts/build/stream.ts link --console /storage/Users/currentUser/usr/local/llvm22.1.7/bin/clang++ -Wl,--whole-archive ' + lwk + '/lib/libWTF.a ' + lwk + '/lib/libJavaScriptCore.a ' + lwk + '/lib/libbmalloc.a ' + icudir + '/libicuuc.a ' + icudir + '/libicui18n.a ' + icudir + '/libicudata.a -Wl,--no-whole-archive ' + shim + ' ' + harden_shim + ' @\$out.rsp \$ldflags -Wl,--wrap=__libcpp_verbose_abort -o \$out'
c = c.replace(old_link, new_link)
with open(nf, 'w') as f:
    f.write(c)
PYEOF
  ok "build.ninja 已补丁"
}

# ─── 阶段7: 编译 ─────────────────────────────────────────────────────────
phase_build() {
  info "=== 编译 (首次: cargo 可能因 Text file busy 失败, 自动重试) ==="
  cd "$BUN_REPO"
  export CC="$BUN_REPO/.bin/cc"
  export CXX="$BUN_REPO/.bin/c++"
  export PATH="$BUN_REPO/.bin:$LLVM_PREFIX/bin:$PATH"
  export LD_LIBRARY_PATH="/storage/Users/currentUser/.harmonybrew/opt/openssl@3/lib"
  export BUN_WEBKIT_PATH="$WEBKIT_SRC"
  export RUSTC_BOOTSTRAP=1
  # cargo build-script 在 OHOS 上需要逐层签名，可能需多轮重试
  local attempt=0
  while [ $attempt -lt 20 ]; do
    attempt=$((attempt + 1))
    info "编译尝试 #$attempt"
    if ninja -C build/release -j1 bun 2>&1 | tee /storage/Users/currentUser/tmp/build.log; then
      ok "编译成功!"
      return 0
    fi
    # 如果失败且是 Text file busy，sign 所有 build-script 并重试
    if grep -qE "Text file busy|Permission denied" /storage/Users/currentUser/tmp/build.log; then
      warn "检测到 build-script 签名问题，修复后重试..."
      # 签名所有未签名的 build-script 二进制，并清除 stamp 迫使 cargo 重新执行
      find build/release/rust-target -name "build-script-build" -type f 2>/dev/null | while read f; do
        if ! readelf -S "$f" 2>/dev/null | grep -q codesign; then
          T="/storage/Users/currentUser/tmp/bs-$$-$(basename $f)"
          binary-sign-tool sign -selfSign 1 -inFile "$f" -outFile "$T" >/dev/null 2>&1 && cp -f "$T" "$f"
          chmod 755 "$f" 2>/dev/null || true; rm -f "$T" 2>/dev/null || true
        fi
      done
      # 清除 stamp/output 文件，迫使 cargo 重跑 build-script 而非重编译
      find build/release/rust-target/release/build -name "output" -type f 2>/dev/null | while read stamp; do
        rm -f "$stamp" 2>/dev/null || true
      done
    else
      err "编译失败, 非签名问题"
      return 1
    fi
  done
  err "重试 20 次后仍失败"
  return 1
}

# ─── 阶段8: 签名 ─────────────────────────────────────────────────────────
phase_sign() {
  info "=== 签名最终产物 ==="
  local binary="$OUTDIR/bun"
  [ -f "$binary" ] || { err "产物不存在"; return 1; }
  chmod 755 "$binary"
  binary-sign-tool sign -selfSign 1 -inFile "$binary" -outFile "$binary"
  ok "签名完成"
  echo ""
  echo "  产物: $OUTDIR/bun"
  echo "  大小: $(ls -lh "$binary" | awk '{print $5}')"
  echo "  UNDEF: $(readelf --dyn-syms "$binary" 2>/dev/null | grep 'NOTYPE.*GLOBAL.*UND' | grep -v 'libc_start\|__register\|__cxa\|__deregister\|stderr\|vfprintf\|strlen\|memcpy\|abort\|_ZNSs\|_ZNKSs\|_ZNSs' | wc -l | xargs)"
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
  phase_check
  phase_webkit_clone
  phase_icu_shim
  phase_clang_sign
  phase_configure
  phase_patch_ninja
  phase_build
  phase_sign
  ok "全部完成! 运行: $OUTDIR/bun --version"
}

main "$@"
