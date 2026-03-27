#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Bun Install Benchmark: Stock Bun vs Ziggit-Simulated Workflow
# ============================================================================
# This script benchmarks:
#   1. Stock bun install with git dependencies (cold + warm cache)
#   2. The exact 3-step git workflow bun uses per git dep:
#      clone --bare → findCommit (rev-parse) → checkout (archive/extract)
#   Comparing: git CLI vs ziggit
# ============================================================================

BUN="/root/.bun/bin/bun"
GIT_CLI="/usr/bin/git"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
BENCH_DIR="/tmp/bun-install-bench-$$"
RESULTS_FILE="/tmp/bench-results-$$.txt"
RUNS=3

# Test repos (what bun install resolves for github: specifiers)
REPOS=(
  "debug-js/debug"
  "npm/node-semver"
  "vercel/ms"
  "chalk/chalk"
  "expressjs/express"
)
REPO_NAMES=(debug semver ms chalk express)

mkdir -p "$BENCH_DIR"
> "$RESULTS_FILE"

log() { echo "[bench] $*" >&2; }
now_ms() { date +%s%3N; }

# ============================================================================
# PART 1: Stock Bun Install
# ============================================================================
log "=== PART 1: Stock bun install ==="

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

for i in $(seq 1 $RUNS); do
  log "Cold run $i/$RUNS ..."
  rm -rf "$BUN_PROJECT/node_modules" "$BUN_PROJECT/bun.lock" ~/.bun/install/cache 2>/dev/null || true
  start=$(now_ms)
  (cd "$BUN_PROJECT" && "$BUN" install --no-progress 2>&1) > /dev/null
  end=$(now_ms)
  elapsed=$((end - start))
  BUN_COLD_TIMES+=($elapsed)
  log "  Cold: ${elapsed}ms"
done

for i in $(seq 1 $RUNS); do
  log "Warm run $i/$RUNS ..."
  rm -rf "$BUN_PROJECT/node_modules" 2>/dev/null || true
  start=$(now_ms)
  (cd "$BUN_PROJECT" && "$BUN" install --no-progress 2>&1) > /dev/null
  end=$(now_ms)
  elapsed=$((end - start))
  BUN_WARM_TIMES+=($elapsed)
  log "  Warm: ${elapsed}ms"
done

echo "BUN_COLD: ${BUN_COLD_TIMES[*]}" >> "$RESULTS_FILE"
echo "BUN_WARM: ${BUN_WARM_TIMES[*]}" >> "$RESULTS_FILE"

# ============================================================================
# PART 2: Per-repo git CLI workflow (clone --bare + rev-parse + archive)
# ============================================================================
log "=== PART 2: Git CLI per-repo workflow ==="

declare -A GIT_CLONE_TIMES
declare -A GIT_RESOLVE_TIMES
declare -A GIT_CHECKOUT_TIMES
declare -A GIT_TOTAL_TIMES

for idx in "${!REPOS[@]}"; do
  repo="${REPOS[$idx]}"
  name="${REPO_NAMES[$idx]}"
  url="https://github.com/${repo}.git"

  declare -a clone_runs=()
  declare -a resolve_runs=()
  declare -a checkout_runs=()
  declare -a total_runs=()

  for i in $(seq 1 $RUNS); do
    workdir="$BENCH_DIR/git-${name}-run${i}"
    rm -rf "$workdir"
    mkdir -p "$workdir"

    # Step 1: clone --bare
    t0=$(now_ms)
    "$GIT_CLI" clone --bare --depth=1 "$url" "$workdir/repo.git" 2>/dev/null
    t1=$(now_ms)

    # Step 2: resolve HEAD to SHA
    sha=$("$GIT_CLI" -C "$workdir/repo.git" rev-parse HEAD 2>/dev/null)
    t2=$(now_ms)

    # Step 3: checkout (archive + extract)
    mkdir -p "$workdir/checkout"
    "$GIT_CLI" -C "$workdir/repo.git" archive HEAD | tar -xC "$workdir/checkout" 2>/dev/null
    t3=$(now_ms)

    clone_ms=$((t1 - t0))
    resolve_ms=$((t2 - t1))
    checkout_ms=$((t3 - t2))
    total_ms=$((t3 - t0))

    clone_runs+=($clone_ms)
    resolve_runs+=($resolve_ms)
    checkout_runs+=($checkout_ms)
    total_runs+=($total_ms)

    log "  git $name run$i: clone=${clone_ms}ms resolve=${resolve_ms}ms checkout=${checkout_ms}ms total=${total_ms}ms"

    rm -rf "$workdir"
  done

  GIT_CLONE_TIMES[$name]="${clone_runs[*]}"
  GIT_RESOLVE_TIMES[$name]="${resolve_runs[*]}"
  GIT_CHECKOUT_TIMES[$name]="${checkout_runs[*]}"
  GIT_TOTAL_TIMES[$name]="${total_runs[*]}"

  echo "GIT_${name}_CLONE: ${clone_runs[*]}" >> "$RESULTS_FILE"
  echo "GIT_${name}_RESOLVE: ${resolve_runs[*]}" >> "$RESULTS_FILE"
  echo "GIT_${name}_CHECKOUT: ${checkout_runs[*]}" >> "$RESULTS_FILE"
  echo "GIT_${name}_TOTAL: ${total_runs[*]}" >> "$RESULTS_FILE"
