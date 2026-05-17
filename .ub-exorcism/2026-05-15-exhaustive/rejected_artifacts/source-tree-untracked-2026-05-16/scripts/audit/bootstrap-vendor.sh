#!/usr/bin/env bash
echo "This is a quarantined rejected artifact from the UB audit; do not run it." >&2
exit 2
# scripts/audit/bootstrap-vendor.sh — META-VENDOR-BOOTSTRAP
#
# Fix for incidental finding I-2 / I-4: vendor/lolhtml (and any other vendor
# C library Bun depends on via a *_sys crate) is empty after a fresh git clone.
# `bun bd --configure-only` generates build_options.rs but does NOT fetch
# vendor sources. This script does the missing vendor-fetch step idempotently.
#
# Usage:
#   scripts/audit/bootstrap-vendor.sh                    # bootstrap missing vendors
#   scripts/audit/bootstrap-vendor.sh --force            # re-bootstrap all (skips no-op detection)
#   scripts/audit/bootstrap-vendor.sh --list             # list vendor specs without fetching
#   scripts/audit/bootstrap-vendor.sh --only <lib>       # bootstrap only one library
#
# Each vendor library is specified in scripts/build/deps/<lib>.ts with a
# pinned commit SHA + upstream URL; this script extracts those and runs
# `git clone --depth 1 <url> vendor/<lib>; git -C vendor/<lib> checkout <sha>`.
#
# Reads-from: scripts/build/deps/*.ts (look for LIB_COMMIT and LIB_URL constants)
# Writes-to: vendor/<lib>/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

MODE="bootstrap"
ONLY=""
FORCE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --list)  MODE="list"; shift ;;
        --force) FORCE=1; shift ;;
        --only)  ONLY="$2"; shift 2 ;;
        *)       echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

# Parse scripts/build/deps/*.ts for {name, commit, url} triples.
# Heuristic: each <lib>.ts has lines like:
#     export const LIB_COMMIT = "<sha>";
#     // upstream: https://github.com/<org>/<repo>
# We grab name from filename, commit from LIB_COMMIT, url from a heuristic
# pattern in the file (any github.com URL).
collect_vendors() {
    for ts in scripts/build/deps/*.ts; do
        [[ -f "$ts" ]] || continue
        local name commit url
        name="$(basename "$ts" .ts)"
        commit="$(grep -oE 'COMMIT\s*=\s*"[a-f0-9]{7,40}"' "$ts" | head -1 | sed 's/.*"\([a-f0-9]\+\)".*/\1/' || echo '')"
        url="$(grep -oE 'https://github\.com/[A-Za-z0-9_./-]+\.git' "$ts" | head -1 || \
               grep -oE 'https://github\.com/[A-Za-z0-9_./-]+' "$ts" | head -1 || \
               echo '')"
        [[ -z "$url" ]] && url="https://github.com/oven-sh/$name"
        # Drop trailing .git for cloning (git accepts either)
        url="${url%.git}.git"
        echo -e "$name\t$commit\t$url"
    done
}

if [[ "$MODE" == "list" ]]; then
    printf '%-25s %-42s %s\n' NAME COMMIT URL
    while IFS=$'\t' read -r name commit url; do
        printf '%-25s %-42s %s\n' "$name" "${commit:-<unknown>}" "$url"
    done < <(collect_vendors)
    exit 0
fi

# Bootstrap loop
bootstrap_count=0
skip_count=0
fail_count=0

while IFS=$'\t' read -r name commit url; do
    [[ -n "$ONLY" && "$ONLY" != "$name" ]] && continue

    dest="vendor/$name"
    if [[ -d "$dest/.git" ]] && [[ "$FORCE" -eq 0 ]]; then
        echo "[skip] $name: vendor/$name already cloned"
        skip_count=$((skip_count+1))
        continue
    fi

    if [[ -z "$commit" ]]; then
        echo "[skip] $name: no COMMIT found in scripts/build/deps/$name.ts; manual setup required"
        skip_count=$((skip_count+1))
        continue
    fi

    if [[ -d "$dest" && "$FORCE" -eq 1 ]]; then
        echo "[force] $name: re-bootstrap (existing vendor/$name preserved, will be overwritten by git)"
    fi

    mkdir -p "$dest"
    (
        cd "$dest"
        if [[ ! -d .git ]]; then
            git init -q
            git remote add origin "$url" 2>/dev/null || git remote set-url origin "$url"
        fi
        # Fetch just the pinned commit (shallow); fall back to full fetch if shallow fails
        if ! git fetch --depth 1 origin "$commit" 2>/dev/null; then
            echo "  [warn] shallow fetch failed; falling back to full fetch (may be slow)"
            git fetch origin || true
        fi
        git checkout --detach "$commit"
    ) > /tmp/bootstrap-vendor.$name.log 2>&1
    if [[ $? -eq 0 ]]; then
        echo "[ok]   $name @ $commit"
        bootstrap_count=$((bootstrap_count+1))
    else
        echo "[fail] $name @ $commit (log: /tmp/bootstrap-vendor.$name.log)"
        fail_count=$((fail_count+1))
    fi
done < <(collect_vendors)

echo ""
echo "Summary: bootstrap=$bootstrap_count skip=$skip_count fail=$fail_count"
[[ $fail_count -eq 0 ]]
