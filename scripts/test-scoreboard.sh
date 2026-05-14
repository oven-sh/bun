#!/bin/bash
# Full test-suite scoreboard. Runs all tests vs current build/debug/bun-debug,
# writes /tmp/SCOREBOARD.md. Idempotent; safe to re-run anytime.
set -uo pipefail
cd /root/bun-5
BIN=./build/debug/bun-debug
OUT=/tmp/SCOREBOARD.md
DIAG=/tmp/scoreboard-logs
mkdir -p "$DIAG"

DIRS=(test/js/bun test/js/node test/js/web test/cli test/bundler test/regression test/integration test/napi)

> "$DIAG/results.txt"
for d in "${DIRS[@]}"; do
  test -d "$d" || continue
  find "$d" -name '*.test.ts' -o -name '*.test.js' -o -name '*.test.tsx' 2>/dev/null
done | sort -u > "$DIAG/all.txt"

test -x "$BIN" || { echo "[scoreboard] $BIN not built — aborting" >&2; exit 1; }
TOTAL=$(wc -l < "$DIAG/all.txt")
echo "[scoreboard] running $TOTAL files (timeout 15s each, -P32, pid-ns isolated)..." >&2

# cgroup: cap memory + pids so a runaway test can't OOM the host or fork-bomb
CG=/sys/fs/cgroup/bun-scoreboard
if [ ! -d "$CG" ]; then
  mkdir -p "$CG"
  echo "+memory +pids" > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
fi
echo 32G   > "$CG/memory.max"    2>/dev/null || true
echo max   > "$CG/pids.max"      2>/dev/null || true

# single-instance lock — daemon also fires this, don't race
exec 9>/tmp/scoreboard.lock
flock -n 9 || { echo "[scoreboard] another run in progress, skipping" >&2; exit 0; }

# per-test isolated TMPDIR (own dir, nuked after) — tests that pollute /tmp
# can't leak into each other or the host
TMPROOT="$DIAG/tmproot"; rm -rf "$TMPROOT"; mkdir -p "$TMPROOT"

# move the xargs supervisor itself into the cgroup so all children inherit
echo $$ > "$CG/cgroup.procs" 2>/dev/null || true

cat "$DIAG/all.txt" | xargs -P 32 -I{} sh -c '
  slug=$(echo "{}" | tr / _)
  td='"$TMPROOT"'/"$slug"; mkdir -p "$td"
  # PID namespace: test sees only its own children, so kill(-1)/pkill cannot
  # touch the host. --mount-proc gives it a clean /proc. --kill-child reaps
  # everything in the namespace on timeout.
  TMPDIR="$td" TEMP="$td" TMP="$td" \
    timeout --kill-after=5 15 \
    unshare --pid --fork --mount-proc --kill-child \
    '"$BIN"' test "{}" > '"$DIAG"'/"$slug".log 2>&1
  rc=$?
  rm -rf "$td"
  echo "{}|$rc"
' >> "$DIAG/results.txt"

# move ourselves back out so the cgroup can be cleaned later
echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null || true

SHA=$(git rev-parse --short HEAD)
{
  echo "# Test Scoreboard @ \`$SHA\` — $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "| dir | files | pass (rc=0) | fail (rc=1) | hang (rc=124) | crash (rc≥128) | other |"
  echo "|---|---|---|---|---|---|---|"
  for d in "${DIRS[@]}"; do
    awk -F'|' -v d="$d/" '
      index($1,d)==1 {
        n++
        if($2==0)p++; else if($2==1)f++; else if($2==124)h++; else if($2>=128)c++; else o++
      }
      END{ if(n>0) printf "| %s | %d | %d | %d | %d | %d | %d |\n", d, n, p, f, h, c, o }
    ' "$DIAG/results.txt"
  done
  awk -F'|' '
    { n++; if($2==0)p++; else if($2==1)f++; else if($2==124)h++; else if($2>=128)c++; else o++ }
    END{ printf "| **TOTAL** | **%d** | **%d** (%.0f%%) | **%d** | **%d** | **%d** | **%d** |\n", n, p, 100.0*p/n, f, h, c, o }
  ' "$DIAG/results.txt"
  echo
  echo "## crashing files"
  awk -F'|' '$2>=128{print "- `"$1"` (rc="$2")"}' "$DIAG/results.txt" | head -30
  echo
  echo "## hanging files (top 30)"
  awk -F'|' '$2==124{print "- `"$1"`"}' "$DIAG/results.txt" | head -30
} > "$OUT"

echo "[scoreboard] → $OUT" >&2
cat "$OUT"
