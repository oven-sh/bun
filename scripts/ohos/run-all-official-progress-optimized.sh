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

BUN="${BUN:-bun}"
PARALLEL=${PARALLEL:-3}
RETRIES=${RETRIES:-3}
TMOUT=${TMOUT:-300}
TMOUT_BUNDLER=${TMOUT_BUNDLER:-900}
BUN_TIMEOUT=${BUN_TIMEOUT:-300000}

# 孤儿清理 — 用 PID 白名单避免自伤
_ohos_kill_orphans() {
  local _pid _my_pids _sig
  _my_pids="$$ $PPID $BASHPID"
  for _sig in TERM KILL; do
    for _pid in $(pgrep -x "bun" 2>/dev/null || true); do
      case " $_my_pids " in *" $_pid "*) continue;; esac
      kill -$_sig "$_pid" 2>/dev/null || true
    done
    sleep 1
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

cleanup() {
  local kids
  kids=$(jobs -p 2>/dev/null)
  [ -n "$kids" ] && kill $kids 2>/dev/null
  _ohos_kill_orphans
  [ -n "$PDIR" ] && [ -d "$PDIR" ] && rm -rf "$PDIR"
}
trap cleanup EXIT INT TERM

# ── 前置清理 ──
_ohos_kill_orphans

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
  ! -path "*/node_modules/*" ! -name "*fuzzy-wuzzy*" \
  ! -path "*/fixtures/*" ! -path "*/snapshots/*" ! -path "*/node-napi-tests/*" \
  | sort > "$PDIR/test_files.txt"

TOTAL_FILES=$(wc -l < "$PDIR/test_files.txt")
echo "Found $TOTAL_FILES test files, running $PARALLEL parallel workers (TIMEOUT=${TMOUT}s, RETRIES=${RETRIES})"
echo "Found $TOTAL_FILES test files" >> "$REPORT"
echo "" >> "$REPORT"

