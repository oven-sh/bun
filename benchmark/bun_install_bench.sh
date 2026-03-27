#!/usr/bin/env bash
# bun_install_bench.sh - End-to-end bun install benchmark + ziggit vs git CLI comparison
# Measures: stock bun install (cold/warm), ziggit clone vs git clone workflow
set -euo pipefail

BUN="/root/.bun/bin/bun"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
RESULTS_FILE="/root/bun-fork/benchmark/raw_results.txt"
BENCH_DIR="/tmp/bench-project"
CLONE_DIR="/tmp/clone-bench"
RUNS=3

# Repos that simulate typical bun install git dependencies (small-to-medium)
REPOS=(
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
  "https://github.com/chalk/chalk.git"
  "https://github.com/sindresorhus/is.git"
)
REPO_NAMES=("debug" "node-semver" "chalk" "is")

ts() { date +%s%N; }
ms_diff() {
  local start=$1 end=$2
  echo "scale=1; ($end - $start) / 1000000" | bc
}

echo "=== Bun Install Benchmark ===" | tee "$RESULTS_FILE"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RESULTS_FILE"
echo "Bun version: $($BUN --version)" | tee -a "$RESULTS_FILE"
echo "Ziggit: $ZIGGIT" | tee -a "$RESULTS_FILE"
echo "Git: $($GIT --version)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

########################################
# PART 1: Stock bun install benchmarks
########################################
echo "=== PART 1: Stock bun install (git dependencies) ===" | tee -a "$RESULTS_FILE"

mkdir -p "$BENCH_DIR"
cat > "$BENCH_DIR/package.json" << 'EOF'
{
  "name": "ziggit-bench",
  "dependencies": {
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver",
    "chalk": "github:chalk/chalk",
    "@sindresorhus/is": "github:sindresorhus/is"
  }
}
EOF

echo "" | tee -a "$RESULTS_FILE"
echo "--- Cold runs (cache cleared) ---" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $RUNS); do
  rm -rf "$BENCH_DIR/node_modules" "$BENCH_DIR/bun.lock" "$BENCH_DIR/bun.lockb"
  rm -rf ~/.bun/install/cache 2>/dev/null || true
  
  start=$(ts)
  cd "$BENCH_DIR" && $BUN install --no-progress 2>&1 | tail -3
  end=$(ts)
  elapsed=$(ms_diff $start $end)
  echo "  Cold run $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
done

echo "" | tee -a "$RESULTS_FILE"
echo "--- Warm runs (lockfile + cache present) ---" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $RUNS); do
  rm -rf "$BENCH_DIR/node_modules"
  
  start=$(ts)
  cd "$BENCH_DIR" && $BUN install --no-progress 2>&1 | tail -3
  end=$(ts)
  elapsed=$(ms_diff $start $end)
  echo "  Warm run $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
done

echo "" | tee -a "$RESULTS_FILE"
echo "--- Hot runs (node_modules present) ---" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $RUNS); do
  start=$(ts)
  cd "$BENCH_DIR" && $BUN install --no-progress 2>&1 | tail -3
  end=$(ts)
  elapsed=$(ms_diff $start $end)
  echo "  Hot run $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
done

########################################
# PART 2: ziggit vs git clone workflow
########################################
echo "" | tee -a "$RESULTS_FILE"
echo "=== PART 2: Clone workflow - ziggit vs git CLI ===" | tee -a "$RESULTS_FILE"
echo "(Simulates bun install git dep resolution: clone -> resolve ref -> checkout)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

for idx in "${!REPOS[@]}"; do
  repo="${REPOS[$idx]}"
  name="${REPO_NAMES[$idx]}"
  
  echo "--- Repo: $name ($repo) ---" | tee -a "$RESULTS_FILE"
  
  # --- git CLI workflow ---
  git_times=()
  for i in $(seq 1 $RUNS); do
    rm -rf "$CLONE_DIR" && mkdir -p "$CLONE_DIR"
    
    start=$(ts)
    # Step 1: bare clone (what bun does for git deps)
    $GIT clone --bare --depth 1 "$repo" "$CLONE_DIR/${name}.git" 2>/dev/null
    # Step 2: resolve HEAD to SHA
    $GIT -C "$CLONE_DIR/${name}.git" rev-parse HEAD >/dev/null 2>&1
    # Step 3: checkout working tree
    mkdir -p "$CLONE_DIR/${name}-work"
    $GIT clone --local "$CLONE_DIR/${name}.git" "$CLONE_DIR/${name}-work/tree" 2>/dev/null
    end=$(ts)
    
    elapsed=$(ms_diff $start $end)
    git_times+=("$elapsed")
    echo "  git run $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
    rm -rf "$CLONE_DIR"
  done
  
  # --- ziggit workflow ---
  ziggit_times=()
  for i in $(seq 1 $RUNS); do
    rm -rf "$CLONE_DIR" && mkdir -p "$CLONE_DIR"
    
    start=$(ts)
    # Step 1: clone
    $ZIGGIT clone --depth 1 "$repo" "$CLONE_DIR/${name}" 2>/dev/null || \
      $ZIGGIT clone "$repo" "$CLONE_DIR/${name}" 2>/dev/null
    # Step 2: resolve HEAD
    $ZIGGIT -C "$CLONE_DIR/${name}" log -1 --format="%H" 2>/dev/null || true
    end=$(ts)
    
    elapsed=$(ms_diff $start $end)
    ziggit_times+=("$elapsed")
    echo "  ziggit run $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
    rm -rf "$CLONE_DIR"
  done
  
  echo "" | tee -a "$RESULTS_FILE"
done

########################################
# PART 3: Full clone (no --depth 1)
########################################
echo "=== PART 3: Full clone comparison ===" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Use smaller repos for full clone on this VM
FULL_REPOS=("https://github.com/debug-js/debug.git" "https://github.com/npm/node-semver.git")
FULL_NAMES=("debug" "node-semver")

for idx in "${!FULL_REPOS[@]}"; do
  repo="${FULL_REPOS[$idx]}"
  name="${FULL_NAMES[$idx]}"
  
  echo "--- Full clone: $name ---" | tee -a "$RESULTS_FILE"
  
  for i in $(seq 1 $RUNS); do
    rm -rf "$CLONE_DIR" && mkdir -p "$CLONE_DIR"
    start=$(ts)
    $GIT clone "$repo" "$CLONE_DIR/${name}" 2>/dev/null
    end=$(ts)
    elapsed=$(ms_diff $start $end)
    echo "  git full clone $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
    rm -rf "$CLONE_DIR"
  done
  
  for i in $(seq 1 $RUNS); do
    rm -rf "$CLONE_DIR" && mkdir -p "$CLONE_DIR"
    start=$(ts)
    $ZIGGIT clone "$repo" "$CLONE_DIR/${name}" 2>/dev/null
    end=$(ts)
    elapsed=$(ms_diff $start $end)
    echo "  ziggit full clone $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
    rm -rf "$CLONE_DIR"
  done
  
  echo "" | tee -a "$RESULTS_FILE"
done

echo "=== Benchmark complete ===" | tee -a "$RESULTS_FILE"
