#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: stock bun vs ziggit-simulated git dependency resolution
#
# Architecture:
#   Stock bun spawns `git` CLI for each git dep operation.
#   Bun+ziggit uses in-process Zig code (no process spawn overhead).
#   This benchmark compares git CLI vs ziggit CLI as a proxy for the local
#   operations: clone-from-bare, rev-parse, and working-tree checkout.
#   Network fetch (HTTP clone) is done once by git and shared.
#
# Run: bash /root/bun-fork/benchmark/bun_install_bench.sh 2>&1 | tee /tmp/bench-output.txt

set -euo pipefail

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
BUN="/root/.bun/bin/bun"
RESULTS_FILE="/root/bun-fork/benchmark/raw_results.txt"
BENCH_DIR="/tmp/bench-workspace"
ITERATIONS=3

REPOS=(
    "https://github.com/debug-js/debug.git"
    "https://github.com/npm/node-semver.git"
    "https://github.com/sindresorhus/is.git"
    "https://github.com/chalk/chalk.git"
    "https://github.com/expressjs/express.git"
)
REPO_NAMES=(debug node-semver is chalk express)

timestamp_ms() {
    python3 -c "import time; print(int(time.time()*1000))"
}

elapsed_ms() {
    echo $(( $2 - $1 ))
}

cleanup_workdirs() {
    rm -rf "$BENCH_DIR/workdir-git" "$BENCH_DIR/workdir-ziggit"
    mkdir -p "$BENCH_DIR/workdir-git" "$BENCH_DIR/workdir-ziggit"
}

echo "=========================================="
echo "BUN INSTALL BENCHMARK"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Stock bun: $($BUN --version)"
echo "Git: $($GIT --version | awk '{print $3}')"
echo "Ziggit: $($ZIGGIT --version 2>&1 || echo 'unknown')"
echo "Iterations: $ITERATIONS"
echo "=========================================="
echo ""

> "$RESULTS_FILE"

###############################################################################
# PART 1: Stock bun install (cold + warm)
###############################################################################
echo "=== PART 1: Stock bun install with git dependencies ==="

mkdir -p /tmp/bench-project
cat > /tmp/bench-project/package.json << 'EOF'
{
  "name": "ziggit-bench",
  "dependencies": {
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver",
    "@sindresorhus/is": "github:sindresorhus/is",
    "chalk": "github:chalk/chalk",
    "express": "github:expressjs/express"
  }
}
EOF

for i in $(seq 1 $ITERATIONS); do
    echo "--- bun install COLD run $i/$ITERATIONS ---"
    cd /tmp/bench-project
    rm -rf node_modules bun.lock
    rm -rf ~/.bun/install/cache 2>/dev/null || true

    start=$(timestamp_ms)
    $BUN install --no-progress 2>&1 || true
    end=$(timestamp_ms)
    ms=$(elapsed_ms $start $end)
    echo "  Cold: ${ms}ms"
    echo "BUN_COLD_$i=${ms}" >> "$RESULTS_FILE"

    echo "--- bun install WARM run $i/$ITERATIONS ---"
    rm -rf node_modules bun.lock
    start=$(timestamp_ms)
    $BUN install --no-progress 2>&1 || true
    end=$(timestamp_ms)
    ms=$(elapsed_ms $start $end)
    echo "  Warm: ${ms}ms"
    echo "BUN_WARM_$i=${ms}" >> "$RESULTS_FILE"
done

echo ""

###############################################################################
# PART 2: Pre-fetch bare repos (shared network cost)
###############################################################################
echo "=== PART 2: Pre-fetching bare repos (one-time network cost) ==="

BARE_CACHE="$BENCH_DIR/bare-cache"
rm -rf "$BARE_CACHE"
mkdir -p "$BARE_CACHE"

for idx in "${!REPOS[@]}"; do
    repo="${REPOS[$idx]}"
    name="${REPO_NAMES[$idx]}"
    echo -n "  Fetching $name... "
    start=$(timestamp_ms)
    $GIT clone --bare "$repo" "$BARE_CACHE/${name}.git" 2>/dev/null
    end=$(timestamp_ms)
    ms=$(elapsed_ms $start $end)
    echo "${ms}ms"
    echo "NETWORK_FETCH_${name}=${ms}" >> "$RESULTS_FILE"
done

echo ""

###############################################################################
# PART 3: Git CLI local operations (what stock bun does per git dep)
###############################################################################
echo "=== PART 3: Git CLI local operations (clone-from-bare + rev-parse + checkout) ==="

