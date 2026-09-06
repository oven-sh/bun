#!/bin/bash
# =============================================================================
# patch-node-gyp.sh — 给所有 node-gyp addon.gypi 应用 OHOS 补丁
#
# 解决的问题: OHOS 上 node-gyp 编译 native addon 需要:
#   - --sysroot 指向 OHOS SDK sysroot（否则找不到系统头）
#   - -DFP_NAN/-DFP_INFINITE/... 宏（OHOS libc++ math.h 需要，否则编译失败）
#
# 注意: node_modules 被 gitignore，每次 `bun install` 重装后补丁会丢失，
# 必须在 install 之后重新运行本脚本。
#
# 用法:
#   bash scripts/ohos/patch-node-gyp.sh              # 修补全部已知位置
#   DRY_RUN=1 bash scripts/ohos/patch-node-gyp.sh    # 只显示将修补哪些文件
# =============================================================================
set -u

# OHOS SDK 路径（与 harmonybrew 安装一致）
SYSROOT="${SYSROOT:-/storage/Users/currentUser/.harmonybrew/opt/ohos-sdk/native/sysroot}"

# 所有需要修补的 addon.gypi 位置
# 格式: 路径 | 结构类型 (simple = include_dirs 后直接加 cflags; oslinux = OS=="linux" 条件块内)
TARGETS=(
  "/storage/Users/currentUser/usr/local/bun-test/all-tests/test/napi/napi-app/node_modules/node-gyp/addon.gypi|simple"
  "/storage/Users/currentUser/usr/local/bun-test/all-tests/test/regression/issue/30205-napi-app/node_modules/node-gyp/addon.gypi|simple"
  "/storage/Users/currentUser/usr/local/bun-test/all-tests/test/node_modules/.bun/node-gyp@10.0.1/node_modules/node-gyp/addon.gypi|simple"
  "/storage/Users/currentUser/.harmonybrew/Cellar/node/26.5.0/libexec/lib/node_modules/npm/node_modules/node-gyp/addon.gypi|oslinux"
  "/storage/Users/currentUser/springsources/bun/test/napi/napi-app/node_modules/node-gyp/addon.gypi|simple"
)

CFLAGS_BLOCK=(
  '--sysroot='"$SYSROOT"
  '-DFP_NAN=0' '-DFP_INFINITE=1' '-DFP_NORMAL=4' '-DFP_SUBNORMAL=3' '-DFP_ZERO=2'
)

LDFLAGS_BLOCK=(
  '--sysroot='"$SYSROOT"
)

# 幂等检查标记: 任一文件含 FP_NAN 即视为已修补
is_patched() {
  grep -q 'FP_NAN' "$1" 2>/dev/null
}

# 简单型: include_dirs 数组结束后（"    ],"）插入 cflags/ldflags
# 匹配 node-gyp 10.x/11.x 的 addon.gypi 结构:
#     'include_dirs': [
#       '<(node_root_dir)/include/node',
#       ...
#       '<(node_root_dir)/<(node_engine_include_dir)'
#     ],
#     'defines!': [
patch_simple() {
  local file="$1"
  local marker="<(node_engine_include_dir)"

  # 找 include_dirs 数组的结束行: 在 marker 行之后第一个 "    ],"
  local marker_line
  marker_line=$(grep -n '<(node_engine_include_dir)' "$file" | head -1 | cut -d: -f1)
  if [ -z "$marker_line" ]; then
    echo "  [SKIP] $file: 未找到 include_dirs 标记（结构不匹配）"
    return 1
  fi

  local anchor_line
  anchor_line=$(awk -v start="$marker_line" 'NR > start && /^    \],$/ { print NR; exit }' "$file")
  if [ -z "$anchor_line" ]; then
    echo "  [SKIP] $file: 未找到 include_dirs 结束行（结构不匹配）"
    return 1
  fi

  # 用 python 在 anchor 行之前插入 cflags + ldflags 块（换行正确）
  SYSROOT="$SYSROOT" ANCHOR_LINE="$anchor_line" FILE="$file" python3 << 'PYEOF'
import os

file = os.environ["FILE"]
anchor = int(os.environ["ANCHOR_LINE"])
sysroot = os.environ["SYSROOT"]

with open(file) as f:
    lines = f.readlines()

patch = (
    "    'cflags': [\n"
    f"      '--sysroot={sysroot}',\n"
    "      '-DFP_NAN=0', '-DFP_INFINITE=1', '-DFP_NORMAL=4', '-DFP_SUBNORMAL=3', '-DFP_ZERO=2',\n"
    "    ],\n"
    "    'ldflags': [\n"
    f"      '--sysroot={sysroot}',\n"
    "    ],\n"
)

lines.insert(anchor, patch)
with open(file, "w") as f:
    f.writelines(lines)
PYEOF
  echo "  [OK] $file (simple)"
}

