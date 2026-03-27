#!/usr/bin/env bash
# bun_install_bench.sh — End-to-end bun install benchmark
# Compares stock bun (git CLI) vs ziggit library for git dependency resolution
#
# Usage: ./bun_install_bench.sh [--skip-bun] [--skip-ziggit]
#
# Prerequisites:
#   - Stock bun at /root/.bun/bin/bun
#   - ziggit built: cd /root/ziggit && zig build
#   - lib_bench built: cd /root/bun-fork/benchmark && zig build -Doptimize=ReleaseFast

set -euo pipefail

SKIP_BUN=false
SKIP_ZIGGIT=false
for arg in "$@"; do
    case "$arg" in
        --skip-bun) SKIP_BUN=true ;;
        --skip-ziggit) SKIP_ZIGGIT=true ;;
    esac
done

BENCH_BIN="/root/bun-fork/benchmark/zig-out/bin/lib_bench"
REPOS_DIR="/tmp/bench-bare-repos"
PROJECT_DIR="/tmp/bench-project"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
RESULTS="/root/bun-fork/benchmark/raw_results_${TIMESTAMP}.txt"

echo "=== Bun Install Benchmark — $TIMESTAMP ===" | tee "$RESULTS"
echo "System: $(uname -srm), $(free -h | awk '/Mem:/{print $2}') RAM" | tee -a "$RESULTS"
echo "" | tee -a "$RESULTS"

# --- Prepare bare repos ---
GITHUB_REPOS="debug-js/debug chalk/chalk sindresorhus/is npm/node-semver expressjs/express"
mkdir -p "$REPOS_DIR"
for repo in $GITHUB_REPOS; do
    name=$(basename "$repo")
    if [ ! -d "$REPOS_DIR/$name.git" ]; then
        echo "Cloning $repo..." | tee -a "$RESULTS"
        git clone --bare "https://github.com/$repo.git" "$REPOS_DIR/$name.git" 2>&1 | tail -2
    fi
done
echo "Repo sizes:" | tee -a "$RESULTS"
du -sh "$REPOS_DIR"/*.git | tee -a "$RESULTS"
echo "" | tee -a "$RESULTS"

# --- Stock bun install ---
if [ "$SKIP_BUN" = false ]; then
    echo "=== STOCK BUN INSTALL ===" | tee -a "$RESULTS"
    
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

    echo "--- Cold Cache (3 runs) ---" | tee -a "$RESULTS"
    for run in 1 2 3; do
        cd "$PROJECT_DIR"
        rm -rf node_modules bun.lock ~/.bun/install/cache
        sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
        sleep 1
        start=$(date +%s%N)
        /root/.bun/bin/bun install --no-progress 2>&1 | tee -a "$RESULTS"
        end=$(date +%s%N)
        echo "Run $run wall: $(( (end - start) / 1000000 ))ms" | tee -a "$RESULTS"
    done

    echo "--- Warm Cache (3 runs) ---" | tee -a "$RESULTS"
    for run in 1 2 3; do
        cd "$PROJECT_DIR"
        rm -rf node_modules
        start=$(date +%s%N)
        /root/.bun/bin/bun install --no-progress 2>&1 | tee -a "$RESULTS"
        end=$(date +%s%N)
        echo "Run $run wall: $(( (end - start) / 1000000 ))ms" | tee -a "$RESULTS"
    done
    echo "" | tee -a "$RESULTS"
fi

# --- Ziggit library vs git CLI ---
if [ "$SKIP_ZIGGIT" = false ]; then
    echo "=== ZIGGIT LIBRARY vs GIT CLI ===" | tee -a "$RESULTS"
    
    if [ ! -f "$BENCH_BIN" ]; then
        echo "ERROR: lib_bench not found at $BENCH_BIN" | tee -a "$RESULTS"
        echo "Build it: cd /root/bun-fork/benchmark && zig build -Doptimize=ReleaseFast" | tee -a "$RESULTS"
        exit 1
    fi

    for name in debug chalk is node-semver express; do
        ITERS=20
        [ "$name" = "express" ] && ITERS=10
        
        echo "--- $name ($ITERS iters, 3 runs) ---" | tee -a "$RESULTS"
        for run in 1 2 3; do
            sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
            echo "  Run $run:" | tee -a "$RESULTS"
            "$BENCH_BIN" "$REPOS_DIR/$name.git" "$ITERS" 2>&1 | tee -a "$RESULTS"
        done
        echo "" | tee -a "$RESULTS"
    done
fi

echo "=== Done. Results in $RESULTS ===" | tee -a "$RESULTS"
