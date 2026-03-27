#!/usr/bin/env bash
set -euo pipefail

# BUN INSTALL GIT DEPENDENCY BENCHMARK
# Compares git CLI vs ziggit for the workflow bun install uses:
#   1. clone --bare (or fetch if cached)
#   2. rev-parse / log (resolve ref to SHA)
#   3. checkout-index (extract working tree)

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
BENCH_DIR="/tmp/ziggit-bun-bench"
RESULTS_FILE="/tmp/ziggit-bun-bench/results.txt"

REPOS=(
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
  "https://github.com/vercel/ms.git"
  "https://github.com/npm/ini.git"
  "https://github.com/broofa/mime.git"
)

REPO_NAMES=(debug node-semver ms ini mime)

NUM_RUNS=${1:-3}

rm -rf "$BENCH_DIR"
mkdir -p "$BENCH_DIR"

echo "=============================================" | tee "$RESULTS_FILE"
echo "BUN INSTALL GIT DEP SIMULATION BENCHMARK" | tee -a "$RESULTS_FILE"
echo "Date: $(date -u)" | tee -a "$RESULTS_FILE"
echo "Runs per test: $NUM_RUNS" | tee -a "$RESULTS_FILE"
echo "=============================================" | tee -a "$RESULTS_FILE"

# Precise timing function (milliseconds)
ms_time() {
  local start end
  start=$(date +%s%N)
  "$@" >/dev/null 2>&1
  end=$(date +%s%N)
  echo $(( (end - start) / 1000000 ))
}

echo "" | tee -a "$RESULTS_FILE"
echo "=== PER-REPO BREAKDOWN ===" | tee -a "$RESULTS_FILE"
printf "%-15s | %-8s | %-10s %-10s %-10s %-10s | %-10s %-10s %-10s %-10s\n" \
  "REPO" "RUN" "GIT_CLONE" "GIT_REV" "GIT_CKOUT" "GIT_TOTAL" \
  "ZIG_CLONE" "ZIG_REV" "ZIG_CKOUT" "ZIG_TOTAL" | tee -a "$RESULTS_FILE"
echo "$(printf '%.0s-' {1..130})" | tee -a "$RESULTS_FILE"

declare -A GIT_TOTALS
declare -A ZIG_TOTALS

for run in $(seq 1 "$NUM_RUNS"); do
  git_run_total=0
  zig_run_total=0

  for idx in "${!REPOS[@]}"; do
    repo="${REPOS[$idx]}"
    name="${REPO_NAMES[$idx]}"

    # Clean up
    rm -rf "$BENCH_DIR/git-bare-$name" "$BENCH_DIR/zig-bare-$name"
    rm -rf "$BENCH_DIR/git-work-$name" "$BENCH_DIR/zig-work-$name"

    # === GIT CLI workflow ===
    # Step 1: clone --bare
    git_clone_ms=$(ms_time "$GIT" clone --bare --depth=1 "$repo" "$BENCH_DIR/git-bare-$name")

    # Step 2: rev-parse HEAD (resolve ref to SHA)
    git_rev_ms=$(ms_time "$GIT" -C "$BENCH_DIR/git-bare-$name" rev-parse HEAD)

    # Step 3: checkout (extract to working dir via clone from bare)
    mkdir -p "$BENCH_DIR/git-work-$name"
    git_checkout_ms=$(ms_time "$GIT" clone --local "$BENCH_DIR/git-bare-$name" "$BENCH_DIR/git-work-$name/tree")

    git_total=$((git_clone_ms + git_rev_ms + git_checkout_ms))

    # === ZIGGIT workflow ===
    # Step 1: clone --bare
    zig_clone_ms=$(ms_time "$ZIGGIT" clone --bare --depth=1 "$repo" "$BENCH_DIR/zig-bare-$name")

    # Step 2: rev-parse HEAD
    zig_rev_ms=$(ms_time "$ZIGGIT" -C "$BENCH_DIR/zig-bare-$name" rev-parse HEAD)

    # Step 3: checkout (extract to working dir via clone from bare)
    mkdir -p "$BENCH_DIR/zig-work-$name"
    zig_checkout_ms=$(ms_time "$ZIGGIT" clone --local "$BENCH_DIR/zig-bare-$name" "$BENCH_DIR/zig-work-$name/tree")

    zig_total=$((zig_clone_ms + zig_rev_ms + zig_checkout_ms))

    git_run_total=$((git_run_total + git_total))
    zig_run_total=$((zig_run_total + zig_total))

    printf "%-15s | run %-4d | %-10s %-10s %-10s %-10s | %-10s %-10s %-10s %-10s\n" \
      "$name" "$run" \
      "${git_clone_ms}ms" "${git_rev_ms}ms" "${git_checkout_ms}ms" "${git_total}ms" \
      "${zig_clone_ms}ms" "${zig_rev_ms}ms" "${zig_checkout_ms}ms" "${zig_total}ms" \
      | tee -a "$RESULTS_FILE"
  done

  echo "" | tee -a "$RESULTS_FILE"
  echo "  Run $run totals: git=${git_run_total}ms  ziggit=${zig_run_total}ms  speedup=$(echo "scale=2; $git_run_total / $zig_run_total" | bc 2>/dev/null || echo "N/A")x" | tee -a "$RESULTS_FILE"
  echo "" | tee -a "$RESULTS_FILE"

  GIT_TOTALS[$run]=$git_run_total
  ZIG_TOTALS[$run]=$zig_run_total
done

echo "" | tee -a "$RESULTS_FILE"
echo "=== SUMMARY ===" | tee -a "$RESULTS_FILE"

git_sum=0; zig_sum=0
for run in $(seq 1 "$NUM_RUNS"); do
  git_sum=$((git_sum + ${GIT_TOTALS[$run]}))
  zig_sum=$((zig_sum + ${ZIG_TOTALS[$run]}))
done
git_avg=$((git_sum / NUM_RUNS))
zig_avg=$((zig_sum / NUM_RUNS))

echo "Average across $NUM_RUNS runs (5 repos each):" | tee -a "$RESULTS_FILE"
echo "  git CLI total:  ${git_avg}ms" | tee -a "$RESULTS_FILE"
echo "  ziggit total:   ${zig_avg}ms" | tee -a "$RESULTS_FILE"
if [ "$zig_avg" -gt 0 ]; then
  speedup=$(echo "scale=2; $git_avg / $zig_avg" | bc 2>/dev/null || echo "N/A")
  savings=$((git_avg - zig_avg))
  echo "  speedup:        ${speedup}x" | tee -a "$RESULTS_FILE"
  echo "  time saved:     ${savings}ms" | tee -a "$RESULTS_FILE"
fi

echo "" | tee -a "$RESULTS_FILE"
echo "Done. Results saved to $RESULTS_FILE"
