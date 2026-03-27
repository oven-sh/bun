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
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
RAW_FILE="/root/bun-fork/benchmark/raw_results_${TIMESTAMP}.txt"

# 5 repos matching the task specification
declare -a REPO_NAMES=(debug semver ms express chalk)

declare -A REPOS
REPOS[debug]="https://github.com/debug-js/debug.git"
REPOS[semver]="https://github.com/npm/node-semver.git"
REPOS[ms]="https://github.com/vercel/ms.git"
REPOS[express]="https://github.com/expressjs/express.git"
REPOS[chalk]="https://github.com/chalk/chalk.git"

declare -A BRANCHES
BRANCHES[debug]="master"
BRANCHES[semver]="main"
BRANCHES[ms]="main"
BRANCHES[express]="master"
BRANCHES[chalk]="main"

# Tee output to raw file and stdout
exec > >(tee "$RAW_FILE") 2>&1

echo "============================================================"
echo "BUN INSTALL GIT DEPENDENCY BENCHMARK"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Runs per test: $NUM_RUNS"
echo "ziggit: $ZIGGIT ($(cd /root/ziggit && git rev-parse --short HEAD))"
echo "git:    $GIT ($($GIT --version))"
echo "bun:    $(/root/.bun/bin/bun --version)"
echo "Repos:  ${REPO_NAMES[*]}"
echo "============================================================"
echo ""

time_ms() {
    local start end
    start=$(date +%s%N)
    "$@" >/dev/null 2>&1
    local rc=$?
    end=$(date +%s%N)
    echo $(( (end - start) / 1000000 ))
    return $rc
}

