#!/usr/bin/env bash
# scripts/audit/check-registry-drift.sh — META-REGISTRY-DRIFT-CHECKER
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/check-registry-drift.sh
# CANONICAL LOCATION: scripts/audit/check-registry-drift.sh
#
# Detects drift between UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md (the registry)
# and the beads tracking those EXPs.

set -euo pipefail

MODE="check"; JSON=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) JSON=1; shift ;;
        --fix)  MODE="fix"; shift ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

REGISTRY=".ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md"
[[ -f "$REGISTRY" ]] || { echo "registry not found: $REGISTRY" >&2; exit 2; }

BEADS_FILE="$(mktemp)"
# Single-quote the trap body so $BEADS_FILE is expanded at trap-fire time
# (not trap-set time). Quote the variable inside so paths with spaces work.
trap 'rm -f "$BEADS_FILE"' EXIT
br list --limit 0 --json -a > "$BEADS_FILE" 2>/dev/null

python3 - "$REGISTRY" "$BEADS_FILE" "$MODE" "$JSON" <<'PYEOF'
import json, re, sys, subprocess

REG_PATH, BEADS_PATH, MODE, JSON_OUT = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])

reg_text = open(REG_PATH).read()
exp_entries = {}
for chunk in re.split(r'(?m)^## EXP-', reg_text)[1:]:
    m = re.match(r'(\d+[a-z]?)\b', chunk)
    if not m: continue
    eid = 'EXP-' + m.group(1)
    title = chunk.split('\n',1)[0].split(':',1)[-1].strip()
    vm = re.search(r'\*\*Verdict:\*\*\s*([A-Z_]+)', chunk)
    verdict = vm.group(1) if vm else 'OPEN'
    file_line = ''
    for pat in [
        r'\*\*Section:\*\*[^\n]*?`((?:src|experiments|vendor|tests)/[^`]+)`',
        r'\*\*Files?:\*\*\s*`?((?:src|experiments|vendor|tests)/[^`,\n]+)`?',
    ]:
        fm = re.search(pat, chunk, re.IGNORECASE)
        if fm:
            file_line = fm.group(1).strip().rstrip(',')
            break
    exp_entries[eid] = {"verdict": verdict, "file_line": file_line, "title": title}

beads = json.load(open(BEADS_PATH))["issues"]
beads_by_exp = {}
for b in beads:
    # Bundled bead titles like "R-EXP-003-006" or "R-EXP-005-034" cover multiple EXPs
    # via the hyphen-separated number list. Match the FULL number sequence.
    m = re.search(r'(R|T|D)-EXP-([0-9]+(?:-[0-9]+)*)', b.get('title',''))
    if not m: continue
    kind = m.group(1)
    labels = b.get('labels', [])
    vlabel = next((l.split(':',1)[1] for l in labels if l.startswith('verdict:')), None)
    # Split the bundled-id range into individual EXPs (e.g. "003-006" -> ["EXP-003","EXP-006"])
    for num in m.group(2).split('-'):
        eid = 'EXP-' + num
        beads_by_exp.setdefault(eid, []).append({"id": b['id'], "kind": kind,
                                                  "verdict_label": vlabel,
                                                  "status": b.get('status', 'open')})

# Build absorbed-EXP map by parsing phase8_remediation_plan.md for each S section.
# Per the audit's structural-fix discipline, an EXP can be covered by an R-S<X>
# bundled bead instead of a per-EXP R-EXP-NNN. The S-section's "Blast radius — closes"
# bullet list names the absorbed EXPs.
absorbed_by_s = {}  # eid -> S_id  (e.g. "EXP-002" -> "S1")
import os
phase8_path = os.path.join(os.path.dirname(REG_PATH), 'phase8_remediation_plan.md')
if os.path.exists(phase8_path):
    p8 = open(phase8_path).read()
    for s_chunk in re.split(r'(?m)^### S', p8)[1:]:
        s_match = re.match(r'(\d+)\.', s_chunk)
        if not s_match: continue
        s_id = 'S' + s_match.group(1)
        body = s_chunk.split('\n### S')[0] if '\n### S' in s_chunk else s_chunk
        # Look ONLY in the "Blast radius — closes:" bullet block, not the
        # whole S section. The Blast-radius block enumerates the EXPs the S
        # fix actually absorbs; other EXP mentions in S text are cross-refs.
        blast = re.search(r'\*\*Blast radius[^\n]*closes[^*]*?\*\*\s*\n((?:^- .*\n?)+)',
                          body, re.MULTILINE)
        if not blast:
            continue
        for eid in set(re.findall(r'EXP-(\d{3})', blast.group(1))):
            absorbed_by_s.setdefault(f'EXP-{eid}', []).append(s_id)

