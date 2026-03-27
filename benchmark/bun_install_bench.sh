#!/bin/bash
# bun install end-to-end benchmark: stock bun vs ziggit-simulated workflow
# Usage: bash bun_install_bench.sh [--ziggit-path /path/to/ziggit/bin]
set -e

ZIGGIT="${1:-/root/ziggit/zig-out/bin/ziggit}"
GIT="/usr/bin/git"
BUN="${BUN:-/root/.bun/bin/bun}"
RUNS=3

REPOS=(
  "https://github.com/sindresorhus/is.git"
  "https://github.com/expressjs/express.git"
  "https://github.com/chalk/chalk.git"
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
)
NAMES=("is" "express" "chalk" "debug" "semver")

WORKDIR="/tmp/bench-git-workflow"
BENCH_PROJECT="/tmp/bench-project"

now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

# ── Section 1: Stock bun install ──────────────────────────────

bench_bun_install() {
    local mode="$1"  # cold or warm
    mkdir -p "$BENCH_PROJECT"
    cat > "$BENCH_PROJECT/package.json" << 'EOF'
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
    cd "$BENCH_PROJECT"
    if [ "$mode" = "cold" ]; then
        rm -rf node_modules bun.lock ~/.bun/install/cache
    else
        rm -rf node_modules bun.lock
    fi
    local start=$(now_ms)
    $BUN install --no-save 2>&1
    local end=$(now_ms)
    echo "$((end - start))"
}

# ── Section 2: Git dep workflow simulation ────────────────────

bench_tool_workflow() {
    local tool="$1"
    local tool_name="$2"
    local run_label="$3"
    local base_dir="$WORKDIR/${tool_name}-${run_label}"

    rm -rf "$base_dir"
    mkdir -p "$base_dir"

    local total_start=$(now_ms)
    for i in "${!REPOS[@]}"; do
        local repo="${REPOS[$i]}"
        local name="${NAMES[$i]}"
        local bare_dir="$base_dir/${name}.git"

        local start=$(now_ms)
        $tool clone --bare --depth=1 "$repo" "$bare_dir" 2>/dev/null
        local clone_end=$(now_ms)

        $tool -C "$bare_dir" rev-parse HEAD > /dev/null 2>&1
        local resolve_end=$(now_ms)

        $tool -C "$bare_dir" ls-tree -r HEAD > /dev/null 2>&1
        local lstree_end=$(now_ms)

        local blobs=$($tool -C "$bare_dir" ls-tree -r HEAD 2>/dev/null | awk '{print $3}' | head -50)
        for blob in $blobs; do
            $tool -C "$bare_dir" cat-file blob "$blob" > /dev/null 2>&1
        done
        local catfile_end=$(now_ms)

        echo "  $name: clone=$((clone_end-start))ms resolve=$((resolve_end-clone_end))ms ls-tree=$((lstree_end-resolve_end))ms cat-file=$((catfile_end-lstree_end))ms total=$((catfile_end-start))ms"
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

echo "── Stock bun install (cold cache) ──"
for run in $(seq 1 $RUNS); do
    ms=$(bench_bun_install cold)
    echo "  Run $run: ${ms}ms"
done

echo ""
echo "── Stock bun install (warm cache) ──"
# Prime cache
bench_bun_install cold > /dev/null 2>&1
for run in $(seq 1 $RUNS); do
    ms=$(bench_bun_install warm)
    echo "  Run $run: ${ms}ms"
done

echo ""
echo "── Git dep workflow: git CLI vs ziggit ──"
for run in $(seq 1 $RUNS); do
    echo ""
    echo "--- Run $run ---"
    bench_tool_workflow "$GIT" "git" "run$run"
    echo ""
    bench_tool_workflow "$ZIGGIT" "ziggit" "run$run"
done