# OS=="linux" 块型: 在 `[ 'OS=="linux"', {` 块内加入 cflags/ldflags
# 匹配 node-gyp 26.x 的 addon.gypi 结构（已有 OS 条件块，含 include_dirs）
patch_oslinux() {
  local file="$1"
  local block_start
  block_start=$(grep -n "'OS==\"linux\"'" "$file" | head -1 | cut -d: -f1)
  if [ -z "$block_start" ]; then
    echo "  [SKIP] $file: 未找到 OS==\"linux\" 块（结构不匹配）"
    return 1
  fi

  local block_end
  block_end=$(awk -v start="$block_start" 'NR > start && /^[[:space:]]*\}\],?$/ { print NR; exit }' "$file")
  if [ -z "$block_end" ]; then
    echo "  [SKIP] $file: 未找到 OS==\"linux\" 块结束（结构不匹配）"
    return 1
  fi

  # 用 python 在块结束前插入 include_dirs/cflags/ldflags（比 awk 嵌套更可靠）
  SYSROOT="$SYSROOT" BLOCK_END="$block_end" FILE="$file" python3 << 'PYEOF'
import os

file = os.environ["FILE"]
block_end = int(os.environ["BLOCK_END"])
sysroot = os.environ["SYSROOT"]

with open(file) as f:
    lines = f.readlines()

cflags = "'.join(f'                   {repr(f)},\n' for f in "
patch = (
    "        'include_dirs': [\n"
    f"          '{sysroot}/usr/include',\n"
    f"          '{sysroot}/usr/include/aarch64-linux-ohos',\n"
    "          '/storage/Users/currentUser/.harmonybrew/opt/ohos-sdk/native/llvm/include/c++/v1',\n"
    "          '/storage/Users/currentUser/.harmonybrew/opt/ohos-sdk/native/llvm/include/libcxx-ohos/include/c++/v1',\n"
    "        ],\n"
    "        'cflags': ['--sysroot=" + sysroot + "',\n"
    "                   '-DFP_NAN=0', '-DFP_INFINITE=1', '-DFP_NORMAL=4', '-DFP_SUBNORMAL=3', '-DFP_ZERO=2'],\n"
    "        'ldflags': ['--sysroot=" + sysroot + "'],\n"
)

lines.insert(block_end - 1, patch)
with open(file, "w") as f:
    f.writelines(lines)
PYEOF
  echo "  [OK] $file (oslinux)"
}

main() {
  echo "=== patch-node-gyp.sh: 应用 OHOS addon.gypi 补丁 ==="
  echo "SYSROOT: $SYSROOT"
  echo ""

  local patched=0
  local skipped=0

  for entry in "${TARGETS[@]}"; do
    local file="${entry%%|*}"
    local type="${entry##*|}"

    if [ ! -f "$file" ]; then
      echo "  [MISS] $file: 不存在（未安装，跳过）"
      skipped=$((skipped + 1))
      continue
    fi

    if is_patched "$file"; then
      echo "  [SKIP] $file: 已有补丁（幂等）"
      skipped=$((skipped + 1))
      continue
    fi

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "  [DRY] $file ($type): 将应用补丁"
      patched=$((patched + 1))
      continue
    fi

    # 备份原文件
    cp "$file" "$file.bak.$(date +%Y%m%d%H%M%S)"

    if [ "$type" = "oslinux" ]; then
      patch_oslinux "$file"
    else
      patch_simple "$file"
    fi
    patched=$((patched + 1))
  done

  echo ""
  echo "完成: $patched 个已处理, $skipped 个跳过/已补丁"
}

main "$@"