median() {
    local arr=("$@")
    local sorted=($(printf '%s\n' "${arr[@]}" | sort -n))
    local mid=$((${#sorted[@]} / 2))
    echo "${sorted[$mid]}"
}

# ============================================================
# PART 1: Stock bun install benchmarks (5 git deps)
# ============================================================
echo "========== PART 1: Stock bun install (5 git deps) =========="
echo ""

BUN="/root/.bun/bin/bun"
BUN_PROJECT="/tmp/bench-project"
mkdir -p "$BUN_PROJECT"
cat > "$BUN_PROJECT/package.json" << 'PKGJSON'
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

bun_cold_med=$(median "${BUN_COLD_TIMES[@]}")
bun_warm_med=$(median "${BUN_WARM_TIMES[@]}")

echo ""
echo "Cold median: ${bun_cold_med}ms  |  Warm median: ${bun_warm_med}ms"
echo ""

# ============================================================
# PART 2: Per-repo ziggit vs git CLI (clone workflow)
# ============================================================
echo "========== PART 2: Per-repo clone workflow (ziggit vs git CLI) =========="
echo ""

# Declare result arrays
declare -A ALL_ZIGGIT_CLONE_MED ALL_ZIGGIT_RESOLVE_MED ALL_ZIGGIT_CHECKOUT_MED ALL_ZIGGIT_TOTAL_MED
declare -A ALL_GIT_CLONE_MED ALL_GIT_RESOLVE_MED ALL_GIT_CHECKOUT_MED ALL_GIT_TOTAL_MED

for repo_name in "${REPO_NAMES[@]}"; do
    url="${REPOS[$repo_name]}"
    branch="${BRANCHES[$repo_name]}"
    echo "--- $repo_name ($url, branch=$branch) ---"
    
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
        
        t1=$(time_ms $ZIGGIT clone --bare "$url" "$BENCH_DIR/ziggit-bare-$repo_name")
        ZIGGIT_CLONE+=($t1)
        
        start_ns=$(date +%s%N)
        sha=$(cd "$BENCH_DIR/ziggit-bare-$repo_name" && $ZIGGIT rev-parse "$branch" 2>/dev/null)
        end_ns=$(date +%s%N)
        t2=$(( (end_ns - start_ns) / 1000000 ))
        ZIGGIT_RESOLVE+=($t2)
        
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
        
        t1=$(time_ms $GIT clone -c core.longpaths=true --quiet --bare "$url" "$BENCH_DIR/git-bare-$repo_name")
        GIT_CLONE+=($t1)
        
        start_ns=$(date +%s%N)
        sha_git=$($GIT -C "$BENCH_DIR/git-bare-$repo_name" log --format=%H -1 "$branch" 2>/dev/null)
        end_ns=$(date +%s%N)
        t2=$(( (end_ns - start_ns) / 1000000 ))
        GIT_RESOLVE+=($t2)
        
        start_ns=$(date +%s%N)
        $GIT clone -c core.longpaths=true --quiet --no-checkout "$BENCH_DIR/git-bare-$repo_name" "$BENCH_DIR/git-wt-$repo_name" >/dev/null 2>&1
        $GIT -C "$BENCH_DIR/git-wt-$repo_name" checkout --quiet "$sha_git" >/dev/null 2>&1
        end_ns=$(date +%s%N)
        t3=$(( (end_ns - start_ns) / 1000000 ))
        GIT_CHECKOUT+=($t3)
        
        total=$((t1 + t2 + t3))
        GIT_TOTAL+=($total)
        
        echo "  Run $i: ziggit=${ZIGGIT_TOTAL[-1]}ms (c:${ZIGGIT_CLONE[-1]} r:${ZIGGIT_RESOLVE[-1]} co:${ZIGGIT_CHECKOUT[-1]}) | git=${GIT_TOTAL[-1]}ms (c:${GIT_CLONE[-1]} r:${GIT_RESOLVE[-1]} co:${GIT_CHECKOUT[-1]})"
    done
    
    z_clone_med=$(median "${ZIGGIT_CLONE[@]}")
    z_resolve_med=$(median "${ZIGGIT_RESOLVE[@]}")
    z_checkout_med=$(median "${ZIGGIT_CHECKOUT[@]}")
    z_total_med=$(median "${ZIGGIT_TOTAL[@]}")
    g_clone_med=$(median "${GIT_CLONE[@]}")
    g_resolve_med=$(median "${GIT_RESOLVE[@]}")
    g_checkout_med=$(median "${GIT_CHECKOUT[@]}")
    g_total_med=$(median "${GIT_TOTAL[@]}")
    
    ALL_ZIGGIT_CLONE_MED[$repo_name]=$z_clone_med
    ALL_ZIGGIT_RESOLVE_MED[$repo_name]=$z_resolve_med
    ALL_ZIGGIT_CHECKOUT_MED[$repo_name]=$z_checkout_med
    ALL_ZIGGIT_TOTAL_MED[$repo_name]=$z_total_med
    ALL_GIT_CLONE_MED[$repo_name]=$g_clone_med
    ALL_GIT_RESOLVE_MED[$repo_name]=$g_resolve_med
    ALL_GIT_CHECKOUT_MED[$repo_name]=$g_checkout_med
    ALL_GIT_TOTAL_MED[$repo_name]=$g_total_med
    
    echo "  MEDIAN: ziggit=${z_total_med}ms | git=${g_total_med}ms"
    echo ""
done

# ============================================================
# PART 3: Fetch (warm bare repo) benchmark
# ============================================================
echo "========== PART 3: Fetch (warm bare repo) =========="
echo ""

declare -A ALL_ZIGGIT_FETCH_MED ALL_GIT_FETCH_MED

for repo_name in "${REPO_NAMES[@]}"; do
    url="${REPOS[$repo_name]}"
    echo "--- $repo_name ---"
    
    ZIGGIT_FETCH=()
    GIT_FETCH=()
    
    for i in $(seq 1 $NUM_RUNS); do
        start_ns=$(date +%s%N)
        cd "$BENCH_DIR/ziggit-bare-$repo_name" && $ZIGGIT fetch >/dev/null 2>&1 || true
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        ZIGGIT_FETCH+=($t)
        
        start_ns=$(date +%s%N)
        $GIT -C "$BENCH_DIR/git-bare-$repo_name" fetch --quiet >/dev/null 2>&1 || true
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        GIT_FETCH+=($t)
        
        echo "  Run $i: ziggit=${ZIGGIT_FETCH[-1]}ms | git=${GIT_FETCH[-1]}ms"
    done
    
    z_med=$(median "${ZIGGIT_FETCH[@]}")
    g_med=$(median "${GIT_FETCH[@]}")
    ALL_ZIGGIT_FETCH_MED[$repo_name]=$z_med
    ALL_GIT_FETCH_MED[$repo_name]=$g_med
    echo "  MEDIAN: ziggit=${z_med}ms | git=${g_med}ms"
    echo ""
done

# ============================================================
# PART 4: findCommit microbenchmark (10 runs)
# ============================================================
echo "========== PART 4: findCommit (rev-parse) microbenchmark =========="
echo ""

MICRO_RUNS=10
for repo_name in "${REPO_NAMES[@]}"; do
    branch="${BRANCHES[$repo_name]}"
    echo "--- $repo_name ($MICRO_RUNS runs) ---"
    
    ZIGGIT_TIMES=()
    GIT_TIMES=()
    
    for i in $(seq 1 $MICRO_RUNS); do
        start_ns=$(date +%s%N)
        cd "$BENCH_DIR/ziggit-bare-$repo_name" && $ZIGGIT rev-parse "$branch" >/dev/null 2>&1
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        ZIGGIT_TIMES+=($t)
        
        start_ns=$(date +%s%N)
        $GIT -C "$BENCH_DIR/git-bare-$repo_name" log --format=%H -1 "$branch" >/dev/null 2>&1
        end_ns=$(date +%s%N)
        t=$(( (end_ns - start_ns) / 1000000 ))
        GIT_TIMES+=($t)
    done
    
    z_med=$(median "${ZIGGIT_TIMES[@]}")
    g_med=$(median "${GIT_TIMES[@]}")
    echo "  ziggit median: ${z_med}ms | git median: ${g_med}ms"
    echo ""
done

# ============================================================
# SUMMARY
# ============================================================
echo "========== FINAL SUMMARY =========="
echo ""
echo "Stock bun install (5 git deps):"
echo "  Cold: ${bun_cold_med}ms (runs: ${BUN_COLD_TIMES[*]})"
echo "  Warm: ${bun_warm_med}ms (runs: ${BUN_WARM_TIMES[*]})"
echo ""

z_total_all=0
g_total_all=0
echo "Per-repo clone workflow (medians):"
printf "  %-10s  %8s  %8s  %8s\n" "Repo" "ziggit" "git" "speedup"
for repo_name in "${REPO_NAMES[@]}"; do
    zt=${ALL_ZIGGIT_TOTAL_MED[$repo_name]}
    gt=${ALL_GIT_TOTAL_MED[$repo_name]}
    z_total_all=$((z_total_all + zt))
    g_total_all=$((g_total_all + gt))
    if [ "$zt" -gt 0 ]; then
        speedup=$(echo "scale=2; $gt / $zt" | bc 2>/dev/null || echo "N/A")
    else
        speedup="inf"
    fi
    printf "  %-10s  %6dms  %6dms  %5sx\n" "$repo_name" "$zt" "$gt" "$speedup"
done
savings=$((g_total_all - z_total_all))
if [ "$z_total_all" -gt 0 ]; then
    pct=$(echo "scale=0; $savings * 100 / $g_total_all" | bc 2>/dev/null || echo "?")
else
    pct="?"
fi
printf "  %-10s  %6dms  %6dms  savings: %dms (%s%%)\n" "TOTAL" "$z_total_all" "$g_total_all" "$savings" "$pct"
echo ""

echo "Fetch (warm, medians):"
for repo_name in "${REPO_NAMES[@]}"; do
    printf "  %-10s  ziggit: %dms  git: %dms\n" "$repo_name" "${ALL_ZIGGIT_FETCH_MED[$repo_name]}" "${ALL_GIT_FETCH_MED[$repo_name]}"
done
echo ""
echo "============================================================"
echo "Raw data saved to: $RAW_FILE"

# Cleanup bench dir
rm -rf "$BENCH_DIR"
