#!/usr/bin/env bash
set -euo pipefail

# BUN INSTALL BENCHMARK: Stock Bun vs Ziggit Integration
# Measures: bun install (cold/warm), git CLI clone, ziggit clone, findCommit
#
# Usage: bash bun_install_bench.sh

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
FC_BENCH="/root/bun-fork/benchmark/zig-out/bin/findcommit_bench"
GIT="/usr/bin/git"
BUN="/root/.bun/bin/bun"
RUNS=3

REPOS=(
  "https://github.com/debug-js/debug.git"
  "https://github.com/npm/node-semver.git"
  "https://github.com/chalk/chalk.git"
  "https://github.com/sindresorhus/is.git"
  "https://github.com/expressjs/express.git"
)
REPO_NAMES=("debug" "semver" "chalk" "is" "express")

timestamp_ms() { python3 -c "import time; print(int(time.time()*1000))"; }

echo "========================================"
echo "BUN INSTALL BENCHMARK SUITE"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Bun: $($BUN --version)"
echo "Git: $($GIT --version)"
echo "Zig: $(zig version)"
echo "Ziggit: $(cd /root/ziggit && git rev-parse --short HEAD)"
echo "========================================"

echo ""
echo "=== 1. BUN INSTALL (COLD) ==="
mkdir -p /tmp/bench-bun
cat > /tmp/bench-bun/package.json << 'EOF'
{
  "name": "ziggit-bench",
  "dependencies": {
    "debug": "github:debug-js/debug",
    "semver": "github:npm/node-semver",
    "chalk": "github:chalk/chalk",
    "@sindresorhus/is": "github:sindresorhus/is",
    "express": "github:expressjs/express"
  }
}
EOF

for run in $(seq 1 $RUNS); do
  cd /tmp/bench-bun
  rm -rf node_modules bun.lock .bun
  rm -rf ~/.bun/install/cache 2>/dev/null || true
  start=$(timestamp_ms)
  $BUN install --no-progress 2>&1 >/dev/null || true
  end=$(timestamp_ms)
  echo "BUN_COLD_${run}=$((end - start))ms"
done

echo ""
echo "=== 2. BUN INSTALL (WARM) ==="
for run in $(seq 1 $RUNS); do
  cd /tmp/bench-bun
  rm -rf node_modules
  start=$(timestamp_ms)
  $BUN install --no-progress 2>&1 >/dev/null || true
  end=$(timestamp_ms)
  echo "BUN_WARM_${run}=$((end - start))ms"
done

echo ""
echo "=== 3. GIT CLI CLONE (bare --depth=1 + local checkout) ==="
for run in $(seq 1 $RUNS); do
  total_start=$(timestamp_ms)
  for i in "${!REPOS[@]}"; do
    repo="${REPOS[$i]}"
    name="${REPO_NAMES[$i]}"
    rm -rf "/tmp/bg-${name}" "/tmp/bg-${name}.bare"
    start=$(timestamp_ms)
    $GIT clone --bare --depth=1 "$repo" "/tmp/bg-${name}.bare" 2>/dev/null
    $GIT clone "/tmp/bg-${name}.bare" "/tmp/bg-${name}" 2>/dev/null
    end=$(timestamp_ms)
    echo "GIT_${name}_run${run}=$((end - start))ms"
    rm -rf "/tmp/bg-${name}" "/tmp/bg-${name}.bare"
  done
  total_end=$(timestamp_ms)
  echo "GIT_TOTAL_run${run}=$((total_end - total_start))ms"
done

echo ""
echo "=== 4. ZIGGIT CLONE (full depth) ==="
for run in $(seq 1 $RUNS); do
  total_start=$(timestamp_ms)
  for i in "${!REPOS[@]}"; do
    repo="${REPOS[$i]}"
    name="${REPO_NAMES[$i]}"
    rm -rf "/tmp/bz-${name}"
    start=$(timestamp_ms)
    $ZIGGIT clone "$repo" "/tmp/bz-${name}" 2>/dev/null || true
    end=$(timestamp_ms)
    echo "ZIGGIT_${name}_run${run}=$((end - start))ms"
    rm -rf "/tmp/bz-${name}"
  done
  total_end=$(timestamp_ms)
  echo "ZIGGIT_TOTAL_run${run}=$((total_end - total_start))ms"
done

echo ""
echo "=== 5. GIT REV-PARSE vs ZIGGIT findCommit ==="
# Set up bare repos
for i in "${!REPOS[@]}"; do
  repo="${REPOS[$i]}"
  name="${REPO_NAMES[$i]}"
  rm -rf "/tmp/fc-${name}"
  $GIT clone --bare --depth=1 "$repo" "/tmp/fc-${name}" 2>/dev/null
done

echo "--- git rev-parse (subprocess) ---"
for run in $(seq 1 3); do
  for i in "${!REPO_NAMES[@]}"; do
    name="${REPO_NAMES[$i]}"
    start=$(date +%s%N)
    (cd "/tmp/fc-${name}" && $GIT rev-parse HEAD >/dev/null 2>&1)
    end=$(date +%s%N)
    echo "GITREVPARSE_${name}_run${run}=$(( (end - start) / 1000 ))µs"
  done
done

echo ""
echo "--- ziggit findCommit (in-process, 1000 iterations) ---"
if [ -x "$FC_BENCH" ]; then
  for name in "${REPO_NAMES[@]}"; do
    $FC_BENCH "/tmp/fc-${name}" HEAD 2>&1
  done
else
  echo "findcommit_bench not built. Build with: cd benchmark && zig build -Doptimize=ReleaseFast"
fi

echo ""
echo "=== DONE ==="
