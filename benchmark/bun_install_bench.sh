#!/usr/bin/env bash
#
# BUN INSTALL BENCHMARK: Stock bun vs Ziggit-simulated git dep resolution
#
# Measures:
#   1. Stock bun install (cold + warm) with git dependencies
#   2. Git CLI workflow: clone --bare --depth=1 + rev-parse + archive|tar
#   3. Ziggit workflow: clone + ref resolve via packed-refs + ls-tree
#   4. Subprocess spawn overhead comparison
#
set -euo pipefail

BUN="/root/.bun/bin/bun"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
RESULTS_FILE="/root/bun-fork/benchmark/raw_results.txt"
BENCH_DIR="/tmp/bench-workdir"
RUNS=3

# Repos that simulate typical git deps in package.json
REPO_NAMES=("debug" "semver" "ms" "balanced-match" "concat-map")
REPO_URLS=(
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
  "https://github.com/vercel/ms.git"
  "https://github.com/juliangruber/balanced-match.git"
  "https://github.com/ljharb/concat-map.git"
)

ts_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
dur() { echo $(( $2 - $1 )); }

median3() {
  local a=$1 b=$2 c=$3
  echo "$a $b $c" | tr ' ' '\n' | sort -n | sed -n '2p'
}

echo "============================================="
echo "BUN INSTALL BENCHMARK"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Bun: $($BUN --version)"
echo "Zig: $(zig version)"
echo "Git: $(git --version | awk '{print $3}')"
echo "Ziggit: $($ZIGGIT --version 2>/dev/null || echo 'N/A')"
echo "System: $(uname -sm), $(free -m | awk '/Mem:/{print $2}')MB RAM"
echo "============================================="
echo ""

# ────────────────────────────────────────
# PART 1: Stock bun install
# ────────────────────────────────────────
echo "## PART 1: Stock bun install"

declare -a BUN_COLD BUN_WARM

for run in $(seq 1 $RUNS); do
  rm -rf /tmp/bench-bun-project
  mkdir -p /tmp/bench-bun-project
  cat > /tmp/bench-bun-project/package.json << 'EOF'
{
  "name": "ziggit-bench",
  "dependencies": {
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver",
    "ms": "github:vercel/ms",
    "balanced-match": "github:juliangruber/balanced-match",
    "concat-map": "github:ljharb/concat-map"
  }
}
EOF

  # Cold: clear everything
  rm -rf /tmp/bench-bun-project/node_modules /tmp/bench-bun-project/bun.lock
  rm -rf ~/.bun/install/cache

  s=$(ts_ms)
  (cd /tmp/bench-bun-project && $BUN install --no-progress 2>&1) || true
  e=$(ts_ms)
  cold=$(dur $s $e)
  BUN_COLD+=($cold)

  # Warm: keep cache, drop node_modules
  rm -rf /tmp/bench-bun-project/node_modules
  s=$(ts_ms)
  (cd /tmp/bench-bun-project && $BUN install --no-progress 2>&1) || true
  e=$(ts_ms)
  warm=$(dur $s $e)
  BUN_WARM+=($warm)

  echo "  Run $run: cold=${cold}ms warm=${warm}ms"
done

bun_cold_median=$(median3 ${BUN_COLD[0]} ${BUN_COLD[1]} ${BUN_COLD[2]})
bun_warm_median=$(median3 ${BUN_WARM[0]} ${BUN_WARM[1]} ${BUN_WARM[2]})
echo "  Median: cold=${bun_cold_median}ms warm=${bun_warm_median}ms"
echo ""

# Count packages bun installed
pkg_count=$(ls /tmp/bench-bun-project/node_modules/ 2>/dev/null | wc -l)
echo "  Packages installed: $pkg_count"
echo ""

# ────────────────────────────────────────
# PART 2: Git CLI per-repo workflow
# ────────────────────────────────────────
echo "## PART 2: Git CLI per-repo workflow"

# Arrays indexed by repo
declare -A GIT_CLONE_R1 GIT_CLONE_R2 GIT_CLONE_R3
declare -A GIT_RESOLVE_R1 GIT_RESOLVE_R2 GIT_RESOLVE_R3
declare -A GIT_ARCHIVE_R1 GIT_ARCHIVE_R2 GIT_ARCHIVE_R3

