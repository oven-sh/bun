#!/bin/bash
# End-to-end wall-clock: cold-cache `bun install --dry-run` against a local
# HTTP registry serving real packuments from disk. Full HTTP + decompress +
# parse path; no internet jitter.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUN="${BUN:-$ROOT/build/release/bun}"
SCRATCH="${TMPDIR:-/tmp}/bun-dry-run-hf"
RUNS="${RUNS:-15}"
WARMUP="${WARMUP:-3}"

rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"; cd "$SCRATCH"
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

# Start the local registry; capture its URL from stdout.
REGISTRY_URL_FILE="$SCRATCH/registry-url"
"$BUN" "$ROOT/bench/json-simd/local-registry.ts" > "$REGISTRY_URL_FILE" 2>"$SCRATCH/registry.log" &
REG_PID=$!
trap 'kill $REG_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do [[ -s "$REGISTRY_URL_FILE" ]] && break; sleep 0.05; done
REGISTRY_URL="$(cat "$REGISTRY_URL_FILE")"
echo "registry: $REGISTRY_URL"

# Prime: one real install through the proxy to fill the packument cache.
CACHE="$SCRATCH/cache"
rm -rf "$CACHE" bun.lock
BUN_INSTALL_CACHE_DIR="$CACHE" "$BUN" install --lockfile-only --registry "$REGISTRY_URL" >/dev/null 2>&1
echo "primed: $(ls /tmp/bun-packument-cache | wc -l) packuments"

PREP="rm -rf '$CACHE' bun.lock node_modules"

hyperfine --warmup "$WARMUP" --runs "$RUNS" --prepare "$PREP" \
  --command-name "scalar (production today)" \
    "BUN_INSTALL_CACHE_DIR='$CACHE' BUN_NPM_PARSE_SCALAR=1 '$BUN' install --lockfile-only --registry '$REGISTRY_URL'" \
  --command-name "expr+SIMD" \
    "BUN_INSTALL_CACHE_DIR='$CACHE' '$BUN' install --lockfile-only --registry '$REGISTRY_URL'" \
  --command-name "cursor" \
    "BUN_INSTALL_CACHE_DIR='$CACHE' BUN_NPM_PARSE_CURSOR=1 '$BUN' install --lockfile-only --registry '$REGISTRY_URL'"
