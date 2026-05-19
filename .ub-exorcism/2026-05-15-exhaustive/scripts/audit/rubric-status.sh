#!/usr/bin/env bash
# scripts/audit/rubric-status.sh — META-RUBRIC-SCORING reporter
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/rubric-status.sh
# CANONICAL LOCATION: scripts/audit/rubric-status.sh
#
# For every R-EXP entry in phase8_remediation_plan.md, reports whether a
# Winner has been documented. Used as a CI pre-merge gate: an R-EXP-NNN bead
# cannot close without a recorded Winner in phase8.
#
# Usage:
#   rubric-status.sh                 # report all
#   rubric-status.sh --json          # JSON output
#   rubric-status.sh --exp EXP-NNN   # check ONE EXP

set -euo pipefail
JSON=0; EXP=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) JSON=1; shift ;;
        --exp)  EXP="$2"; shift 2 ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PHASE8="$REPO_ROOT/.ub-exorcism/2026-05-15-exhaustive/phase8_remediation_plan.md"
[[ -f "$PHASE8" ]] || { echo "phase8 plan not found: $PHASE8" >&2; exit 2; }

python3 - "$PHASE8" "$EXP" "$JSON" <<'PYEOF'
import json, re, sys

p8_path, only_exp, json_out = sys.argv[1], sys.argv[2], int(sys.argv[3])

text = open(p8_path).read()
parts = re.split(r'(?m)^### R-EXP-', text)[1:]

# Parse registry verdicts so we can skip non-actionable EXPs (RESOLVED, NO_EVIDENCE).
# DEFERRED entries are kept (they're design-only but may still need a Winner
# documented for "if we ever pursue this, here's the plan").
import os
REG = os.path.join(os.path.dirname(p8_path), 'UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md')
exp_verdict = {}
if os.path.exists(REG):
    for ch in re.split(r'(?m)^## EXP-', open(REG).read())[1:]:
        m = re.match(r'(\d+[a-z]?)\b', ch)
        if not m: continue
        eid = 'EXP-' + m.group(1)
        vm = re.search(r'\*\*Verdict:\*\*\s*([A-Z_]+)', ch)
        exp_verdict[eid] = vm.group(1) if vm else 'OPEN'

# Also build absorbed-by-S map so we can flag covered-by-S as a separate column
# (R-S<X> bundled fixes have their Winner in the S section, not per-EXP).
absorbed_by_s = {}
for s_chunk in re.split(r'(?m)^### S', text)[1:]:
    sm = re.match(r'(\d+)\.', s_chunk)
    if not sm: continue
    s_id = 'S' + sm.group(1)
    body = s_chunk.split('\n### S')[0] if '\n### S' in s_chunk else s_chunk
    # Restrict to the "Blast radius — closes:" bullet block, not the whole S
    # section. Otherwise cross-references to other EXPs would falsely look
    # like absorption.
    blast = re.search(r'\*\*Blast radius[^\n]*closes[^*]*?\*\*\s*\n((?:^- .*\n?)+)',
                      body, re.MULTILINE)
    if not blast: continue
    for eid in set(re.findall(r'EXP-(\d{3})', blast.group(1))):
        absorbed_by_s.setdefault(f'EXP-{eid}', set()).add(s_id)

SKIP_VERDICTS = {'RESOLVED', 'NO_EVIDENCE'}

rows = []
for chunk in parts:
    m = re.match(r'(\d+(?:\s*/\s*R-EXP-\d+)*(?:\s*-\s*\d+)*)[:\s]', chunk)
    if not m: continue
    raw_ids = m.group(1).strip()
    ids = ['EXP-' + i for i in re.findall(r'\d+', raw_ids)]
    if only_exp and only_exp not in ids: continue

    # Skip entries where ALL EXPs are RESOLVED or NO_EVIDENCE
    actionable_ids = [i for i in ids if exp_verdict.get(i, 'OPEN') not in SKIP_VERDICTS]
    if not actionable_ids:
        continue
    # Skip entries where all EXPs are absorbed by an S-bundle
    # (the winner lives in the S section, not per-EXP)
    if all(eid in absorbed_by_s for eid in actionable_ids):
        continue

    has_table = bool(re.search(r'\n\|[^\n]*ID[^\n]*\|', chunk))
    winner = ''
    for label in ['Winner', 'Winner candidate-by-candidate verification',
                  'Winning approach', 'Chosen approach', 'Recommended approach']:
        wm = re.search(rf'\*\*{re.escape(label)}:\*\*\s*(.+?)(?=\n\*\*[A-Z]|\n\n)', chunk, re.DOTALL)
        if wm:
            winner = re.sub(r'\s+', ' ', wm.group(1).strip())[:200]
            break

    rows.append({"exp_ids": ids, "has_rubric_table": has_table,
                "winner_recorded": bool(winner), "winner_snippet": winner,
                "actionable_ids": actionable_ids})

n_total = len(rows)
n_with_winner = sum(1 for r in rows if r["winner_recorded"])
n_with_table = sum(1 for r in rows if r["has_rubric_table"])

if json_out:
    print(json.dumps({"total": n_total, "with_winner": n_with_winner,
                      "with_table": n_with_table, "rows": rows}, indent=2))
else:
    print(f"Phase 8 rubric status: {n_total} R-EXP entries, "
          f"{n_with_winner} have Winner ({n_with_table} with rubric table)")
    missing = [r for r in rows if not r["winner_recorded"]]
    if missing:
        print(f"\nEXPs MISSING winner:")
        for r in missing:
            print(f"  - {','.join(r['exp_ids'])} (rubric_table={r['has_rubric_table']})")
    else:
        print("All R-EXP entries have a recorded Winner.")

# Exit 1 if any missing winners (CI gate); 0 if clean.
sys.exit(1 if n_with_winner < n_total else 0)
PYEOF
