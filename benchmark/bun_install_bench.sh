#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: Stock bun vs Ziggit-simulated workflow
# Measures the git operations that bun install performs for git dependencies
set -euo pipefail

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="git"
BUN="/root/.bun/bin/bun"
RESULTS_FILE="/root/bun-fork/BUN_INSTALL_BENCHMARK.md"
BENCH_DIR="/tmp/bench-bun-install"
RUNS=3

# Repos that represent typical bun install git dependencies
declare -A REPOS=(
    [debug]="https://github.com/debug-js/debug.git"
    [semver]="https://github.com/npm/node-semver.git"
    [chalk]="https://github.com/chalk/chalk.git"
    [express]="https://github.com/expressjs/express.git"
    [is]="https://github.com/sindresorhus/is.git"
)

# High-resolution timer (ms)
now_ms() {
    date +%s%3N
}

elapsed_ms() {
    echo $(( $(now_ms) - $1 ))
}

cleanup() {
    rm -rf "$BENCH_DIR"
    mkdir -p "$BENCH_DIR"
}

echo "=== BUN INSTALL BENCHMARK ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Ziggit: $($ZIGGIT --version-info 2>&1 | head -1)"
echo "Git: $($GIT --version)"
echo "Bun: $($BUN --version)"
echo ""

###############################################################################
# SECTION 1: Stock bun install with git dependencies (cold + warm)
###############################################################################
echo "--- Section 1: Stock bun install ---"

BUN_PROJECT="$BENCH_DIR/bun-project"
mkdir -p "$BUN_PROJECT"
cat > "$BUN_PROJECT/package.json" << 'EOF'
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

declare -a BUN_COLD_TIMES=()
declare -a BUN_WARM_TIMES=()

for run in $(seq 1 $RUNS); do
    echo "  bun install cold run $run/$RUNS..."
    rm -rf "$BUN_PROJECT/node_modules" "$BUN_PROJECT/bun.lock"
    rm -rf ~/.bun/install/cache
    sync
    
    start=$(now_ms)
    cd "$BUN_PROJECT" && $BUN install --no-progress 2>&1 | tail -3
    cold_ms=$(elapsed_ms $start)
    BUN_COLD_TIMES+=($cold_ms)
    echo "    cold: ${cold_ms}ms"
    
    # Warm run (cache exists, node_modules removed)
    rm -rf "$BUN_PROJECT/node_modules" "$BUN_PROJECT/bun.lock"
    start=$(now_ms)
    cd "$BUN_PROJECT" && $BUN install --no-progress 2>&1 | tail -3
    warm_ms=$(elapsed_ms $start)
    BUN_WARM_TIMES+=($warm_ms)
    echo "    warm: ${warm_ms}ms"
done

###############################################################################
# SECTION 2: Per-repo git CLI workflow (simulating what bun install does)
###############################################################################
echo ""
echo "--- Section 2: Git CLI workflow (simulating bun install) ---"

# For each repo: clone --bare, rev-parse HEAD, clone local + checkout
declare -A GIT_CLONE_TIMES=()
declare -A GIT_RESOLVE_TIMES=()
declare -A GIT_CHECKOUT_TIMES=()
declare -A GIT_TOTAL_TIMES=()

for name in "${!REPOS[@]}"; do
    url="${REPOS[$name]}"
    total_clone=0; total_resolve=0; total_checkout=0
    
    for run in $(seq 1 $RUNS); do
        bare_dir="$BENCH_DIR/git-bare-$name"
        work_dir="$BENCH_DIR/git-work-$name"
        rm -rf "$bare_dir" "$work_dir"
        
        # Step 1: clone --bare
        start=$(now_ms)
        $GIT clone --bare --quiet "$url" "$bare_dir" 2>&1
        clone_ms=$(elapsed_ms $start)
        total_clone=$((total_clone + clone_ms))
        
        # Step 2: resolve HEAD to commit SHA
        start=$(now_ms)
        sha=$($GIT -C "$bare_dir" rev-parse HEAD 2>&1)
        resolve_ms=$(elapsed_ms $start)
        total_resolve=$((total_resolve + resolve_ms))
        
        # Step 3: local clone + checkout (what bun does for working tree)
        start=$(now_ms)
        $GIT clone --quiet --no-checkout "$bare_dir" "$work_dir" 2>&1
        $GIT -C "$work_dir" checkout --quiet "$sha" 2>&1
        checkout_ms=$(elapsed_ms $start)
        total_checkout=$((total_checkout + checkout_ms))
        
        rm -rf "$bare_dir" "$work_dir"
    done
    
    GIT_CLONE_TIMES[$name]=$((total_clone / RUNS))
    GIT_RESOLVE_TIMES[$name]=$((total_resolve / RUNS))
    GIT_CHECKOUT_TIMES[$name]=$((total_checkout / RUNS))
    GIT_TOTAL_TIMES[$name]=$(( (total_clone + total_resolve + total_checkout) / RUNS ))
    
    echo "  git/$name: clone=${GIT_CLONE_TIMES[$name]}ms resolve=${GIT_RESOLVE_TIMES[$name]}ms checkout=${GIT_CHECKOUT_TIMES[$name]}ms total=${GIT_TOTAL_TIMES[$name]}ms"
