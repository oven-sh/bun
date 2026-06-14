#!/usr/bin/env bash
# scripts/audit/bootstrap-vendor.sh — META-VENDOR-BOOTSTRAP
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/bootstrap-vendor.sh
# CANONICAL LOCATION (when audit lands): scripts/audit/bootstrap-vendor.sh
#
# Fix for incidental finding I-2 / I-4: vendor/ directory is empty after a fresh
# git clone. `bun bd --configure-only` generates build_options.rs but does NOT
# fetch vendor sources.
#
# Usage:
#   bootstrap-vendor.sh                    # bootstrap missing vendors
#   bootstrap-vendor.sh --force            # disabled in this staged helper
#   bootstrap-vendor.sh --list             # list vendor specs without fetching
#   bootstrap-vendor.sh --only <lib>       # bootstrap only one library

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

MODE="bootstrap"; ONLY=""; FORCE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --list)  MODE="list"; shift ;;
        --force) FORCE=1; shift ;;
        --only)
            if [[ -z "${2:-}" ]]; then
                echo "--only requires a vendor name" >&2
                exit 2
            fi
            ONLY="$2"; shift 2 ;;
        *)       echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

if [[ "$FORCE" -eq 1 ]]; then
    echo "--force is disabled in this staged audit helper; use a disposable clone/worktree" >&2
    exit 2
fi

collect_vendors() {
    for ts in scripts/build/deps/*.ts; do
        [[ -f "$ts" ]] || continue
        local name commit url repo
        name="$(basename "$ts" .ts)"
        # COMMIT can be either a sha (7-40 hex) OR a git tag/ref
        # (e.g., "v1.1.0", "release-1.27"). Match both shapes.
        # NOTE: each grep gets `|| true` so a file with no COMMIT (e.g., the
        # `index.ts` aggregator) doesn't break the pipefail-protected pipeline.
        commit="$( { grep -oE '[A-Z_]+(_COMMIT|Commit)\s*=\s*[\"'\''][A-Za-z0-9._/-]+[\"'\'']' "$ts" || true; } \
                  | head -1 | sed -E 's/^[^"'\'']*[\"'\'']([^\"'\'']+)[\"'\''].*/\1/')"
        # Bun's deps/*.ts standard format: repo: "org/name" (per the
        # github-archive and direct kinds). Extract that and build a URL.
        repo="$( { grep -oE 'repo:\s*"[A-Za-z0-9_./-]+"' "$ts" || true; } | head -1 \
                | sed -E 's/repo:[[:space:]]*"([^"]+)"/\1/')"
        if [[ -n "$repo" ]]; then
            url="https://github.com/${repo}.git"
        else
            url="$( { grep -oE 'https://github\.com/[A-Za-z0-9_./-]+' "$ts" || true; } | head -1)"
            [[ -n "$url" ]] && url="${url%.git}.git"
        fi
        [[ -z "$url" ]] && url="<unknown: no repo field or github URL>"
        # NOTE: `IFS=$'\t' read` COLLAPSES consecutive tabs (bash treats tab
        # as whitespace for IFS splitting), so an empty commit between two
        # tabs would silently merge the URL into the commit field. Use the
        # non-whitespace SOH (0x01) byte instead — `read` won't collapse it.
        printf '%s\x01%s\x01%s\n' "$name" "$commit" "$url"
    done
}

if [[ "$MODE" == "list" ]]; then
    printf '%-25s %-42s %s\n' NAME COMMIT URL
    while IFS=$'\x01' read -r name commit url; do
        printf '%-25s %-42s %s\n' "$name" "${commit:-<unknown>}" "$url"
    done < <(collect_vendors)
    exit 0
fi

bootstrap_count=0; skip_count=0; fail_count=0
while IFS=$'\x01' read -r name commit url; do
    [[ -n "$ONLY" && "$ONLY" != "$name" ]] && continue
    dest="vendor/$name"
    # Already-bootstrapped detection: vendor/$name is considered ready if
    # EITHER it has .git/ (cloned) OR it has any content (tarball-extracted
    # via the github-archive `kind`, which is Bun's most common deps setup).
    # The I-2 finding this script addresses is "vendor is EMPTY after fresh
    # clone" — so a non-empty directory by any means satisfies the gate.
    if [[ -d "$dest/.git" ]]; then
        echo "[skip] $name: vendor/$name already cloned"; skip_count=$((skip_count+1)); continue
    fi
    if [[ -d "$dest" ]]; then
        shopt -s nullglob dotglob
        existing_entries=("$dest"/*)
        shopt -u nullglob dotglob
        if [[ ${#existing_entries[@]} -gt 0 ]]; then
            echo "[skip] $name: vendor/$name already populated (tarball-extracted or other; not a git clone)"
            skip_count=$((skip_count+1)); continue
        fi
    fi
    if [[ -z "$commit" ]]; then
        echo "[skip] $name: no COMMIT found in scripts/build/deps/$name.ts"; skip_count=$((skip_count+1)); continue
    fi
    if [[ "$url" == "<unknown:"* ]]; then
        echo "[skip] $name: no source repository found in scripts/build/deps/$name.ts"; skip_count=$((skip_count+1)); continue
    fi
    mkdir -p "$dest"
    (
        cd "$dest"
        if [[ ! -d .git ]]; then git init -q; git remote add origin "$url" 2>/dev/null || git remote set-url origin "$url"; fi
        if ! git fetch --depth 1 origin "$commit" 2>/dev/null; then git fetch origin || true; fi
        git checkout --detach "$commit"
    ) > /tmp/bootstrap-vendor.$name.log 2>&1 \
      && { echo "[ok]   $name @ $commit"; bootstrap_count=$((bootstrap_count+1)); } \
      || { echo "[fail] $name @ $commit (/tmp/bootstrap-vendor.$name.log)"; fail_count=$((fail_count+1)); }
done < <(collect_vendors)

echo ""; echo "Summary: bootstrap=$bootstrap_count skip=$skip_count fail=$fail_count"
[[ $fail_count -eq 0 ]]
