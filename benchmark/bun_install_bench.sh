#!/usr/bin/env bash
# BUN INSTALL BENCHMARK: Stock bun vs ziggit-simulated git dependency resolution
set -uo pipefail

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
BUN="/root/.bun/bin/bun"
BENCH_DIR="/tmp/bench-workspace"
RUNS=3
OUTFILE="/tmp/bench-raw-results.txt"

REPOS=(
    "https://github.com/chalk/chalk.git"
    "https://github.com/debug-js/debug.git"
    "https://github.com/sindresorhus/is.git"
)
REPO_NAMES=(chalk debug is)

timestamp() { date +%s%N; }
ms_diff() { echo $(( ($2 - $1) / 1000000 )); }
log() { echo "[$(date +%H:%M:%S)] $*"; }

> "$OUTFILE"
cd /tmp  # Stable working directory

log "Starting benchmark"
log "bun: $($BUN --version), git: $($GIT --version | awk '{print $3}')"
log "System: $(nproc) CPU, $(free -h | awk '/Mem:/{print $2}') RAM, $(df -h / | awk 'NR==2{print $4}') disk free"
echo ""

# ============================================================
# SECTION 1: Stock bun install (cold = no cache, warm = cached)
# ============================================================
log "=== SECTION 1: Stock bun install ==="

for run in $(seq 1 $RUNS); do
    rm -rf /tmp/bench-bun-project ~/.bun/install/cache 2>/dev/null || true
    sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
    sleep 1
    mkdir -p /tmp/bench-bun-project
    cat > /tmp/bench-bun-project/package.json << 'EOF'
{
  "name": "ziggit-bench",
  "dependencies": {
    "@sindresorhus/is": "github:sindresorhus/is",
    "chalk": "github:chalk/chalk",
    "debug": "github:debug-js/debug"
  }
}
EOF
    start=$(timestamp)
    (cd /tmp/bench-bun-project && $BUN install --no-progress 2>&1 | tail -3)
    end=$(timestamp)
    elapsed=$(ms_diff $start $end)
    echo "BUN_COLD_RUN${run}=${elapsed}" | tee -a "$OUTFILE"
done

for run in $(seq 1 $RUNS); do
    (cd /tmp/bench-bun-project && rm -rf node_modules bun.lock)
    start=$(timestamp)
    (cd /tmp/bench-bun-project && $BUN install --no-progress 2>&1 | tail -3)
    end=$(timestamp)
    elapsed=$(ms_diff $start $end)
    echo "BUN_WARM_RUN${run}=${elapsed}" | tee -a "$OUTFILE"
done

rm -rf /tmp/bench-bun-project
log "Section 1 done"
echo ""

# ============================================================
# SECTION 2: git CLI bare-clone + resolve + checkout (cold network)
# ============================================================
log "=== SECTION 2: git CLI clone workflow ==="

for run in $(seq 1 $RUNS); do
    rm -rf "$BENCH_DIR/git-run" 2>/dev/null
    sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
    sleep 1
    mkdir -p "$BENCH_DIR/git-run"
    run_total=0

    for i in "${!REPOS[@]}"; do
        repo="${REPOS[$i]}"
        name="${REPO_NAMES[$i]}"
        bare="$BENCH_DIR/git-run/${name}.git"
        work="$BENCH_DIR/git-run/${name}"

        s1=$(timestamp)
        $GIT clone --bare --depth=1 "$repo" "$bare" 2>&1 | grep -v "^$" || true
        e1=$(timestamp)

        sha=$($GIT --git-dir="$bare" rev-parse HEAD 2>/dev/null || echo "N/A")
        e2=$(timestamp)

        mkdir -p "$work"
        $GIT --git-dir="$bare" --work-tree="$work" checkout HEAD -- . 2>/dev/null || true
        e3=$(timestamp)

        clone_ms=$(ms_diff $s1 $e1)
        resolve_ms=$(ms_diff $e1 $e2)
        checkout_ms=$(ms_diff $e2 $e3)
        total_ms=$(ms_diff $s1 $e3)
        run_total=$((run_total + total_ms))

        echo "GIT_${name}_RUN${run}=clone:${clone_ms},resolve:${resolve_ms},checkout:${checkout_ms},total:${total_ms}" | tee -a "$OUTFILE"
    done

    echo "GIT_TOTAL_RUN${run}=${run_total}" | tee -a "$OUTFILE"
    rm -rf "$BENCH_DIR/git-run"
