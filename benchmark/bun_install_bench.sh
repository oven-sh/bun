#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: Stock Bun vs Ziggit-simulated workflow
# Session 11 — 2026-03-27
set -euo pipefail

BUN="/root/.bun/bin/bun"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
TMPDIR="/tmp/bench-$$"
RESULTS_FILE="/tmp/bench-results-$$.txt"

REPOS=(
  "debug|https://github.com/debug-js/debug.git"
  "semver|https://github.com/npm/node-semver.git"
  "ms|https://github.com/vercel/ms.git"
  "chalk|https://github.com/chalk/chalk.git"
  "express|https://github.com/expressjs/express.git"
)

RUNS=3

now_ms() {
  date +%s%N | cut -b1-13
}

cleanup() {
  rm -rf "$TMPDIR" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== BUN INSTALL BENCHMARK (Session 11) ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%MZ)"
echo "Bun: $($BUN --version)"
echo "Ziggit: $(cd /root/ziggit && git log --oneline -1)"
echo "Git CLI: $($GIT --version)"
echo ""

# ---- PART 1: Stock bun install ----
echo "=== PART 1: Stock Bun Install (5 git deps) ==="

mkdir -p /tmp/bench-bun-project
cd /tmp/bench-bun-project
cat > package.json << 'EOF'
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

echo ""
echo "--- Cold cache runs ---"
for i in $(seq 1 $RUNS); do
  rm -rf node_modules bun.lock /root/.bun/install/cache 2>/dev/null || true
  t1=$(now_ms)
  $BUN install --no-progress 2>&1 >/dev/null
  t2=$(now_ms)
  echo "  Run $i: $((t2 - t1))ms"
done

echo ""
echo "--- Warm cache runs ---"
for i in $(seq 1 $RUNS); do
  rm -rf node_modules 2>/dev/null || true
  t1=$(now_ms)
  $BUN install --no-progress 2>&1 >/dev/null
  t2=$(now_ms)
  echo "  Run $i: $((t2 - t1))ms"
done

# ---- PART 2: Per-repo workflow comparison ----
echo ""
echo "=== PART 2: Per-Repo Git Workflow (git CLI vs ziggit) ==="
echo "  Workflow: clone --bare → rev-parse HEAD → clone from bare"
echo ""

for entry in "${REPOS[@]}"; do
  IFS='|' read -r name url <<< "$entry"
  echo "=== $name ($url) ==="
  
  for run in $(seq 1 $RUNS); do
    # --- Git CLI ---
    rm -rf "$TMPDIR" && mkdir -p "$TMPDIR"
    
    t1=$(now_ms)
    $GIT clone --bare --quiet "$url" "$TMPDIR/bare-git" 2>/dev/null
    t2=$(now_ms)
    clone_git=$((t2 - t1))
    
    t1=$(now_ms)
    sha=$($GIT -C "$TMPDIR/bare-git" rev-parse HEAD 2>/dev/null)
    t2=$(now_ms)
    resolve_git=$((t2 - t1))
    
    t1=$(now_ms)
    $GIT clone --quiet "$TMPDIR/bare-git" "$TMPDIR/work-git" 2>/dev/null
    t2=$(now_ms)
    checkout_git=$((t2 - t1))
    
    total_git=$((clone_git + resolve_git + checkout_git))
    echo "  git    $run: clone=${clone_git} resolve=${resolve_git} checkout=${checkout_git} total=${total_git}ms"
    
    # --- Ziggit ---
    rm -rf "$TMPDIR" && mkdir -p "$TMPDIR"
    
    t1=$(now_ms)
    $ZIGGIT clone --bare --quiet "$url" "$TMPDIR/bare-zig" 2>/dev/null
    t2=$(now_ms)
    clone_zig=$((t2 - t1))
    
    t1=$(now_ms)
    sha=$($ZIGGIT -C "$TMPDIR/bare-zig" rev-parse HEAD 2>/dev/null)
    t2=$(now_ms)
    resolve_zig=$((t2 - t1))
    
    t1=$(now_ms)
    $ZIGGIT clone --quiet "$TMPDIR/bare-zig" "$TMPDIR/work-zig" 2>/dev/null
    t2=$(now_ms)
    checkout_zig=$((t2 - t1))
    
    total_zig=$((clone_zig + resolve_zig + checkout_zig))
    echo "  ziggit $run: clone=${clone_zig} resolve=${resolve_zig} checkout=${checkout_zig} total=${total_zig}ms"
  done
  echo ""
done

# Cleanup
rm -rf /tmp/bench-bun-project "$TMPDIR" 2>/dev/null || true
echo "=== DONE ==="