for i in "${!REPO_NAMES[@]}"; do
  name="${REPO_NAMES[$i]}"
  url="${REPO_URLS[$i]}"

  for run in $(seq 1 $RUNS); do
    rm -rf "$BENCH_DIR"
    mkdir -p "$BENCH_DIR"
    bare="$BENCH_DIR/${name}.git"
    work="$BENCH_DIR/${name}-work"

    # Clone --bare --depth=1
    s=$(ts_ms)
    git clone --bare --depth=1 "$url" "$bare" 2>/dev/null
    e=$(ts_ms)
    eval "GIT_CLONE_R${run}[$name]=$(dur $s $e)"

    # rev-parse HEAD
    s=$(ts_ms)
    git -C "$bare" rev-parse HEAD >/dev/null 2>&1
    e=$(ts_ms)
    eval "GIT_RESOLVE_R${run}[$name]=$(dur $s $e)"

    # archive + extract
    mkdir -p "$work"
    s=$(ts_ms)
    git -C "$bare" archive HEAD | tar -x -C "$work" 2>/dev/null
    e=$(ts_ms)
    eval "GIT_ARCHIVE_R${run}[$name]=$(dur $s $e)"
  done

  c=$(median3 ${GIT_CLONE_R1[$name]} ${GIT_CLONE_R2[$name]} ${GIT_CLONE_R3[$name]})
  r=$(median3 ${GIT_RESOLVE_R1[$name]} ${GIT_RESOLVE_R2[$name]} ${GIT_RESOLVE_R3[$name]})
  a=$(median3 ${GIT_ARCHIVE_R1[$name]} ${GIT_ARCHIVE_R2[$name]} ${GIT_ARCHIVE_R3[$name]})
  echo "  $name: clone=${c}ms resolve=${r}ms archive=${a}ms total=$((c+r+a))ms"
done
echo ""

# ────────────────────────────────────────
# PART 3: Ziggit per-repo workflow
# ────────────────────────────────────────
echo "## PART 3: Ziggit per-repo workflow"

declare -A ZIG_CLONE_R1 ZIG_CLONE_R2 ZIG_CLONE_R3
declare -A ZIG_RESOLVE_R1 ZIG_RESOLVE_R2 ZIG_RESOLVE_R3

for i in "${!REPO_NAMES[@]}"; do
  name="${REPO_NAMES[$i]}"
  url="${REPO_URLS[$i]}"

  for run in $(seq 1 $RUNS); do
    rm -rf "$BENCH_DIR"
    mkdir -p "$BENCH_DIR"
    repo="$BENCH_DIR/${name}"

    # Clone
    s=$(ts_ms)
    $ZIGGIT clone "$url" "$repo" 2>/dev/null || true
    e=$(ts_ms)
    eval "ZIG_CLONE_R${run}[$name]=$(dur $s $e)"

    # Resolve: log -1 to get HEAD commit
    s=$(ts_ms)
    (cd "$repo" && $ZIGGIT log -1 2>/dev/null) || true
    e=$(ts_ms)
    eval "ZIG_RESOLVE_R${run}[$name]=$(dur $s $e)"
  done

  c=$(median3 ${ZIG_CLONE_R1[$name]} ${ZIG_CLONE_R2[$name]} ${ZIG_CLONE_R3[$name]})
  r=$(median3 ${ZIG_RESOLVE_R1[$name]} ${ZIG_RESOLVE_R2[$name]} ${ZIG_RESOLVE_R3[$name]})
  echo "  $name: clone=${c}ms resolve=${r}ms total=$((c+r))ms"
done
echo ""

# ────────────────────────────────────────
# PART 4: Subprocess spawn overhead
# ────────────────────────────────────────
echo "## PART 4: Spawn overhead (100 iterations)"

s=$(ts_ms)
for i in $(seq 1 100); do git --version >/dev/null 2>&1; done
e=$(ts_ms)
git_spawn_total=$(dur $s $e)
git_spawn_per=$(python3 -c "print(f'{$git_spawn_total/100:.2f}')")
echo "  git --version x100: ${git_spawn_total}ms (${git_spawn_per}ms/call)"

