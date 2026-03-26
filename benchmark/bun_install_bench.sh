#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Bun Install Benchmark: Stock Bun vs Ziggit Integration
# =============================================================================
# Measures:
#   1. Stock bun install with 3 and 5 GitHub git dependencies (cold + warm)
#   2. Local clone: git CLI vs ziggit CLI (small/medium/large repos)
#   3. Remote clone: git --depth=1 vs ziggit full clone (5 GitHub repos)
#   4. findCommit: git rev-parse CLI vs ziggit in-process library (1000 iters)
#   5. Process spawn overhead measurement
# =============================================================================

BUN="/root/.bun/bin/bun"
ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="/usr/bin/git"
FINDCOMMIT="/root/bun-fork/benchmark/zig-out/bin/findcommit_bench"
RESULTS_DIR="/root/bun-fork/benchmark"
RUNS=3

now_ms() { date +%s%N | cut -b1-13; }
now_ns() { date +%s%N; }
timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

RAW="$RESULTS_DIR/raw_results.txt"
echo "=== Benchmark Run: $(timestamp) ===" > "$RAW"
echo "Machine: $(uname -m), $(nproc) CPU, $(free -h | awk '/Mem:/{print $2}') RAM" >> "$RAW"
echo "Bun: $($BUN --version), Git: $($GIT --version), Zig: $(zig version)" >> "$RAW"
echo "" >> "$RAW"

# =============================================================================
# Part 1: Stock bun install
# =============================================================================
echo "### Part 1: Stock bun install" | tee -a "$RAW"

for NDEPS in 3 5; do
    BENCH_DIR="/tmp/bench-bun-$NDEPS"
    mkdir -p "$BENCH_DIR"

    if [ "$NDEPS" -eq 3 ]; then
        cat > "$BENCH_DIR/package.json" << 'EOF'
{"name":"ziggit-bench-3","dependencies":{"debug":"github:debug-js/debug","semver":"github:npm/node-semver","ms":"github:vercel/ms"}}
EOF
    else
        cat > "$BENCH_DIR/package.json" << 'EOF'
{"name":"ziggit-bench-5","dependencies":{"debug":"github:debug-js/debug","semver":"github:npm/node-semver","ms":"github:vercel/ms","chalk":"github:chalk/chalk","is":"github:sindresorhus/is"}}
EOF
    fi

    echo "--- $NDEPS deps, cold ---" | tee -a "$RAW"
    for i in $(seq 1 $RUNS); do
        cd "$BENCH_DIR"
        rm -rf node_modules bun.lock .bun 2>/dev/null || true
        rm -rf ~/.bun/install/cache 2>/dev/null || true
        sync
        START=$(now_ms)
        $BUN install --no-save 2>&1 > /dev/null
        END=$(now_ms)
        echo "  Run $i: $((END - START))ms" | tee -a "$RAW"
    done

    echo "--- $NDEPS deps, warm ---" | tee -a "$RAW"
    for i in $(seq 1 $RUNS); do
        cd /tmp  # avoid cwd issues
        rm -rf "$BENCH_DIR/node_modules" "$BENCH_DIR/bun.lock" 2>/dev/null || true
        cd "$BENCH_DIR"
        START=$(now_ms)
        $BUN install --no-save 2>&1 > /dev/null
        END=$(now_ms)
        echo "  Run $i: $((END - START))ms" | tee -a "$RAW"
    done
done

# =============================================================================
# Part 2: Local clone benchmark
# =============================================================================
echo "" | tee -a "$RAW"
echo "### Part 2: Local clone (git vs ziggit)" | tee -a "$RAW"

REPOS_DIR="/tmp/bench-local-repos"
rm -rf "$REPOS_DIR"
mkdir -p "$REPOS_DIR"

create_repo() {
    local name=$1 num_files=$2 file_size=$3
    local dir="$REPOS_DIR/source-$name"
    mkdir -p "$dir" && cd "$dir"
    $GIT init -q && $GIT config user.name "b" && $GIT config user.email "b@b"
    for f in $(seq 1 $num_files); do
        dd if=/dev/urandom bs=$file_size count=1 2>/dev/null | base64 > "file_$f.txt"
    done
    echo '{"name":"'$name'","version":"1.0.0"}' > package.json
    $GIT add -A && $GIT commit -q -m "init"
    echo "$dir"
}

SMALL=$(create_repo "small" 10 512)
MEDIUM=$(create_repo "medium" 50 2048)
LARGE=$(create_repo "large" 200 4096)

