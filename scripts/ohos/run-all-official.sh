#!/bin/sh
# Run official Bun test suite - mirrors upstream runner.node.mjs logic.
# Each test file runs in a separate `bun test` process.
# Features: retries, per-test timeout, parallel execution.
# OHOS adaptations: watchdog timeout, configurable TMPDIR, bundler timeout.

BUN="${BUN:-bun}"
PARALLEL=${PARALLEL:-6}
RETRIES=${RETRIES:-3}
# Per-test-file watchdog timeout (seconds). Bundler tests get TMOUT_BUNDLER.
TMOUT=${TMOUT:-300}
TMOUT_BUNDLER=${TMOUT_BUNDLER:-900}
# Bun's internal per-test-case timeout (ms), passed as --timeout.
BUN_TIMEOUT=${BUN_TIMEOUT:-300000}
TS=$(date +%Y%m%d_%H%M%S)
REPORT="all-official-report-${TS}.txt"
PDIR="${TMPDIR:-/storage/Users/currentUser/tmp}/bun_test_parallel_$$"
mkdir -p "$PDIR"

# ── Header ──
echo "========== All Official Tests (parallel) ==========" | tee "$REPORT"
echo "Bun: $($BUN --version 2>/dev/null)" | tee -a "$REPORT"
echo "Date: $(date)" | tee -a "$REPORT"
echo "Parallel: $PARALLEL | Timeout: ${TMOUT}s (bundler: ${TMOUT_BUNDLER}s) | Retries: ${RETRIES}" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# ── Test discovery (same patterns as runner.node.mjs) ──
find test/ -type f \
  \( -name "*.test.ts" -o -name "*.test.js" -o -name "*.test.tsx" -o -name "*.test.jsx" \
     -o -name "*.spec.ts" -o -name "*.spec.tsx" -o -name "*.spec.js" -o -name "*.spec.jsx" \
     -o -name "*.test.mjs" -o -name "*.test.cjs" -o -name "*.spec.mjs" -o -name "*.spec.cjs" \
     -o -name "*.test.mts" -o -name "*.test.cts" -o -name "*.spec.mts" -o -name "*.spec.cts" \) \
  ! -path "*/node_modules/*" \
  ! -name "*fuzzy-wuzzy*" \
  ! -path "*/fixtures/*" \
  ! -path "*/snapshots/*" \
  ! -path "*/node-napi-tests/*" \
  | sort > "$PDIR/test_files.txt"

TOTAL_FILES=$(wc -l < "$PDIR/test_files.txt")
echo "Found $TOTAL_FILES test files" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# ── Helper: run one test file with retries ──
# Usage: run_test <index> <filepath>
run_test() {
  idx=$1
  f=$2
  case "$f" in
    */bundler/*)
      WT=${TMOUT_BUNDLER}
      BT="--timeout ${BUN_TIMEOUT}"
      ;;
    *)
      WT=${TMOUT}
      BT="--timeout ${BUN_TIMEOUT}"
      ;;
  esac

  # Retry loop (upstream: --retries=N means N retries = N+1 attempts)
  attempt=1
  max_attempts=$((RETRIES + 1))
  while [ $attempt -le $max_attempts ]; do
    out="$PDIR/out_${idx}.tmp"
    # Run with watchdog (OHOS has no `timeout` command)
    $BUN test $BT "$f" > "$out" 2>&1 &
    BUNPID=$!
    (sleep $WT; kill $BUNPID 2>/dev/null) &
    WDOG=$!
    wait $BUNPID 2>/dev/null
    EXIT=$?
    kill $WDOG 2>/dev/null

    # Check if this attempt passed
    if [ $EXIT -eq 0 ]; then
      # Passed - write output and return
      cat "$out" >> "$PDIR/out_${idx}.txt"
      echo "EXIT_CODE:0" >> "$PDIR/out_${idx}.txt"
      rm -f "$out"
      return 0
    fi

    # Failed - retry unless it's the last attempt
    if [ $attempt -lt $max_attempts ]; then
      # Write retry attempt output to report (like upstream does)
      { echo "[$idx/$TOTAL_FILES] $f [attempt #$((attempt+1))]"; cat "$out"; } >> "$REPORT"
      rm -f "$out"
      attempt=$((attempt + 1))
    else
      # Last attempt failed - write final output
      cat "$out" >> "$PDIR/out_${idx}.txt"
      echo "EXIT_CODE:$EXIT" >> "$PDIR/out_${idx}.txt"
      rm -f "$out"
      return $EXIT
    fi
  done
}

# ── Launch all tests in parallel ──
i=1
while IFS= read -r f; do
  # Start test in background with throttling
  run_test "$i" "$f" &
  
  # Throttle: wait if we hit PARALLEL limit
  while [ "$(jobs -l 2>/dev/null | grep -c Running)" -ge "$PARALLEL" ]; do
    sleep 0.5
  done
  i=$((i+1))
done < "$PDIR/test_files.txt"

# Wait for all remaining tests
wait

# ── Collect results ──
PASS=0; FAIL=0; TOTAL=0
i=1
while [ "$i" -le "$TOTAL_FILES" ]; do
  out="$PDIR/out_${i}.txt"
  if [ -f "$out" ]; then
    TOTAL=$((TOTAL+1))
    ec=$(tail -1 "$out" | grep -o 'EXIT_CODE:[0-9]*' | cut -d: -f2)
    sed '$d' "$out" >> "$REPORT"
    if [ "$ec" = "0" ]; then
      PASS=$((PASS+1))
    else
      FAIL=$((FAIL+1))
    fi
  fi
  i=$((i+1))
done

rm -rf "$PDIR"

echo "" | tee -a "$REPORT"
echo "TOTAL:$TOTAL PASS:$PASS FAIL:$FAIL" | tee -a "$REPORT"
echo "Report: $REPORT"
[ "$FAIL" -eq 0 ] || exit 1