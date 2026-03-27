#!/usr/bin/env bash
set -euo pipefail

# BUN INSTALL BENCHMARK: Stock bun vs ziggit-simulated workflow
# Compares git CLI (what stock bun uses) vs ziggit for git dependency resolution

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
BUN="/root/.bun/bin/bun"

# Test repos (same as what a package.json with github: deps would use)
REPOS=(
  "https://github.com/sindresorhus/is.git"
  "https://github.com/expressjs/express.git"
  "https://github.com/chalk/chalk.git"
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
)
REPO_NAMES=("@sindresorhus/is" "express" "chalk" "debug" "semver")

RUNS=3
WORKDIR="/tmp/bench-workdir"
RAW_FILE="/root/bun-fork/benchmark/raw_results_$(date -u +%Y%m%dT%H%M%SZ).txt"

timestamp() { date +%s%N; }
ms_diff() {
  local start=$1 end=$2
  echo $(( (end - start) / 1000000 ))
}

cleanup_workdir() {
  rm -rf "$WORKDIR"
  mkdir -p "$WORKDIR"
}

# Get ziggit version
ZIGGIT_VERSION=$(cd /root/ziggit && git log --oneline -1)

{
echo "=== BUN INSTALL BENCHMARK ==="
echo "Date: $(date -u)"
echo "Ziggit: $ZIGGIT_VERSION"
echo ""

########################################
# PART 1: Stock bun install benchmarks
########################################
echo "--- PART 1: Stock bun install ---"

BENCH_PROJECT="/tmp/bench-project"

declare -a bun_cold_times
declare -a bun_warm_times

for run in $(seq 1 $RUNS); do
  echo "  Run $run/$RUNS..."
  # Cold: clear everything
  rm -rf "$BENCH_PROJECT" ~/.bun/install/cache
  mkdir -p "$BENCH_PROJECT"
  cat > "$BENCH_PROJECT/package.json" << 'PKGJSON'
{
  "name": "ziggit-bench",
  "dependencies": {
    "@sindresorhus/is": "github:sindresorhus/is",
    "express": "github:expressjs/express",
    "chalk": "github:chalk/chalk",
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver"
  }
}
PKGJSON
  cd "$BENCH_PROJECT"
  start=$(timestamp)
  $BUN install --no-progress 2>&1 || true
  end=$(timestamp)
  cold_ms=$(ms_diff $start $end)
  bun_cold_times+=($cold_ms)

  # Warm: keep cache, remove node_modules + lockfile
  rm -rf node_modules bun.lock
  start=$(timestamp)
  $BUN install --no-progress 2>&1 || true
  end=$(timestamp)
  warm_ms=$(ms_diff $start $end)
  bun_warm_times+=($warm_ms)

  echo "    Cold=${cold_ms}ms Warm=${warm_ms}ms"
done

# Average
cold_avg=0; warm_avg=0
for t in "${bun_cold_times[@]}"; do cold_avg=$((cold_avg + t)); done
for t in "${bun_warm_times[@]}"; do warm_avg=$((warm_avg + t)); done
cold_avg=$((cold_avg / RUNS))
warm_avg=$((warm_avg / RUNS))
echo "  Average: Cold=${cold_avg}ms Warm=${warm_avg}ms"
echo ""

########################################
# PART 2: Git CLI per-repo workflow
########################################
echo "--- PART 2: Git CLI per-repo (3 runs each, averaged) ---"

declare -A git_clone_avg git_resolve_avg git_checkout_avg git_total_avg

for i in "${!REPOS[@]}"; do
  repo="${REPOS[$i]}"
  name="${REPO_NAMES[$i]}"
  
  clone_sum=0; resolve_sum=0; checkout_sum=0
  
  for run in $(seq 1 $RUNS); do
    cleanup_workdir
    dest="$WORKDIR/git-bare-${i}"
    checkout_dest="$WORKDIR/git-checkout-${i}"
    
    # Clone bare
    start=$(timestamp)
    $GIT clone --bare --depth=1 --single-branch "$repo" "$dest" 2>/dev/null
    end=$(timestamp)
    clone_ms=$(ms_diff $start $end)
    
    # Resolve HEAD to SHA
    start=$(timestamp)
    sha=$($GIT -C "$dest" rev-parse HEAD 2>/dev/null)
    end=$(timestamp)
    resolve_ms=$(ms_diff $start $end)
    
    # Checkout (archive + extract)
    mkdir -p "$checkout_dest"
    start=$(timestamp)
    $GIT -C "$dest" archive --format=tar HEAD | tar -xf - -C "$checkout_dest"
    end=$(timestamp)
    checkout_ms=$(ms_diff $start $end)
    
    clone_sum=$((clone_sum + clone_ms))
    resolve_sum=$((resolve_sum + resolve_ms))
    checkout_sum=$((checkout_sum + checkout_ms))
  done
  
  git_clone_avg[$name]=$((clone_sum / RUNS))
  git_resolve_avg[$name]=$((resolve_sum / RUNS))
  git_checkout_avg[$name]=$((checkout_sum / RUNS))
  total=$((clone_sum / RUNS + resolve_sum / RUNS + checkout_sum / RUNS))
  git_total_avg[$name]=$total
  
  echo "  $name: clone=${git_clone_avg[$name]}ms resolve=${git_resolve_avg[$name]}ms checkout=${git_checkout_avg[$name]}ms total=${total}ms"
done

git_total_sum=0
for name in "${REPO_NAMES[@]}"; do
  git_total_sum=$((git_total_sum + git_total_avg[$name]))
done
echo "  TOTAL: ${git_total_sum}ms"
echo ""

########################################
# PART 3: Ziggit per-repo workflow
########################################
echo "--- PART 3: Ziggit per-repo (3 runs each, averaged) ---"

declare -A zig_clone_avg zig_resolve_avg zig_checkout_avg zig_total_avg

for i in "${!REPOS[@]}"; do
  repo="${REPOS[$i]}"
  name="${REPO_NAMES[$i]}"
  
  clone_sum=0; resolve_sum=0; checkout_sum=0
  
  for run in $(seq 1 $RUNS); do
    cleanup_workdir
    dest="$WORKDIR/zig-bare-${i}"
    checkout_dest="$WORKDIR/zig-checkout-${i}"
    
    # Clone bare
    start=$(timestamp)
    $ZIGGIT clone --bare --depth 1 "$repo" "$dest" 2>/dev/null || true
    end=$(timestamp)
    clone_ms=$(ms_diff $start $end)
    
    # Resolve HEAD to SHA (use git rev-parse on the ziggit-created bare repo)
    start=$(timestamp)
    if [ -d "$dest" ]; then
      sha=$($GIT -C "$dest" rev-parse HEAD 2>/dev/null || echo "unknown")
    fi
    end=$(timestamp)
    resolve_ms=$(ms_diff $start $end)
    
    # Checkout (archive + extract from ziggit-created repo)
    mkdir -p "$checkout_dest"
    start=$(timestamp)
    if [ -d "$dest" ]; then
      $GIT -C "$dest" archive --format=tar HEAD 2>/dev/null | tar -xf - -C "$checkout_dest" 2>/dev/null || true
    fi
    end=$(timestamp)
    checkout_ms=$(ms_diff $start $end)
    
    clone_sum=$((clone_sum + clone_ms))
    resolve_sum=$((resolve_sum + resolve_ms))
    checkout_sum=$((checkout_sum + checkout_ms))
  done
  
  zig_clone_avg[$name]=$((clone_sum / RUNS))
  zig_resolve_avg[$name]=$((resolve_sum / RUNS))
  zig_checkout_avg[$name]=$((checkout_sum / RUNS))
  total=$((clone_sum / RUNS + resolve_sum / RUNS + checkout_sum / RUNS))
  zig_total_avg[$name]=$total
  
  echo "  $name: clone=${zig_clone_avg[$name]}ms resolve=${zig_resolve_avg[$name]}ms checkout=${zig_checkout_avg[$name]}ms total=${total}ms"
done

zig_total_sum=0
for name in "${REPO_NAMES[@]}"; do
  zig_total_sum=$((zig_total_sum + zig_total_avg[$name]))
done
echo "  TOTAL: ${zig_total_sum}ms"
echo ""

########################################
# SUMMARY
########################################
if [ $git_total_sum -gt 0 ]; then
  # Use bc for floating point
  speedup=$(echo "scale=2; $git_total_sum / $zig_total_sum" | bc 2>/dev/null || echo "N/A")
  savings=$((git_total_sum - zig_total_sum))
  pct=$(( savings * 100 / git_total_sum ))
  echo "=== SUMMARY ==="
  echo "Git CLI total: ${git_total_sum}ms"
  echo "Ziggit total:  ${zig_total_sum}ms"
  echo "Savings:       ${savings}ms (${pct}%)"
  echo "Speedup:       ${speedup}x"
  echo ""
  echo "Bun install cold avg: ${cold_avg}ms"
  echo "Bun install warm avg: ${warm_avg}ms"
  echo ""
  
  # Per-repo breakdown for markdown
  echo "--- PER-REPO CLONE BREAKDOWN ---"
  for name in "${REPO_NAMES[@]}"; do
    git_c=${git_clone_avg[$name]}
    zig_c=${zig_clone_avg[$name]}
    if [ $git_c -gt 0 ]; then
      delta=$((git_c - zig_c))
      dpct=$((delta * 100 / git_c))
      echo "  $name: git=${git_c}ms ziggit=${zig_c}ms delta=-${delta}ms (${dpct}%)"
    fi
  done
  echo ""
  echo "--- PER-REPO CHECKOUT BREAKDOWN ---"
  for name in "${REPO_NAMES[@]}"; do
    git_co=${git_checkout_avg[$name]}
    zig_co=${zig_checkout_avg[$name]}
    delta=$((zig_co - git_co))
    echo "  $name: git=${git_co}ms ziggit=${zig_co}ms delta=${delta}ms"
  done
fi

} 2>&1 | tee "$RAW_FILE"

echo ""
echo "Raw results saved to: $RAW_FILE"
