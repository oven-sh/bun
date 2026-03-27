#!/usr/bin/env bash
# bun_install_bench.sh - Benchmark ziggit vs git CLI for bun install git dep workflow
#
# Simulates what bun install does for each git dependency:
#   1. clone --bare (fetch repo to local cache)
#   2. rev-parse HEAD (resolve ref to SHA - findCommit)
#   3. clone (extract working tree from bare clone - checkout)
#
# Compares:
#   A) ziggit CLI (pure Zig library, same code path as bun fork integration)
#   B) git CLI (what stock bun spawns as subprocesses)

set -euo pipefail

ZIGGIT="/root/ziggit/zig-out/bin/ziggit"
GIT="git"
BENCH_DIR="/tmp/bun-install-bench"
RESULTS_FILE="$BENCH_DIR/results.txt"
RUNS=3

# Repos bun install would fetch as git deps
REPOS=(
    "https://github.com/debug-js/debug.git"
    "https://github.com/npm/node-semver.git"
    "https://github.com/vercel/ms.git"
)
REPO_NAMES=(debug semver ms)

rm -rf "$BENCH_DIR"
mkdir -p "$BENCH_DIR/sources"

echo "=============================================="
echo " BUN INSTALL GIT DEP WORKFLOW BENCHMARK"
echo "=============================================="
echo ""
echo "Ziggit: $($ZIGGIT -v 2>&1 | head -1)"
echo "Git:    $($GIT --version)"
echo "Date:   $(date -u)"
echo "System: $(uname -sr), $(free -m | awk '/Mem:/{print $2}')MB RAM"
echo ""

# Pre-clone repos to local disk (isolate clone perf from network)
echo "--- Preparing source repos (one-time network fetch) ---"
for i in "${!REPOS[@]}"; do
    name="${REPO_NAMES[$i]}"
    url="${REPOS[$i]}"
    echo "  Fetching $name..."
    git clone --bare --quiet "$url" "$BENCH_DIR/sources/$name.git" 2>/dev/null
done
echo "  Done."
echo ""

# Helper: time in nanoseconds
now_ns() { date +%s%N; }

# ======================================================
# BENCHMARK: Full bun-install workflow per repo
# ======================================================

declare -A git_clone_times ziggit_clone_times
declare -A git_findcommit_times ziggit_findcommit_times
declare -A git_checkout_times ziggit_checkout_times
declare -A git_total_times ziggit_total_times

for i in "${!REPO_NAMES[@]}"; do
    name="${REPO_NAMES[$i]}"
    src="$BENCH_DIR/sources/$name.git"

    echo "=== Repo: $name ==="

    git_clone_sum=0; ziggit_clone_sum=0
    git_fc_sum=0; ziggit_fc_sum=0
    git_co_sum=0; ziggit_co_sum=0

    for run in $(seq 1 $RUNS); do
        # --- GIT CLI workflow ---
        rm -rf "$BENCH_DIR/git-bare-$name" "$BENCH_DIR/git-work-$name"

        # 1. clone --bare
        t0=$(now_ns)
        $GIT clone --bare --quiet "$src" "$BENCH_DIR/git-bare-$name" 2>/dev/null
        t1=$(now_ns)
        git_clone_ms=$(( (t1 - t0) / 1000000 ))

        # 2. rev-parse HEAD (findCommit)
        t0=$(now_ns)
        $GIT -C "$BENCH_DIR/git-bare-$name" rev-parse HEAD >/dev/null 2>&1
        t1=$(now_ns)
        git_fc_ms=$(( (t1 - t0) / 1000000 ))

        # 3. clone from bare (checkout)
        t0=$(now_ns)
        $GIT clone --quiet "$BENCH_DIR/git-bare-$name" "$BENCH_DIR/git-work-$name" 2>/dev/null
        t1=$(now_ns)
        git_co_ms=$(( (t1 - t0) / 1000000 ))

        git_total=$((git_clone_ms + git_fc_ms + git_co_ms))
        git_clone_sum=$((git_clone_sum + git_clone_ms))
        git_fc_sum=$((git_fc_sum + git_fc_ms))
        git_co_sum=$((git_co_sum + git_co_ms))

        # --- ZIGGIT workflow ---
        rm -rf "$BENCH_DIR/ziggit-bare-$name" "$BENCH_DIR/ziggit-work-$name"

        # 1. clone --bare
        t0=$(now_ns)
        $ZIGGIT clone --bare "$src" "$BENCH_DIR/ziggit-bare-$name" >/dev/null 2>&1
        t1=$(now_ns)
        ziggit_clone_ms=$(( (t1 - t0) / 1000000 ))

        # 2. rev-parse HEAD (findCommit)
        t0=$(now_ns)
        (cd "$BENCH_DIR/ziggit-bare-$name" && $ZIGGIT rev-parse HEAD >/dev/null 2>&1)
        t1=$(now_ns)
        ziggit_fc_ms=$(( (t1 - t0) / 1000000 ))

        # 3. clone from bare (checkout)
        t0=$(now_ns)
        $ZIGGIT clone "$BENCH_DIR/ziggit-bare-$name" "$BENCH_DIR/ziggit-work-$name" >/dev/null 2>&1
        t1=$(now_ns)
        ziggit_co_ms=$(( (t1 - t0) / 1000000 ))

        ziggit_total=$((ziggit_clone_ms + ziggit_fc_ms + ziggit_co_ms))
        ziggit_clone_sum=$((ziggit_clone_sum + ziggit_clone_ms))
        ziggit_fc_sum=$((ziggit_fc_sum + ziggit_fc_ms))
        ziggit_co_sum=$((ziggit_co_sum + ziggit_co_ms))

        printf "  Run %d: git=%dms ziggit=%dms (clone: %d/%d, findCommit: %d/%d, checkout: %d/%d)\n" \
            "$run" "$git_total" "$ziggit_total" \
            "$git_clone_ms" "$ziggit_clone_ms" \
            "$git_fc_ms" "$ziggit_fc_ms" \
            "$git_co_ms" "$ziggit_co_ms"

        # Cleanup work dirs
        rm -rf "$BENCH_DIR/git-bare-$name" "$BENCH_DIR/git-work-$name"
        rm -rf "$BENCH_DIR/ziggit-bare-$name" "$BENCH_DIR/ziggit-work-$name"
    done

    git_clone_times[$name]=$((git_clone_sum / RUNS))
    ziggit_clone_times[$name]=$((ziggit_clone_sum / RUNS))
    git_findcommit_times[$name]=$((git_fc_sum / RUNS))
    ziggit_findcommit_times[$name]=$((ziggit_fc_sum / RUNS))
    git_checkout_times[$name]=$((git_co_sum / RUNS))
    ziggit_checkout_times[$name]=$((ziggit_co_sum / RUNS))
    git_total_times[$name]=$((git_clone_sum / RUNS + git_fc_sum / RUNS + git_co_sum / RUNS))
    ziggit_total_times[$name]=$((ziggit_clone_sum / RUNS + ziggit_fc_sum / RUNS + ziggit_co_sum / RUNS))

    echo ""
