#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: stock bun vs ziggit-simulated git dependency resolution
# Runs each benchmark 3 times and reports median.
set -euo pipefail

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
BUN="/root/.bun/bin/bun"
RESULTS_FILE="/root/bun-fork/benchmark/raw_results.txt"
BENCH_DIR="/tmp/bench-workspace"

# Repos that simulate typical bun install git dependencies (small-medium)
REPOS=(
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
  "https://github.com/chalk/chalk.git"
  "https://github.com/sindresorhus/is.git"
  "https://github.com/expressjs/express.git"
)

REPO_NAMES=("debug" "node-semver" "chalk" "is" "express")

rm -f "$RESULTS_FILE"
echo "=== BUN INSTALL BENCHMARK $(date -Iseconds) ===" | tee "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Helper: median of 3 values
median3() {
  echo "$1 $2 $3" | tr ' ' '\n' | sort -n | sed -n '2p'
}

########################################
# PART 1: Stock bun install benchmark
########################################
echo "## Part 1: Stock bun install (git dependencies)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

mkdir -p /tmp/bench-bun-project
cat > /tmp/bench-bun-project/package.json << 'EOF'
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
EOF

echo "### Cold cache runs:" | tee -a "$RESULTS_FILE"
bun_cold_times=()
for i in 1 2 3; do
  cd /tmp/bench-bun-project
  rm -rf node_modules bun.lock .bun
  rm -rf ~/.bun/install/cache 2>/dev/null || true
  start=$(date +%s%N)
  "$BUN" install 2>&1 || true
  end=$(date +%s%N)
  t=$(( (end - start) / 1000000 ))
  bun_cold_times+=("$t")
  echo "  Run $i: ${t}ms" | tee -a "$RESULTS_FILE"
done
bun_cold_median=$(median3 "${bun_cold_times[0]}" "${bun_cold_times[1]}" "${bun_cold_times[2]}")
echo "  Median (cold): ${bun_cold_median}ms" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

echo "### Warm cache runs:" | tee -a "$RESULTS_FILE"
# Ensure cache is populated
cd /tmp/bench-bun-project
rm -rf node_modules
"$BUN" install >/dev/null 2>&1 || true
bun_warm_times=()
for i in 1 2 3; do
  cd /tmp/bench-bun-project
  rm -rf node_modules
  start=$(date +%s%N)
  "$BUN" install 2>&1 || true
  end=$(date +%s%N)
  t=$(( (end - start) / 1000000 ))
  bun_warm_times+=("$t")
  echo "  Run $i: ${t}ms" | tee -a "$RESULTS_FILE"
done
bun_warm_median=$(median3 "${bun_warm_times[0]}" "${bun_warm_times[1]}" "${bun_warm_times[2]}")
echo "  Median (warm): ${bun_warm_median}ms" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

########################################
# PART 2: Per-repo git CLI vs ziggit
# Simulates bun install workflow:
#   1. clone (fetch pack data from remote)
#   2. resolve HEAD to SHA
#   3. checkout working tree
########################################
echo "## Part 2: Per-repo clone+resolve benchmark (git CLI vs ziggit)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"
echo "Workflow: clone → resolve HEAD → checkout working tree" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

printf "| %-15s | %12s | %14s | %12s | %14s | %7s |\n" \
  "Repo" "git clone ms" "ziggit clone ms" "git total ms" "ziggit total ms" "Speedup" | tee -a "$RESULTS_FILE"
printf "|%-15s-|-%12s-|-%14s-|-%12s-|-%14s-|-%7s-|\n" \
  "---------------" "------------" "--------------" "------------" "--------------" "-------" | tee -a "$RESULTS_FILE"

total_git=0
total_ziggit=0

