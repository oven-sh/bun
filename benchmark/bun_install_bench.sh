#!/usr/bin/env bash
#
# BUN INSTALL BENCHMARK: Stock bun vs Ziggit-simulated git dep resolution
#
# Measures:
#   1. Stock bun install (cold + warm) with git dependencies
#   2. Git CLI workflow: clone --bare --depth=1 + rev-parse + archive|tar
#   3. Ziggit workflow: clone + fix HEAD + checkout
#   4. Subprocess spawn overhead comparison
#
# Each operation is run 3 times, median reported.
#
set -euo pipefail

BUN="/root/.bun/bin/bun"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
BENCH_DIR="/tmp/bench-workdir"
RUNS=3

REPO_NAMES=("debug" "semver" "ms" "balanced-match" "concat-map")
REPO_URLS=(
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
  "https://github.com/vercel/ms.git"
  "https://github.com/juliangruber/balanced-match.git"
  "https://github.com/ljharb/concat-map.git"
)
# Default branches (ziggit clone sets HEAD to master, but these repos use main/master)
REPO_BRANCHES=("main" "main" "main" "master" "main")

ts_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
dur() { echo $(( $2 - $1 )); }

median3() {
  echo "$1 $2 $3" | tr ' ' '\n' | sort -n | sed -n '2p'
}

echo "============================================="
echo "BUN INSTALL BENCHMARK — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================="
echo "Bun:     $($BUN --version)"
echo "Zig:     $(zig version)"
echo "Git:     $(git --version | awk '{print $3}')"
echo "Ziggit:  built from /root/ziggit HEAD ($(cd /root/ziggit && git rev-parse --short HEAD))"
echo "System:  $(uname -sm), $(free -m | awk '/Mem:/{print $2}')MB RAM"
echo ""

# ────────────────────────────────────────
# PART 1: Stock bun install
# ────────────────────────────────────────
echo "## PART 1: Stock bun install (5 git deps)"

declare -a BUN_COLD BUN_WARM

for run in $(seq 1 $RUNS); do
  rm -rf /tmp/bench-bun-project
  mkdir -p /tmp/bench-bun-project
  cat > /tmp/bench-bun-project/package.json << 'PKGJSON'
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
PKGJSON

  # Cold: nuke everything
  rm -rf /tmp/bench-bun-project/node_modules /tmp/bench-bun-project/bun.lock
  rm -rf ~/.bun/install/cache

  s=$(ts_ms)
  (cd /tmp/bench-bun-project && $BUN install --no-progress 2>&1) >/dev/null || true
  e=$(ts_ms)
  cold=$(dur $s $e)
  BUN_COLD+=($cold)

  # Warm: keep bun cache, remove node_modules only
  rm -rf /tmp/bench-bun-project/node_modules
  s=$(ts_ms)
  (cd /tmp/bench-bun-project && $BUN install --no-progress 2>&1) >/dev/null || true
  e=$(ts_ms)
  warm=$(dur $s $e)
  BUN_WARM+=($warm)

  echo "  Run $run: cold=${cold}ms warm=${warm}ms"
done

bun_cold_median=$(median3 ${BUN_COLD[0]} ${BUN_COLD[1]} ${BUN_COLD[2]})
bun_warm_median=$(median3 ${BUN_WARM[0]} ${BUN_WARM[1]} ${BUN_WARM[2]})
echo "  >> Median: cold=${bun_cold_median}ms warm=${bun_warm_median}ms"

pkg_count=$(ls /tmp/bench-bun-project/node_modules/ 2>/dev/null | wc -l)
echo "  >> Packages installed: $pkg_count"
echo ""

# ────────────────────────────────────────
# PART 2: Git CLI per-repo workflow
# ────────────────────────────────────────
echo "## PART 2: Git CLI workflow (clone --bare --depth=1 + rev-parse + archive|tar)"

declare -A GIT_CLONE GIT_RESOLVE GIT_ARCHIVE  # median values
declare -A GIT_CLONE_ALL GIT_RESOLVE_ALL GIT_ARCHIVE_ALL  # all 3 runs

