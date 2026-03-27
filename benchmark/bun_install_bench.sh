#!/bin/bash
# bun_install_bench.sh — End-to-end bun install benchmark
# Compares stock bun (git CLI subprocess) vs ziggit library integration
#
# Usage: ./bun_install_bench.sh [output_file]
# Default output: raw_results_$(date -u +%Y%m%dT%H%M%SZ).txt

set -euo pipefail

OUTPUT="${1:-raw_results_$(date -u +%Y%m%dT%H%M%SZ).txt}"
BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_BIN="$BENCH_DIR/zig-out/bin/lib_bench"
BUN="/root/.bun/bin/bun"
ITERS=20
RUNS=3

# Repos to benchmark (name:github_path)
REPOS=(
    "debug:debug-js/debug"
    "chalk:chalk/chalk"
    "is:sindresorhus/is"
    "node-semver:npm/node-semver"
)

BARE_DIR="/tmp/bench-bare-repos"
PROJECT_DIR="/tmp/bench-project"

exec > >(tee "$BENCH_DIR/$OUTPUT") 2>&1

echo "========================================="
echo "BUN INSTALL BENCHMARK — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================="
echo "System: $(uname -srm), $(free -h | awk '/Mem:/{print $2}') RAM"
echo "Stock bun: $($BUN --version)"
echo "Zig: $(zig version)"
echo "Git: $(git --version)"
echo ""

# ---- Phase 1: Stock bun install ----
echo "============================================"
echo "PHASE 1: Stock bun install (5 git deps)"
echo "============================================"

mkdir -p "$PROJECT_DIR"
cat > "$PROJECT_DIR/package.json" <<EOF
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

echo ""
echo "--- Cold cache runs ---"
for i in $(seq 1 $RUNS); do
    cd "$PROJECT_DIR"
    rm -rf node_modules bun.lock
    rm -rf ~/.bun/install/cache
    sync
    echo "Run $i:"
    { time $BUN install --no-progress 2>&1; } 2>&1
    echo ""
done

echo ""
echo "--- Warm cache runs ---"
# Ensure cache is warm
cd "$PROJECT_DIR"
rm -rf node_modules
$BUN install --no-progress >/dev/null 2>&1

for i in $(seq 1 $RUNS); do
    cd "$PROJECT_DIR"
    rm -rf node_modules
    sync
    echo "Run $i:"
    { time $BUN install --no-progress 2>&1; } 2>&1
    echo ""
done

# ---- Phase 2: Set up bare repos ----
echo "============================================"
echo "PHASE 2: Prepare bare repos"
echo "============================================"
mkdir -p "$BARE_DIR"
for entry in "${REPOS[@]}"; do
    name="${entry%%:*}"
    path="${entry#*:}"
    if [ ! -d "$BARE_DIR/$name.git" ]; then
        echo "Cloning $path..."
        git clone --bare --quiet "https://github.com/$path" "$BARE_DIR/$name.git"
    else
        echo "$name.git exists ($(du -sh "$BARE_DIR/$name.git" | cut -f1))"
    fi
done
echo ""

# ---- Phase 3: lib_bench per repo ----
echo "============================================"
echo "PHASE 3: Ziggit library vs git CLI"
echo "============================================"

if [ ! -x "$BENCH_BIN" ]; then
    echo "Building lib_bench..."
    cd "$BENCH_DIR"
    zig build -Doptimize=ReleaseFast 2>&1
fi

for entry in "${REPOS[@]}"; do
    name="${entry%%:*}"
    echo ""
    echo "############### $name ($(du -sh "$BARE_DIR/$name.git" | cut -f1)) ###############"
    for run in $(seq 1 $RUNS); do
        echo "--- Run $run ---"
        "$BENCH_BIN" "$BARE_DIR/$name.git" "$ITERS" 2>&1
        echo ""
    done
done

echo ""
echo "========================================="
echo "BENCHMARK COMPLETE — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================="
