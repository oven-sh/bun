#!/usr/bin/env bash
# Bun Install Benchmark: Stock Bun vs Ziggit-simulated workflow
# Measures end-to-end git dependency resolution performance
set -euo pipefail

STOCK_BUN="/root/.bun/bin/bun"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
BENCH_DIR="/tmp/bench-project"
RESULTS_FILE="/tmp/bench_results.txt"

# Repos that simulate real bun install git deps
REPOS=(
  "https://github.com/sindresorhus/is.git"
  "https://github.com/expressjs/express.git"
  "https://github.com/chalk/chalk.git"
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
)
REPO_NAMES=(is express chalk debug node-semver)

RUNS=3

echo "=== Bun Install Benchmark ===" | tee "$RESULTS_FILE"
echo "Date: $(date -u +%Y-%m-%dT%H:%MZ)" | tee -a "$RESULTS_FILE"
echo "Stock Bun: $($STOCK_BUN --version)" | tee -a "$RESULTS_FILE"
echo "Ziggit: $($ZIGGIT --version 2>&1 || echo 'n/a')" | tee -a "$RESULTS_FILE"
echo "Git: $(git --version)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

##############################################################################
# SECTION 1: Stock bun install (cold + warm)
##############################################################################
echo "=== Section 1: Stock bun install ===" | tee -a "$RESULTS_FILE"

mkdir -p "$BENCH_DIR"
cat > "$BENCH_DIR/package.json" << 'EOF'
{
  "name": "ziggit-bench",
  "dependencies": {
    "is": "github:sindresorhus/is",
    "express": "github:expressjs/express",
    "chalk": "github:chalk/chalk",
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver"
  }
}
EOF

# Cold runs
echo "--- Cold cache runs ---" | tee -a "$RESULTS_FILE"
cold_times=()
for i in $(seq 1 $RUNS); do
  rm -rf "$BENCH_DIR/node_modules" "$BENCH_DIR/bun.lock" ~/.bun/install/cache 2>/dev/null || true
  start_ns=$(date +%s%N)
  (cd "$BENCH_DIR" && "$STOCK_BUN" install --no-progress 2>&1) > /dev/null
  end_ns=$(date +%s%N)
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  cold_times+=($elapsed_ms)
  echo "  Cold run $i: ${elapsed_ms}ms" | tee -a "$RESULTS_FILE"
done

# Warm runs
echo "--- Warm cache runs ---" | tee -a "$RESULTS_FILE"
warm_times=()
for i in $(seq 1 $RUNS); do
  rm -rf "$BENCH_DIR/node_modules" "$BENCH_DIR/bun.lock" 2>/dev/null || true
  start_ns=$(date +%s%N)
  (cd "$BENCH_DIR" && "$STOCK_BUN" install --no-progress 2>&1) > /dev/null
  end_ns=$(date +%s%N)
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  warm_times+=($elapsed_ms)
  echo "  Warm run $i: ${elapsed_ms}ms" | tee -a "$RESULTS_FILE"
done

echo "" | tee -a "$RESULTS_FILE"

##############################################################################
# SECTION 2: Git CLI workflow (what bun does internally for git deps)
##############################################################################
echo "=== Section 2: Git CLI workflow (clone --bare + rev-parse + checkout) ===" | tee -a "$RESULTS_FILE"

git_clone_times=()
git_total_times=()

for run in $(seq 1 $RUNS); do
  echo "--- Git CLI run $run ---" | tee -a "$RESULTS_FILE"
  run_total=0
  for idx in "${!REPOS[@]}"; do
    repo="${REPOS[$idx]}"
    name="${REPO_NAMES[$idx]}"
    bare_dir="/tmp/git-bare-${name}"
    work_dir="/tmp/git-work-${name}"
    rm -rf "$bare_dir" "$work_dir"

    # Step 1: clone --bare
    start_ns=$(date +%s%N)
    git clone --bare --depth=1 "$repo" "$bare_dir" 2>/dev/null
    clone_end=$(date +%s%N)

    # Step 2: rev-parse HEAD (findCommit equivalent)
    git -C "$bare_dir" rev-parse HEAD > /dev/null 2>&1
    resolve_end=$(date +%s%N)

    # Step 3: checkout (archive + extract)
    mkdir -p "$work_dir"
    git -C "$bare_dir" archive HEAD | tar -x -C "$work_dir" 2>/dev/null
    checkout_end=$(date +%s%N)

    clone_ms=$(( (clone_end - start_ns) / 1000000 ))
    resolve_ms=$(( (resolve_end - clone_end) / 1000000 ))
    checkout_ms=$(( (checkout_end - resolve_end) / 1000000 ))
    total_ms=$(( (checkout_end - start_ns) / 1000000 ))
    run_total=$((run_total + total_ms))

    echo "  $name: clone=${clone_ms}ms resolve=${resolve_ms}ms checkout=${checkout_ms}ms total=${total_ms}ms" | tee -a "$RESULTS_FILE"

    rm -rf "$bare_dir" "$work_dir"
  done
  git_total_times+=($run_total)
  echo "  Run $run total: ${run_total}ms" | tee -a "$RESULTS_FILE"
