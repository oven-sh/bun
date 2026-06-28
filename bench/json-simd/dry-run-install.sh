#!/bin/bash
# Cold-cache `bun install --dry-run` benchmark: PackageManifest::parse() vs
# parse_cursor(). --dry-run resolves (downloads + parses every packument) but
# never fetches tarballs, links node_modules, or runs lifecycle scripts.
#
# Network is hit on every run (cold cache), so wall-clock includes registry
# round-trips; the [npm parse] line isolates the manifest-parse time.

set -euo pipefail
BUN="${BUN:-$(cd "$(dirname "$0")/../.." && pwd)/build/release/bun}"
SCRATCH="${TMPDIR:-/tmp}/bun-dry-run-bench"
RUNS="${RUNS:-3}"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
cd "$SCRATCH"

cat > package.json <<'EOF'
{
  "name": "dry-run-bench",
  "private": true,
  "dependencies": {
    "next": "^14",
    "react": "^18",
    "react-dom": "^18",
    "typescript": "^5",
    "@types/react": "^18",
    "@types/node": "^20",
    "tailwindcss": "^3",
    "eslint": "^8",
    "prettier": "^3",
    "vite": "^5",
    "vitest": "^1",
    "express": "^4",
    "lodash": "^4",
    "axios": "^1",
    "zod": "^3"
  }
}
EOF

run_mode () {
  local label="$1"; shift
  echo
  echo "── mode: $label ──"
  for i in $(seq 1 "$RUNS"); do
    rm -rf bun.lock node_modules cache
    local out
    out=$(BUN_INSTALL_CACHE_DIR="$SCRATCH/cache" BUN_NPM_PARSE_STATS=1 \
      "$@" /usr/bin/time -f 'wall=%es' "$BUN" install --dry-run 2>&1)
    local parse wall
    parse=$(printf '%s\n' "$out" | grep '^\[npm parse\]' || true)
    wall=$(printf '%s\n' "$out" | grep '^wall=' || true)
    printf '  [%d] %s  %s\n' "$i" "$wall" "$parse"
    rm -rf cache
  done
}

# Warm DNS + TCP once so the first timed run isn't penalised.
rm -rf cache bun.lock
BUN_INSTALL_CACHE_DIR="$SCRATCH/cache" "$BUN" install --dry-run >/dev/null 2>&1 || true
rm -rf cache bun.lock

run_mode "parse() — Expr + scalar JSON (production today)" env BUN_NPM_PARSE_SCALAR=1
run_mode "parse() — Expr + SIMD JSON" env
run_mode "parse_cursor() — JsonCursor" env BUN_NPM_PARSE_CURSOR=1

echo
echo "(wall-clock includes network; [npm parse] is the manifest-parse total)"
