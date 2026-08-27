#!/bin/bash
# =============================================================================
# run-all-official-progress-optimized.sh — 优化版
#
# 相对原版的改进:
#   1. 移除 pkill 自伤问题（不再用 -f 匹配会命中自身的模式）
#   2. 进度刷新从 1s 降到 5-10s，减少 CPU 开销
#   3. 孤儿清理从"每文件一次"改为"每 30 文件 + 仅当孤儿 > 阈值"
#   4. 超长的 no-orphans test 加独立超时
# =============================================================================

# ── 根据 7/21 全量日志优化（OHOS 比 Linux 慢 5-10x） ──
# 日志: 1868 files, 01:31:24, 92 timeouts (37 @300s)
# 建议: 普通 300s, bundler 900s, 泄漏 1200s
BUN="${BUN:-bun}"
PARALLEL=${PARALLEL:-3}
RETRIES=${RETRIES:-1}
TMOUT=${TMOUT:-300}
TMOUT_BUNDLER=${TMOUT_BUNDLER:-1200}
BUN_TIMEOUT=${BUN_TIMEOUT:-600000}

# OHOS: /tmp is read-only; postinstall scripts (node-gyp etc.) need a writable tmp.
# Default to the app's private tmp dir, respecting explicit TMPDIR override.
export TMPDIR="${TMPDIR:-/data/storage/el2/base/tmp}"

# ── node-gyp 环境 ──
# 必须用 harmonybrew 的 c++（llvm@21）：node-gyp 默认 clang++（llvm22.1.7）的
# 隐式 include 路径含两个 libc++ 且顺序错误，触发 __functional/hash.h 编译失败。
# bun install 重装 node_modules 会覆盖 addon.gypi 补丁（sysroot + FP_NAN），
# 每次全量跑前重新应用。脚本不存在时跳过（不阻塞运行）。
export CXX="${CXX:-/storage/Users/currentUser/.harmonybrew/bin/c++}"
export CC="${CC:-/storage/Users/currentUser/.harmonybrew/bin/cc}"
# OHOS 平台标志：测试文件用它做平台特判（如 sharp prebuilt 不可用
# 时 complex-workspace 用 --ignore-scripts，与 Windows 分支同理）
export BUN_OHOS="${BUN_OHOS:-1}"
# CI 标志：全量测试即 CI 运行。expectBundled 等依赖 isCI 决定超时
# （isCI → 无超时；否则 bundler 快照测试 5s 超时，OHOS 慢设备必现）。
export CI="${CI:-1}"
# 兼容从根目录或 scripts/ohos/ 下运行：先找同目录，再找 scripts/ohos/
_OHOS_PATCH_SCRIPT="$(dirname "$0")/patch-node-gyp.sh"
[ -f "$_OHOS_PATCH_SCRIPT" ] || _OHOS_PATCH_SCRIPT="$(dirname "$0")/scripts/ohos/patch-node-gyp.sh"
[ -f "$_OHOS_PATCH_SCRIPT" ] || _OHOS_PATCH_SCRIPT="/storage/Users/currentUser/usr/local/bun-test/all-tests/scripts/ohos/patch-node-gyp.sh"
if [ -f "$_OHOS_PATCH_SCRIPT" ]; then
  echo "[node-gyp] Applying OHOS addon.gypi patches ($_OHOS_PATCH_SCRIPT)..."
  bash "$_OHOS_PATCH_SCRIPT" 2>&1 | grep -E '\[OK\]|\[SKIP\]|完成' | head -8
fi

# 清理之前残留的 verdaccio 实例（每个占 ~35% CPU）
pkill -f "verdaccio" 2>/dev/null || true

# 清理孤儿 bun 进程
_ohos_kill_orphans 2>/dev/null || true

# PPID=1 孤儿清理 — 杀所有不属于 verdaccio/opencode 的 PPID=1 bun 进程
# 这些是 bun test 被杀后遗留的子孙（如 bun run jsx-*、bun -e fixture 等）
_ohos_kill_orphans() {
  local _pid _age
  for _pid in $(ps -eo pid,ppid,args 2>/dev/null | awk '/[b]un/ && !/verdaccio/ && !/opencode/ && $2 == 1 {print $1}'); do
    # 只杀存活 >10s 的孤儿 bun：刚过继给 init 的子进程可能仍被
    # 其他 worker 的测试使用（正常退出前的瞬态），立即杀会误伤。
    _age=$(ps -o etimes= -p "$_pid" 2>/dev/null || echo 0)
    [ "${_age:-0}" -gt 10 ] 2>/dev/null && kill -9 "$_pid" 2>/dev/null || true
  done
}

# sleep 孤儿扫荡 — sleep 数量超过 并行数×2 时才动手
# 正常情况下每个测试配一个 watchdog sleep，多余的是残留
_ohos_sweep_orphans() {
  local _max_sleep _sleep_count _pid _age _my_pids
  _max_sleep=$((PARALLEL * 2))
  _sleep_count=$(ps -ef 2>/dev/null | grep ' sleep ' | grep -v grep | wc -l)
  # sleep 数在合理范围内 → 跳过
  [ "$_sleep_count" -le "$_max_sleep" ] 2>/dev/null && return 0

  _my_pids="$$ $PPID $BASHPID"
  for _pid in $(pgrep -x "sleep" 2>/dev/null || true); do
    case " $_my_pids " in *" $_pid "*) continue;; esac
    _age=$(ps -o etimes= -p "$_pid" 2>/dev/null || echo 0)
    # 只杀 >30min 的 sleep（正常 watchdog 不会活那么久）
    [ "${_age:-0}" -gt 1800 ] 2>/dev/null && kill -9 "$_pid" 2>/dev/null || true
  done
}

# ── NAPI 预编译（在跑 NAPI 测试前统一编译 .node addon） ──
_ohos_napi_prebuild() {
  local _napi_root="test/napi/node-napi-tests"
  local _napi_dirs
  _napi_dirs=$(find "$_napi_root" -name 'do.test.ts' -not -path '*/node_modules/*' 2>/dev/null | while IFS= read -r _f; do dirname "$_f"; done | sort -u | tr '\n' ' ')
  if [ -z "$_napi_dirs" ]; then
    return 0
  fi
  echo "[NAPI] Prebuilding native addons..."
  if ! $BUN "$_napi_root/prebuild.ts" $_napi_dirs >> "$REPORT" 2>&1; then
    echo "[NAPI] Prebuild failed (each NAPI test will build its own addon)"
  else
    echo "[NAPI] Prebuild done"
  fi
}

cleanup() {
  local kids
  kids=$(jobs -p 2>/dev/null)
  [ -n "$kids" ] && kill $kids 2>/dev/null
  _ohos_kill_orphans
  pkill -f "verdaccio" 2>/dev/null || true
  [ -n "$PDIR" ] && [ -d "$PDIR" ] && rm -rf "$PDIR"
}
trap cleanup EXIT INT TERM

