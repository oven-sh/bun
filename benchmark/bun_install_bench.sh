#!/usr/bin/env bash
set -euo pipefail

# BUN INSTALL BENCHMARK: Stock Bun vs Ziggit Integration
# Measures: bun install (cold/warm), git CLI clone, ziggit clone, findCommit
#
# Usage: bash bun_install_bench.sh
# Requires: bun, git, zig (built ziggit), python3

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

# --- 1. BUN INSTALL (COLD) ---
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

# --- 2. BUN INSTALL (WARM) ---
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

# --- 3. SEQUENTIAL CLONE: GIT CLI (bare --depth=1 + local checkout) ---
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

# --- 4. SEQUENTIAL CLONE: ZIGGIT (--depth 1) ---
echo ""
echo "=== 4. ZIGGIT CLONE (--depth 1) ==="
for run in $(seq 1 $RUNS); do
  total_start=$(timestamp_ms)
  for i in "${!REPOS[@]}"; do
    repo="${REPOS[$i]}"
    name="${REPO_NAMES[$i]}"
    rm -rf "/tmp/bz-${name}"
    start=$(timestamp_ms)
    $ZIGGIT clone --depth 1 "$repo" "/tmp/bz-${name}" 2>/dev/null || true
    end=$(timestamp_ms)
    echo "ZIGGIT_${name}_run${run}=$((end - start))ms"
    rm -rf "/tmp/bz-${name}"
  done
  total_end=$(timestamp_ms)
  echo "ZIGGIT_TOTAL_run${run}=$((total_end - total_start))ms"
done

# --- 5. PARALLEL CLONE (simulating bun install's concurrent git dep fetch) ---
echo ""
echo "=== 5. PARALLEL CLONE (5 repos, --depth 1) ==="
# Warm up network
$GIT ls-remote https://github.com/debug-js/debug.git HEAD 2>/dev/null >/dev/null
sleep 1

for run in $(seq 1 $RUNS); do
  # Git parallel
  for name in "${REPO_NAMES[@]}"; do rm -rf "/tmp/pg-${name}"; done
  start=$(timestamp_ms)
  for i in "${!REPOS[@]}"; do
    $GIT clone --depth 1 "${REPOS[$i]}" "/tmp/pg-${REPO_NAMES[$i]}" 2>/dev/null &
  done
  wait
  end=$(timestamp_ms)
  echo "GIT_PARALLEL_run${run}=$((end - start))ms"
  for name in "${REPO_NAMES[@]}"; do rm -rf "/tmp/pg-${name}"; done
  sleep 0.5

  # Ziggit parallel
  for name in "${REPO_NAMES[@]}"; do rm -rf "/tmp/pz-${name}"; done
  start=$(timestamp_ms)
  for i in "${!REPOS[@]}"; do
    $ZIGGIT clone --depth 1 "${REPOS[$i]}" "/tmp/pz-${REPO_NAMES[$i]}" 2>/dev/null &
  done
  wait
  end=$(timestamp_ms)
  echo "ZIGGIT_PARALLEL_run${run}=$((end - start))ms"
  for name in "${REPO_NAMES[@]}"; do rm -rf "/tmp/pz-${name}"; done
  sleep 0.5
done

# --- 6. GIT REV-PARSE vs ZIGGIT findCommit ---
echo ""
echo "=== 6. GIT REV-PARSE vs ZIGGIT findCommit ==="
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

# Cleanup
for name in "${REPO_NAMES[@]}"; do rm -rf "/tmp/fc-${name}"; done

echo ""
echo "=== DONE ==="
