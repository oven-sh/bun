#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: stock bun vs ziggit-simulated workflow
# Compares: stock bun install (git deps) vs ziggit clone workflow
set -euo pipefail

ZIGGIT=/root/ziggit/zig-out/bin/ziggit
GIT=/usr/bin/git
BUN=/root/.bun/bin/bun
TMPDIR=/tmp/bench-$$
RESULTS=""

# Repos that simulate typical bun install git dependencies
declare -A REPOS=(
  [debug]="https://github.com/debug-js/debug.git"
  [semver]="https://github.com/npm/node-semver.git"
  [ms]="https://github.com/vercel/ms.git"
  [chalk]="https://github.com/chalk/chalk.git"
  [express]="https://github.com/expressjs/express.git"
)

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Returns milliseconds
measure_ms() {
  local start end
  start=$(date +%s%N)
  "$@" >/dev/null 2>&1
  end=$(date +%s%N)
  echo $(( (end - start) / 1000000 ))
}

############################################################
# PART 1: Stock bun install benchmarks
############################################################
log "=== PART 1: Stock bun install ==="

mkdir -p /tmp/bench-bun
cat > /tmp/bench-bun/package.json << 'EOF'
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

BUN_COLD=()
BUN_WARM=()

for i in 1 2 3; do
  log "bun install cold run $i..."
  rm -rf /tmp/bench-bun/node_modules /tmp/bench-bun/bun.lock
  rm -rf ~/.bun/install/cache 2>/dev/null || true
  ms=$(measure_ms $BUN install --cwd /tmp/bench-bun)
  BUN_COLD+=($ms)
  log "  cold: ${ms}ms"
done

for i in 1 2 3; do
  log "bun install warm run $i..."
  rm -rf /tmp/bench-bun/node_modules
  ms=$(measure_ms $BUN install --cwd /tmp/bench-bun)
  BUN_WARM+=($ms)
  log "  warm: ${ms}ms"
done

############################################################
# PART 2: Per-repo clone workflow: git CLI vs ziggit
# Simulates what bun install does for each git dep:
#   1. clone --bare (fetch objects)
#   2. rev-parse HEAD (resolve ref)
#   3. checkout (extract tree via clone to working dir)
############################################################
log "=== PART 2: Per-repo git CLI vs ziggit ==="

declare -A GIT_CLONE_TIMES
declare -A ZIGGIT_CLONE_TIMES
declare -A GIT_TOTAL_TIMES
declare -A ZIGGIT_TOTAL_TIMES