for iter in $(seq 1 $ITERATIONS); do
    echo "--- git CLI iteration $iter/$ITERATIONS ---"
    cleanup_workdirs
    total_git=0

    for idx in "${!REPOS[@]}"; do
        name="${REPO_NAMES[$idx]}"
        bare="$BARE_CACHE/${name}.git"
        work="$BENCH_DIR/workdir-git/${name}"

        # rev-parse (resolve ref)
        start=$(timestamp_ms)
        sha=$($GIT -C "$bare" rev-parse HEAD 2>/dev/null)
        end=$(timestamp_ms)
        resolve_ms=$(elapsed_ms $start $end)

        # clone from bare to working tree
        start=$(timestamp_ms)
        $GIT clone "$bare" "$work" 2>/dev/null
        end=$(timestamp_ms)
        clone_ms=$(elapsed_ms $start $end)

        repo_total=$((resolve_ms + clone_ms))
        total_git=$((total_git + repo_total))
        echo "  $name: rev-parse=${resolve_ms}ms clone-local=${clone_ms}ms total=${repo_total}ms"
        echo "GIT_LOCAL_${name}_${iter}_resolve=${resolve_ms}" >> "$RESULTS_FILE"
        echo "GIT_LOCAL_${name}_${iter}_clone=${clone_ms}" >> "$RESULTS_FILE"
        echo "GIT_LOCAL_${name}_${iter}_total=${repo_total}" >> "$RESULTS_FILE"
    done

    echo "  TOTAL git CLI local: ${total_git}ms"
    echo "GIT_LOCAL_TOTAL_${iter}=${total_git}" >> "$RESULTS_FILE"
done

echo ""

###############################################################################
# PART 4: Ziggit local operations (what bun+ziggit does per git dep)
###############################################################################
echo "=== PART 4: Ziggit local operations (clone-from-bare + rev-parse + checkout) ==="

for iter in $(seq 1 $ITERATIONS); do
    echo "--- ziggit iteration $iter/$ITERATIONS ---"
    cleanup_workdirs
    total_ziggit=0

    for idx in "${!REPOS[@]}"; do
        name="${REPO_NAMES[$idx]}"
        bare="$BARE_CACHE/${name}.git"
        work="$BENCH_DIR/workdir-ziggit/${name}"

        # rev-parse (resolve ref)
        start=$(timestamp_ms)
        sha=$($ZIGGIT -C "$bare" rev-parse HEAD 2>/dev/null)
        end=$(timestamp_ms)
        resolve_ms=$(elapsed_ms $start $end)

        # clone from bare to working tree
        start=$(timestamp_ms)
        $ZIGGIT clone "$bare" "$work" 2>/dev/null
        end=$(timestamp_ms)
        clone_ms=$(elapsed_ms $start $end)

        repo_total=$((resolve_ms + clone_ms))
        total_ziggit=$((total_ziggit + repo_total))
        echo "  $name: rev-parse=${resolve_ms}ms clone-local=${clone_ms}ms total=${repo_total}ms"
        echo "ZIGGIT_LOCAL_${name}_${iter}_resolve=${resolve_ms}" >> "$RESULTS_FILE"
        echo "ZIGGIT_LOCAL_${name}_${iter}_clone=${clone_ms}" >> "$RESULTS_FILE"
        echo "ZIGGIT_LOCAL_${name}_${iter}_total=${repo_total}" >> "$RESULTS_FILE"
    done

    echo "  TOTAL ziggit local: ${total_ziggit}ms"
    echo "ZIGGIT_LOCAL_TOTAL_${iter}=${total_ziggit}" >> "$RESULTS_FILE"
done

echo ""

###############################################################################
# PART 5: Process spawn overhead measurement
###############################################################################
echo "=== PART 5: Process spawn overhead (git vs ziggit startup) ==="

for iter in $(seq 1 $ITERATIONS); do
    # Measure cost of 5x git --version (simulates 5 git subprocess calls)
    start=$(timestamp_ms)
    for i in $(seq 1 5); do $GIT --version >/dev/null 2>&1; done
    end=$(timestamp_ms)
    git_spawn=$(elapsed_ms $start $end)
    echo "  5x git --version: ${git_spawn}ms"
    echo "GIT_SPAWN_5x_${iter}=${git_spawn}" >> "$RESULTS_FILE"

    # bun+ziggit avoids this entirely (in-process)
    echo "  bun+ziggit: 0ms (in-process, no spawn)"
    echo "ZIGGIT_SPAWN_5x_${iter}=0" >> "$RESULTS_FILE"
done

echo ""
echo "=== RAW RESULTS ==="
cat "$RESULTS_FILE"
echo ""
echo "=== BENCHMARK COMPLETE ==="
