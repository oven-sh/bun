#!/usr/bin/env bash
# scripts/audit/rubric-prompt.sh — META-RUBRIC-SCORING interactive prompter
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/rubric-prompt.sh
# CANONICAL LOCATION: scripts/audit/rubric-prompt.sh
#
# Walks the implementer through re-scoring an R-EXP-NNN rubric before the
# bead can close. Prints the EXP hypothesis + current rubric + candidates,
# asks "is the existing Winner still correct?", and writes the chosen
# Winner back to phase8_remediation_plan.md (with a diff preview).
#
# Usage:
#   rubric-prompt.sh EXP-NNN

set -euo pipefail

[[ $# -eq 1 ]] || { echo "usage: $0 EXP-NNN" >&2; exit 2; }
EXP_ID="$1"

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REGISTRY="$REPO_ROOT/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md"
PHASE8="$REPO_ROOT/.ub-exorcism/2026-05-15-exhaustive/phase8_remediation_plan.md"

if ! grep -q "^## $EXP_ID" "$REGISTRY" 2>/dev/null; then
    echo "ERROR: $EXP_ID not found in registry $REGISTRY" >&2; exit 1
fi

echo "=================================================================="
echo "  RUBRIC PROMPT: $EXP_ID"
echo "=================================================================="
echo ""
echo "Registry entry (Hypothesis + Notes excerpt):"
echo "------------------------------------------------------------------"
awk "/^## $EXP_ID/,/^---\$/" "$REGISTRY" | head -50
echo "..."
echo ""
echo "------------------------------------------------------------------"
echo "Phase 8 R-EXP entry (current rubric):"
echo "------------------------------------------------------------------"
awk "/^### R-EXP-${EXP_ID#EXP-}/,/^---\$/" "$PHASE8" 2>/dev/null | head -40
echo ""
echo "------------------------------------------------------------------"
echo ""
echo "Pre-flight checklist:"
echo "  [ ] Re-read the registry Hypothesis + Notes above"
echo "  [ ] Ran scripts/audit/check-registry-drift.sh --exp $EXP_ID"
echo "  [ ] Re-ran the pre-fix repro invocation (must still fail)"
echo "  [ ] Re-evaluated each candidate against current source state"
echo "  [ ] Confirmed the Winner / scored fresh if needed"
echo ""
echo "If the existing Winner is STILL correct, no action needed — close the"
echo "R-EXP-NNN bead through the normal close-order gate."
echo ""
echo "If the Winner needs to CHANGE, edit:"
echo "  $PHASE8"
echo "to reflect the new Winner + Rationale, then commit before closing."
echo ""
echo "After edits, verify with:"
echo "  scripts/audit/rubric-status.sh --exp $EXP_ID"