done

###############################################################################
# SECTION 3: Ziggit workflow (same operations)
###############################################################################
echo ""
echo "--- Section 3: Ziggit workflow (simulating bun install) ---"

declare -A ZIG_CLONE_TIMES=()
declare -A ZIG_RESOLVE_TIMES=()
declare -A ZIG_CHECKOUT_TIMES=()
declare -A ZIG_TOTAL_TIMES=()

for name in "${!REPOS[@]}"; do
    url="${REPOS[$name]}"
    total_clone=0; total_resolve=0; total_checkout=0
    
    for run in $(seq 1 $RUNS); do
        bare_dir="$BENCH_DIR/zig-bare-$name"
        work_dir="$BENCH_DIR/zig-work-$name"
        rm -rf "$bare_dir" "$work_dir"
        
        # Step 1: clone --bare
        start=$(now_ms)
        $ZIGGIT clone --bare "$url" "$bare_dir" 2>&1
        clone_ms=$(elapsed_ms $start)
        total_clone=$((total_clone + clone_ms))
        
        # Step 2: resolve HEAD to commit SHA
        start=$(now_ms)
        sha=$($ZIGGIT -C "$bare_dir" rev-parse HEAD 2>&1)
        resolve_ms=$(elapsed_ms $start)
        total_resolve=$((total_resolve + resolve_ms))
        
        # Step 3: local clone + checkout
        start=$(now_ms)
        $ZIGGIT clone --no-checkout "$bare_dir" "$work_dir" 2>&1
        $ZIGGIT -C "$work_dir" checkout "$sha" 2>&1
        checkout_ms=$(elapsed_ms $start)
        total_checkout=$((total_checkout + checkout_ms))
        
        rm -rf "$bare_dir" "$work_dir"
    done
    
    ZIG_CLONE_TIMES[$name]=$((total_clone / RUNS))
    ZIG_RESOLVE_TIMES[$name]=$((total_resolve / RUNS))
    ZIG_CHECKOUT_TIMES[$name]=$((total_checkout / RUNS))
    ZIG_TOTAL_TIMES[$name]=$(( (total_clone + total_resolve + total_checkout) / RUNS ))
    
    echo "  ziggit/$name: clone=${ZIG_CLONE_TIMES[$name]}ms resolve=${ZIG_RESOLVE_TIMES[$name]}ms checkout=${ZIG_CHECKOUT_TIMES[$name]}ms total=${ZIG_TOTAL_TIMES[$name]}ms"
done

###############################################################################
# SECTION 4: Generate markdown report
###############################################################################
echo ""
echo "--- Generating report ---"

# Calculate totals
git_total_all=0
zig_total_all=0
for name in "${!REPOS[@]}"; do
    git_total_all=$((git_total_all + ${GIT_TOTAL_TIMES[$name]}))
    zig_total_all=$((zig_total_all + ${ZIG_TOTAL_TIMES[$name]}))
done

# Calculate averages for bun install
bun_cold_avg=0
bun_warm_avg=0
for t in "${BUN_COLD_TIMES[@]}"; do bun_cold_avg=$((bun_cold_avg + t)); done
bun_cold_avg=$((bun_cold_avg / RUNS))
for t in "${BUN_WARM_TIMES[@]}"; do bun_warm_avg=$((bun_warm_avg + t)); done
bun_warm_avg=$((bun_warm_avg / RUNS))

if [ "$zig_total_all" -gt 0 ]; then
    speedup=$(echo "scale=2; $git_total_all / $zig_total_all" | bc 2>/dev/null || echo "N/A")
else
    speedup="inf"
fi

cat > "$RESULTS_FILE" << MARKDOWN
# Bun Install Benchmark: Stock Bun vs Ziggit Integration

**Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**System:** $(uname -srm), $(grep -c ^processor /proc/cpuinfo) CPUs, $(free -h | awk '/Mem:/{print $2}') RAM
**Bun:** $($BUN --version)
**Git:** $($GIT --version | awk '{print $3}')
**Ziggit:** $($ZIGGIT --version-info 2>&1 | head -1)
**Runs per benchmark:** $RUNS (averaged)

## Summary

| Metric | Value |
|--------|-------|
| Stock bun install (cold, 5 git deps) | **${bun_cold_avg}ms** |
| Stock bun install (warm cache) | **${bun_warm_avg}ms** |
| Git CLI workflow total (5 repos) | **${git_total_all}ms** |
| Ziggit workflow total (5 repos) | **${zig_total_all}ms** |
| **Ziggit speedup (git operations)** | **${speedup}x** |

## 1. Stock Bun Install (baseline)

Cold = no cache, no node_modules, no lockfile.
Warm = git cache exists, node_modules + lockfile removed.

| Run | Cold (ms) | Warm (ms) |
|-----|-----------|-----------|
MARKDOWN

