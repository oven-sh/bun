#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: stock bun vs ziggit-simulated workflow
# Compares: stock bun install (git deps) vs ziggit clone workflow
#
# Usage: bash bun_install_bench.sh [--save]
#   --save: save raw results to timestamped file
set -euo pipefail

ZIGGIT=/root/ziggit/zig-out/bin/ziggit
GIT=/usr/bin/git
BUN=/root/.bun/bin/bun
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SAVE_RESULTS=false
[[ "${1:-}" == "--save" ]] && SAVE_RESULTS=true

# Repos that simulate typical bun install git dependencies
declare -A REPOS=(
  [debug]="https://github.com/debug-js/debug.git"
  [semver]="https://github.com/npm/node-semver.git"
  [ms]="https://github.com/vercel/ms.git"
  [chalk]="https://github.com/chalk/chalk.git"
  [express]="https://github.com/expressjs/express.git"
)

REPO_ORDER=(debug semver ms chalk express)

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Capture all output for saving
exec > >(tee /tmp/bench_output_$$.txt) 2>&1

echo "============================================"
echo "BUN INSTALL BENCHMARK — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "VM: $(nproc) CPU, $(free -h | awk '/Mem:/{print $2}') RAM"
echo "bun: $($BUN --version)"
echo "git: $($GIT --version)"
echo "ziggit: $ZIGGIT"
echo "ziggit commit: $(cd /root/ziggit && git rev-parse --short HEAD)"
echo "============================================"
echo ""

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
  rm -rf /tmp/bench-bun/node_modules /tmp/bench-bun/bun.lock
  rm -rf ~/.bun/install/cache 2>/dev/null || true
  start=$(date +%s%N)
  $BUN install --cwd /tmp/bench-bun >/dev/null 2>&1
  end=$(date +%s%N)
  ms=$(( (end - start) / 1000000 ))
  BUN_COLD+=($ms)
  log "  bun cold run $i: ${ms}ms"
done

for i in 1 2 3; do
  rm -rf /tmp/bench-bun/node_modules
  start=$(date +%s%N)
  $BUN install --cwd /tmp/bench-bun >/dev/null 2>&1
  end=$(date +%s%N)
  ms=$(( (end - start) / 1000000 ))
  BUN_WARM+=($ms)
  log "  bun warm run $i: ${ms}ms"
done

rm -rf /tmp/bench-bun

############################################################
# PART 2: Per-repo clone workflow: git CLI vs ziggit
############################################################
log "=== PART 2: Per-repo git CLI vs ziggit ==="

for repo_name in "${REPO_ORDER[@]}"; do
  url="${REPOS[$repo_name]}"
  echo "--- $repo_name ($url) ---"

  for tool_name in git ziggit; do
    if [ "$tool_name" = "git" ]; then
      TOOL=$GIT
    else
      TOOL=$ZIGGIT
    fi

    for i in 1 2 3; do
      workdir=$(mktemp -d)

      t0=$(date +%s%N)
      $TOOL clone --bare "$url" "$workdir/bare.git" >/dev/null 2>&1
      t1=$(date +%s%N)

      sha=$($GIT --git-dir="$workdir/bare.git" rev-parse HEAD 2>/dev/null)
      t2=$(date +%s%N)

      $TOOL clone "$workdir/bare.git" "$workdir/checkout" >/dev/null 2>&1
      t3=$(date +%s%N)

      clone_ms=$(( (t1 - t0) / 1000000 ))
      resolve_ms=$(( (t2 - t1) / 1000000 ))
      checkout_ms=$(( (t3 - t2) / 1000000 ))
      total_ms=$(( (t3 - t0) / 1000000 ))

      echo "  $tool_name run $i: clone=${clone_ms} resolve=${resolve_ms} checkout=${checkout_ms} total=${total_ms}ms"

      rm -rf "$workdir"
    done
  done
  echo ""
done

############################################################
# PART 3: Summary
############################################################
log "=== SUMMARY ==="
BUN_COLD_SORTED=($(printf '%s\n' "${BUN_COLD[@]}" | sort -n))
BUN_WARM_SORTED=($(printf '%s\n' "${BUN_WARM[@]}" | sort -n))
echo "Bun cold (median): ${BUN_COLD_SORTED[1]}ms  (runs: ${BUN_COLD[*]})"
echo "Bun warm (median): ${BUN_WARM_SORTED[1]}ms  (runs: ${BUN_WARM[*]})"

# Save raw results
if $SAVE_RESULTS; then
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  cp /tmp/bench_output_$$.txt "$SCRIPT_DIR/raw_results_${ts}.txt"
  log "Saved raw results to $SCRIPT_DIR/raw_results_${ts}.txt"
fi

rm -f /tmp/bench_output_$$.txt
log "Done."
