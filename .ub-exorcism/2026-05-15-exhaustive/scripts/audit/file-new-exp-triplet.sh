#!/usr/bin/env bash
# scripts/audit/file-new-exp-triplet.sh — META-SOAK-TRIAGE / META-REGISTRY-DRIFT companion
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/file-new-exp-triplet.sh
# CANONICAL LOCATION: scripts/audit/file-new-exp-triplet.sh
#
# Files the standard R-EXP-NNN / T-EXP-NNN / D-EXP-NNN bead triplet for a
# newly-promoted EXP. Called by triage-soak-results.sh when a SOAK run finds
# a NEW UB signal that doesn't match any existing EXP.
#
# Usage:
#   file-new-exp-triplet.sh EXP-NNN "title" [--severity CONDITIONAL_UB] [--bucket "1+15"]
#
# Pre-conditions:
#   - The EXP-NNN registry entry exists in UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md
#     (use scripts/audit/check-registry-drift.sh to verify)

set -euo pipefail
[[ $# -ge 2 ]] || { echo "usage: $0 EXP-NNN \"title\" [--severity X] [--bucket Y]" >&2; exit 2; }

EXP="$1"; shift
TITLE="$1"; shift
SEV="CONDITIONAL_UB"; BUCKET="unspecified"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --severity) SEV="$2"; shift 2 ;;
        --bucket)   BUCKET="$2"; shift 2 ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

# Verify the EXP entry exists in the registry
REGISTRY=".ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md"
grep -q "^## $EXP:" "$REGISTRY" || { echo "ERROR: $EXP not found in $REGISTRY" >&2; exit 1; }

COMMON_LABELS="audit:ub-exorcist-2026-05-15,exp:$EXP,severity:$SEV,verdict:CANDIDATE_AWAITING_MIRI,deep-pass:soak-triage"

# Create R bead
R_DESC="Remediation bead for $EXP (auto-filed by SOAK triage).

EXP REFERENCE:
  Registry: .ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md ($EXP)
  Bucket:   $BUCKET
  Severity: $SEV
  Verdict:  CANDIDATE_AWAITING_MIRI

This bead was automatically filed when SOAK-triage matched a new UB signal
that did not correspond to any existing EXP. Before this bead can close:
1. Author the remediation candidates list with a rubric (see META-RUBRIC-SCORING)
2. Implement the winner
3. Land T-$EXP regression test
4. Land D-$EXP SAFETY block

## Acceptance Criteria
- Rubric winner documented in this bead
- Implementation lands at the EXP file:line
- T-$EXP and D-$EXP closed first (META-CLOSE-ORDER-ENFORCEMENT)
- Registry verdict updated to RESOLVED with witness log
"

# Helper: create a bead, verify a valid ID came back, abort if not.
# Returns the new bead ID on stdout.
create_bead() {
    local title="$1" prio="$2" labels="$3" desc="$4"
    # --silent emits ONLY the issue ID on success; on error it emits a
    # message to stderr and exits non-zero. We capture stdout and verify
    # the result matches the bun-XXXX pattern.
    local out
    if ! out=$(br create "$title" -t task -p "$prio" -l "$labels" -d "$desc" --silent 2>/dev/null); then
        echo "ERROR: br create failed for: $title" >&2
        return 1
    fi
    out="$(echo "$out" | tail -1 | tr -d '[:space:]')"
    if [[ ! "$out" =~ ^bun-[a-z0-9]+$ ]]; then
        echo "ERROR: br create did not return a valid bead ID (got: $out)" >&2
        return 1
    fi
    printf '%s' "$out"
}

R_ID="$(create_bead "[core] R-$EXP: $TITLE (auto-filed)" 2 "$COMMON_LABELS,kind:remediation" "$R_DESC")"
echo "R-$EXP filed as $R_ID"

T_DESC="Regression test bead for $EXP (auto-filed by SOAK triage).
See R-$EXP for context. Author the regression test once the remediation lands.

## Acceptance Criteria
- Test exists and runs Miri-clean on patched tree
- Negative control re-introduces UB signal
- T-$EXP closes only after R-$EXP and D-$EXP
"
T_ID="$(create_bead "[test] T-$EXP: regression test (auto-filed)" 2 "$COMMON_LABELS,kind:test" "$T_DESC")"
echo "T-$EXP filed as $T_ID"

D_DESC="SAFETY-comment bead for $EXP (auto-filed by SOAK triage).
See R-$EXP for context. Author the 4-field SAFETY block once remediation lands.

## Acceptance Criteria
- 4-field SAFETY block at every modified unsafe site
- INVARIANT/WITNESS/CALLER MUST UPHOLD/ENFORCED-BY
- D-$EXP closes only after R-$EXP and T-$EXP
"
D_ID="$(create_bead "[docs] D-$EXP: SAFETY block (auto-filed)" 3 "$COMMON_LABELS,kind:docs" "$D_DESC")"
echo "D-$EXP filed as $D_ID"

# Wire the triplet deps. Each must succeed; if any fails we report which one
# but don't unwind the already-created beads (per AGENTS.md no-delete rule).
br dep add "$T_ID" "$R_ID" -q || echo "WARN: failed to wire T-$EXP -> R-$EXP" >&2
br dep add "$D_ID" "$R_ID" -q || echo "WARN: failed to wire D-$EXP -> R-$EXP" >&2
echo "Triplet wired: R=$R_ID T=$T_ID D=$D_ID"
