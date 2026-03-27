#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: ziggit vs git CLI
# Simulates the exact 3-step workflow bun install uses for git dependencies:
#   1. clone --bare (or fetch if cached)
#   2. rev-parse / findCommit (resolve ref to SHA)
#   3. clone --no-checkout + checkout (extract working tree)
#
# Usage: bash benchmark/bun_install_bench.sh [NUM_RUNS]

set -euo pipefail

NUM_RUNS="${1:-3}"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
BENCH_DIR="/tmp/bun-install-bench"
RESULTS_FILE="/tmp/bun-install-bench-results.txt"

# Repos to benchmark (same ones used in stock bun test)
declare -A REPOS
REPOS[debug]="https://github.com/debug-js/debug.git"
REPOS[semver]="https://github.com/npm/node-semver.git"
REPOS[ms]="https://github.com/vercel/ms.git"

# Default branches for each repo
declare -A BRANCHES
BRANCHES[debug]="master"
BRANCHES[semver]="main"
BRANCHES[ms]="main"

echo "============================================================"
echo "BUN INSTALL GIT DEPENDENCY BENCHMARK"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Runs per test: $NUM_RUNS"
echo "ziggit: $ZIGGIT"
echo "git:    $GIT ($($GIT --version))"
echo "============================================================"
echo ""

> "$RESULTS_FILE"

time_ms() {
    # Returns elapsed time in milliseconds
    local start end
    start=$(date +%s%N)
    "$@" >/dev/null 2>&1
    local rc=$?
    end=$(date +%s%N)
    echo $(( (end - start) / 1000000 ))
    return $rc
}

# ============================================================
# PART 1: Stock bun install benchmarks
# ============================================================
echo "========== PART 1: Stock bun install =========="
echo ""

BUN="/root/.bun/bin/bun"
BUN_PROJECT="/tmp/bench-project"
mkdir -p "$BUN_PROJECT"
cat > "$BUN_PROJECT/package.json" << 'PKGJSON'
{
  "name": "ziggit-bench",
  "dependencies": {
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver",
    "ms": "github:vercel/ms"
  }
}
PKGJSON

echo "--- Cold cache (full install) ---"
BUN_COLD_TIMES=()
for i in $(seq 1 $NUM_RUNS); do
    cd "$BUN_PROJECT"
    rm -rf node_modules bun.lock
    rm -rf ~/.bun/install/cache 2>/dev/null || true
    t=$(time_ms $BUN install --no-progress)
    BUN_COLD_TIMES+=($t)
    echo "  Run $i: ${t}ms"
done

echo ""
echo "--- Warm cache (node_modules removed, cache kept) ---"
BUN_WARM_TIMES=()
for i in $(seq 1 $NUM_RUNS); do
    cd "$BUN_PROJECT"
    rm -rf node_modules bun.lock
    t=$(time_ms $BUN install --no-progress)
    BUN_WARM_TIMES+=($t)
    echo "  Run $i: ${t}ms"
done

echo ""

# ============================================================
# PART 2: Per-repo ziggit vs git CLI workflow
# ============================================================
echo "========== PART 2: Per-repo git workflow comparison =========="
echo "Workflow: clone_bare → findCommit(rev-parse) → clone_local + checkout"
echo ""