s=$(ts_ms)
for i in $(seq 1 100); do $ZIGGIT --version >/dev/null 2>&1 || $ZIGGIT 2>/dev/null || true; done
e=$(ts_ms)
zig_spawn_total=$(dur $s $e)
zig_spawn_per=$(python3 -c "print(f'{$zig_spawn_total/100:.2f}')")
echo "  ziggit x100: ${zig_spawn_total}ms (${zig_spawn_per}ms/call)"
echo ""

# ────────────────────────────────────────
# PART 5: File extraction comparison
# ────────────────────────────────────────
echo "## PART 5: Blob extraction (git cat-file vs ziggit show)"

# Use the last git-cloned debug repo
rm -rf "$BENCH_DIR"
mkdir -p "$BENCH_DIR"
git clone --bare --depth=1 https://github.com/debug-js/debug.git "$BENCH_DIR/debug.git" 2>/dev/null

# Get list of all blobs
blob_list=$(git -C "$BENCH_DIR/debug.git" ls-tree -r HEAD | awk '{print $3}')
blob_count=$(echo "$blob_list" | wc -l)
echo "  Blobs in debug repo: $blob_count"

# git cat-file for all blobs
s=$(ts_ms)
for sha in $blob_list; do
  git -C "$BENCH_DIR/debug.git" cat-file -p "$sha" >/dev/null 2>&1
done
e=$(ts_ms)
git_catfile_ms=$(dur $s $e)
echo "  git cat-file x${blob_count}: ${git_catfile_ms}ms"

# ziggit: clone then read files from working tree (simulated via log)
# Since ziggit doesn't have cat-file yet, we measure what's available
$ZIGGIT clone https://github.com/debug-js/debug.git "$BENCH_DIR/debug-zig" 2>/dev/null || true
s=$(ts_ms)
(cd "$BENCH_DIR/debug-zig" && $ZIGGIT log -1 2>/dev/null) || true
e=$(ts_ms)
zig_resolve_ms=$(dur $s $e)
echo "  ziggit log (ref resolve): ${zig_resolve_ms}ms"
echo ""

# ────────────────────────────────────────
# Save raw results
# ────────────────────────────────────────
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
RAW_FILE="/root/bun-fork/benchmark/raw_results_${TIMESTAMP}.txt"
{
  echo "timestamp=$TIMESTAMP"
  echo "bun_cold=${BUN_COLD[*]}"
  echo "bun_warm=${BUN_WARM[*]}"
  echo "bun_cold_median=$bun_cold_median"
  echo "bun_warm_median=$bun_warm_median"
  echo "pkg_count=$pkg_count"
  echo "git_spawn_per=$git_spawn_per"
  echo "zig_spawn_per=$zig_spawn_per"

  for name in "${REPO_NAMES[@]}"; do
    gc=$(median3 ${GIT_CLONE_R1[$name]} ${GIT_CLONE_R2[$name]} ${GIT_CLONE_R3[$name]})
    gr=$(median3 ${GIT_RESOLVE_R1[$name]} ${GIT_RESOLVE_R2[$name]} ${GIT_RESOLVE_R3[$name]})
    ga=$(median3 ${GIT_ARCHIVE_R1[$name]} ${GIT_ARCHIVE_R2[$name]} ${GIT_ARCHIVE_R3[$name]})
    zc=$(median3 ${ZIG_CLONE_R1[$name]} ${ZIG_CLONE_R2[$name]} ${ZIG_CLONE_R3[$name]})
    zr=$(median3 ${ZIG_RESOLVE_R1[$name]} ${ZIG_RESOLVE_R2[$name]} ${ZIG_RESOLVE_R3[$name]})
    echo "repo_${name}_git_clone=$gc"
    echo "repo_${name}_git_resolve=$gr"
    echo "repo_${name}_git_archive=$ga"
    echo "repo_${name}_zig_clone=$zc"
    echo "repo_${name}_zig_resolve=$zr"
  done
} > "$RAW_FILE"
cp "$RAW_FILE" "$RESULTS_FILE"

echo "Raw results: $RAW_FILE"
echo "Done!"