# ── 前置清理 ──
_ohos_kill_orphans
pkill -f "verdaccio" 2>/dev/null || true

TS=$(date +%Y%m%d_%H%M%S)
REPORT="all-official-report-${TS}.txt"
_BASE_TMP="${TMPDIR:-/tmp}"
PDIR="${_BASE_TMP}/bun_test_progress_$$"
START_SECONDS=$SECONDS

# ── vendored node 测试排除开关 ──
# SKIP_VENDORED_NODE_TESTS=1（默认）: 仅跑原有口径（*.test.* / *.spec.*，isTestStrict），
#   排除 js/node/test/{parallel,sequential}、js/bun/test/parallel、js/node/cluster/test-*
#   ——这些是 vendored Node 原版测试（test-*.js），bun test 无法独立运行，全部 FAIL 0/0，
#   只产生文件级噪声并拉长运行（3,829 文件 ≈ +2h52m）。
# SKIP_VENDORED_NODE_TESTS=0: 跑全部 case（对齐上游 CI runner.node.mjs 的 isTest 规则）。
SKIP_VENDORED_NODE_TESTS=${SKIP_VENDORED_NODE_TESTS:-1}
export SKIP_VENDORED_NODE_TESTS

# ── 依赖检查 ──
{
echo "========== All Official Tests (optimized) =========="
echo "Bun: $($BUN --version 2>/dev/null)"
echo "Date: $(date)"
echo "Parallel: $PARALLEL | Timeout: ${TMOUT}s (bundler: ${TMOUT_BUNDLER}s) | Retries: ${RETRIES}"
echo "VendoredNodeTests: $([ "$SKIP_VENDORED_NODE_TESTS" = "1" ] && echo "EXCLUDED (original scope only)" || echo "INCLUDED (full upstream isTest)")"
echo ""
} | tee "$REPORT" >/dev/null

mkdir -p "$PDIR"

# ── 测试文件收集（默认排除 vendored node 测试；SKIP_VENDORED_NODE_TESTS=0 时
#    与上游 CI runner.node.mjs 的 isTest 规则一致） ──
# isNodeTest:   js/node/test/{parallel,sequential}/ + js/bun/test/parallel/ 下所有 JS
# isClusterTest: js/node/cluster/test-*.ts
# isTestStrict: *.test.* / *.spec.*（JS 扩展名）
# 排除: node_modules / 隐藏文件与目录（同上游 isHidden）
# 用 python 精确复刻上游 isTest（isNodeTest/isClusterTest/isTestStrict +
# isHidden），避免 find 的 glob 与上游正则的边界差异。
"$BUN" -e '
const { readdirSync } = require("fs");
const { join, basename, dirname } = require("path");
const skipVendored = process.env.SKIP_VENDORED_NODE_TESTS !== "0";
const isJs = p => /\.(c|m)?(j|t)sx?$/.test(basename(p));
const isNodeTest = p => {
  if (skipVendored) return false;
  const u = p.replaceAll("\\", "/");
  return (u.includes("js/node/test/parallel/") || u.includes("js/node/test/sequential/") || u.includes("js/bun/test/parallel/")) && isJs(p);
};
const isClusterTest = p => {
  if (skipVendored) return false;
  const u = p.replaceAll("\\", "/");
  return u.includes("js/node/cluster/test-") && u.endsWith(".ts");
};
const isTestStrict = p => isJs(p) && /\.test|spec\./.test(basename(p));
const isHidden = p => /node_modules|node\.js/.test(dirname(p).replaceAll("\\", "/")) || /^\./.test(basename(p));
const tests = [];
const walk = (cwd, rel) => {
  for (const e of readdirSync(join(cwd, rel), { withFileTypes: true })) {
    const f = join(rel, e.name);
    if (isHidden(f)) continue;
    if (e.isFile()) { if (isNodeTest(f) || isClusterTest(f) || isTestStrict(f)) tests.push(f); }
    else if (e.isDirectory()) walk(cwd, f);
  }
};
walk(process.cwd(), "test");
for (const t of tests) console.log(t);
' > "$PDIR/test_files_all.txt"

# 慢文件放末尾（交错会导致 slow 散布全程，5 个 worker 被 slow 占满，
# fast 排队等待 → 完成速率骤降 → 3600s 超时杀剩余 1800 文件）。
# 放末尾：fast 先快速完成（~1900 个），最后 35 个 slow 5 并行集中跑。
SLOW_RE="(jsx-production|shell-cmdsub-crash|run-extensionless|udp_socket\.test|bunshell\.test|spawn\.test|fetch/fetch\.test|terminal/terminal-|terminal\.test\.ts|bun-install\.test|request-clone-leak|create-jsx|bun-run\.test|dev-server\.test|expo-app|fetch-leak|bun-security-scanner-matrix|test-dev-peer-dependency|spawn-noread-leak|bun-install-registry|boundary-conditions|streams-leak|serve-response-stream-sink-leak|bun-serve-static-stress|bun-add\.test|init\.test|rm\.test\.ts|inspector\.test\.ts)"
grep -v -E "$SLOW_RE" "$PDIR/test_files_all.txt" > "$PDIR/test_files_fast.txt"
grep -E "$SLOW_RE" "$PDIR/test_files_all.txt" > "$PDIR/test_files_slow.txt"
# cat 拼接（非 grep >> 追加）：若前一段末尾无换行，>> 会粘连行；
# 且强制末尾换行，确保 while read 读到全部行（read 在无结尾换行时
# 对最后一行仍会读，但某些 toybox 版本会提前 EOF）。
cat "$PDIR/test_files_fast.txt" "$PDIR/test_files_slow.txt" > "$PDIR/test_files.txt"
printf '\n' >> "$PDIR/test_files.txt" 2>/dev/null || true
# 去除可能因末尾空行产生的多余计数（grep -v 空行，不用 sed -i）
grep -v '^$' "$PDIR/test_files.txt" > "$PDIR/test_files.txt.tmp"
mv "$PDIR/test_files.txt.tmp" "$PDIR/test_files.txt"

TOTAL_FILES=$(wc -l < "$PDIR/test_files.txt")
echo "Found $TOTAL_FILES test files, running $PARALLEL parallel workers (TIMEOUT=${TMOUT}s, RETRIES=${RETRIES})"
echo "Found $TOTAL_FILES test files" >> "$REPORT"
echo "" >> "$REPORT"