for repo_name in debug semver ms; do
    url="${REPOS[$repo_name]}"
    branch="${BRANCHES[$repo_name]}"
    echo "--- $repo_name ($url) ---"
    
    # Arrays to accumulate per-step times
    ZIGGIT_CLONE=()
    ZIGGIT_RESOLVE=()
    ZIGGIT_CHECKOUT=()
    ZIGGIT_TOTAL=()
    GIT_CLONE=()
    GIT_RESOLVE=()
    GIT_CHECKOUT=()
    GIT_TOTAL=()
    
    for i in $(seq 1 $NUM_RUNS); do
        # ---- ZIGGIT ----
        rm -rf "$BENCH_DIR/ziggit-bare-$repo_name" "$BENCH_DIR/ziggit-wt-$repo_name"
        
        # Step 1: clone --bare
        t1=$(time_ms $ZIGGIT clone --bare "$url" "$BENCH_DIR/ziggit-bare-$repo_name")
        ZIGGIT_CLONE+=($t1)
        
        # Step 2: findCommit (rev-parse)
        start_ns=$(date +%s%N)
        sha=$(cd "$BENCH_DIR/ziggit-bare-$repo_name" && $ZIGGIT rev-parse "$branch" 2>/dev/null)
        end_ns=$(date +%s%N)
        t2=$(( (end_ns - start_ns) / 1000000 ))
        ZIGGIT_RESOLVE+=($t2)
        
        # Step 3: clone --no-checkout + checkout
        start_ns=$(date +%s%N)
        $ZIGGIT clone --no-checkout "$BENCH_DIR/ziggit-bare-$repo_name" "$BENCH_DIR/ziggit-wt-$repo_name" >/dev/null 2>&1
        cd "$BENCH_DIR/ziggit-wt-$repo_name" && $ZIGGIT checkout "$sha" >/dev/null 2>&1
        end_ns=$(date +%s%N)
        t3=$(( (end_ns - start_ns) / 1000000 ))
        ZIGGIT_CHECKOUT+=($t3)
        
        total=$((t1 + t2 + t3))
        ZIGGIT_TOTAL+=($total)
        
        # ---- GIT CLI ----
        rm -rf "$BENCH_DIR/git-bare-$repo_name" "$BENCH_DIR/git-wt-$repo_name"
        
        # Step 1: clone --bare
        t1=$(time_ms $GIT clone -c core.longpaths=true --quiet --bare "$url" "$BENCH_DIR/git-bare-$repo_name")
        GIT_CLONE+=($t1)
        
        # Step 2: findCommit (log --format=%H -1)
        start_ns=$(date +%s%N)
        sha_git=$($GIT -C "$BENCH_DIR/git-bare-$repo_name" log --format=%H -1 "$branch" 2>/dev/null)
        end_ns=$(date +%s%N)
        t2=$(( (end_ns - start_ns) / 1000000 ))
        GIT_RESOLVE+=($t2)
        
        # Step 3: clone --no-checkout + checkout
        start_ns=$(date +%s%N)
        $GIT clone -c core.longpaths=true --quiet --no-checkout "$BENCH_DIR/git-bare-$repo_name" "$BENCH_DIR/git-wt-$repo_name" >/dev/null 2>&1
        $GIT -C "$BENCH_DIR/git-wt-$repo_name" checkout --quiet "$sha_git" >/dev/null 2>&1
        end_ns=$(date +%s%N)
        t3=$(( (end_ns - start_ns) / 1000000 ))
        GIT_CHECKOUT+=($t3)
        
        total=$((t1 + t2 + t3))
        GIT_TOTAL+=($total)
        
        echo "  Run $i: ziggit=${ZIGGIT_TOTAL[-1]}ms (clone:${ZIGGIT_CLONE[-1]} resolve:${ZIGGIT_RESOLVE[-1]} checkout:${ZIGGIT_CHECKOUT[-1]}) | git=${GIT_TOTAL[-1]}ms (clone:${GIT_CLONE[-1]} resolve:${GIT_RESOLVE[-1]} checkout:${GIT_CHECKOUT[-1]})"
    done
    
    # Compute medians (sort and take middle)
    median() {
        local arr=("$@")
        local sorted=($(printf '%s\n' "${arr[@]}" | sort -n))
        local mid=$((${#sorted[@]} / 2))
        echo "${sorted[$mid]}"
    }
    
    z_clone_med=$(median "${ZIGGIT_CLONE[@]}")
    z_resolve_med=$(median "${ZIGGIT_RESOLVE[@]}")
    z_checkout_med=$(median "${ZIGGIT_CHECKOUT[@]}")
    z_total_med=$(median "${ZIGGIT_TOTAL[@]}")
    g_clone_med=$(median "${GIT_CLONE[@]}")
    g_resolve_med=$(median "${GIT_RESOLVE[@]}")
    g_checkout_med=$(median "${GIT_CHECKOUT[@]}")
    g_total_med=$(median "${GIT_TOTAL[@]}")
    
    echo "  MEDIAN: ziggit=${z_total_med}ms | git=${g_total_med}ms"
    echo "    clone:    ziggit=${z_clone_med}ms vs git=${g_clone_med}ms"
    echo "    resolve:  ziggit=${z_resolve_med}ms vs git=${g_resolve_med}ms"  
    echo "    checkout: ziggit=${z_checkout_med}ms vs git=${g_checkout_med}ms"
    echo ""
    
    # Save to results file
    echo "$repo_name ziggit clone_med=$z_clone_med resolve_med=$z_resolve_med checkout_med=$z_checkout_med total_med=$z_total_med" >> "$RESULTS_FILE"
    echo "$repo_name git clone_med=$g_clone_med resolve_med=$g_resolve_med checkout_med=$g_checkout_med total_med=$g_total_med" >> "$RESULTS_FILE"
done

# ============================================================
# PART 3: Fetch (warm) benchmark - simulates re-fetch
# ============================================================
echo "========== PART 3: Fetch (warm bare repo) comparison =========="
echo ""

for repo_name in debug semver ms; do
    url="${REPOS[$repo_name]}"
    echo "--- $repo_name (fetch into existing bare) ---"
    
    ZIGGIT_FETCH=()
    GIT_FETCH=()
    
    for i in $(seq 1 $NUM_RUNS); do
        # ziggit fetch
        start_ns=$(date +%s%N)
        cd "$BENCH_DIR/ziggit-bare-$repo_name" && $ZIGGIT fetch >/dev/null 2>&1 || true
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        ZIGGIT_FETCH+=($t)
        
        # git fetch
        start_ns=$(date +%s%N)
        $GIT -C "$BENCH_DIR/git-bare-$repo_name" fetch --quiet >/dev/null 2>&1 || true
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        GIT_FETCH+=($t)
        
        echo "  Run $i: ziggit=${ZIGGIT_FETCH[-1]}ms | git=${GIT_FETCH[-1]}ms"
    done
    
    z_med=$(median "${ZIGGIT_FETCH[@]}")
    g_med=$(median "${GIT_FETCH[@]}")
    echo "  MEDIAN: ziggit=${z_med}ms | git=${g_med}ms"
    echo ""
    
    echo "$repo_name ziggit fetch_med=$z_med" >> "$RESULTS_FILE"
    echo "$repo_name git fetch_med=$g_med" >> "$RESULTS_FILE"
done

# ============================================================
# PART 4: findCommit-only microbenchmark (the ~50x faster claim)
# ============================================================
echo "========== PART 4: findCommit (rev-parse) microbenchmark =========="
echo "This is the operation bun calls for each git dep to resolve refs."
echo "ziggit does this in-process; stock bun spawns 'git log --format=%H -1'"
echo ""

MICRO_RUNS=10
for repo_name in debug semver ms; do
    branch="${BRANCHES[$repo_name]}"
    echo "--- $repo_name (${MICRO_RUNS} runs) ---"
    
    ZIGGIT_TIMES=()
    GIT_TIMES=()
    
    for i in $(seq 1 $MICRO_RUNS); do
        # ziggit rev-parse
        start_ns=$(date +%s%N)
        cd "$BENCH_DIR/ziggit-bare-$repo_name" && $ZIGGIT rev-parse "$branch" >/dev/null 2>&1
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        ZIGGIT_TIMES+=($t)
        
        # git log
        start_ns=$(date +%s%N)
        $GIT -C "$BENCH_DIR/git-bare-$repo_name" log --format=%H -1 "$branch" >/dev/null 2>&1
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        GIT_TIMES+=($t)
    done
    
    z_med=$(median "${ZIGGIT_TIMES[@]}")
    g_med=$(median "${GIT_TIMES[@]}")
    
    if [ "$z_med" -gt 0 ]; then
        speedup=$(echo "scale=1; $g_med / $z_med" | bc 2>/dev/null || echo "N/A")
    else
        speedup="inf (ziggit <1ms)"
    fi
    
    echo "  ziggit median: ${z_med}ms | git median: ${g_med}ms | speedup: ${speedup}x"
    echo ""
done

# ============================================================
# SUMMARY
# ============================================================
echo "========== SUMMARY =========="
echo ""

# Compute bun install medians
bun_cold_med=$(median "${BUN_COLD_TIMES[@]}")
bun_warm_med=$(median "${BUN_WARM_TIMES[@]}")
echo "Stock bun install (3 git deps):"
echo "  Cold (no cache): ${bun_cold_med}ms (runs: ${BUN_COLD_TIMES[*]})"
echo "  Warm (cache hit): ${bun_warm_med}ms (runs: ${BUN_WARM_TIMES[*]})"
echo ""
echo "Full results saved to: $RESULTS_FILE"
echo "============================================================"

# Cleanup
rm -rf "$BENCH_DIR"
