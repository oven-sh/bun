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

# 清理之前残留的 verdaccio 实例（每个占 ~35% CPU）
pkill -f "verdaccio" 2>/dev/null || true

# 清理孤儿 bun 进程
_ohos_kill_orphans 2>/dev/null || true

# PPID=1 孤儿清理 — 杀所有不属于 verdaccio/opencode 的 PPID=1 bun 进程
# 这些是 bun test 被杀后遗留的子孙（如 bun run jsx-*、bun -e fixture 等）
_ohos_kill_orphans() {
  local _pid
  for _pid in $(ps -eo pid,ppid,args 2>/dev/null | awk '/[b]un/ && !/verdaccio/ && !/opencode/ && $2 == 1 {print $1}'); do
    kill -9 "$_pid" 2>/dev/null || true
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

# ── 依赖检查 ──
{
echo "========== All Official Tests (optimized) =========="
echo "Bun: $($BUN --version 2>/dev/null)"
echo "Date: $(date)"
echo "Parallel: $PARALLEL | Timeout: ${TMOUT}s (bundler: ${TMOUT_BUNDLER}s) | Retries: ${RETRIES}"
echo ""
} | tee "$REPORT" >/dev/null

mkdir -p "$PDIR"

find test/ -type f \
  \( -name "*.test.ts" -o -name "*.test.js" -o -name "*.test.tsx" -o -name "*.test.jsx" \
     -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.cjs" \
     -o -name "*.test.mjs" -o -name "*.test.cjs" -o -name "*.spec.mjs" \
     -o -name "*.test.mts" -o -name "*.test.cts" -o -name "*.spec.cts" \) \
  ! -path "*/node_modules/*" \
  | awk 'BEGIN{srand();}{print rand()"\t"$0}' | sort -k1 -n | sed 's/^[0-9.]*\t//' \
  > "$PDIR/test_files_all.txt"

# 把慢测试移到末尾（避免阻塞调度循环）
# 匹配已知 >300s 的测试模式
grep -v -E "(jsx-production|shell-cmdsub-crash|run-extensionless|udp_socket\.test|bunshell\.test|spawn\.test|fetch/fetch\.test|terminal/terminal-|terminal\.test\.ts|bun-install\.test|request-clone-leak|create-jsx|bun-run\.test|dev-server\.test|expo-app|fetch-leak|bun-security-scanner-matrix|test-dev-peer-dependency|spawn-noread-leak|bun-install-registry|boundary-conditions|streams-leak|serve-response-stream-sink-leak|bun-serve-static-stress|bun-add\.test|init\.test|rm\.test\.ts|inspector\.test\.ts)" \
  "$PDIR/test_files_all.txt" > "$PDIR/test_files_fast.txt"
grep -E "(jsx-production|shell-cmdsub-crash|run-extensionless|udp_socket\.test|bunshell\.test|spawn\.test|fetch/fetch\.test|terminal/terminal-|terminal\.test\.ts|bun-install\.test|request-clone-leak|create-jsx|bun-run\.test|dev-server\.test|expo-app|fetch-leak|bun-security-scanner-matrix|test-dev-peer-dependency|spawn-noread-leak|bun-install-registry|boundary-conditions|streams-leak|serve-response-stream-sink-leak|bun-serve-static-stress|bun-add\.test|init\.test|rm\.test\.ts|inspector\.test\.ts)" \
  "$PDIR/test_files_all.txt" >> "$PDIR/test_files_fast.txt"
mv "$PDIR/test_files_fast.txt" "$PDIR/test_files.txt"

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
    # ── 慢测试单独调大超时 ──
    */bundler/transpiler/jsx-production.test.ts|*/udp/udp_socket.test.ts|*/terminal/terminal-platform-gaps.test.ts|*/spawn/spawn.test.ts|*/inspector/inspector.test.ts|*/run-extensionless.test.ts)
      WT=$((TMOUT * 4))       # 2400s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    */bake/dev/server-sourcemap.test.ts|*/web/fetch/fetch.test.ts|*/cli/create/create-jsx.test.ts|*/shell/bunshell.test.ts|*/terminal/terminal.test.ts)
      WT=$((TMOUT * 3))       # 1800s
      BT="--expose-internals --smol --timeout ${BUN_TIMEOUT}"
      ;;
    # ── 泄漏/长时间测试 ──
    *leak*|*no-orphans*|*spawn-pipe-leak*|*serve-body-leak*|*handle-leak*)
      WT=$((TMOUT * 2))
      BT="--expose-internals --smol --timeout 600000"
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

  # ── 串行标记：这些测试并行跑会冲突导致 subshell 死 ──
  _serial=0
  case "$f" in
    *socket.io/*|*grpc-js/*|*jsonwebtoken/*|*pg-gateway/*|*resvg/*|*@napi-rs/*|*@fastify/*|*@electric-sql/*)
      _serial=1 ;;
    *fetch/fetch-http3-cold-post*|*hono/hello-world*|*wpt-h2/*|*canvas/*|*socket.io*)
      _serial=1 ;;
  esac

  # ── 串行锁 ──
  if [ "$_serial" -eq 1 ]; then
    # 等待串行锁（每次只允许一个串行测试跑）
    while ! mkdir "$PDIR/serial.lock" 2>/dev/null; do sleep 1; done
    # 记录本测试持有锁，方便释放
    echo "$$" > "$PDIR/serial_holder" 2>/dev/null
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

    if [ $EXIT -eq 0 ] || [ $EXIT -eq 1 ]; then
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
  # 原子更新进度计数（mv 替代 mkdir 锁，避免死锁）
  _np=$CASE_PASS; _nf=$CASE_FAIL
  [ "$TIMEOUT" = "1" ] && _np=0 && _nf=0
  if [ -f "$PDIR/progress" ]; then . "$PDIR/progress"; else DONE=0 PASS=0 FAIL=0 CP=0 CF=0; fi
  if [ "$FILE_RESULT" = PASS ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
  CP=$((CP + _np)); CF=$((CF + _nf)); DONE=$((DONE + 1))
  echo "DONE=$DONE PASS=$PASS FAIL=$FAIL CP=$CP CF=$CF" > "$PDIR/progress.tmp"
  mv "$PDIR/progress.tmp" "$PDIR/progress" 2>>"$REPORT"
  # 释放串行锁
  if [ "$_serial" -eq 1 ]; then
    rmdir "$PDIR/serial.lock" 2>/dev/null || true
  fi
}

# ── 进度显示（5-10s 刷新，减少 CPU） ──
show_progress() {
  local completed passed failed case_pass case_fail elapsed pct
  local running_list last_completed no_progress_start _rc

  no_progress_start=0; last_completed=0
  while true; do
    # 读取增量进度计数（单文件，不遍历 1893 个 result_*）
    if [ -f "$PDIR/progress" ]; then
      . "$PDIR/progress"
      completed=$DONE; passed=$PASS; failed=$FAIL; case_pass=$CP; case_fail=$CF
    else
      completed=0; passed=0; failed=0; case_pass=0; case_fail=0
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
          # 等运行中的测试通过 watchdog 完成，不要提前退出
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
  # 更新进度计数
  if [ -f "$PDIR/progress" ]; then . "$PDIR/progress"; else DONE=0 PASS=0 FAIL=0 CP=0 CF=0; fi
  FAIL=$((FAIL + 1)); DONE=$((DONE + 1))
  echo "DONE=$DONE PASS=$PASS FAIL=$FAIL CP=$CP CF=$CF" > "$PDIR/progress.tmp"
  mv "$PDIR/progress.tmp" "$PDIR/progress" 2>>"$REPORT"
}

show_progress &
STATUS_PID=$!

# ── NAPI 预编译（提前编译 .node addon，避免 node-gyp 冲突） ──
_ohos_napi_prebuild

# 孤儿扫荡 — 每 120 秒跑一次（取代原来每 30 文件）
_ohos_last_sweep=$SECONDS
i=1
while IFS= read -r f; do
  echo "$f" > "$PDIR/running_${i}"
  # 保存该测试的 watchdog 超时（秒），供调度循环超时判断
  # 必须与 run_test 中的 case 保持一致
  case "$f" in
    */bundler/transpiler/jsx-production.test.ts|*/udp/udp_socket.test.ts|*/terminal/terminal-platform-gaps.test.ts|*/spawn/spawn.test.ts|*/inspector/inspector.test.ts|*/run-extensionless.test.ts)
      echo $((TMOUT * 4)) > "$PDIR/wt_${i}" ;;
    */bake/dev/server-sourcemap.test.ts|*/web/fetch/fetch.test.ts|*/cli/create/create-jsx.test.ts|*/shell/bunshell.test.ts|*/terminal/terminal.test.ts)
      echo $((TMOUT * 3)) > "$PDIR/wt_${i}" ;;
    *leak*|*no-orphans*|*spawn-pipe-leak*|*serve-body-leak*|*handle-leak*)
      echo $((TMOUT * 2)) > "$PDIR/wt_${i}" ;;
    */bundler/*)
      echo $TMOUT_BUNDLER > "$PDIR/wt_${i}" ;;
    *)
      echo $TMOUT > "$PDIR/wt_${i}" ;;
  esac
  run_test "$i" "$f" &
  echo "$!" > "$PDIR/pid_${i}"

  # 阻塞直到有空闲 slot — 通过检查已完成的 result_* 来回收 running 文件
  while true; do
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
          # subshell 死了但没写 result → 写 timeout
          _test_path=$(cat "$PDIR/running_$_j" 2>/dev/null || echo "unknown")
          echo "[ZOMBIE] $_test_path (subshell $_pid died without result)" >> "$REPORT"
          _ohos_force_result "$_j" "$_test_path" "0"
          rm -f "$PDIR/running_$_j" "$PDIR/pid_$_j" "$PDIR/wt_$_j"
          continue
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
  if [ $((SECONDS - _wait_start)) -gt 3600 ]; then
    echo "[WARN] worker cleanup: 60m timeout, killing remaining workers" >&2
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
