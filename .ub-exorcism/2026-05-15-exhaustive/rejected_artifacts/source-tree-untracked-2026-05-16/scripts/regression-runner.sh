#!/usr/bin/env bash
echo "This is a quarantined rejected artifact from the UB audit; do not run it." >&2
exit 2
# scripts/regression-runner.sh — META-LOGGING-CONVENTION runner
#
# Runs ONE regression test (Miri config or Bun integration test) for ONE EXP
# and emits a BEGIN/END-bracketed log + an index.jsonl row.
#
# Usage:
#   scripts/regression-runner.sh <EXP-ID> <config>
#
# Configs:
#   sb    Stacked Borrows (default Miri)
#   tb    Tree Borrows
#   sp    Strict Provenance
#   sa    Symbolic Alignment Check
#   integration   Bun integration test (requires test/regression/issue/<N>/<EXP>.test.ts OR test/js/bun/<dir>/<EXP>*.test.ts)
#
# Output:
#   .ub-exorcism/2026-05-15-exhaustive/phase11_artifacts/regression/<EXP>/miri-<cfg>.log
#   .ub-exorcism/2026-05-15-exhaustive/phase11_artifacts/regression/index.jsonl  (appended)
#
# Exit: 0 on clean, non-zero on UB / failure / unexpected timeout.

set -euo pipefail

if [[ $# -lt 2 ]]; then
    echo "usage: $0 <EXP-ID> <sb|tb|sp|sa|integration>" >&2
    exit 2
fi

EXP_ID="$1"
CFG="$2"
NEGATIVE_CONTROL=""
if [[ "${3:-}" == "--negative-control" && -n "${4:-}" ]]; then
    NEGATIVE_CONTROL="$4"
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUDIT_ROOT="$REPO_ROOT/.ub-exorcism/2026-05-15-exhaustive"
ARTIFACTS_DIR="$AUDIT_ROOT/phase11_artifacts/regression/$EXP_ID"
INDEX_FILE="$AUDIT_ROOT/phase11_artifacts/regression/index.jsonl"
EXPERIMENTS_DIR="$AUDIT_ROOT/experiments/$EXP_ID"

mkdir -p "$ARTIFACTS_DIR"
mkdir -p "$(dirname "$INDEX_FILE")"

# Resolve Miri flags from config
case "$CFG" in
    sb)          MIRIFLAGS_VAL="" ;;
    tb)          MIRIFLAGS_VAL="-Zmiri-tree-borrows" ;;
    sp)          MIRIFLAGS_VAL="-Zmiri-strict-provenance" ;;
    sa)          MIRIFLAGS_VAL="-Zmiri-symbolic-alignment-check" ;;
    integration) MIRIFLAGS_VAL="" ;;
    *) echo "unknown config: $CFG" >&2; exit 2 ;;
esac

LOG_FILE="$ARTIFACTS_DIR/miri-$CFG.log"
SHA="$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null || echo 'unknown')"
ISO_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# If --negative-control: stash + checkout fix-sha~1 (parent of the fix commit)
# so we run against the PRE-FIX tree expecting the original UB signal.
STASH_REF=""
if [[ -n "$NEGATIVE_CONTROL" ]]; then
    cd "$REPO_ROOT"
    STASH_REF="$(git stash create "regression-runner pre-NC stash" || true)"
    git checkout "$NEGATIVE_CONTROL^" 2>&1 | head -3
fi

cleanup() {
    if [[ -n "$STASH_REF" ]]; then
        cd "$REPO_ROOT"
        git checkout - 2>&1 | head -3 || true
        if [[ -n "$STASH_REF" ]]; then
            git stash apply "$STASH_REF" 2>&1 | head -3 || true
        fi
    fi
}
trap cleanup EXIT

# Header
{
    echo "BEGIN $EXP_ID regression $ISO_TS $SHA miri:$CFG${NEGATIVE_CONTROL:+ negative-control:$NEGATIVE_CONTROL}"
} > "$LOG_FILE"