drift = []; fixes = []
# Verdicts that DO NOT require R/T/D triplet coverage
# (NO_EVIDENCE/RESOLVED never need it; DEFERRED is design-only by definition)
SKIP_VERDICTS = {"NO_EVIDENCE", "RESOLVED", "DEFERRED"}

for eid, entry in exp_entries.items():
    if entry["verdict"] in SKIP_VERDICTS: continue
    kinds = {b["kind"] for b in beads_by_exp.get(eid, [])}
    missing = [k for k in ('R','T','D') if k not in kinds]
    # Check if missing kinds are covered by a structural-fix bundle.
    # Per the audit's discipline (see pass-1 bead creation), structural fixes
    # bundle R/T/D at the cluster level (R-S<X>/T-S<X>/D-S<X>), and the
    # per-EXP D-EXP-NNN beads are filed for SAFETY blocks at each absorbed site.
    # So:
    #   - R-EXP-NNN missing is OK if absorbed_by_s (R-S<X> covers it)
    #   - T-EXP-NNN missing is OK if absorbed_by_s (T-S<X> covers it)
    #   - D-EXP-NNN is STILL required per-EXP (per-site SAFETY blocks; not bundled)
    if eid in absorbed_by_s:
        missing = [k for k in missing if k == 'D']
    if missing:
        drift.append({"kind": "missing_triplet", "exp": eid,
                      "missing_kinds": missing, "verdict": entry["verdict"],
                      "absorbed_by_s": sorted(set(absorbed_by_s.get(eid, [])))})

for eid in beads_by_exp:
    if eid not in exp_entries:
        drift.append({"kind": "bead_without_registry_entry", "exp": eid,
                      "beads": [b["id"] for b in beads_by_exp[eid]]})

# Recognized refinement labels — these are bead-side specializations of a
# registry verdict that should NOT be flagged as drift. The convention:
# <REGISTRY-VERDICT>_<REFINEMENT> where REGISTRY-VERDICT is the bare verdict
# (NO_EVIDENCE, CONFIRMED_UB, DEFERRED, etc.) and REFINEMENT names a
# narrower scope (e.g. NO_EVIDENCE_PRODUCTION means the bead is more
# precise than the registry: it asserts NO_EVIDENCE specifically for the
# production code path, while the registry's bare NO_EVIDENCE covers both
# production and standalone-model dimensions).
def labels_match(registry_verdict, bead_label):
    if registry_verdict == bead_label:
        return True
    # Refinement: bead label starts with the registry verdict + underscore
    if bead_label.startswith(registry_verdict + '_'):
        return True
    return False

for eid, entry in exp_entries.items():
    for b in beads_by_exp.get(eid, []):
        if b["verdict_label"] is None: continue
        if not labels_match(entry["verdict"], b["verdict_label"]):
            drift.append({"kind": "verdict_label_drift", "exp": eid,
                          "bead": b["id"], "kind_letter": b["kind"],
                          "registry_verdict": entry["verdict"],
                          "bead_label": b["verdict_label"]})
            if MODE == "fix":
                try:
                    subprocess.check_call(['br','update', b['id'],
                                          '--remove-label', f'verdict:{b["verdict_label"]}',
                                          '--add-label', f'verdict:{entry["verdict"]}', '-q'])
                    fixes.append({"bead": b['id'], "from": b["verdict_label"], "to": entry["verdict"]})
                except Exception: pass

result = {"registry_exp_count": len(exp_entries), "bead_exp_groups": len(beads_by_exp),
          "drift_count": len(drift), "drift": drift, "fixes_applied": fixes if MODE=='fix' else None}
if JSON_OUT:
    print(json.dumps(result, indent=2))
else:
    if not drift:
        print(f"OK: no drift. {len(exp_entries)} registry EXPs, {len(beads_by_exp)} bead-EXP groups.")
    else:
        print(f"DRIFT: {len(drift)} issue(s) across {len(exp_entries)} registry EXPs.")
        for d in drift[:20]:
            print(f"  - {d['kind']}: {d.get('exp','?')}")
            for k,v in d.items():
                if k not in ('kind','exp'):
                    print(f"      {k}: {v}")
        if len(drift) > 20: print(f"  ... +{len(drift)-20} more")
        if MODE == "fix": print(f"\nApplied {len(fixes)} label fixes")
sys.exit(1 if drift else 0)
PYEOF
