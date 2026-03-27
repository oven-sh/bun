#!/bin/bash
# bun install end-to-end benchmark: stock bun vs ziggit-simulated workflow
# Usage: bash bun_install_bench.sh [--output FILE]
#
# Requires: bun (stock), ziggit binary, git
set -e

ZIGGIT="${ZIGGIT:-/root/ziggit/zig-out/bin/ziggit}"
GIT="${GIT:-/usr/bin/git}"
BUN="${BUN:-/root/.bun/bin/bun}"
RUNS=3
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)

OUTPUT="${1:-/root/bun-fork/benchmark/raw_results_${TIMESTAMP}.txt}"

REPOS=(
  "https://github.com/sindresorhus/is.git|is"
  "https://github.com/expressjs/express.git|express"
  "https://github.com/chalk/chalk.git|chalk"
  "https://github.com/debug-js/debug.git|debug"
  "https://github.com/npm/node-semver.git|semver"
)

BENCH_PROJECT="/tmp/bench-project"

now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

log() { echo "$@" | tee -a "$OUTPUT"; }

echo "" > "$OUTPUT"
log "=== BUN INSTALL BENCHMARK — $TIMESTAMP ==="
log "VM: $(free -h | awk '/Mem:/{print $2}') RAM, $(nproc) CPU, $(uname -m)"
log "Bun: $($BUN --version), Git: $($GIT --version | awk '{print $3}'), Zig: $(zig version)"
log "Ziggit: $ZIGGIT"
log ""

# ── Section 1: Stock bun install ──────────────────────────────

log "== Section 1: Stock bun install =="

mkdir -p "$BENCH_PROJECT"
cat > "$BENCH_PROJECT/package.json" << 'PKGJSON'
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
PKGJSON

log "  Cold cache runs:"
for i in $(seq 1 $RUNS); do
    cd "$BENCH_PROJECT"
    rm -rf node_modules bun.lock ~/.bun/install/cache
    sync
    s=$(now_ms)
    $BUN install --no-save 2>&1 > /dev/null
    ms=$(( $(now_ms) - s ))
    log "    Run $i: ${ms}ms"
    sleep 1
done

log "  Warm cache runs:"
cd "$BENCH_PROJECT"
rm -rf node_modules bun.lock
$BUN install --no-save 2>&1 > /dev/null
for i in $(seq 1 $RUNS); do
    cd "$BENCH_PROJECT"
    rm -rf node_modules bun.lock
    sync
    s=$(now_ms)
    $BUN install --no-save 2>&1 > /dev/null
    ms=$(( $(now_ms) - s ))
    log "    Run $i: ${ms}ms"
    sleep 1
done

# ── Section 2: Clone benchmark ────────────────────────────────

log ""
log "== Section 2: Clone bare --depth=1 =="

for run in $(seq 1 $RUNS); do
    log "  --- Run $run ---"
    
    git_total=0
    for entry in "${REPOS[@]}"; do
        IFS='|' read -r url name <<< "$entry"
        rm -rf "/tmp/bench_git_$name"
        s=$(now_ms)
        $GIT clone --bare --depth=1 "$url" "/tmp/bench_git_$name" 2>/dev/null
        ms=$(( $(now_ms) - s ))
        git_total=$((git_total + ms))
        log "    git  $name: ${ms}ms"
    done
    log "    git  TOTAL: ${git_total}ms"
    
    zig_total=0
    for entry in "${REPOS[@]}"; do
        IFS='|' read -r url name <<< "$entry"
        rm -rf "/tmp/bench_zig_$name"
        s=$(now_ms)
        $ZIGGIT clone --bare --depth 1 "$url" "/tmp/bench_zig_$name" 2>/dev/null
        ms=$(( $(now_ms) - s ))
        zig_total=$((zig_total + ms))
        log "    ziggit $name: ${ms}ms"
    done
    log "    ziggit TOTAL: ${zig_total}ms"
    sleep 1
done

# ── Section 3: Full workflow ──────────────────────────────────