done

# ============================================================================
# PART 3: Per-repo ziggit workflow (clone --bare + rev-parse + archive)
# ============================================================================
log "=== PART 3: Ziggit per-repo workflow ==="

declare -A ZIG_CLONE_TIMES
declare -A ZIG_RESOLVE_TIMES
declare -A ZIG_CHECKOUT_TIMES
declare -A ZIG_TOTAL_TIMES

for idx in "${!REPOS[@]}"; do
  repo="${REPOS[$idx]}"
  name="${REPO_NAMES[$idx]}"
  url="https://github.com/${repo}.git"

  declare -a clone_runs=()
  declare -a resolve_runs=()
  declare -a checkout_runs=()
  declare -a total_runs=()

  for i in $(seq 1 $RUNS); do
    workdir="$BENCH_DIR/zig-${name}-run${i}"
    rm -rf "$workdir"
    mkdir -p "$workdir"

    # Step 1: clone --bare
    t0=$(now_ms)
    "$ZIGGIT" clone --bare --depth=1 "$url" "$workdir/repo.git" 2>/dev/null
    t1=$(now_ms)

    # Step 2: resolve HEAD to SHA
    sha=$("$ZIGGIT" -C "$workdir/repo.git" rev-parse HEAD 2>/dev/null)
    t2=$(now_ms)

    # Step 3: checkout (archive + extract)
    mkdir -p "$workdir/checkout"
    "$ZIGGIT" -C "$workdir/repo.git" archive HEAD | tar -xC "$workdir/checkout" 2>/dev/null
    t3=$(now_ms)

    clone_ms=$((t1 - t0))
    resolve_ms=$((t2 - t1))
    checkout_ms=$((t3 - t2))
    total_ms=$((t3 - t0))

    clone_runs+=($clone_ms)
    resolve_runs+=($resolve_ms)
    checkout_runs+=($checkout_ms)
    total_runs+=($total_ms)

    log "  ziggit $name run$i: clone=${clone_ms}ms resolve=${resolve_ms}ms checkout=${checkout_ms}ms total=${total_ms}ms"

    rm -rf "$workdir"
  done

  ZIG_CLONE_TIMES[$name]="${clone_runs[*]}"
  ZIG_RESOLVE_TIMES[$name]="${resolve_runs[*]}"
  ZIG_CHECKOUT_TIMES[$name]="${checkout_runs[*]}"
  ZIG_TOTAL_TIMES[$name]="${total_runs[*]}"

  echo "ZIG_${name}_CLONE: ${clone_runs[*]}" >> "$RESULTS_FILE"
  echo "ZIG_${name}_RESOLVE: ${resolve_runs[*]}" >> "$RESULTS_FILE"
  echo "ZIG_${name}_CHECKOUT: ${checkout_runs[*]}" >> "$RESULTS_FILE"
  echo "ZIG_${name}_TOTAL: ${total_runs[*]}" >> "$RESULTS_FILE"
done

# ============================================================================
# Output raw results
# ============================================================================
echo ""
echo "=========================================="
echo "RAW RESULTS"
echo "=========================================="
cat "$RESULTS_FILE"

# Cleanup
rm -rf "$BENCH_DIR"
log "Done. Raw results at $RESULTS_FILE"