for i in "${!REPO_NAMES[@]}"; do
  name="${REPO_NAMES[$i]}"
  url="${REPO_URLS[$i]}"
  declare -a _gc _gr _ga

  for run in $(seq 1 $RUNS); do
    rm -rf "$BENCH_DIR/${name}.git" "$BENCH_DIR/${name}-work"
    mkdir -p "$BENCH_DIR"
    bare="$BENCH_DIR/${name}.git"
    work="$BENCH_DIR/${name}-work"

    s=$(ts_ms)
    git clone --bare --depth=1 "$url" "$bare" 2>/dev/null
    e=$(ts_ms)
    _gc+=( $(dur $s $e) )

    s=$(ts_ms)
    git -C "$bare" rev-parse HEAD >/dev/null 2>&1
    e=$(ts_ms)
    _gr+=( $(dur $s $e) )

    mkdir -p "$work"
    s=$(ts_ms)
    git -C "$bare" archive HEAD | tar -x -C "$work" 2>/dev/null
    e=$(ts_ms)
    _ga+=( $(dur $s $e) )
  done

  GIT_CLONE[$name]=$(median3 ${_gc[0]} ${_gc[1]} ${_gc[2]})
  GIT_RESOLVE[$name]=$(median3 ${_gr[0]} ${_gr[1]} ${_gr[2]})
  GIT_ARCHIVE[$name]=$(median3 ${_ga[0]} ${_ga[1]} ${_ga[2]})
  GIT_CLONE_ALL[$name]="${_gc[*]}"
  GIT_RESOLVE_ALL[$name]="${_gr[*]}"
  GIT_ARCHIVE_ALL[$name]="${_ga[*]}"

  total=$(( ${GIT_CLONE[$name]} + ${GIT_RESOLVE[$name]} + ${GIT_ARCHIVE[$name]} ))
  echo "  $name: clone=${GIT_CLONE[$name]}ms resolve=${GIT_RESOLVE[$name]}ms archive=${GIT_ARCHIVE[$name]}ms total=${total}ms  (runs: ${_gc[*]})"
  unset _gc _gr _ga
done
echo ""

# ────────────────────────────────────────
# PART 3: Ziggit per-repo workflow
# ────────────────────────────────────────
echo "## PART 3: Ziggit workflow (clone + fix HEAD + checkout)"

declare -A ZIG_CLONE ZIG_CHECKOUT ZIG_TOTAL
declare -A ZIG_CLONE_ALL ZIG_CHECKOUT_ALL

for i in "${!REPO_NAMES[@]}"; do
  name="${REPO_NAMES[$i]}"
  url="${REPO_URLS[$i]}"
  branch="${REPO_BRANCHES[$i]}"
  declare -a _zc _zo

  for run in $(seq 1 $RUNS); do
    rm -rf "$BENCH_DIR/${name}-zig"
    mkdir -p "$BENCH_DIR"
    repo="$BENCH_DIR/${name}-zig"

    # Clone (fetches packfile, creates .git structure)
    s=$(ts_ms)
    $ZIGGIT clone "$url" "$repo" 2>/dev/null || true
    e=$(ts_ms)
    clone_ms=$(dur $s $e)

    # Fix HEAD symref if needed, then checkout to populate working tree
    head_ref=$(cat "$repo/.git/HEAD" 2>/dev/null | sed 's/ref: //')
    actual_branch="$branch"
    # Check if the branch from HEAD exists in packed-refs; if not, use known default
    if ! grep -q "refs/heads/$branch" "$repo/.git/packed-refs" 2>/dev/null; then
      # Try what HEAD points to
      short_ref=$(basename "$head_ref")
      if grep -q "refs/heads/$short_ref" "$repo/.git/packed-refs" 2>/dev/null; then
        actual_branch="$short_ref"
      fi
    fi
    echo "ref: refs/heads/$actual_branch" > "$repo/.git/HEAD"

    s=$(ts_ms)
    (cd "$repo" && $ZIGGIT checkout "$actual_branch" 2>/dev/null) || true
    e=$(ts_ms)
    checkout_ms=$(dur $s $e)

    _zc+=( $clone_ms )
    _zo+=( $checkout_ms )
  done

  ZIG_CLONE[$name]=$(median3 ${_zc[0]} ${_zc[1]} ${_zc[2]})
  ZIG_CHECKOUT[$name]=$(median3 ${_zo[0]} ${_zo[1]} ${_zo[2]})
  ZIG_CLONE_ALL[$name]="${_zc[*]}"
  ZIG_CHECKOUT_ALL[$name]="${_zo[*]}"

  total=$(( ${ZIG_CLONE[$name]} + ${ZIG_CHECKOUT[$name]} ))
  ZIG_TOTAL[$name]=$total

  # Verify files exist
  file_count=$(find "$BENCH_DIR/${name}-zig" -maxdepth 1 -not -name '.git' -not -name '.' | wc -l)
  echo "  $name: clone=${ZIG_CLONE[$name]}ms checkout=${ZIG_CHECKOUT[$name]}ms total=${total}ms  files=$file_count  (runs: ${_zc[*]})"
  unset _zc _zo