done

echo "" | tee -a "$RESULTS_FILE"

##############################################################################
# SECTION 3: Ziggit workflow (clone + log + checkout-index simulation)
##############################################################################
echo "=== Section 3: Ziggit workflow (clone + resolve + checkout) ===" | tee -a "$RESULTS_FILE"

ziggit_total_times=()

for run in $(seq 1 $RUNS); do
  echo "--- Ziggit run $run ---" | tee -a "$RESULTS_FILE"
  run_total=0
  for idx in "${!REPOS[@]}"; do
    repo="${REPOS[$idx]}"
    name="${REPO_NAMES[$idx]}"
    clone_dir="/tmp/ziggit-clone-${name}"
    rm -rf "$clone_dir"

    # Step 1: clone (ziggit clone)
    start_ns=$(date +%s%N)
    "$ZIGGIT" clone "$repo" "$clone_dir" 2>/dev/null || true
    clone_end=$(date +%s%N)

    # Step 2: resolve ref (ziggit log -1)
    "$ZIGGIT" -C "$clone_dir" log -1 --format="%H" 2>/dev/null || true
    resolve_end=$(date +%s%N)

    # Step 3: files are already checked out by clone, measure status as proxy
    "$ZIGGIT" -C "$clone_dir" status 2>/dev/null || true
    checkout_end=$(date +%s%N)

    clone_ms=$(( (clone_end - start_ns) / 1000000 ))
    resolve_ms=$(( (resolve_end - clone_end) / 1000000 ))
    checkout_ms=$(( (checkout_end - resolve_end) / 1000000 ))
    total_ms=$(( (checkout_end - start_ns) / 1000000 ))
    run_total=$((run_total + total_ms))

    echo "  $name: clone=${clone_ms}ms resolve=${resolve_ms}ms checkout=${checkout_ms}ms total=${total_ms}ms" | tee -a "$RESULTS_FILE"

    rm -rf "$clone_dir"
  done
  ziggit_total_times+=($run_total)
  echo "  Run $run total: ${run_total}ms" | tee -a "$RESULTS_FILE"
done

echo "" | tee -a "$RESULTS_FILE"

##############################################################################
# SECTION 4: Local re-clone benchmark (cache simulation)
##############################################################################
echo "=== Section 4: Local re-clone (cached repo) ===" | tee -a "$RESULTS_FILE"

# Pre-clone one repo for local benchmarks
TEST_REPO="https://github.com/chalk/chalk.git"
LOCAL_BARE="/tmp/local-bare-chalk"
rm -rf "$LOCAL_BARE"
git clone --bare "$TEST_REPO" "$LOCAL_BARE" 2>/dev/null

echo "--- git archive from local bare (3 runs) ---" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $RUNS); do
  work="/tmp/local-work-git-$i"
  rm -rf "$work"; mkdir -p "$work"
  start_ns=$(date +%s%N)
  git -C "$LOCAL_BARE" archive HEAD | tar -x -C "$work"
  end_ns=$(date +%s%N)
  ms=$(( (end_ns - start_ns) / 1000000 ))
  echo "  git archive run $i: ${ms}ms" | tee -a "$RESULTS_FILE"
  rm -rf "$work"
done

echo "--- ziggit clone from local bare (3 runs) ---" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $RUNS); do
  work="/tmp/local-work-ziggit-$i"
  rm -rf "$work"
  start_ns=$(date +%s%N)
  "$ZIGGIT" clone "$LOCAL_BARE" "$work" 2>/dev/null || true
  end_ns=$(date +%s%N)
  ms=$(( (end_ns - start_ns) / 1000000 ))
  echo "  ziggit clone run $i: ${ms}ms" | tee -a "$RESULTS_FILE"
  rm -rf "$work"
done

rm -rf "$LOCAL_BARE"

echo "" | tee -a "$RESULTS_FILE"
echo "=== Benchmark complete ===" | tee -a "$RESULTS_FILE"
