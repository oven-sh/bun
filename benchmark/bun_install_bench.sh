#!/usr/bin/env bash
set -euo pipefail

# Bun Install Benchmark: ziggit vs git CLI
# Session 12 — 2026-03-27
#
# Measures:
#   1. Stock bun install (cold + warm) for 5 git dependencies
#   2. Per-repo: git CLI clone workflow vs ziggit clone workflow (3 runs each)

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
BUN="/root/.bun/bin/bun"
BENCH_DIR="/tmp/bench-session12"
RESULTS_FILE="/tmp/bench-session12/results.txt"

REPOS=(
  "debug|https://github.com/debug-js/debug.git"
  "semver|https://github.com/npm/node-semver.git"
  "ms|https://github.com/vercel/ms.git"
  "chalk|https://github.com/chalk/chalk.git"
  "express|https://github.com/expressjs/express.git"
)

NUM_RUNS=3

rm -rf "$BENCH_DIR"
mkdir -p "$BENCH_DIR"
echo "=== Bun Install Benchmark Session 12 ===" | tee "$RESULTS_FILE"
echo "Date: $(date -u +%Y-%m-%dT%H:%MZ)" | tee -a "$RESULTS_FILE"
echo "Ziggit: $($ZIGGIT version 2>/dev/null || echo 'n/a')" | tee -a "$RESULTS_FILE"
echo "Git: $($GIT --version)" | tee -a "$RESULTS_FILE"
echo "Bun: $($BUN --version)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# --- Part 1: Stock bun install ---
echo "=== PART 1: Stock Bun Install ===" | tee -a "$RESULTS_FILE"

BUN_PROJECT="$BENCH_DIR/bun-project"
mkdir -p "$BUN_PROJECT"
cat > "$BUN_PROJECT/package.json" <<'EOF'
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

# Cold runs
echo "--- Cold cache runs ---" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $NUM_RUNS); do
  rm -rf "$BUN_PROJECT/node_modules" "$BUN_PROJECT/bun.lock" ~/.bun/install/cache 2>/dev/null || true
  cd "$BUN_PROJECT"
  start_ms=$(($(date +%s%N)/1000000))
  $BUN install --no-progress 2>&1 || true
  end_ms=$(($(date +%s%N)/1000000))
  elapsed=$((end_ms - start_ms))
  echo "  Cold run $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
done

# Warm runs (keep cache + lockfile)
echo "--- Warm cache runs ---" | tee -a "$RESULTS_FILE"
for i in $(seq 1 $NUM_RUNS); do
  rm -rf "$BUN_PROJECT/node_modules" 2>/dev/null || true
  cd "$BUN_PROJECT"
  start_ms=$(($(date +%s%N)/1000000))
  $BUN install --no-progress 2>&1 || true
  end_ms=$(($(date +%s%N)/1000000))
  elapsed=$((end_ms - start_ms))
  echo "  Warm run $i: ${elapsed}ms" | tee -a "$RESULTS_FILE"
done

echo "" | tee -a "$RESULTS_FILE"

# --- Part 2: Per-repo git CLI vs ziggit ---
echo "=== PART 2: Per-Repo Clone Workflow ===" | tee -a "$RESULTS_FILE"

time_ms() {
  local start end
  start=$(($(date +%s%N)/1000000))
  "$@" >/dev/null 2>&1
  end=$(($(date +%s%N)/1000000))
  echo $((end - start))
}

for entry in "${REPOS[@]}"; do
  IFS='|' read -r name url <<< "$entry"
  echo "" | tee -a "$RESULTS_FILE"
  echo "=== $name ($url) ===" | tee -a "$RESULTS_FILE"

  for run in $(seq 1 $NUM_RUNS); do
    # --- git CLI workflow ---
    bare_dir="$BENCH_DIR/git-bare-${name}-${run}"
    work_dir="$BENCH_DIR/git-work-${name}-${run}"
    rm -rf "$bare_dir" "$work_dir"

    clone_t=$(time_ms $GIT clone --bare --quiet "$url" "$bare_dir")
    resolve_start=$(($(date +%s%N)/1000000))
    sha=$($GIT -C "$bare_dir" rev-parse HEAD 2>/dev/null || echo "unknown")
    resolve_end=$(($(date +%s%N)/1000000))
    resolve_t=$((resolve_end - resolve_start))
    checkout_t=$(time_ms $GIT clone --quiet "$bare_dir" "$work_dir")
    total=$((clone_t + resolve_t + checkout_t))
    echo "  git    $run: clone=${clone_t} resolve=${resolve_t} checkout=${checkout_t} total=${total}ms" | tee -a "$RESULTS_FILE"

    # --- ziggit workflow ---
    zbare_dir="$BENCH_DIR/zig-bare-${name}-${run}"
    zwork_dir="$BENCH_DIR/zig-work-${name}-${run}"
    rm -rf "$zbare_dir" "$zwork_dir"

    zclone_t=$(time_ms $ZIGGIT clone --bare "$url" "$zbare_dir")
    zresolve_start=$(($(date +%s%N)/1000000))
    zsha=$($ZIGGIT rev-parse HEAD 2>/dev/null || echo "unknown")
    zresolve_end=$(($(date +%s%N)/1000000))
    zresolve_t=$((zresolve_end - zresolve_start))
    # Use ziggit clone from bare for checkout
    zcheckout_t=$(time_ms $ZIGGIT clone "$zbare_dir" "$zwork_dir")
    ztotal=$((zclone_t + zresolve_t + zcheckout_t))
    echo "  ziggit $run: clone=${zclone_t} resolve=${zresolve_t} checkout=${zcheckout_t} total=${ztotal}ms" | tee -a "$RESULTS_FILE"
  done
done

echo "" | tee -a "$RESULTS_FILE"
echo "=== BENCHMARK COMPLETE ===" | tee -a "$RESULTS_FILE"
echo "Results saved to: $RESULTS_FILE"