START_EPOCH=$(date +%s)
EXIT_CODE=0
UB_LINES=0

if [[ "$CFG" == "integration" ]]; then
    # Bun integration test path: locate a matching test file
    CANDIDATES=(
        "$REPO_ROOT/test/regression/issue/${EXP_ID#EXP-}/*.test.ts"
        "$REPO_ROOT/test/js/bun/ffi/${EXP_ID,,}*-regression.test.ts"
        "$REPO_ROOT/test/js/bun/ffi/ffi-bare-jsvalue-regression.test.ts"  # EXP-109 specific
    )
    TEST_FILE=""
    for pat in "${CANDIDATES[@]}"; do
        for f in $pat; do
            [[ -f "$f" ]] && TEST_FILE="$f" && break 2
        done
    done
    if [[ -z "$TEST_FILE" ]]; then
        echo "no integration test file found for $EXP_ID" >> "$LOG_FILE"
        EXIT_CODE=2
    else
        echo "running: bun bd test $TEST_FILE" >> "$LOG_FILE"
        if (cd "$REPO_ROOT" && bun bd test "$TEST_FILE") >> "$LOG_FILE" 2>&1; then
            EXIT_CODE=0
        else
            EXIT_CODE=$?
        fi
    fi
else
    # Miri leaf-crate test path: prefer experiments/<EXP>/ standalone reproducer,
    # fall back to inferring crate from registry entry (skip — caller can ensure).
    if [[ -d "$EXPERIMENTS_DIR" ]]; then
        echo "running: MIRIFLAGS=\"$MIRIFLAGS_VAL\" cargo +nightly miri run (in $EXPERIMENTS_DIR)" >> "$LOG_FILE"
        if (cd "$EXPERIMENTS_DIR" && env MIRIFLAGS="$MIRIFLAGS_VAL" cargo +nightly miri run) >> "$LOG_FILE" 2>&1; then
            EXIT_CODE=0
        else
            EXIT_CODE=$?
        fi
    else
        echo "experiments dir not found: $EXPERIMENTS_DIR" >> "$LOG_FILE"
        EXIT_CODE=2
    fi
fi

UB_LINES=$(grep -cE 'error: Undefined Behavior' "$LOG_FILE" || true)
END_EPOCH=$(date +%s)
WALL=$((END_EPOCH - START_EPOCH))

echo "END $EXP_ID regression exit=$EXIT_CODE ub_lines=$UB_LINES wall_seconds=$WALL" >> "$LOG_FILE"

# Append to index.jsonl
printf '{"exp":"%s","config":"%s","ub_lines":%d,"exit":%d,"wall_seconds":%d,"sha":"%s","ts":"%s","negative_control":"%s"}\n' \
    "$EXP_ID" "$CFG" "$UB_LINES" "$EXIT_CODE" "$WALL" "$SHA" "$ISO_TS" "$NEGATIVE_CONTROL" \
    >> "$INDEX_FILE"

# Exit code:
#   - For normal runs: 0 if no UB AND exit==0; non-zero otherwise.
#   - For --negative-control runs: 0 if UB DETECTED (we EXPECT failure); non-zero if clean.
if [[ -n "$NEGATIVE_CONTROL" ]]; then
    if [[ $UB_LINES -gt 0 ]] || [[ $EXIT_CODE -ne 0 ]]; then
        echo "[negative-control] $EXP_ID/$CFG: UB detected as expected" >&2
        exit 0
    else
        echo "[negative-control] $EXP_ID/$CFG: NO UB detected; negative control FAILED" >&2
        exit 1
    fi
else
    if [[ $UB_LINES -gt 0 ]] || [[ $EXIT_CODE -ne 0 ]]; then
        echo "$EXP_ID/$CFG: FAILED (exit=$EXIT_CODE ub_lines=$UB_LINES)" >&2
        exit 1
    else
        echo "$EXP_ID/$CFG: PASS"
        exit 0
    fi
fi