for repo_name in debug semver ms express chalk; do
  url="${REPOS[$repo_name]}"
  log "--- $repo_name ($url) ---"

  GIT_RUNS=()
  ZIGGIT_RUNS=()
  GIT_CLONE_RUNS=()
  ZIGGIT_CLONE_RUNS=()

  for i in 1 2 3; do
    workdir=$(mktemp -d)

    # Git CLI: full workflow
    t_start=$(date +%s%N)
    $GIT clone --bare "$url" "$workdir/bare.git" >/dev/null 2>&1
    t_clone=$(date +%s%N)
    sha=$($GIT --git-dir="$workdir/bare.git" rev-parse HEAD 2>/dev/null)
    t_resolve=$(date +%s%N)
    $GIT clone "$workdir/bare.git" "$workdir/checkout" >/dev/null 2>&1
    t_end=$(date +%s%N)

    clone_ms=$(( (t_clone - t_start) / 1000000 ))
    total_ms=$(( (t_end - t_start) / 1000000 ))
    GIT_CLONE_RUNS+=($clone_ms)
    GIT_RUNS+=($total_ms)
    rm -rf "$workdir"

    log "  git run $i: clone=${clone_ms}ms total=${total_ms}ms"
  done

  for i in 1 2 3; do
    workdir=$(mktemp -d)

    # Ziggit: full workflow
    t_start=$(date +%s%N)
    $ZIGGIT clone --bare "$url" "$workdir/bare.git" >/dev/null 2>&1
    t_clone=$(date +%s%N)
    sha=$($ZIGGIT --git-dir="$workdir/bare.git" rev-parse HEAD 2>/dev/null || $GIT --git-dir="$workdir/bare.git" rev-parse HEAD 2>/dev/null)
    t_resolve=$(date +%s%N)
    $ZIGGIT clone "$workdir/bare.git" "$workdir/checkout" >/dev/null 2>&1
    t_end=$(date +%s%N)

    clone_ms=$(( (t_clone - t_start) / 1000000 ))
    total_ms=$(( (t_end - t_start) / 1000000 ))
    ZIGGIT_CLONE_RUNS+=($clone_ms)
    ZIGGIT_RUNS+=($total_ms)
    rm -rf "$workdir"

    log "  ziggit run $i: clone=${clone_ms}ms total=${total_ms}ms"
  done

  # Compute medians (sort and take middle)
  GIT_SORTED=($(printf '%s\n' "${GIT_RUNS[@]}" | sort -n))
  ZIGGIT_SORTED=($(printf '%s\n' "${ZIGGIT_RUNS[@]}" | sort -n))
  GIT_CLONE_SORTED=($(printf '%s\n' "${GIT_CLONE_RUNS[@]}" | sort -n))
  ZIGGIT_CLONE_SORTED=($(printf '%s\n' "${ZIGGIT_CLONE_RUNS[@]}" | sort -n))

  GIT_TOTAL_TIMES[$repo_name]=${GIT_SORTED[1]}
  ZIGGIT_TOTAL_TIMES[$repo_name]=${ZIGGIT_SORTED[1]}
  GIT_CLONE_TIMES[$repo_name]=${GIT_CLONE_SORTED[1]}
  ZIGGIT_CLONE_TIMES[$repo_name]=${ZIGGIT_CLONE_SORTED[1]}

  log "  MEDIAN: git=${GIT_SORTED[1]}ms ziggit=${ZIGGIT_SORTED[1]}ms"
done

############################################################
# PART 3: Output results
############################################################
log "=== RESULTS ==="

BUN_COLD_SORTED=($(printf '%s\n' "${BUN_COLD[@]}" | sort -n))
BUN_WARM_SORTED=($(printf '%s\n' "${BUN_WARM[@]}" | sort -n))

echo ""
echo "## Stock Bun Install"
echo "Cold cache (median of 3): ${BUN_COLD_SORTED[1]}ms  (runs: ${BUN_COLD[*]})"
echo "Warm cache (median of 3): ${BUN_WARM_SORTED[1]}ms  (runs: ${BUN_WARM[*]})"
echo ""
echo "## Per-Repo: Git CLI vs Ziggit (median ms)"
echo "| Repo | git clone | ziggit clone | git total | ziggit total | Speedup |"
echo "|------|----------:|-------------:|----------:|-------------:|--------:|"

git_grand=0
ziggit_grand=0
for repo_name in debug semver ms express chalk; do
  gt=${GIT_TOTAL_TIMES[$repo_name]}
  zt=${ZIGGIT_TOTAL_TIMES[$repo_name]}
  gc=${GIT_CLONE_TIMES[$repo_name]}
  zc=${ZIGGIT_CLONE_TIMES[$repo_name]}
  if [ "$zt" -gt 0 ]; then
    speedup=$(echo "scale=2; $gt / $zt" | bc)
  else
    speedup="N/A"
  fi
  echo "| $repo_name | ${gc}ms | ${zc}ms | ${gt}ms | ${zt}ms | ${speedup}× |"
  git_grand=$((git_grand + gt))
  ziggit_grand=$((ziggit_grand + zt))
done

if [ "$ziggit_grand" -gt 0 ]; then
  grand_speedup=$(echo "scale=2; $git_grand / $ziggit_grand" | bc)
else
  grand_speedup="N/A"
fi
savings=$((git_grand - ziggit_grand))
echo "| **TOTAL** | | | **${git_grand}ms** | **${ziggit_grand}ms** | **${grand_speedup}×** |"
echo ""
echo "Total savings: ${savings}ms ($(echo "scale=0; $savings * 100 / $git_grand" | bc)%)"

# Cleanup
rm -rf /tmp/bench-bun

log "Done."