for idx in "${!REPOS[@]}"; do
  repo="${REPOS[$idx]}"
  name="${REPO_NAMES[$idx]}"

  git_clone_runs=()
  git_total_runs=()
  ziggit_clone_runs=()
  ziggit_total_runs=()

  for run in 1 2 3; do
    ########### git CLI ###########
    rm -rf "$BENCH_DIR/git-$name" "$BENCH_DIR/git-$name-work"
    mkdir -p "$BENCH_DIR"

    t0=$(date +%s%N)
    "$GIT" clone --depth=1 "$repo" "$BENCH_DIR/git-$name" >/dev/null 2>&1
    t1=$(date +%s%N)
    "$GIT" -C "$BENCH_DIR/git-$name" rev-parse HEAD >/dev/null 2>&1
    t2=$(date +%s%N)

    git_clone_ms=$(( (t1 - t0) / 1000000 ))
    git_total_ms=$(( (t2 - t0) / 1000000 ))
    git_clone_runs+=("$git_clone_ms")
    git_total_runs+=("$git_total_ms")
    rm -rf "$BENCH_DIR/git-$name"

    ########### ziggit ###########
    rm -rf "$BENCH_DIR/ziggit-$name" "$BENCH_DIR/ziggit-$name-work"
    mkdir -p "$BENCH_DIR"

    t0=$(date +%s%N)
    "$ZIGGIT" clone --depth=1 "$repo" "$BENCH_DIR/ziggit-$name" >/dev/null 2>&1 || \
      "$ZIGGIT" clone "$repo" "$BENCH_DIR/ziggit-$name" >/dev/null 2>&1 || true
    t1=$(date +%s%N)
    # resolve HEAD
    "$ZIGGIT" -C "$BENCH_DIR/ziggit-$name" log -1 --format=%H >/dev/null 2>&1 || \
      "$GIT" -C "$BENCH_DIR/ziggit-$name" rev-parse HEAD >/dev/null 2>&1 || true
    t2=$(date +%s%N)

    ziggit_clone_ms=$(( (t1 - t0) / 1000000 ))
    ziggit_total_ms=$(( (t2 - t0) / 1000000 ))
    ziggit_clone_runs+=("$ziggit_clone_ms")
    ziggit_total_runs+=("$ziggit_total_ms")
    rm -rf "$BENCH_DIR/ziggit-$name"
  done

  gc=$(median3 "${git_clone_runs[0]}" "${git_clone_runs[1]}" "${git_clone_runs[2]}")
  gt=$(median3 "${git_total_runs[0]}" "${git_total_runs[1]}" "${git_total_runs[2]}")
  zc=$(median3 "${ziggit_clone_runs[0]}" "${ziggit_clone_runs[1]}" "${ziggit_clone_runs[2]}")
  zt=$(median3 "${ziggit_total_runs[0]}" "${ziggit_total_runs[1]}" "${ziggit_total_runs[2]}")

  total_git=$((total_git + gt))
  total_ziggit=$((total_ziggit + zt))

  if [ "$zt" -gt 0 ]; then
    speedup=$(echo "scale=2; $gt / $zt" | bc 2>/dev/null || echo "N/A")
  else
    speedup="INF"
  fi

  printf "| %-15s | %10sms | %12sms | %10sms | %12sms | %5sx |\n" \
    "$name" "$gc" "$zc" "$gt" "$zt" "$speedup" | tee -a "$RESULTS_FILE"
done

echo "" | tee -a "$RESULTS_FILE"
echo "### Aggregate (all 5 repos, median of 3 runs each):" | tee -a "$RESULTS_FILE"
echo "  git CLI total:    ${total_git}ms" | tee -a "$RESULTS_FILE"
echo "  ziggit total:     ${total_ziggit}ms" | tee -a "$RESULTS_FILE"
if [ "$total_ziggit" -gt 0 ]; then
  overall=$(echo "scale=2; $total_git / $total_ziggit" | bc 2>/dev/null || echo "N/A")
  savings=$((total_git - total_ziggit))
  echo "  Overall speedup:  ${overall}x" | tee -a "$RESULTS_FILE"
  echo "  Time saved:       ${savings}ms" | tee -a "$RESULTS_FILE"
fi
echo "" | tee -a "$RESULTS_FILE"

########################################
# PART 3: Projected bun install impact
########################################
echo "## Part 3: Projected bun install improvement" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"
echo "Stock bun install cold cache: ${bun_cold_median}ms" | tee -a "$RESULTS_FILE"
echo "Stock bun install warm cache: ${bun_warm_median}ms" | tee -a "$RESULTS_FILE"
echo "Git dep resolution via git CLI: ${total_git}ms" | tee -a "$RESULTS_FILE"
echo "Git dep resolution via ziggit:  ${total_ziggit}ms" | tee -a "$RESULTS_FILE"
if [ "$total_ziggit" -gt 0 ] && [ "$total_git" -gt 0 ]; then
  savings=$((total_git - total_ziggit))
  projected=$((bun_cold_median - savings))
  if [ "$projected" -lt 0 ]; then projected=0; fi
  pct=$(echo "scale=1; $savings * 100 / $bun_cold_median" | bc 2>/dev/null || echo "N/A")
  echo "" | tee -a "$RESULTS_FILE"
  echo "Projected cold install with ziggit: ~${projected}ms" | tee -a "$RESULTS_FILE"
  echo "Estimated improvement: ${pct}% faster on git dependency resolution" | tee -a "$RESULTS_FILE"
fi

echo "" | tee -a "$RESULTS_FILE"
echo "=== BENCHMARK COMPLETE ===" | tee -a "$RESULTS_FILE"