log ""
log "== Section 3: Full workflow (clone + rev-parse + ls-tree + cat-file ALL blobs) =="

for run in $(seq 1 $RUNS); do
    log "  --- Run $run ---"
    
    git_total=0
    for entry in "${REPOS[@]}"; do
        IFS='|' read -r url name <<< "$entry"
        dir="/tmp/fwb_git_$name"
        rm -rf "$dir"
        
        s=$(now_ms); $GIT clone --bare --depth=1 "$url" "$dir" 2>/dev/null; clone_ms=$(( $(now_ms) - s ))
        s=$(now_ms); $GIT -C "$dir" rev-parse HEAD >/dev/null 2>&1; rev_ms=$(( $(now_ms) - s ))
        s=$(now_ms); files=$($GIT -C "$dir" ls-tree -r HEAD --name-only 2>/dev/null); ls_ms=$(( $(now_ms) - s ))
        nfiles=$(echo "$files" | wc -l)
        blobs=$($GIT -C "$dir" ls-tree -r HEAD 2>/dev/null | awk '{print $3}')
        s=$(now_ms)
        for blob in $blobs; do $GIT -C "$dir" cat-file blob "$blob" > /dev/null 2>&1; done
        cat_ms=$(( $(now_ms) - s ))
        
        total=$((clone_ms + rev_ms + ls_ms + cat_ms))
        git_total=$((git_total + total))
        log "    git  $name (${nfiles}f): clone=$clone_ms rev=$rev_ms ls=$ls_ms cat=$cat_ms total=${total}ms"
    done
    log "    git  TOTAL: ${git_total}ms"
    
    zig_total=0
    for entry in "${REPOS[@]}"; do
        IFS='|' read -r url name <<< "$entry"
        dir="/tmp/fwb_zig_$name"
        rm -rf "$dir"
        
        s=$(now_ms); $ZIGGIT clone --bare --depth 1 "$url" "$dir" 2>/dev/null; clone_ms=$(( $(now_ms) - s ))
        s=$(now_ms); $ZIGGIT -C "$dir" rev-parse HEAD >/dev/null 2>&1; rev_ms=$(( $(now_ms) - s ))
        s=$(now_ms); tree_output=$($ZIGGIT -C "$dir" ls-tree -r HEAD 2>/dev/null); ls_ms=$(( $(now_ms) - s ))
        nfiles=$(echo "$tree_output" | grep -c "blob" || echo 0)
        blobs=$(echo "$tree_output" | awk '{print $3}')
        s=$(now_ms)
        for blob in $blobs; do $ZIGGIT -C "$dir" cat-file blob "$blob" > /dev/null 2>&1; done
        cat_ms=$(( $(now_ms) - s ))
        
        total=$((clone_ms + rev_ms + ls_ms + cat_ms))
        zig_total=$((zig_total + total))
        log "    zig  $name (${nfiles}f): clone=$clone_ms rev=$rev_ms ls=$ls_ms cat=$cat_ms total=${total}ms"
    done
    log "    zig  TOTAL: ${zig_total}ms"
    sleep 1
done

# ── Section 4: Spawn overhead ────────────────────────────────

log ""
log "== Section 4: Spawn overhead (200 iterations) =="
s=$(date +%s%N)
for i in $(seq 1 200); do $GIT --version > /dev/null 2>&1; done
git_ns=$(( ($(date +%s%N) - s) / 200 ))

s=$(date +%s%N)
for i in $(seq 1 200); do $ZIGGIT --version > /dev/null 2>&1; done
zig_ns=$(( ($(date +%s%N) - s) / 200 ))

log "  git spawn: $(echo "scale=2; $git_ns / 1000000" | bc)ms/call"
log "  ziggit spawn: $(echo "scale=2; $zig_ns / 1000000" | bc)ms/call"
log "  delta: $(echo "scale=2; ($zig_ns - $git_ns) / 1000000" | bc)ms/call"
log "  delta x 426 files: $(echo "scale=1; ($zig_ns - $git_ns) * 426 / 1000000" | bc)ms"

log ""
log "=== DONE ==="