# ── 运行单个测试 ──
run_test() {
  idx=$1
  f=$2
  # ── OHOS 环境特殊处理 ──
  case "$f" in
    # terminal 测试需要 PTY（/dev/tty），用 script 包装
    */terminal/terminal.test.ts|*/terminal/terminal-spawn.test.ts)
      WRAP="script -q -c"
      ;;
    *)
      WRAP=""
      ;;
  esac

  case "$f" in
    # ── 已知连续多日 600s 超时文件：快速失败（120s 就杀，不白等 600s）──
    # 这些文件在 OHOS 上持续超时（repl/streams 连续 3+ 次全量），降低 WT
    # 让失败尽早暴露，同时省下 ~480s/文件 的等待时间。
    # 08-06 新增：import-attributes/snapshot/spawn.ipc.bun-node/26286 均 600s TIMEOUT
    */js/node/tty.test.ts|*/cli/run/env.test.ts|\
    */js/bun/repl/repl.test.ts|\
    */js/web/streams/streams.test.js|*/js/bun/shell/shell-cmdsub-crash.test.ts|\
    */js/bun/import-attributes/import-attributes.test.ts|\
    */js/bun/test/snapshot-tests/snapshots/snapshot.test.ts|\
    */js/bun/spawn/spawn.ipc.bun-node.test.ts|*/regression/issue/26286.test.ts)
      WT=120
      BT="--expose-internals --smol --timeout 120000"
      ;;
    # ── 慢测试单独调大超时 ──
    # spawn.test.ts 已连续超时（2402s 白等），降为 600s 快速失败（省 ~20m）
    */bundler/transpiler/jsx-production.test.ts|*/udp/udp_socket.test.ts|*/terminal/terminal-platform-gaps.test.ts|*/inspector/inspector.test.ts|*/run-extensionless.test.ts)
      WT=$((TMOUT * 4))       # 2400s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    */spawn/spawn.test.ts)
      # OHOS 减量后单跑实测 519s，并行 5 worker 下留余量
      WT=$((TMOUT * 3))       # 900s
      BT="--expose-internals --smol --timeout 600000"
      ;;
    */bake/dev/server-sourcemap.test.ts|*/web/fetch/fetch.test.ts|*/cli/create/create-jsx.test.ts|*/shell/bunshell.test.ts|*/terminal/terminal.test.ts|*/websocket/websocket-server.test.ts)
      WT=$((TMOUT * 3))       # 1800s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # ── cli/install 连续多日 600s 超时的大文件 ──
    # 单跑实测 4-10 分钟（bun-install 386s / bun-add-filter 599s / bun-add
    # 226s），并行 5 worker 时资源竞争使耗时膨胀超过默认 TMOUT=300s。
    # 给足 2×TMOUT 让它们按单跑速度完成，而非超时误杀。
    */cli/install/bun-update.test.ts|\
    */cli/install/bun-update-lockfile-sync.test.ts|*/cli/install/bun-dedupe.test.ts|\
    */cli/install/bun-prune.test.ts|\
    */cli/install/bun-pm-licenses.test.ts|*/cli/install/bun-add-catalog.test.ts|\
    */cli/install/bun-add.test.ts|*/cli/install/migration/migrate.test.ts|\
    */cli/install/bun-security-scanner-matrix-with-node-modules.test.ts|\
    */cli/install/bun-security-scanner-matrix-without-node-modules.test.ts|\
    */cli/install/bun-pack.test.ts)
      WT=$((TMOUT * 2))       # 600s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # bun-install / nested-overrides / bun-run / bun-add-filter：单跑
    # 373-599s，全量串行竞争（+其他 session 负载）下超时轮转；给 900s
    */cli/install/bun-install.test.ts|*/cli/install/nested-overrides.test.ts|\
    */cli/install/bun-run.test.ts|*/cli/install/bun-add-filter.test.ts)
      WT=$((TMOUT * 3))       # 900s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # ── verdaccio 大文件：并发改串行后单跑实测 ──
    # bun-update-transitive 1134s / bun-install-registry 850s / catalogs
    # 385s / bun-workspaces 391s / lifecycle-scripts 421s（并行 5 worker
    # 下更慢）。给足余量，避免全量时超时误杀。
    */cli/install/bun-update-transitive.test.ts)
      WT=$((TMOUT * 8))       # 2400s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    */cli/install/bun-install-registry.test.ts)
      WT=$((TMOUT * 4))       # 1200s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    */cli/install/catalogs.test.ts|*/cli/install/bun-workspaces.test.ts|\
    */cli/install/bun-install-lifecycle-scripts.test.ts)
      WT=$((TMOUT * 3))       # 900s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # ── bun-audit：150 用例已改顺序执行，单跑实测 676s，需 3×TMOUT ──
    */cli/install/bun-audit.test.ts)
      WT=$((TMOUT * 3))       # 900s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # ── napi：harness expect import 修复后全绿，单跑实测 napi.test
    # 529s / uv_stub 408s（曾 120s fast-fail）──
    */napi/napi.test.ts)
      WT=$((TMOUT * 4))       # 1200s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    */napi/uv_stub.test.ts)
      WT=$((TMOUT * 4))       # 1200s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # ── 泄漏/长时间测试 ──
    # shell/leak、spawn-pipe-leak 连续多日 FAIL（386-400s），降为 300s 快速失败
    *serve-body-leak*|*handle-leak*|*no-orphans*)
      WT=$((TMOUT * 2))
      BT="--expose-internals --smol --timeout 600000"
      ;;
    *shell/leak.test.ts|*spawn-pipe-leak.test.ts)
      # 泄漏检测在 OHOS 上必超时（单跑 400s+ 未完，用例 90-190s 超时），
      # 120s 快速失败收敛超时上限（曾 300s×2 试=600s 白等）
      WT=120
      BT="--expose-internals --smol --timeout 120000"
      ;;
    # ── bundler ──
    */bundler/*)
      WT=${TMOUT_BUNDLER}
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # ── 默认 ──
    *)
      WT=${TMOUT}
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
  esac

  # ── 大文件回摆标记：全量并行负载下偶发用例失败（单跑必过）。
  # 这些文件用例失败时重试一次（默认只对超时重试）。
  _retry_on_fail=0
  case "$f" in
    */websocket/websocket-server.test.ts|*/test/fake-timers/fake-timers.test.ts|\
    */bundler/transpiler/transpiler.test.js|*/http/proxy.test.ts)
      _retry_on_fail=1 ;;
    # node-dns queries public DNS (socketify.dev etc.); passes solo but
    # flakes under full-run network load
    */node/dns/node-dns.test.js)
      _retry_on_fail=1 ;;
    # test-dev-peer-dependency-priority: verdaccio-serial, passes solo
    # (4/0), one case flaked in the full run
    */install/test-dev-peer-dependency-priority.test.ts)
      _retry_on_fail=1 ;;
    # body.test.ts textStream ECONNRESET case: passes solo; the connection
    # sometimes drops before the first chunk decodes under full-run load
    */web/fetch/body.test.ts)
      _retry_on_fail=1 ;;
    # napi.test.ts: the tsfn-orphan leg hangs under full-run + concurrent
    # CI load (passes solo in 4.6s); retry once on case failure
    */napi/napi.test.ts)
      _retry_on_fail=1 ;;
  esac

  # ── 串行标记：这些测试并行跑会冲突导致 subshell 死 ──
  _serial=0
  _exclusive=0
  case "$f" in
    *socket.io/*|*grpc-js/*|*jsonwebtoken/*|*pg-gateway/*|*resvg/*|*@napi-rs/*|*@fastify/*|*@electric-sql/*)
      _serial=1 ;;
    *fetch/fetch-http3-cold-post*|*hono/hello-world*|*wpt-h2/*|*canvas/*|*socket.io*|\
    *fetch/fetch-tcp-stress*)
      _serial=1 ;;
    # VerdaccioRegistry tests share the registry storage dir
    # (.verdaccio-db.json / htpasswd under test/cli/install/registry);
    # two instances running at once race user creation ("Failed to create
    # user") and package writes. Run them serially. Keep this list in sync
    # with every test file that news VerdaccioRegistry (grep
    # "VerdaccioRegistry" test/cli/install).
    *cli/install/bun-add-catalog.test.ts|*cli/install/bun-add-filter.test.ts|\
    *cli/install/bun-audit.test.ts|*cli/install/bun-dedupe.test.ts|\
    *cli/install/bun-install-lifecycle-scripts.test.ts|\
    *cli/install/bun-install-native-binlink.test.ts|\
    *cli/install/bun-install-patch.test.ts|*cli/install/bun-install-registry.test.ts|\
    *cli/install/bun-install.test.ts|*cli/install/bun-lock.test.ts|\
    *cli/install/bun-lockb.test.ts|*cli/install/bun-patch.test.ts|\
    *cli/install/bun-pm-licenses.test.ts|*cli/install/bun-prune.test.ts|\
    *cli/install/bun-publish.test.ts|*cli/install/bun-update.test.ts|\
    *cli/install/bun-update-lockfile-sync.test.ts|\
    *cli/install/bun-update-transitive.test.ts|*cli/install/bun-workspaces.test.ts|\
    *cli/install/catalogs.test.ts|*cli/install/config-precedence.test.ts|\
    *cli/install/frozen-lockfile-missing-workspace.test.ts|\
    *cli/install/frozen-lockfile-pruned.test.ts|*cli/install/hoist.test.ts|\
    *cli/install/isolated-install.test.ts|*cli/install/isolated-relink.test.ts|\
    *cli/install/migration/pnpm-lock-v9.test.ts|\
    *cli/install/migration/pnpm-migration.test.ts|\
    *cli/install/nested-overrides.test.ts|*cli/install/npmrc.test.ts|\
    *cli/install/public-hoist-pattern.test.ts)
      _serial=1 ;;
    # native-plugin 编译/加载 .node 与并发 bun 进程冲突（_Znwm symbol not
    # found：任何并发 bun test 进程存在时 .node 的 libc++ 符号解析竞争）。
    # 独占：获取 exclusive.lock 后其他 worker 分派暂停（缓解，非根治）。
    *native-plugin*)
      _serial=1
      _exclusive=1 ;;
  esac

  # ── 串行锁 ──
  if [ "$_serial" -eq 1 ]; then
    # 等待串行锁（每次只允许一个串行测试跑）
    while ! mkdir "$PDIR/serial.lock" 2>/dev/null; do sleep 1; done
    # 记录本测试持有锁，方便释放
    echo "$$" > "$PDIR/serial_holder" 2>/dev/null
  fi

  # ── 独占锁 ──
  if [ "${_exclusive:-0}" -eq 1 ]; then
    while ! mkdir "$PDIR/exclusive.lock" 2>/dev/null; do sleep 1; done
  fi

  START_TS=$(date +%s%N)

  attempt=1
  max_attempts=$((RETRIES + 1))
  while [ $attempt -le $max_attempts ]; do
    out="$PDIR/out_${idx}_a${attempt}.tmp"
    if [ -n "$WRAP" ]; then
      # OHOS CI 无 TTY，用 script 分配 PTY
      $WRAP "$BUN test $BT \"$f\"" /dev/null > "$out" 2>&1 &
    else
      $BUN test $BT "$f" > "$out" 2>&1 &
    fi
    BUNPID=$!
    # Watchdog — graceful timeout: SIGTERM → 15s grace → SIGKILL
    # 相比旧的 kill + 6s 模式，给予更多时间让进程处理 termination signal，
    # 减少子进程变成 PPID=1 孤儿的机会
    (
      sleep $WT
      # Phase 1: 通知子进程（防止孤儿化）
      pkill -P $BUNPID 2>/dev/null
      # Phase 2: SIGTERM — 优雅退出
      kill -TERM $BUNPID 2>/dev/null
      # Phase 3: 等 15s（5×3s）让进程处理退出信号
      for _i in 1 2 3 4 5; do
        sleep 3 2>/dev/null
        kill -0 $BUNPID 2>/dev/null || exit 0  # 已优雅退出
      done
      # Phase 4: 仍然活着 → 强制杀
      pkill -P $BUNPID 2>/dev/null
      kill -KILL $BUNPID 2>/dev/null
      sleep 2 2>/dev/null
      kill -0 $BUNPID 2>/dev/null && kill -9 $BUNPID 2>/dev/null
    ) 2>/dev/null &
    WDOG=$!
    wait $BUNPID 2>/dev/null
    EXIT=$?
    # 杀 watchdog — 先 disown 再杀，避免 shell 打印 "Terminated"
    disown $WDOG 2>/dev/null || true
    pkill -P $WDOG >/dev/null 2>&1 || true
    kill $WDOG >/dev/null 2>&1 || true

    # 后清理 — 确保 bun 进程的所有子孙已死
    # 注意: 不能 pkill -P $BUNPID（BUNPID 已死，子进程已过继给 init）
    # 改为杀 PPID=1 的孤儿 bun（从 test-all-tests 目录）
    _ohos_kill_orphans 2>/dev/null || true

    TIMEOUT=0
    if [ $EXIT -eq 137 ] || [ $EXIT -eq 143 ]; then
      TIMEOUT=1
    elif [ $EXIT -ne 0 ] && [ $EXIT -ne 1 ]; then
      TIMEOUT=1
    fi

    if [ $EXIT -eq 0 ] || { [ $EXIT -eq 1 ] && [ "$_retry_on_fail" -ne 1 ]; }; then
      LAST_OUT="$out"
      break
    fi

    if [ $attempt -lt $max_attempts ]; then
      { echo "[$idx/$TOTAL_FILES] $f [attempt #$((attempt+1))]"; cat "$out"; } >> "$REPORT"
      rm -f "$out"
      attempt=$((attempt + 1))
    else
      LAST_OUT="$out"
      break
    fi
  done

  [ $EXIT -eq 0 ] && FILE_RESULT="PASS" || FILE_RESULT="FAIL"

  CASE_PASS=0; CASE_FAIL=0
  if [ -f "$LAST_OUT" ]; then
    pass_line=$(grep -a -E '^ +[0-9]+ pass' "$LAST_OUT" | head -1)
    [ -n "$pass_line" ] && CASE_PASS=$(echo "$pass_line" | awk '{print $1+0}')
    fail_line=$(grep -a -E '^ +[0-9]+ fail' "$LAST_OUT" | head -1)
    [ -n "$fail_line" ] && CASE_FAIL=$(echo "$fail_line" | awk '{print $1+0}')
  fi

  [ $TIMEOUT -eq 1 ] && CASE_PASS=-1 && CASE_FAIL=-1

  cat "$LAST_OUT" > "$PDIR/out_${idx}.txt"
  echo "EXIT_CODE:$EXIT" >> "$PDIR/out_${idx}.txt"
  rm -f "$LAST_OUT"

  END_TS=$(date +%s%N)
  DURATION_MS=$(( (END_TS - START_TS) / 1000000 ))
  {
    echo "FILE=$f"
    echo "RESULT=$FILE_RESULT"
    echo "EXIT_CODE=$EXIT"
    echo "CASE_PASS=$CASE_PASS"
    echo "CASE_FAIL=$CASE_FAIL"
    echo "DURATION_MS=$DURATION_MS"
    echo "TIMEOUT=$TIMEOUT"
  } > "$PDIR/result_${idx}.tmp"
  mv "$PDIR/result_${idx}.tmp" "$PDIR/result_${idx}"
  # running_${idx} 由主循环管理（基于 result_* 文件存在性），不在 worker 中删除
  # 进度用追加日志（每行一条结果），避免并发 read-modify-write 竞态丢计数：
  # 旧方案 source progress + 写回在 5 个 worker 并发时互相覆盖（DONE 少计数）。
  # 格式: <PASS|FAIL> <case_pass> <case_fail>
  _np=$CASE_PASS; _nf=$CASE_FAIL
  [ "$TIMEOUT" = "1" ] && _np=0 && _nf=0
  {
    if [ "$FILE_RESULT" = PASS ]; then printf 'PASS %d %d\n' "$_np" "$_nf"; else printf 'FAIL %d %d\n' "$_np" "$_nf"; fi
  } >> "$PDIR/progress.log" 2>>"$REPORT"
  # 释放串行锁
  if [ "$_serial" -eq 1 ]; then
    rmdir "$PDIR/serial.lock" 2>/dev/null || true
  fi
  # 释放独占锁
  if [ "${_exclusive:-0}" -eq 1 ]; then
    rmdir "$PDIR/exclusive.lock" 2>/dev/null || true
  fi
}

# ── 进度显示（5-10s 刷新，减少 CPU） ──
show_progress() {
  local completed passed failed case_pass case_fail elapsed pct
  local running_list last_completed no_progress_start _rc

  no_progress_start=0; last_completed=0
  while true; do
    # 从追加日志统计（无 read-modify-write 竞态）。日志行数即 DONE。
    # 增量统计：completed/passed 等跨轮累计（local 声明在函数开头），
    # 每轮只扫新增行，避免全量重扫（~2000 行 × 每 10s）。
    if [ -z "${_pl_seen:-}" ]; then _pl_seen=0; completed=0; passed=0; failed=0; case_pass=0; case_fail=0; fi
    if [ -f "$PDIR/progress.log" ]; then
      _pl_total=$(wc -l < "$PDIR/progress.log" 2>/dev/null || echo 0)
      if [ "${_pl_total:-0}" -gt "$_pl_seen" ]; then
        while IFS=' ' read -r _st _cp _cf; do
          completed=$((completed + 1))
          if [ "$_st" = "PASS" ]; then passed=$((passed + 1)); else failed=$((failed + 1)); fi
          case_pass=$((case_pass + _cp)); case_fail=$((case_fail + _cf))
        done < <(tail -n $((_pl_total - _pl_seen)) "$PDIR/progress.log")
        _pl_seen=$_pl_total
      fi
    fi

    first=1; running_list=""
    for run_file in "$PDIR"/running_*; do
      [ -f "$run_file" ] || continue
      read -r rl < "$run_file"
      if [ $first -eq 1 ]; then running_list="$rl"; first=0; else running_list="$running_list | $rl"; fi
    done
    [ ${#running_list} -gt 80 ] && running_list="${running_list:0:77}..."

    elapsed=$(( SECONDS - START_SECONDS ))
    elapsed_fmt=$(printf '%02d:%02d:%02d' $((elapsed/3600)) $(( (elapsed%3600)/60 )) $((elapsed%60)))
    pct=0; [ $TOTAL_FILES -gt 0 ] && pct=$(( completed * 100 / TOTAL_FILES ))
    # 🐰 = 总 bun 进程数（不含 verdaccio/opencode），显示为 主进程+子进程
    # timeout 包裹 pgrep/ps — OHOS 上进程扫描偶发挂起，卡住会冻结进度显示
    _bun_pids=$(timeout 5 pgrep -x "bun" 2>/dev/null || true)
    bun_count=0
    for _bp in $_bun_pids; do
      _bargs=$(timeout 3 ps -o args= -p "$_bp" 2>/dev/null || echo "")
      case "$_bargs" in *verdaccio*|*opencode*) continue ;; esac
      bun_count=$((bun_count + 1))
    done
    # 同时统计主进程（running_* 即 worker 数）
    _worker_count=0
    for _rf in "$PDIR"/running_*; do [ -f "$_rf" ] && _worker_count=$((_worker_count + 1)); done

    printf "\r\033[K[%s] Files: %d/%d (%d%%) | ✅ %d | ❌ %d | Cases: +%d/-%d | 🐰%d(%d) | ▶ %s" \
      "$elapsed_fmt" "$completed" "$TOTAL_FILES" "$pct" \
      "$passed" "$failed" "$case_pass" "$case_fail" "$bun_count" "$_worker_count" "$running_list"

    [ "$completed" -ge "$TOTAL_FILES" ] && break

    if [ "$completed" -eq "$last_completed" ]; then
      [ "$no_progress_start" -eq 0 ] && no_progress_start=$SECONDS
      # 检查 worker 是否全部死亡
      # 只有全部完成或所有 worker 真正死亡（非瞬时空闲）才退出
      if [ "$_worker_count" -eq 0 ]; then
        if [ "$completed" -ge "$TOTAL_FILES" ]; then
          break    # 全部完成
        fi
        # 二次确认：等 3s 再看是否真的没有 worker 了
        sleep 3
        _wc2=0
        for _rf in "$PDIR"/running_*; do [ -f "$_rf" ] && _wc2=$((_wc2 + 1)); done
        if [ "$_wc2" -gt 0 ]; then
          :  # worker 又出现了，继续
        elif [ "$completed" -lt "$TOTAL_FILES" ]; then
          # 没有 worker 但还有未完成的测试 → 调度循环已结束/worker 被杀了
          # 用 result 文件数兜底：若全部 result 已到位但 DONE 计数因
          # ZOMBIE/竞态少了几个，这里应退出而不是死等（否则卡 3600s）。
          _result_count=$(ls "$PDIR"/result_* 2>/dev/null | wc -l)
          if [ "${_result_count:-0}" -ge "$TOTAL_FILES" ]; then
            break  # 所有 result 到位，计数丢失不影响退出
          fi
          # result 未齐 → 等运行中的测试通过 watchdog 完成
          : # 什么都不做，回到 while 循环继续等
        else
          break  # 全部完成了
        fi
      fi
    else
      no_progress_start=0
    fi
    last_completed=$completed
    # 无进度超时 3600s (60min) — 覆盖最慢测试 WT=TMOUT*4=2400s + watchdog 余量
    # 之前 1800s 会在 terminal-platform-gaps (2400s) 这类慢测试中途误杀进度显示
    if [ "$no_progress_start" -ne 0 ] && [ $((SECONDS - no_progress_start)) -gt 3600 ]; then
      echo ""; echo "[WARN] show_progress: 30m without new results (stuck workers?), exiting"; break
    fi

    # 自适应刷新: 前100个文件 5s, 之后 10s
    if [ "$completed" -gt 500 ]; then sleep 10
    elif [ "$completed" -gt 100 ]; then sleep 7
    else sleep 5
    fi
  done

  echo
  echo ""
  echo "── Per-file results ──" | tee -a "$REPORT"
  for i in $(seq 1 $TOTAL_FILES); do
    res_file="$PDIR/result_${i}"
    [ -f "$res_file" ] || continue
    file_result=$(grep -a '^RESULT=' "$res_file" | cut -d= -f2)
    file_duration=$(grep -a '^DURATION_MS=' "$res_file" | cut -d= -f2)
    file_timeout=$(grep -a '^TIMEOUT=' "$res_file" | cut -d= -f2)
    file_case_pass=$(grep -a '^CASE_PASS=' "$res_file" | cut -d= -f2)
    file_case_fail=$(grep -a '^CASE_FAIL=' "$res_file" | cut -d= -f2)
    file_path=$(grep -a '^FILE=' "$res_file" | cut -d= -f2-)

    if [ -n "$file_duration" ] && [ "$file_duration" -gt 0 ]; then
      dur_fmt="$((file_duration / 1000)).$(( (file_duration % 1000) / 100 ))s"
    else
      dur_fmt="?"
    fi

    if [ "$file_timeout" = "1" ]; then icon="⏰"; result_str="TIMEOUT"
    elif [ "$file_result" = "PASS" ]; then icon="✅"; result_str="PASS"
    else icon="❌"; result_str="FAIL"; fi

    line="  $icon [$i/$TOTAL_FILES] $result_str ${dur_fmt} $file_path (cases: +${file_case_pass}/-${file_case_fail})"
    echo "$line"
    echo "$line" >> "$REPORT"
  done
}

echo "Progress updates every 5-10s."
echo ""

# 强制写结果（仅写 result 文件，不更新 progress——show_progress 直接数文件）
_ohos_force_result() {
  local _idx _path _elapsed
  _idx=$1; _path=$2; _elapsed=$3
  {
    echo "FILE=$_path"
    echo "RESULT=TIMEOUT"
    echo "EXIT_CODE=99"
    echo "CASE_PASS=-1"
    echo "CASE_FAIL=-1"
    echo "DURATION_MS=$((_elapsed * 1000))"
    echo "TIMEOUT=1"
  } > "$PDIR/result_${_idx}.tmp"
  mv "$PDIR/result_${_idx}.tmp" "$PDIR/result_${_idx}"
  # 更新进度计数（追加日志，与 run_test 一致，避免并发覆盖）
  printf 'FAIL 0 0\n' >> "$PDIR/progress.log" 2>>"$REPORT"
}

show_progress &
STATUS_PID=$!

# ── NAPI 预编译（提前编译 .node addon，避免 node-gyp 冲突） ──
_ohos_napi_prebuild

# 孤儿扫荡 — 每 120 秒跑一次（取代原来每 30 文件）
_ohos_last_sweep=$SECONDS
i=1
_g_max_wt=0
while IFS= read -r f; do
  echo "$f" > "$PDIR/running_${i}"
  # 保存该测试的 watchdog 超时（秒），供调度循环超时判断
  # 必须与 run_test 中的 case 保持一致
  case "$f" in
    */bundler/transpiler/jsx-production.test.ts|*/udp/udp_socket.test.ts|*/terminal/terminal-platform-gaps.test.ts|*/spawn/spawn.test.ts|*/inspector/inspector.test.ts|*/run-extensionless.test.ts)
      _wt=$((TMOUT * 4)) ;;
    */bake/dev/server-sourcemap.test.ts|*/web/fetch/fetch.test.ts|*/cli/create/create-jsx.test.ts|*/shell/bunshell.test.ts|*/terminal/terminal.test.ts|*/websocket/websocket-server.test.ts)
      _wt=$((TMOUT * 3)) ;;
    *leak*|*no-orphans*|*spawn-pipe-leak*|*serve-body-leak*|*handle-leak*)
      _wt=$((TMOUT * 2)) ;;
    */bundler/*)
      _wt=$TMOUT_BUNDLER ;;
    *)
      _wt=$TMOUT ;;
  esac
  echo "$_wt" > "$PDIR/wt_${i}"
  # 全局最大 WT：_wait_start 阶段 wt_* 可能已被回收（worker 完成时删除），
  # 动态超时依赖它计算；在分派时记录，避免 _max_wt=0 退化为 3600s 固定值。
  [ "$_wt" -gt "$_g_max_wt" ] 2>/dev/null && _g_max_wt=$_wt
  # stdin 必须重定向到 /dev/null：后台子进程（含 bun test、script 包装的
  # terminal 测试）继承循环的 stdin（= test_files.txt fd），一旦子进程读
  # stdin 就会消费文件剩余内容 → 主循环 read 提前 EOF → 尾部文件从未分派
  # （2026-08-10 全量：terminal.test.ts 后 27 个文件丢失即此根因）。
  run_test "$i" "$f" < /dev/null &
  echo "$!" > "$PDIR/pid_${i}"

  # 阻塞直到有空闲 slot — 通过检查已完成的 result_* 来回收 running 文件
  while true; do
    # 独占测试运行中：非独占测试暂停分派（native-plugin 与任何并发
    # bun 进程冲突，_Znwm symbol not found）
    if [ "${_exclusive:-0}" -ne 1 ] && [ -d "$PDIR/exclusive.lock" ]; then
      sleep 1
      continue
    fi
    # 回收所有已完成测试的 running 文件和超时 worker
    # 遍历 running_* 文件替代 seq 1 $i（OHOS 上 seq 慢，且最多 PARALLEL 个文件）
    for _jf in "$PDIR"/running_*; do
      [ -f "$_jf" ] || continue
      _j="${_jf##*/running_}"
      [ -z "$_j" ] && continue
      # 正常完成：result 和 running 都存在 → 清理
      if [ -f "$PDIR/result_$_j" ] && [ -f "$PDIR/running_$_j" ]; then
        rm -f "$PDIR/running_$_j" "$PDIR/pid_$_j" "$PDIR/wt_$_j" 2>/dev/null
        continue
      fi
      # 异常残留：running 存在但 subshell 已死 → 清理（不写 timeout）
      if [ -f "$PDIR/running_$_j" ] && [ ! -f "$PDIR/result_$_j" ]; then
        _pid=$(cat "$PDIR/pid_$_j" 2>/dev/null || echo 0)
        if [ "$_pid" -gt 0 ] && ! kill -0 "$_pid" 2>/dev/null; then
          # subshell 刚退出时 result 可能还在写入收尾（快速测试的
          # wait/清理阶段）。短暂轮询确认 result 是否出现，避免把
          # 正常完成的快速测试误判为 ZOMBIE（本次 131 个假 ZOMBIE 根因）。
          _zombie_confirm=1
          for _zc in 1 2 3 4 5; do
            [ -f "$PDIR/result_$_j" ] && { _zombie_confirm=0; break; }
            sleep 0.2 2>/dev/null || sleep 1
          done
          if [ "$_zombie_confirm" -eq 1 ] && [ ! -f "$PDIR/result_$_j" ]; then
            _test_path=$(cat "$PDIR/running_$_j" 2>/dev/null || echo "unknown")
            echo "[ZOMBIE] $_test_path (subshell $_pid died without result)" >> "$REPORT"
            _ohos_force_result "$_j" "$_test_path" "0"
            rm -f "$PDIR/running_$_j" "$PDIR/pid_$_j" "$PDIR/wt_$_j"
            continue
          fi
        fi
      fi
      # 检查卡死的 worker：running 存在但 result 不存在，且超时
      if [ -f "$PDIR/running_$_j" ] && [ ! -f "$PDIR/result_$_j" ]; then
        _wt=$(cat "$PDIR/wt_$_j" 2>/dev/null || echo $TMOUT)
        _pid=$(cat "$PDIR/pid_$_j" 2>/dev/null || echo 0)
        if [ "$_pid" -gt 0 ]; then
          _elapsed=$(ps -o etimes= -p "$_pid" 2>/dev/null || echo 0)
          _max=$((_wt * 2 + 60))    # 2x watchdog + 60s 余量
          if [ "${_elapsed:-0}" -gt "$_max" ] 2>/dev/null; then
            # 强制杀
            pkill -P "$_pid" 2>/dev/null || true
            kill -9 "$_pid" 2>/dev/null || true
            wait "$_pid" 2>/dev/null || true
            _test_path=$(cat "$PDIR/running_$_j" 2>/dev/null || echo "unknown")
            echo "[FORCE] $_test_path (exceeded ${_max}s, was ${_elapsed}s)" >> "$REPORT"
            _ohos_force_result "$_j" "$_test_path" "${_elapsed:-0}"
            rm -f "$PDIR/running_$_j" "$PDIR/pid_$_j" "$PDIR/wt_$_j"
          fi
        fi
      fi
    done
    # 计数当前运行的 worker
    running_count=0
    for _rf in "$PDIR"/running_*; do [ -f "$_rf" ] && running_count=$((running_count + 1)); done
    [ "$running_count" -lt "$PARALLEL" ] && break
    sleep 0.5
  done
  i=$((i+1))

  # 孤儿清理：时间触发，每 120s
  if [ $((SECONDS - _ohos_last_sweep)) -gt 120 ]; then
    _ohos_sweep_orphans
    _ohos_kill_orphans
    _ohos_last_sweep=$SECONDS
  fi