done

# ======================================================
# SUMMARY
# ======================================================

echo "=============================================="
echo " SUMMARY (averages over $RUNS runs)"
echo "=============================================="
echo ""
printf "%-8s | %8s %8s | %8s %8s | %8s %8s | %8s %8s | %s\n" \
    "Repo" "git-cln" "zig-cln" "git-fc" "zig-fc" "git-co" "zig-co" "git-tot" "zig-tot" "Speedup"
printf "%s\n" "---------|-------------------|--------------------|--------------------|--------------------|--------"

total_git=0
total_ziggit=0
for name in "${REPO_NAMES[@]}"; do
    gt=${git_total_times[$name]}
    zt=${ziggit_total_times[$name]}
    total_git=$((total_git + gt))
    total_ziggit=$((total_ziggit + zt))
    if [ "$zt" -gt 0 ]; then
        speedup=$(echo "scale=2; $gt / $zt" | bc)
    else
        speedup="inf"
    fi
    printf "%-8s | %6dms %6dms | %6dms %6dms | %6dms %6dms | %6dms %6dms | %sx\n" \
        "$name" \
        "${git_clone_times[$name]}" "${ziggit_clone_times[$name]}" \
        "${git_findcommit_times[$name]}" "${ziggit_findcommit_times[$name]}" \
        "${git_checkout_times[$name]}" "${ziggit_checkout_times[$name]}" \
        "$gt" "$zt" "$speedup"
done

echo ""
if [ "$total_ziggit" -gt 0 ]; then
    overall_speedup=$(echo "scale=2; $total_git / $total_ziggit" | bc)
else
    overall_speedup="inf"
fi
echo "TOTAL: git=${total_git}ms ziggit=${total_ziggit}ms speedup=${overall_speedup}x"
echo ""

# Save machine-readable results
cat > "$RESULTS_FILE" << ENDRESULTS
RUNS=$RUNS
TOTAL_GIT=$total_git
TOTAL_ZIGGIT=$total_ziggit
OVERALL_SPEEDUP=$overall_speedup
ENDRESULTS
for name in "${REPO_NAMES[@]}"; do
    cat >> "$RESULTS_FILE" << ENDRESULTS
${name}_git_clone=${git_clone_times[$name]}
${name}_ziggit_clone=${ziggit_clone_times[$name]}
${name}_git_fc=${git_findcommit_times[$name]}
${name}_ziggit_fc=${ziggit_findcommit_times[$name]}
${name}_git_co=${git_checkout_times[$name]}
${name}_ziggit_co=${ziggit_checkout_times[$name]}
${name}_git_total=${git_total_times[$name]}
${name}_ziggit_total=${ziggit_total_times[$name]}
ENDRESULTS
done

echo "Raw results saved to $RESULTS_FILE"
