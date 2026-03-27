#!/bin/bash
# bun install end-to-end benchmark: stock bun vs ziggit-simulated workflow
# Usage: bash bun_install_bench.sh [--ziggit-path /path/to/ziggit/bin]
set -e

ZIGGIT="${ZIGGIT:-/root/ziggit/zig-out/bin/ziggit}"
GIT="/usr/bin/git"
BUN="${BUN:-/root/.bun/bin/bun}"
RUNS=3

REPOS=(
  "https://github.com/sindresorhus/is.git|is"
  "https://github.com/expressjs/express.git|express"
  "https://github.com/chalk/chalk.git|chalk"
  "https://github.com/debug-js/debug.git|debug"
  "https://github.com/npm/node-semver.git|semver"
)

WORKDIR="/tmp/bench-git-workflow"
BENCH_PROJECT="/tmp/bench-project"

now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

# ── Section 1: Stock bun install ──────────────────────────────

bench_bun_install() {
    local mode="$1"  # cold or warm
    mkdir -p "$BENCH_PROJECT"
    cat > "$BENCH_PROJECT/package.json" << 'PKGJSON'
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
    cd "$BENCH_PROJECT"
    if [ "$mode" = "cold" ]; then
        rm -rf node_modules bun.lock ~/.bun/install/cache
    else
        rm -rf node_modules bun.lock
    fi
    local start=$(now_ms)
    $BUN install --no-save 2>&1 | grep "packages installed" || true
    local end=$(now_ms)
    echo "$((end - start))"
}

# ── Section 2: Full bun-install workflow simulation ───────────
# Simulates: clone --bare --depth=1 + rev-parse HEAD + ls-tree -r + cat-file ALL blobs

bench_full_workflow() {
    local tool="$1"
    local tool_name="$2"
    local run_label="$3"
    local base_dir="$WORKDIR/${tool_name}-${run_label}"

    rm -rf "$base_dir"
    mkdir -p "$base_dir"

    local total_start=$(now_ms)
    for entry in "${REPOS[@]}"; do
        IFS='|' read -r url name <<< "$entry"
        local bare_dir="$base_dir/${name}.git"

        local start=$(now_ms)
        $tool clone --bare --depth=1 "$url" "$bare_dir" 2>/dev/null
        local clone_end=$(now_ms)

        $tool -C "$bare_dir" rev-parse HEAD > /dev/null 2>&1
        local resolve_end=$(now_ms)

        local tree_output=$($tool -C "$bare_dir" ls-tree -r HEAD 2>/dev/null)
        local lt_end=$(now_ms)

        local blobs=$(echo "$tree_output" | awk '{print $3}')
        local blob_count=0
        for blob in $blobs; do
            $tool -C "$bare_dir" cat-file blob "$blob" > /dev/null 2>&1
            blob_count=$((blob_count+1))
        done
        local cf_end=$(now_ms)

        echo "  $name (${blob_count} files): clone=$((clone_end-start))ms resolve=$((resolve_end-clone_end))ms ls-tree=$((lt_end-resolve_end))ms cat-file=$((cf_end-lt_end))ms total=$((cf_end-start))ms"
    done
    local total_end=$(now_ms)
    echo "  TOTAL: $((total_end-total_start))ms"
}

# ── Section 3: Clone-only benchmark ──────────────────────────

bench_clone_only() {
    local tool="$1"
    local tool_name="$2"
    local run_label="$3"
    local base_dir="$WORKDIR/${tool_name}-clone-${run_label}"

    rm -rf "$base_dir"
    mkdir -p "$base_dir"

    local total_start=$(now_ms)
    for entry in "${REPOS[@]}"; do
        IFS='|' read -r url name <<< "$entry"
        local bare_dir="$base_dir/${name}.git"

        local start=$(now_ms)
        $tool clone --bare --depth=1 "$url" "$bare_dir" 2>/dev/null
        local end=$(now_ms)
        echo "  $name: $((end-start))ms"
    done
    local total_end=$(now_ms)
    echo "  TOTAL: $((total_end-total_start))ms"
}

# ── Main ──────────────────────────────────────────────────────

echo "============================================"
echo "  bun install End-to-End Benchmark"
echo "  Stock bun + Git CLI vs Ziggit"
echo "  $(date)"
echo "  VM: $(free -h | awk '/Mem:/{print $2}') RAM, $(nproc) CPUs"
echo "  bun: $($BUN --version)"
echo "  git: $($GIT --version)"
echo "  ziggit: $($ZIGGIT --version 2>&1)"
echo "============================================"
echo ""

echo "═══ Section 1: Stock bun install (cold cache) ═══"
for run in $(seq 1 $RUNS); do
    ms=$(bench_bun_install cold)
    echo "  Run $run: ${ms}ms"
done

echo ""
echo "═══ Section 2: Stock bun install (warm cache) ═══"
bench_bun_install cold > /dev/null 2>&1  # prime cache
for run in $(seq 1 $RUNS); do
    ms=$(bench_bun_install warm)
    echo "  Run $run: ${ms}ms"
done

echo ""
echo "═══ Section 3: Clone-only benchmark ═══"
for run in $(seq 1 $RUNS); do
    echo ""
    echo "--- Run $run: git CLI ---"
    bench_clone_only "$GIT" "git" "run$run"
    echo "--- Run $run: ziggit ---"
    bench_clone_only "$ZIGGIT" "ziggit" "run$run"
done

echo ""
echo "═══ Section 4: Full workflow simulation (clone + resolve + extract ALL files) ═══"
for run in $(seq 1 $RUNS); do
    echo ""
    echo "--- Run $run: git CLI ---"
    bench_full_workflow "$GIT" "git" "run$run"
    echo "--- Run $run: ziggit ---"
    bench_full_workflow "$ZIGGIT" "ziggit" "run$run"
done

echo ""
echo "═══ Section 5: Process spawn overhead ═══"
for tool_info in "$GIT|git" "$ZIGGIT|ziggit"; do
    IFS='|' read -r tool name <<< "$tool_info"
    total=0
    for i in $(seq 1 20); do
        start=$(date +%s%N)
        $tool --version > /dev/null 2>&1
        end=$(date +%s%N)
        total=$((total + (end - start) / 1000000))
    done
    avg=$((total / 20))
    echo "  $name --version avg spawn: ${avg}ms (20 iterations)"
done

echo ""
echo "Benchmark complete."