done < "$PDIR/test_files.txt"

# 等待所有 worker 完成（基于 running_* + result_* 文件）
_wait_start=$SECONDS
while true; do
  # 清理残留：result 已存在但 running 还在（调度循环已结束，reaping 没机会跑）
  for _pf in "$PDIR"/pid_*; do
    [ -f "$_pf" ] || continue
    _idx="${_pf##*/pid_}"
    [ -f "$PDIR/result_$_idx" ] || continue
    [ -f "$PDIR/running_$_idx" ] || continue
    _pid=$(cat "$_pf" 2>/dev/null || echo 0)
    kill -0 "$_pid" 2>/dev/null && continue   # PID 还活着 → 跳过
    # PID 死了但 running 还在 → 清理
    rm -f "$PDIR/running_$_idx" "$PDIR/pid_$_idx" "$PDIR/wt_$_idx" 2>/dev/null
  done
  # ZOMBIE 检测（等待阶段）：subshell 已死但没写 result → 补写 TIMEOUT。
  # 主循环的 ZOMBIE 检测在分派阶段有效，最后一批 worker 只在这里被兜底。
  # 否则 result 永远缺失 → _results < TOTAL_FILES → 卡死直到超时。
  # 同样加轮询确认：快速测试的 subshell 退出后 result 可能仍在收尾。
  for _pf in "$PDIR"/pid_*; do
    [ -f "$_pf" ] || continue
    _idx="${_pf##*/pid_}"
    [ -f "$PDIR/result_$_idx" ] && continue
    [ -f "$PDIR/running_$_idx" ] || continue
    _pid=$(cat "$_pf" 2>/dev/null || echo 0)
    if [ "$_pid" -gt 0 ] 2>/dev/null && ! kill -0 "$_pid" 2>/dev/null; then
      _zombie_confirm=1
      for _zc in 1 2 3 4 5; do
        [ -f "$PDIR/result_$_idx" ] && { _zombie_confirm=0; break; }
        sleep 0.2 2>/dev/null || sleep 1
      done
      if [ "$_zombie_confirm" -eq 1 ] && [ ! -f "$PDIR/result_$_idx" ]; then
        _test_path=$(cat "$PDIR/running_$_idx" 2>/dev/null || echo "unknown")
        echo "[ZOMBIE] $_test_path (subshell $_pid died without result, wait-stage)" >> "$REPORT"
        _ohos_force_result "$_idx" "$_test_path" "0"
        rm -f "$PDIR/running_$_idx" "$PDIR/pid_$_idx" "$PDIR/wt_$_idx" 2>/dev/null
      fi
    fi
  done

  _running=$(ls "$PDIR"/running_* 2>/dev/null | wc -l)
  _results=$(ls "$PDIR"/result_* 2>/dev/null | wc -l)
  # 必须所有结果都到位（result_* >= TOTAL_FILES）才真正退出
  # 不依赖 running_*=0，因为调度循环结束后 running_* 可能已被清理
  if [ "$_results" -ge "$TOTAL_FILES" ]; then break; fi
  # 如果没有任何 worker 也没有全部结果：可能是调度循环结束了但测试还在跑
  # 继续等，直到 watchdog 超时或结果收齐
  if [ "$_running" -eq 0 ]; then
    # 等 10 秒看看有没有新结果
    sleep 10
    _results2=$(ls "$PDIR"/result_* 2>/dev/null | wc -l)
    if [ "$_results2" -le "$_results" ]; then
      : # 确实没新结果，但不要退出，继续等 watchdog 超时
    fi
  fi
  # 动态超时：固定 3600s 会在慢文件堆积时误杀仍合法运行的 worker。
  # 慢文件放末尾后，_wait_start 时剩余的全是慢文件（每个最长
  # WT=TMOUT*4=1200s），5 并行处理 N 个慢文件需要 ceil(N/5)×max_wt。
  # 超时 = ceil(剩余worker数/PARALLEL) × max_wt + 10min 余量。
  _max_wt=0
  for _wf in "$PDIR"/wt_*; do
    [ -f "$_wf" ] || continue
    _wv=$(cat "$_wf" 2>/dev/null || echo 0)
    [ "${_wv:-0}" -gt "$_max_wt" ] 2>/dev/null && _max_wt=$_wv
  done
  [ "$_g_max_wt" -gt "$_max_wt" ] 2>/dev/null && _max_wt=$_g_max_wt
  _wait_timeout=3600
  if [ "$_max_wt" -gt 0 ] 2>/dev/null; then
    # 超时基数 = 缺失的 result 数（而非 running_* 计数）：
    # 最后一批 worker 完成后 running_*=0，若用 running 计数会算出
    # (0/PARALLEL+1)*max_wt+600 ≈ 2400s 的短超时，在尾部文件因调度
    # bug 未分派时静默提前结束（2026-08-10 全量 27 文件丢失即此）。
    _results_now=$(ls "$PDIR"/result_* 2>/dev/null | wc -l)
    _results_now=${_results_now:-0}
    _remain_count=$((TOTAL_FILES - _results_now))
    [ "$_remain_count" -lt 0 ] 2>/dev/null && _remain_count=0
    _wait_timeout=$(( (_remain_count / PARALLEL + 1) * _max_wt + 600 ))
    # 兜底：至少 2 倍单文件 WT + 余量
    _min_wait=$((_max_wt * 2 + 600))
    [ "$_wait_timeout" -lt "$_min_wait" ] 2>/dev/null && _wait_timeout=$_min_wait
  fi
  if [ $((SECONDS - _wait_start)) -gt "$_wait_timeout" ]; then
    echo "[WARN] worker cleanup: ${_wait_timeout}s timeout, killing remaining workers" >&2
    # 只杀 worker（pid_* 里的 PID），不碰 show_progress（STATUS_PID）
    for _pf in "$PDIR"/pid_*; do
      [ -f "$_pf" ] || continue
      _wpid=$(cat "$_pf" 2>/dev/null || echo 0)
      [ "$_wpid" -gt 0 ] 2>/dev/null && kill -9 "$_wpid" 2>/dev/null || true
    done
    sleep 3
    break
  fi
  # 非阻塞等待 — 每次 5s 循环
  while [ "$(jobs -r | wc -l)" -gt 1 ]; do
    wait -n 2>/dev/null || break
  done 2>/dev/null
  sleep 2