for i in $(seq 0 $((RUNS-1))); do
    echo "| $((i+1)) | ${BUN_COLD_TIMES[$i]} | ${BUN_WARM_TIMES[$i]} |" >> "$RESULTS_FILE"
done

cat >> "$RESULTS_FILE" << MARKDOWN
| **Avg** | **${bun_cold_avg}** | **${bun_warm_avg}** |

## 2. Per-Repo Breakdown: Git CLI vs Ziggit

Each row = average of $RUNS runs. Operations mirror what bun install does:
1. **clone --bare** — fetch packfile from remote
2. **resolve** — rev-parse HEAD to commit SHA
3. **checkout** — local clone + checkout working tree

### Git CLI

| Repo | Clone (ms) | Resolve (ms) | Checkout (ms) | Total (ms) |
|------|-----------|-------------|--------------|-----------|
MARKDOWN

for name in "${!REPOS[@]}"; do
    echo "| $name | ${GIT_CLONE_TIMES[$name]} | ${GIT_RESOLVE_TIMES[$name]} | ${GIT_CHECKOUT_TIMES[$name]} | ${GIT_TOTAL_TIMES[$name]} |" >> "$RESULTS_FILE"
done
echo "| **Total** | | | | **${git_total_all}** |" >> "$RESULTS_FILE"

cat >> "$RESULTS_FILE" << MARKDOWN

### Ziggit

| Repo | Clone (ms) | Resolve (ms) | Checkout (ms) | Total (ms) |
|------|-----------|-------------|--------------|-----------|
MARKDOWN

for name in "${!REPOS[@]}"; do
    echo "| $name | ${ZIG_CLONE_TIMES[$name]} | ${ZIG_RESOLVE_TIMES[$name]} | ${ZIG_CHECKOUT_TIMES[$name]} | ${ZIG_TOTAL_TIMES[$name]} |" >> "$RESULTS_FILE"
done
echo "| **Total** | | | | **${zig_total_all}** |" >> "$RESULTS_FILE"

cat >> "$RESULTS_FILE" << MARKDOWN

### Per-Repo Speedup

| Repo | Git (ms) | Ziggit (ms) | Speedup |
|------|---------|------------|---------|
MARKDOWN

for name in "${!REPOS[@]}"; do
    gt=${GIT_TOTAL_TIMES[$name]}
    zt=${ZIG_TOTAL_TIMES[$name]}
    if [ "$zt" -gt 0 ]; then
        sp=$(echo "scale=2; $gt / $zt" | bc 2>/dev/null || echo "N/A")
    else
        sp="inf"
    fi
    echo "| $name | $gt | $zt | ${sp}x |" >> "$RESULTS_FILE"
done

cat >> "$RESULTS_FILE" << MARKDOWN

## 3. What This Means for Bun Install

The bun fork ([build.zig.zon](build.zig.zon)) integrates ziggit as a native Zig dependency.
In \`src/install/repository.zig\`, every git operation tries ziggit first and falls back to
git CLI on failure. The three operations benchmarked above (\`cloneBare\`, \`findCommit\`,
\`checkout\`) are the exact same calls made during \`bun install\` for each git dependency.

### Projected impact on bun install

Stock bun install (cold) spends roughly **${git_total_all}ms** on git operations for 5 deps.
With ziggit, that drops to **${zig_total_all}ms** — a **${speedup}x** improvement on the git
operation portion.

The remaining bun install time covers:
- Dependency resolution & lockfile generation
- npm registry fetches (for transitive deps)
- node_modules linking

### Building the bun fork

The full bun binary cannot be built on this VM (483MB RAM, 2.4GB disk). A production
build requires:

\`\`\`bash
# Requirements: ≥8GB RAM, ≥20GB disk, zig 0.15.x
cd /root/bun-fork
zig build -Doptimize=ReleaseFast  # ~15-30 min on 8-core
\`\`\`

Once built, the fork binary would show the ziggit speedup directly in \`bun install\` times
with no benchmark script needed — it's the default code path.

## 4. Raw Data

\`\`\`
bun_cold_times=(${BUN_COLD_TIMES[*]})
bun_warm_times=(${BUN_WARM_TIMES[*]})
MARKDOWN

for name in "${!REPOS[@]}"; do
    echo "git_${name}=(clone=${GIT_CLONE_TIMES[$name]} resolve=${GIT_RESOLVE_TIMES[$name]} checkout=${GIT_CHECKOUT_TIMES[$name]} total=${GIT_TOTAL_TIMES[$name]})" >> "$RESULTS_FILE"
    echo "zig_${name}=(clone=${ZIG_CLONE_TIMES[$name]} resolve=${ZIG_RESOLVE_TIMES[$name]} checkout=${ZIG_CHECKOUT_TIMES[$name]} total=${ZIG_TOTAL_TIMES[$name]})" >> "$RESULTS_FILE"
done

echo '```' >> "$RESULTS_FILE"

echo ""
echo "=== BENCHMARK COMPLETE ==="
echo "Results: $RESULTS_FILE"
echo "Ziggit speedup: ${speedup}x"
