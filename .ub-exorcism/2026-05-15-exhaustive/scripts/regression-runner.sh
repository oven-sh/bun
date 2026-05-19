#!/usr/bin/env bash
# scripts/regression-runner.sh — META-LOGGING-CONVENTION runner
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/regression-runner.sh
# CANONICAL LOCATION (when audit lands): scripts/regression-runner.sh
#
# Runs ONE regression test (Miri config or Bun integration test) for ONE EXP
# and emits a BEGIN/END-bracketed log + an index.jsonl row.
#
# Usage:
#   regression-runner.sh <EXP-ID> <config>
#
# Negative controls must run in a disposable worktree. This staged audit helper
# deliberately refuses `--negative-control` rather than checking out commits in
# the active Bun worktree.
#
# Configs:
#   sb           Stacked Borrows (default Miri)
#   tb           Tree Borrows
#   sp           Strict Provenance
#   sa           Symbolic Alignment Check
#   integration  Bun integration test (test/regression/issue/<N>/*.test.ts OR test/js/bun/...)
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
if [[ "${3:-}" == "--negative-control" ]]; then
    echo "--negative-control is disabled in this staged helper; use a disposable git worktree runner" >&2
    exit 2
fi
if [[ $# -gt 2 ]]; then
    echo "unexpected extra arguments: ${*:3}" >&2
    echo "usage: $0 <EXP-ID> <sb|tb|sp|sa|integration>" >&2
    exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
AUDIT_ROOT="$REPO_ROOT/.ub-exorcism/2026-05-15-exhaustive"
ARTIFACTS_DIR="$AUDIT_ROOT/phase11_artifacts/regression/$EXP_ID"
INDEX_FILE="$AUDIT_ROOT/phase11_artifacts/regression/index.jsonl"
EXPERIMENTS_DIR="$AUDIT_ROOT/experiments/$EXP_ID"

mkdir -p "$ARTIFACTS_DIR"
mkdir -p "$(dirname "$INDEX_FILE")"

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

echo "BEGIN $EXP_ID regression $ISO_TS $SHA miri:$CFG" > "$LOG_FILE"

START_EPOCH=$(date +%s)
EXIT_CODE=0

if [[ "$CFG" == "integration" ]]; then
    # Conservative test-file discovery. Today this staged helper only auto-runs
    # test/regression/issue/<N>/ files. Most Bun fixes should instead add tests
    # to the existing module test file per AGENTS.md; promoting this runner
    # requires an explicit EXP→test-file mapping for those cases.
    CANDIDATES=(
        "$REPO_ROOT/test/regression/issue/${EXP_ID#EXP-}"
    )
    TEST_FILE=""
    for c in "${CANDIDATES[@]}"; do
        if [[ -d "$c" ]]; then
            for f in "$c"/*.test.ts "$c"/*.test.js; do
                [[ -f "$f" ]] && TEST_FILE="$f" && break 2
            done
        elif [[ -f "$c" ]]; then
            TEST_FILE="$c"; break
        fi
    done
    if [[ -z "$TEST_FILE" ]]; then
        echo "no integration test file found for $EXP_ID" >> "$LOG_FILE"; EXIT_CODE=2
    else
        echo "running: bun bd test $TEST_FILE" >> "$LOG_FILE"
        (cd "$REPO_ROOT" && bun bd test "$TEST_FILE") >> "$LOG_FILE" 2>&1 || EXIT_CODE=$?
    fi
else
    # Verify the experiments dir has a Cargo.toml (otherwise `cargo miri run`
    # would emit a confusing "could not find Cargo.toml" error and the
    # ub_lines count would be 0, masking the misconfiguration as "success".
    if [[ ! -d "$EXPERIMENTS_DIR" ]]; then
        echo "experiments dir not found: $EXPERIMENTS_DIR" >> "$LOG_FILE"; EXIT_CODE=2
    elif [[ ! -f "$EXPERIMENTS_DIR/Cargo.toml" ]]; then
        echo "experiments dir has no Cargo.toml: $EXPERIMENTS_DIR" >> "$LOG_FILE"; EXIT_CODE=2
    else
        echo "running: MIRIFLAGS=\"$MIRIFLAGS_VAL\" cargo +nightly miri run (in $EXPERIMENTS_DIR)" >> "$LOG_FILE"
        (cd "$EXPERIMENTS_DIR" && env MIRIFLAGS="$MIRIFLAGS_VAL" cargo +nightly miri run) >> "$LOG_FILE" 2>&1 || EXIT_CODE=$?
    fi
fi

UB_LINES=$(grep -cE 'error: Undefined Behavior|error: undefined behavior' "$LOG_FILE" || true)
END_EPOCH=$(date +%s)
WALL=$((END_EPOCH - START_EPOCH))

echo "END $EXP_ID regression exit=$EXIT_CODE ub_lines=$UB_LINES wall_seconds=$WALL" >> "$LOG_FILE"

printf '{"exp":"%s","config":"%s","ub_lines":%d,"exit":%d,"wall_seconds":%d,"sha":"%s","ts":"%s","negative_control":"%s"}\n' \
    "$EXP_ID" "$CFG" "$UB_LINES" "$EXIT_CODE" "$WALL" "$SHA" "$ISO_TS" "" \
    >> "$INDEX_FILE"

if [[ $UB_LINES -gt 0 || $EXIT_CODE -ne 0 ]]; then
    echo "$EXP_ID/$CFG: FAILED (exit=$EXIT_CODE ub_lines=$UB_LINES)" >&2; exit 1
fi
echo "$EXP_ID/$CFG: PASS"