# ── 运行单个测试 ──
run_test() {
  idx=$1
  f=$2
  case "$f" in
    */bundler/*)
      WT=${TMOUT_BUNDLER}
      BT="--timeout ${BUN_TIMEOUT}"
      ;;
    *leak*|*no-orphans*|*spawn-pipe-leak*|*serve-body-leak*|*handle-leak*)
      WT=$((TMOUT * 2))
      BT="--timeout 600000"
      ;;
    *)
      WT=${TMOUT}
      BT="--timeout ${BUN_TIMEOUT}"
      ;;
  esac

  echo "$f" > "$PDIR/running_${idx}"
  START_TS=$(date +%s%N)

  attempt=1
  max_attempts=$((RETRIES + 1))
  while [ $attempt -le $max_attempts ]; do
    out="$PDIR/out_${idx}_a${attempt}.tmp"
    $BUN test $BT "$f" > "$out" 2>&1 &
    BUNPID=$!
    # Watchdog
    (
      sleep $WT
      kill $BUNPID 2>/dev/null
      for _try in 1 2; do
        sleep 3
        kill -0 $BUNPID 2>/dev/null || exit 0
        kill -9 $BUNPID 2>/dev/null
      done
    ) &
    WDOG=$!
    wait $BUNPID 2>/dev/null
    EXIT=$?
    # 杀 watchdog — 用 PGID 避免孤儿 sleep
    pkill -P $WDOG 2>/dev/null
    kill $WDOG 2>/dev/null

    # 后清理 — 确保 bun 进程已死
    if kill -0 $BUNPID 2>/dev/null; then
      kill -9 $BUNPID 2>/dev/null || true
      wait $BUNPID 2>/dev/null || true
    fi

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
  rm -f "$PDIR/running_${idx}"
}

# ── 进度显示（5-10s 刷新，减少 CPU） ──
show_progress() {
  local completed passed failed case_pass case_fail elapsed pct
  local running_list last_completed no_progress_start

  no_progress_start=0; last_completed=0
  while true; do
    completed=0; passed=0; failed=0; case_pass=0; case_fail=0
    running_list=""

    for res_file in "$PDIR"/result_*; do
      [ -f "$res_file" ] || continue
      completed=$((completed + 1))
      file_result=; file_case_pass=; file_case_fail=; file_timeout=
      while IFS='=' read -r key val; do
        case "$key" in
          RESULT)   file_result=$val ;;
          CASE_PASS) file_case_pass=$val ;;
          CASE_FAIL) file_case_fail=$val ;;
          TIMEOUT)  file_timeout=$val ;;
        esac
      done < "$res_file"
      [ "$file_result" = "PASS" ] && passed=$((passed + 1)) || failed=$((failed + 1))
      if [ "$file_timeout" != "1" ]; then
        [ -n "$file_case_pass" ] && case_pass=$((case_pass + file_case_pass))
        [ -n "$file_case_fail" ] && case_fail=$((case_fail + file_case_fail))
      fi
    done

    first=1
    for run_file in "$PDIR"/running_*; do
      [ -f "$run_file" ] || continue
      read -r rl < "$run_file"
      if [ $first -eq 1 ]; then running_list="$rl"; first=0; else running_list="$running_list | $rl"; fi
    done
    [ ${#running_list} -gt 80 ] && running_list="${running_list:0:77}..."

    elapsed=$(( SECONDS - START_SECONDS ))
    elapsed_fmt=$(printf '%02d:%02d:%02d' $((elapsed/3600)) $(( (elapsed%3600)/60 )) $((elapsed%60)))
    pct=0; [ $TOTAL_FILES -gt 0 ] && pct=$(( completed * 100 / TOTAL_FILES ))

    printf "\r\033[K[%s] Files: %d/%d (%d%%) | ✅ %d | ❌ %d | Cases: +%d/-%d | ▶ %s" \
      "$elapsed_fmt" "$completed" "$TOTAL_FILES" "$pct" \
      "$passed" "$failed" "$case_pass" "$case_fail" "$running_list"

    [ "$completed" -ge "$TOTAL_FILES" ] && break

    if [ "$completed" -eq "$last_completed" ]; then
      [ "$no_progress_start" -eq 0 ] && no_progress_start=$SECONDS
    else
      no_progress_start=0
    fi
    last_completed=$completed
    if [ "$no_progress_start" -ne 0 ] && [ $((SECONDS - no_progress_start)) -gt 900 ]; then
      echo ""; echo "[WARN] show_progress: no new results for 15 minutes, exiting"; break
    fi

    # 自适应刷新: 前100个文件 5s, 之后 10s
    if [ "$completed" -gt 500 ]; then sleep 10
    elif [ "$completed" -gt 100 ]; then sleep 7
    else sleep 5
    fi
  done

  echo
  echo ""
  echo "── Per-file results ──"
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

    echo "  $icon [$i/$TOTAL_FILES] $result_str ${dur_fmt} $file_path (cases: +${file_case_pass}/-${file_case_fail})"
  done
}

echo "Progress updates every 5-10s."
echo ""

show_progress &
STATUS_PID=$!

# 孤儿扫荡 — 每 30 个文件跑一次
_ohos_orphan_count=0
i=1
while IFS= read -r f; do
  run_test "$i" "$f" &
  i=$((i+1))

  _ohos_orphan_count=$((_ohos_orphan_count + 1))
  if [ "$_ohos_orphan_count" -ge 30 ]; then
    _ohos_sweep_orphans
    _ohos_orphan_count=0
  fi

  while true; do
    running_count=0
    for _f in "$PDIR"/running_*; do [ -f "$_f" ] && running_count=$((running_count + 1)); done
    [ "$running_count" -lt "$PARALLEL" ] && break
    sleep 0.5
  done
done < "$PDIR/test_files.txt"

wait
wait $STATUS_PID 2>/dev/null
kill $STATUS_PID 2>/dev/null

# ── 汇总 ──
PASS=0; FAIL=0; TOTAL=0; CASE_PASS=0; CASE_FAIL=0; TIMEOUT_COUNT=0
i=1
while [ "$i" -le "$TOTAL_FILES" ]; do
  res_file="$PDIR/result_${i}"
  out_file="$PDIR/out_${i}.txt"
  if [ -f "$res_file" ] && [ -f "$out_file" ]; then
    TOTAL=$((TOTAL+1))
    ec=$(tail -1 "$out_file" | grep -o 'EXIT_CODE:[0-9]*' | cut -d: -f2)
    sed '$d' "$out_file" >> "$REPORT"
    file_result=$(grep '^RESULT=' "$res_file" | cut -d= -f2)
    file_case_pass=$(grep '^CASE_PASS=' "$res_file" | cut -d= -f2)
    file_case_fail=$(grep '^CASE_FAIL=' "$res_file" | cut -d= -f2)
    file_timeout=$(grep '^TIMEOUT=' "$res_file" | cut -d= -f2)
    [ "$ec" = "0" ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
    [ "$file_timeout" = "1" ] && TIMEOUT_COUNT=$((TIMEOUT_COUNT+1))
    [ -n "$file_case_pass" ] && [ "$file_case_pass" -ge 0 ] && CASE_PASS=$((CASE_PASS + file_case_pass))
    [ -n "$file_case_fail" ] && [ "$file_case_fail" -ge 0 ] && CASE_FAIL=$((CASE_FAIL + file_case_fail))
  fi
  i=$((i+1))
done

elapsed=$(( SECONDS - START_SECONDS ))
elapsed_fmt=$(printf '%02d:%02d:%02d' $((elapsed/3600)) $(( (elapsed%3600)/60 )) $((elapsed%60)))
{
echo ""
echo "════════════════════════════════════════════════════"
echo "  Duration: $elapsed_fmt"
echo "  Files:    $TOTAL total | $PASS passed | $FAIL failed"
echo "  Cases:    $CASE_PASS passed | $CASE_FAIL failed"
echo "  Timeouts: $TIMEOUT_COUNT"
echo "════════════════════════════════════════════════════"
echo "Report: $REPORT"
} | tee -a "$REPORT"

echo ""
echo "════════════════════════════════════════════════════"
echo "  Duration: $elapsed_fmt  Files: $TOTAL  ✅ $PASS  ❌ $FAIL  Cases: +$CASE_PASS/-$CASE_FAIL  ⏰ $TIMEOUT_COUNT"
echo "════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] || exit 1
