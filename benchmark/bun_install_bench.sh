#!/bin/bash
# bun_install_bench.sh — End-to-end bun install benchmark
# Compares stock bun (git CLI subprocess) vs ziggit library integration
#
# Usage: ./bun_install_bench.sh [output_file]
# Requirements: bun v1.3.11+ at /root/.bun/bin/bun, lib_bench built
#
# What this does:
# 1. Runs stock `bun install` with 5 GitHub git deps (cold + warm cache)
# 2. Runs lib_bench (ziggit library vs git CLI subprocess) for each repo
# 3. Outputs a combined report

set -euo pipefail

OUTFILE="${1:-/tmp/bun_install_bench_$(date -u +%Y%m%dT%H%M%SZ).txt}"
BENCH="$(dirname "$0")/zig-out/bin/lib_bench"
BUN="/root/.bun/bin/bun"
REPOS_DIR="/tmp/bench-repos"
PROJECT_DIR="/tmp/bench-project"

echo "=== Bun Install Benchmark — $(date -u) ===" | tee "$OUTFILE"
echo "" | tee -a "$OUTFILE"

# --- Step 1: Prepare bare repos ---
echo "--- Preparing bare repos ---" | tee -a "$OUTFILE"
mkdir -p "$REPOS_DIR"
for spec in "debug-js/debug" "chalk/chalk" "sindresorhus/is" "npm/node-semver" "expressjs/express"; do
    name=$(basename "$spec")
    dir="${REPOS_DIR}/${name}.git"
    if [ ! -d "$dir" ]; then
        echo "  Cloning $spec..."
        git clone --bare "https://github.com/${spec}.git" "$dir" 2>&1
    fi
    echo "  $name: $(du -sh "$dir" | cut -f1)" | tee -a "$OUTFILE"
done
echo "" | tee -a "$OUTFILE"

# --- Step 2: Stock bun install benchmarks ---
echo "--- Stock bun install (cold cache, 3 runs) ---" | tee -a "$OUTFILE"
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

for i in 1 2 3; do
    cd "$PROJECT_DIR"
    rm -rf node_modules bun.lock
    rm -rf ~/.bun/install/cache
    echo "  Cold Run $i:" | tee -a "$OUTFILE"
    { time "$BUN" install 2>&1; } 2>&1 | tee -a "$OUTFILE"
done

echo "" | tee -a "$OUTFILE"
echo "--- Stock bun install (warm cache, 3 runs) ---" | tee -a "$OUTFILE"
for i in 1 2 3; do
    cd "$PROJECT_DIR"
    rm -rf node_modules
    echo "  Warm Run $i:" | tee -a "$OUTFILE"
    { time "$BUN" install 2>&1; } 2>&1 | tee -a "$OUTFILE"
done

echo "" | tee -a "$OUTFILE"

# --- Step 3: Ziggit library vs git CLI per-repo ---
echo "--- Ziggit library vs git CLI (per-repo, 3 runs each) ---" | tee -a "$OUTFILE"

if [ ! -x "$BENCH" ]; then
    echo "ERROR: lib_bench not found at $BENCH" | tee -a "$OUTFILE"
    echo "Build it: cd $(dirname "$0") && zig build -Doptimize=ReleaseFast" | tee -a "$OUTFILE"
    exit 1
fi

for name in debug chalk is node-semver express; do
    dir="${REPOS_DIR}/${name}.git"
    iters=20
    [ "$name" = "express" ] && iters=10

    echo ">>> $name ($iters iters) <<<" | tee -a "$OUTFILE"
    for run in 1 2 3; do
        echo "  Run $run:" | tee -a "$OUTFILE"
        "$BENCH" "$dir" "$iters" 2>&1 | tee -a "$OUTFILE"
    done
    echo "" | tee -a "$OUTFILE"
done

echo "=== Done. Results in $OUTFILE ===" | tee -a "$OUTFILE"
