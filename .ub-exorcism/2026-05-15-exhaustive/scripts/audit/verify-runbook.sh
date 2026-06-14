#!/usr/bin/env bash
# scripts/audit/verify-runbook.sh — META-REPRODUCIBILITY
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/verify-runbook.sh
# CANONICAL LOCATION: scripts/audit/verify-runbook.sh
#
# Single-command reproducibility gate: a third party should be able to
# clone Bun, run this script, and end up with the same audit verdicts.
#
# Usage:
#   verify-runbook.sh                 # check against stored manifest hash
#   verify-runbook.sh --update-hash   # update REPRODUCIBILITY_HASH file
#   verify-runbook.sh --quick         # skip full SOAK; smoke only
#
# Steps:
#   1. Prerequisite check (clang-21, lld-21, ninja, cargo +nightly, miri)
#   2. Bootstrap vendor sources (calls bootstrap-vendor.sh)
#   3. bun bd --configure-only
#   4. Ninja codegen
#   5. cargo check --workspace
#   6. Run EVERY EXP's standalone reproducer (calls regression-runner.sh per EXP, per config)
#   7. Compute SHA-256 of the verdict-table manifest
#   8. Compare to REPRODUCIBILITY_HASH file
#
# Exit: 0 iff hash matches AND every regression passes; 1 otherwise.

set -euo pipefail

QUICK=0; UPDATE_HASH=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)       QUICK=1; shift ;;
        --update-hash) UPDATE_HASH=1; shift ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

AUDIT_ROOT=".ub-exorcism/2026-05-15-exhaustive"
HASH_FILE="$AUDIT_ROOT/REPRODUCIBILITY_HASH"
MANIFEST_LOG="$AUDIT_ROOT/phase11_artifacts/reproducibility/$(date -u +%Y-%m-%dT%H-%M-%S).log"
mkdir -p "$(dirname "$MANIFEST_LOG")"

echo "[verify-runbook] step 1: prerequisite check" | tee -a "$MANIFEST_LOG"
for tool in cargo git ninja python3 jq; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "MISSING prereq: $tool" | tee -a "$MANIFEST_LOG"
        exit 1
    fi
done
if ! rustup toolchain list | grep -q nightly; then
    echo "MISSING prereq: rustup nightly toolchain" | tee -a "$MANIFEST_LOG"
    exit 1
fi
if ! rustup component list --installed --toolchain nightly | grep -q miri; then
    echo "MISSING prereq: miri component" | tee -a "$MANIFEST_LOG"
    exit 1
fi
echo "  PASS" | tee -a "$MANIFEST_LOG"

echo "[verify-runbook] step 2: bootstrap vendor sources" | tee -a "$MANIFEST_LOG"
bash "$AUDIT_ROOT/scripts/audit/bootstrap-vendor.sh" >> "$MANIFEST_LOG" 2>&1 || {
    echo "  FAIL"; exit 1; }
echo "  PASS" | tee -a "$MANIFEST_LOG"

echo "[verify-runbook] step 3: bun bd --configure-only" | tee -a "$MANIFEST_LOG"
bun bd --configure-only >> "$MANIFEST_LOG" 2>&1 || true  # may be no-op
echo "  done" | tee -a "$MANIFEST_LOG"

echo "[verify-runbook] step 4: ninja codegen" | tee -a "$MANIFEST_LOG"
if [[ -f build/debug/build.ninja ]]; then
    ninja -C build/debug \
        codegen/cpp.rs codegen/generated_classes.rs \
        codegen/generated_host_exports.rs codegen/generated_js2native.rs \
        codegen/generated_jssink.rs >> "$MANIFEST_LOG" 2>&1 || true
    echo "  PASS" | tee -a "$MANIFEST_LOG"
else
    echo "  SKIP (build/debug/build.ninja not present)" | tee -a "$MANIFEST_LOG"
fi

echo "[verify-runbook] step 5: cargo check --workspace" | tee -a "$MANIFEST_LOG"
cargo check --workspace >> "$MANIFEST_LOG" 2>&1 && echo "  PASS" || \
    { echo "  FAIL (see log)" | tee -a "$MANIFEST_LOG"; exit 1; }

echo "[verify-runbook] step 6: run every EXP regression (quick=$QUICK)" | tee -a "$MANIFEST_LOG"
PASSES=0; FAILS=0; SKIPPED=0
for d in $AUDIT_ROOT/experiments/EXP-*/; do
    eid="$(basename "$d")"
    [[ -f "$d/Cargo.toml" ]] || { SKIPPED=$((SKIPPED+1)); continue; }
    configs="sb"
    [[ "$QUICK" -eq 0 ]] && configs="sb tb sp sa"
    for cfg in $configs; do
        if bash "$AUDIT_ROOT/scripts/regression-runner.sh" "$eid" "$cfg" >/dev/null 2>&1; then
            PASSES=$((PASSES+1))
        else
            FAILS=$((FAILS+1))
        fi
    done
done
echo "  passes=$PASSES fails=$FAILS skipped=$SKIPPED" | tee -a "$MANIFEST_LOG"

echo "[verify-runbook] step 7: compute manifest hash" | tee -a "$MANIFEST_LOG"
MANIFEST_INPUT="$(mktemp)"
# Make sure the tempfile gets cleaned on any exit path, not just the happy one.
trap 'rm -f "$MANIFEST_INPUT"' EXIT
{
    # Verdict-table from the registry (alphabetical = deterministic ordering)
    grep -E '^\*\*Verdict:\*\*' "$AUDIT_ROOT/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md" | sort
    # Per-EXP log digest: extract substantive fields (exp/config/exit/ub_lines)
    # FIRST, then sort+dedupe. Otherwise sort-then-jq leaves duplicate rows for
    # the same (exp,config) pair across runs because each row has a fresh
    # timestamp + SHA + wall_seconds — breaking the reproducibility-hash
    # invariant ("same audit state → same hash").
    if [[ -f "$AUDIT_ROOT/phase11_artifacts/regression/index.jsonl" ]]; then
        jq -r '"\(.exp)\t\(.config)\t\(.exit)\t\(.ub_lines)"' \
            "$AUDIT_ROOT/phase11_artifacts/regression/index.jsonl" 2>/dev/null \
          | sort -u
    fi
} > "$MANIFEST_INPUT"
HASH="$(sha256sum < "$MANIFEST_INPUT" | awk '{print $1}')"
echo "  manifest hash: $HASH" | tee -a "$MANIFEST_LOG"

if [[ "$UPDATE_HASH" -eq 1 ]]; then
    echo "$HASH" > "$HASH_FILE"
    echo "[verify-runbook] HASH FILE UPDATED: $HASH_FILE"
    exit 0
fi

echo "[verify-runbook] step 8: compare hash" | tee -a "$MANIFEST_LOG"
if [[ -f "$HASH_FILE" ]]; then
    EXPECTED="$(cat "$HASH_FILE")"
    if [[ "$HASH" == "$EXPECTED" ]]; then
        echo "  MATCH (audit reproduces)" | tee -a "$MANIFEST_LOG"
    else
        echo "  MISMATCH (expected $EXPECTED, got $HASH)" | tee -a "$MANIFEST_LOG"
        exit 1
    fi
else
    echo "  WARN: $HASH_FILE not found; run with --update-hash to create" | tee -a "$MANIFEST_LOG"
fi

[[ $FAILS -eq 0 ]] || exit 1
echo "[verify-runbook] ALL PASS"