done
echo ""

# ────────────────────────────────────────
# PART 4: Subprocess spawn overhead
# ────────────────────────────────────────
echo "## PART 4: Spawn overhead (200 iterations)"

s=$(ts_ms)
for i in $(seq 1 200); do git --version >/dev/null 2>&1; done
e=$(ts_ms)
git_spawn_total=$(dur $s $e)
git_spawn_per=$(python3 -c "print(f'{$git_spawn_total/200:.2f}')")
echo "  git --version x200: ${git_spawn_total}ms (${git_spawn_per}ms/call)"

s=$(ts_ms)
for i in $(seq 1 200); do $ZIGGIT --version >/dev/null 2>&1; done
e=$(ts_ms)
zig_spawn_total=$(dur $s $e)
zig_spawn_per=$(python3 -c "print(f'{$zig_spawn_total/200:.2f}')")
echo "  ziggit --version x200: ${zig_spawn_total}ms (${zig_spawn_per}ms/call)"
echo ""

# ────────────────────────────────────────
# Summary
# ────────────────────────────────────────
echo "## SUMMARY"

git_total=0
zig_total=0
for name in "${REPO_NAMES[@]}"; do
  gt=$(( ${GIT_CLONE[$name]} + ${GIT_RESOLVE[$name]} + ${GIT_ARCHIVE[$name]} ))
  zt=${ZIG_TOTAL[$name]}
  git_total=$((git_total + gt))
  zig_total=$((zig_total + zt))
done

speedup=$(python3 -c "print(f'{$git_total/$zig_total:.2f}' if $zig_total > 0 else 'N/A')")
echo "  Git CLI total:   ${git_total}ms (clone+resolve+archive, 5 repos)"
echo "  Ziggit total:    ${zig_total}ms (clone+checkout, 5 repos)"
echo "  Speedup:         ${speedup}×"
echo "  Bun cold median: ${bun_cold_median}ms"
echo "  Bun warm median: ${bun_warm_median}ms"
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
  echo "git_total=$git_total"
  echo "zig_total=$zig_total"
  echo "speedup=$speedup"

  for name in "${REPO_NAMES[@]}"; do
    echo "repo_${name}_git_clone=${GIT_CLONE[$name]} (${GIT_CLONE_ALL[$name]})"
    echo "repo_${name}_git_resolve=${GIT_RESOLVE[$name]} (${GIT_RESOLVE_ALL[$name]})"
    echo "repo_${name}_git_archive=${GIT_ARCHIVE[$name]} (${GIT_ARCHIVE_ALL[$name]})"
    echo "repo_${name}_zig_clone=${ZIG_CLONE[$name]} (${ZIG_CLONE_ALL[$name]})"
    echo "repo_${name}_zig_checkout=${ZIG_CHECKOUT[$name]} (${ZIG_CHECKOUT_ALL[$name]})"
  done
} > "$RAW_FILE"

echo "Raw results saved: $RAW_FILE"
echo "Done!"