done
wait $STATUS_PID 2>/dev/null
kill $STATUS_PID 2>/dev/null

# ── 汇总（用 grep 读 result 文件，避免 source 因权限/格式出错崩溃）
TOTAL=0; T_PASS=0; T_FAIL=0; T_CP=0; T_CF=0; T_TO=0
for _rf in "$PDIR"/result_*; do
  [ -f "$_rf" ] || continue
  TOTAL=$((TOTAL+1))
  # 用 grep 读取字段，不 source 整个文件（避免 Permission denied 等错误）
  _EC=$(grep -a '^EXIT_CODE=' "$_rf" 2>/dev/null | cut -d= -f2)
  _TIMEOUT=$(grep -a '^TIMEOUT=' "$_rf" 2>/dev/null | cut -d= -f2)
  _CP_VAL=$(grep -a '^CASE_PASS=' "$_rf" 2>/dev/null | cut -d= -f2)
  _CF_VAL=$(grep -a '^CASE_FAIL=' "$_rf" 2>/dev/null | cut -d= -f2)
  [ "${_EC:-0}" = "0" ] && T_PASS=$((T_PASS+1)) || T_FAIL=$((T_FAIL+1))
  [ "$_TIMEOUT" = "1" ] && T_TO=$((T_TO+1))
  [ -n "$_CP_VAL" ] && [ "$_CP_VAL" -ge 0 ] 2>/dev/null && T_CP=$((T_CP + _CP_VAL))
  [ -n "$_CF_VAL" ] && [ "$_CF_VAL" -ge 0 ] 2>/dev/null && T_CF=$((T_CF + _CF_VAL))
  # 输出文件内容到 report（使用文件名序号，保持原有行为）
  _seq_file=$(printf "%s/out_%d.txt" "$PDIR" "$TOTAL" 2>/dev/null)
  [ -f "$_seq_file" ] && { sed '$d' "$_seq_file" >> "$REPORT" 2>/dev/null; }
done

elapsed=$(( SECONDS - START_SECONDS ))
elapsed_fmt=$(printf '%02d:%02d:%02d' $((elapsed/3600)) $(( (elapsed%3600)/60 )) $((elapsed%60)))
{
echo ""
echo "════════════════════════════════════════════════════"
echo "  Duration: $elapsed_fmt"
echo "  Files:    $TOTAL total | $T_PASS passed | $T_FAIL failed"
echo "  Cases:    $T_CP passed | $T_CF failed"
echo "  Timeouts: $T_TO"
echo "════════════════════════════════════════════════════"
echo "Report: $REPORT"
} | tee -a "$REPORT"

echo ""
echo "════════════════════════════════════════════════════"
echo "  Duration: $elapsed_fmt  Files: $TOTAL  ✅ $T_PASS  ❌ $T_FAIL  Cases: +$T_CP/-$T_CF  ⏰ $T_TO"
echo "════════════════════════════════════════════════════"

[ "$T_FAIL" -eq 0 ] || exit 1
