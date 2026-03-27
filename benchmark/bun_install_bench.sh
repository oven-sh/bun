#!/usr/bin/env bash
# bun_install_bench.sh - End-to-end bun install benchmark
# Compares stock bun (git CLI subprocess) vs ziggit library integration
#
# Usage: ./bun_install_bench.sh [cold_runs] [warm_runs]
#
# Prerequisites:
#   - Stock bun at /root/.bun/bin/bun
#   - lib_bench built: cd /root/bun-fork/benchmark && zig build -Doptimize=ReleaseFast
#   - Internet access for GitHub clones

set -euo pipefail

COLD_RUNS=${1:-3}
WARM_RUNS=${2:-3}
BENCH_DIR="/root/bun-fork/benchmark"
BENCH_BIN="$BENCH_DIR/zig-out/bin/lib_bench"
PROJECT_DIR="/tmp/bench-project"
REPOS_DIR="/tmp/bench-repos"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
RESULTS_FILE="$BENCH_DIR/raw_results_${TIMESTAMP}.txt"
BUN="/root/.bun/bin/bun"

echo "=== Bun Install Benchmark — $(date -u) ===" | tee "$RESULTS_FILE"
echo "Stock bun: $($BUN --version)" | tee -a "$RESULTS_FILE"
echo "Machine: $(uname -srm), $(free -m | awk '/Mem:/{print $2}')MB RAM" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# ─── SECTION 1: Stock bun install with 5 git dependencies ───

mkdir -p "$PROJECT_DIR"
cat > "$PROJECT_DIR/package.json" << 'EOF'
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

echo "=== SECTION 1: Stock Bun Install (Cold Cache) ===" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $COLD_RUNS); do
    cd "$PROJECT_DIR"
    rm -rf node_modules bun.lock ~/.bun/install/cache 2>/dev/null
    sync
    echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
    
    result=$( { time $BUN install --no-save 2>&1 ; } 2>&1 )
    echo "  Cold run $i:" | tee -a "$RESULTS_FILE"
    echo "$result" | tee -a "$RESULTS_FILE"
    echo "" | tee -a "$RESULTS_FILE"
done

echo "=== SECTION 1b: Stock Bun Install (Warm Cache) ===" | tee -a "$RESULTS_FILE"
cd "$PROJECT_DIR"
$BUN install --no-save 2>&1 > /dev/null  # ensure lockfile + cache exist
for i in $(seq 1 $WARM_RUNS); do
    rm -rf node_modules
    result=$( { time $BUN install --no-save 2>&1 ; } 2>&1 )
    echo "  Warm run $i:" | tee -a "$RESULTS_FILE"
    echo "$result" | tee -a "$RESULTS_FILE"
    echo "" | tee -a "$RESULTS_FILE"
done

# ─── SECTION 2: Clone bare repos for local ziggit benchmarks ───

echo "=== SECTION 2: Preparing bare repos ===" | tee -a "$RESULTS_FILE"
mkdir -p "$REPOS_DIR"
for repo in "sindresorhus/is" "expressjs/express" "chalk/chalk" "debug-js/debug" "npm/node-semver"; do
    name=$(basename "$repo")
    if [ ! -d "$REPOS_DIR/$name.git" ]; then
        echo "Cloning $repo..." | tee -a "$RESULTS_FILE"
        git clone --bare --quiet "https://github.com/$repo.git" "$REPOS_DIR/$name.git"
    fi
done

# ─── SECTION 3: Ziggit library vs Git CLI benchmarks ───

if [ ! -x "$BENCH_BIN" ]; then
    echo "ERROR: lib_bench not found. Build with: cd $BENCH_DIR && zig build -Doptimize=ReleaseFast"
    exit 1
fi

echo "=== SECTION 3: Ziggit Library vs Git CLI ===" | tee -a "$RESULTS_FILE"
for repo in debug chalk is node-semver; do
    echo "" | tee -a "$RESULTS_FILE"
    echo ">>> REPO: $repo <<<" | tee -a "$RESULTS_FILE"
    for run in $(seq 1 3); do
        echo "  --- Run $run ---" | tee -a "$RESULTS_FILE"
        "$BENCH_BIN" "$REPOS_DIR/${repo}.git" 30 2>&1 | tee -a "$RESULTS_FILE"
        rm -rf /tmp/lib-bench-* 2>/dev/null
    done
done

# Express gets fewer iterations due to size (11MB)
echo "" | tee -a "$RESULTS_FILE"
echo ">>> REPO: express (reduced iterations due to 11MB size) <<<" | tee -a "$RESULTS_FILE"
"$BENCH_BIN" "$REPOS_DIR/express.git" 3 2>&1 | tee -a "$RESULTS_FILE" || true
rm -rf /tmp/lib-bench-* 2>/dev/null

echo "" | tee -a "$RESULTS_FILE"
echo "=== Benchmark complete — $(date -u) ===" | tee -a "$RESULTS_FILE"
echo "Results saved to: $RESULTS_FILE"