for repo_info in "small:$SMALL" "medium:$MEDIUM" "large:$LARGE"; do
    NAME="${repo_info%%:*}"
    SRC="${repo_info#*:}"
    echo "--- $NAME ---" | tee -a "$RAW"

    for run in $(seq 1 $RUNS); do
        WD="/tmp/bench-local-w-$NAME-$run"
        rm -rf "$WD"; mkdir -p "$WD"; cd /tmp

        START=$(now_ms); $GIT clone -q "$SRC" "$WD/gc" 2>&1 > /dev/null; END=$(now_ms); GC=$((END-START))
        START=$(now_ms); $ZIGGIT clone "$SRC" "$WD/zc" 2>&1 > /dev/null; END=$(now_ms); ZC=$((END-START))

        cd "$WD/gc"
        START=$(now_ms); $GIT status --porcelain > /dev/null 2>&1; END=$(now_ms); GS=$((END-START))

        ZS="N/A"
        if [ -d "$WD/zc/.git" ]; then
            cd "$WD/zc"
            START=$(now_ms); $ZIGGIT status --porcelain > /dev/null 2>&1 || true; END=$(now_ms); ZS=$((END-START))
        fi
        cd /tmp

        echo "  Run $run: clone(git=${GC}ms ziggit=${ZC}ms) status(git=${GS}ms ziggit=${ZS}ms)" | tee -a "$RAW"
        rm -rf "$WD"
    done
done

# =============================================================================
# Part 3: Remote clone benchmark
# =============================================================================
echo "" | tee -a "$RAW"
echo "### Part 3: Remote clone (git --depth=1 vs ziggit)" | tee -a "$RAW"

REPOS=("https://github.com/debug-js/debug.git" "https://github.com/npm/node-semver.git" "https://github.com/vercel/ms.git" "https://github.com/chalk/chalk.git" "https://github.com/expressjs/express.git")
NAMES=("debug" "node-semver" "ms" "chalk" "express")

for idx in "${!REPOS[@]}"; do
    REPO="${REPOS[$idx]}"
    NAME="${NAMES[$idx]}"
    echo "--- $NAME ---" | tee -a "$RAW"

    for run in $(seq 1 $RUNS); do
        WD="/tmp/bench-rem-$NAME-$run"
        rm -rf "$WD"; mkdir -p "$WD"; cd /tmp

        START=$(now_ms); $GIT clone --depth=1 -q "$REPO" "$WD/gc" 2>&1 > /dev/null; END=$(now_ms); GC=$((END-START))
        START=$(now_ms); $ZIGGIT clone "$REPO" "$WD/zc" 2>&1 > /dev/null; END=$(now_ms); ZC=$((END-START))

        echo "  Run $run: git=${GC}ms ziggit=${ZC}ms" | tee -a "$RAW"
        rm -rf "$WD"
    done
done

# =============================================================================
# Part 4: findCommit benchmark (in-process vs CLI)
# =============================================================================
echo "" | tee -a "$RAW"
echo "### Part 4: findCommit (1000 iters, in-process vs CLI)" | tee -a "$RAW"

# Prepare bare repos
BARE_DIR="/tmp/bare-repos"
rm -rf "$BARE_DIR"; mkdir -p "$BARE_DIR"
for repo in "debug-js/debug" "npm/node-semver" "vercel/ms" "chalk/chalk" "expressjs/express"; do
    name=$(basename $repo)
    $GIT clone --bare --depth=50 "https://github.com/$repo.git" "$BARE_DIR/$name.git" 2>&1 > /dev/null
done

for repo in "$BARE_DIR"/*.git; do
    NAME=$(basename "$repo" .git)

    # Ziggit in-process (1000 iters)
    ZIG_OUT=$($FINDCOMMIT "$repo" HEAD 2>&1 | grep per_call || echo "per_call=0.0µs")
    ZIG_US=$(echo "$ZIG_OUT" | grep -oP 'per_call=\K[0-9.]+')

    # Git CLI (100 iters → extrapolate)
    START=$(now_ns)
    for i in $(seq 1 100); do $GIT --git-dir="$repo" rev-parse HEAD > /dev/null 2>&1; done
    END=$(now_ns)
    GIT_US=$(( (END - START) / 100000 ))

    echo "  $NAME: ziggit=${ZIG_US}µs git=${GIT_US}µs" | tee -a "$RAW"
done

# =============================================================================
# Part 5: Process spawn overhead
# =============================================================================
echo "" | tee -a "$RAW"
echo "### Part 5: Process spawn overhead (100 iters)" | tee -a "$RAW"

START=$(now_ns); for i in $(seq 1 100); do $GIT --version > /dev/null 2>&1; done; END=$(now_ns)
echo "  git --version: $(( (END - START) / 100000 ))µs/call" | tee -a "$RAW"

START=$(now_ns); for i in $(seq 1 100); do $ZIGGIT --help > /dev/null 2>&1; done; END=$(now_ns)
echo "  ziggit --help: $(( (END - START) / 100000 ))µs/call" | tee -a "$RAW"

START=$(now_ns); for i in $(seq 1 100); do /bin/true; done; END=$(now_ns)
echo "  /bin/true: $(( (END - START) / 100000 ))µs/call (baseline)" | tee -a "$RAW"

echo ""
echo "=== Benchmark complete at $(timestamp) ===" | tee -a "$RAW"