done

log "Section 2 done"
echo ""

# ============================================================
# SECTION 3: ziggit clone workflow (cold network)
# ============================================================
log "=== SECTION 3: ziggit clone workflow ==="

for run in $(seq 1 $RUNS); do
    rm -rf "$BENCH_DIR/ziggit-run" 2>/dev/null
    sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
    sleep 1
    mkdir -p "$BENCH_DIR/ziggit-run"
    run_total=0

    for i in "${!REPOS[@]}"; do
        repo="${REPOS[$i]}"
        name="${REPO_NAMES[$i]}"
        dest="$BENCH_DIR/ziggit-run/${name}"

        s1=$(timestamp)
        $ZIGGIT clone "$repo" "$dest" 2>&1 | grep -v "^$" || true
        e1=$(timestamp)

        sha=$($ZIGGIT -C "$dest" log --format="%H" -n1 2>/dev/null || echo "N/A")
        e2=$(timestamp)

        file_count=$(find "$dest" -maxdepth 1 -not -name '.git' -not -name '.' 2>/dev/null | wc -l)
        e3=$(timestamp)

        clone_ms=$(ms_diff $s1 $e1)
        resolve_ms=$(ms_diff $e1 $e2)
        wt_ms=$(ms_diff $e2 $e3)
        total_ms=$(ms_diff $s1 $e3)
        run_total=$((run_total + total_ms))

        echo "ZIGGIT_${name}_RUN${run}=clone:${clone_ms},resolve:${resolve_ms},wt_check:${wt_ms},total:${total_ms},files:${file_count}" | tee -a "$OUTFILE"
    done

    echo "ZIGGIT_TOTAL_RUN${run}=${run_total}" | tee -a "$OUTFILE"
    rm -rf "$BENCH_DIR/ziggit-run"
done

log "Section 3 done"
echo ""

# ============================================================
# SECTION 4: Head-to-head per-repo (interleaved, drop caches between)
# ============================================================
log "=== SECTION 4: Head-to-head (single repo, cache-cleared) ==="

for i in "${!REPOS[@]}"; do
    repo="${REPOS[$i]}"
    name="${REPO_NAMES[$i]}"
    echo "--- $name ---"
    
    for run in $(seq 1 $RUNS); do
        # git
        rm -rf "$BENCH_DIR/h2h" 2>/dev/null
        sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
        sleep 0.5
        mkdir -p "$BENCH_DIR/h2h"
        s=$(timestamp)
        $GIT clone --depth=1 "$repo" "$BENCH_DIR/h2h/git-${name}" 2>/dev/null || true
        e=$(timestamp)
        git_ms=$(ms_diff $s $e)
        rm -rf "$BENCH_DIR/h2h"
        
        # ziggit
        sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
        sleep 0.5
        mkdir -p "$BENCH_DIR/h2h"
        s=$(timestamp)
        $ZIGGIT clone "$repo" "$BENCH_DIR/h2h/ziggit-${name}" 2>/dev/null || true
        e=$(timestamp)
        ziggit_ms=$(ms_diff $s $e)
        rm -rf "$BENCH_DIR/h2h"
        
        echo "H2H_${name}_RUN${run}=git:${git_ms},ziggit:${ziggit_ms}" | tee -a "$OUTFILE"
    done
done

log "All benchmarks complete"
log "Raw results in $OUTFILE"
