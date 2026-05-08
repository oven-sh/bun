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

TOTAL=$(wc -l < "$DIAG/all.txt")
echo "[scoreboard] running $TOTAL files (timeout 15s each, -P32)..." >&2

cat "$DIAG/all.txt" | xargs -P 32 -I{} sh -c '
  slug=$(echo "{}" | tr / _)
  timeout 15 '"$BIN"' test "{}" > '"$DIAG"'/"$slug".log 2>&1
  rc=$?
  echo "{}|$rc"
' >> "$DIAG/results.txt"

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
