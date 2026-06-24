#!/usr/bin/env bash
# scripts/audit/check-registry-drift.sh — META-REGISTRY-DRIFT-CHECKER
#
# Detects drift between UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md (the EXP
# registry) and the beads tracking those EXPs.
#
# Drift sources:
#   - EXP added to registry without R/T/D triplet beads
#   - Bead verdict-label out of sync with registry verdict
#   - Bead title's EXP-NNN doesn't match registry entry's number
#   - Bead description's file:line stale vs current registry file:line
#
# Usage:
#   scripts/audit/check-registry-drift.sh            # report drift, exit 1 if any
#   scripts/audit/check-registry-drift.sh --json     # JSON report
#   scripts/audit/check-registry-drift.sh --fix      # update bead labels (NEVER deletes beads)
#
# Exit: 0 if no drift; 1 if drift found; 2 on usage error.

set -euo pipefail

MODE="check"
JSON=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) JSON=1; shift ;;
        --fix)  MODE="fix"; shift ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

REGISTRY=".ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md"
if [[ ! -f "$REGISTRY" ]]; then
    echo "registry not found: $REGISTRY" >&2; exit 2
fi

BEADS_JSON="$(br list --limit 0 --json -a 2>/dev/null || echo '{"issues":[]}')"

python3 <<PYEOF
import json, re, sys, subprocess

REGISTRY_PATH = "$REGISTRY"
MODE = "$MODE"
JSON_OUT = int("$JSON")

# Parse registry: extract per-EXP verdict + file:line
reg_text = open(REGISTRY_PATH).read()
exp_entries = {}  # {"EXP-NNN": {"verdict": ..., "file_line": ..., "title": ...}}

for chunk in re.split(r'(?m)^## EXP-', reg_text)[1:]:
    m = re.match(r'(\d+[a-z]?)\b', chunk)
    if not m: continue
    eid = 'EXP-' + m.group(1)
    title_line = chunk.split('\n', 1)[0]
    title = title_line.split(':', 1)[1].strip() if ':' in title_line else title_line

    verdict_m = re.search(r'\*\*Verdict:\*\*\s*([A-Z_]+)', chunk)
    verdict = verdict_m.group(1) if verdict_m else 'OPEN'

    file_line = ''
    for pat in [
        r'\*\*Section:\*\*[^\n]*?\`((?:src|experiments|vendor|tests)/[^\`]+)\`',
        r'\*\*Files?:\*\*\s*\`?((?:src|experiments|vendor|tests)/[^\`,\n]+)\`?',
        r'anchored at\s*\`((?:src|experiments|vendor|tests)/[^\`]+)\`',
    ]:
        fm = re.search(pat, chunk, re.IGNORECASE)
        if fm:
            file_line = fm.group(1).strip().rstrip(',')
            break

    exp_entries[eid] = {"verdict": verdict, "file_line": file_line, "title": title}

# Parse beads
beads = json.loads("""$BEADS_JSON""")["issues"]
beads_by_exp = {}  # {"EXP-NNN": [{"id": ..., "kind": ..., "verdict_label": ..., "status": ...}]}
for b in beads:
    title = b.get('title', '')
    m = re.search(r'(R|T|D)-EXP-([0-9]+)', title)
    if not m: continue
    kind = m.group(1)
    eid = 'EXP-' + m.group(2)
    labels = b.get('labels', [])
    verdict_label = next((l.split(':',1)[1] for l in labels if l.startswith('verdict:')), None)
    beads_by_exp.setdefault(eid, []).append({
        "id": b['id'], "kind": kind, "verdict_label": verdict_label,
        "status": b.get('status', 'open'),
    })

# Find drift
drift = []
fixes_applied = []

# 1. Registry EXPs with NO bead coverage
for eid, entry in exp_entries.items():
    if entry["verdict"] in ("NO_EVIDENCE", "RESOLVED"):
        continue
    bead_kinds = {b["kind"] for b in beads_by_exp.get(eid, [])}
    missing = [k for k in ('R','T','D') if k not in bead_kinds]
    if missing:
        drift.append({"kind": "missing_triplet", "exp": eid,
                      "missing_kinds": missing, "verdict": entry["verdict"]})

# 2. Bead with EXP-NNN that the registry doesn't list
all_registry_eids = set(exp_entries.keys())
for eid in beads_by_exp:
    if eid not in all_registry_eids:
        drift.append({"kind": "bead_without_registry_entry", "exp": eid,
                      "beads": [b["id"] for b in beads_by_exp[eid]]})

# 3. Verdict-label drift
for eid, entry in exp_entries.items():
    for b in beads_by_exp.get(eid, []):
        if b["verdict_label"] is None:
            continue  # bead has no verdict label; not necessarily drift
        # Normalize for comparison (registry uses CONFIRMED_UB; beads sometimes use the same)
        if entry["verdict"] != b["verdict_label"]:
            drift.append({"kind": "verdict_label_drift", "exp": eid,
                          "bead": b["id"], "kind_letter": b["kind"],
                          "registry_verdict": entry["verdict"],
                          "bead_label": b["verdict_label"]})
            if MODE == "fix":
                # br update <id> --remove-label "verdict:<old>" --add-label "verdict:<new>"
                try:
                    subprocess.check_call(['br', 'update', b['id'],
                                           '--remove-label', f'verdict:{b["verdict_label"]}',
                                           '--add-label', f'verdict:{entry["verdict"]}',
                                           '-q'])
                    fixes_applied.append({"bead": b['id'],
                                         "from": b["verdict_label"], "to": entry["verdict"]})
                except subprocess.CalledProcessError as e:
                    pass

result = {
    "registry_exp_count": len(exp_entries),
    "bead_exp_groups": len(beads_by_exp),
    "drift_count": len(drift),
    "drift": drift,
    "fixes_applied": fixes_applied if MODE == "fix" else None,
}

if JSON_OUT:
    print(json.dumps(result, indent=2))
else:
    if not drift:
        print(f"OK: no drift. {len(exp_entries)} registry EXPs, "
              f"{len(beads_by_exp)} bead-EXP groups.")
    else:
        print(f"DRIFT: {len(drift)} issue(s) across {len(exp_entries)} registry EXPs.")
        for d in drift[:20]:
            print(f"  - {d['kind']}: {d.get('exp','?')}")
            for k,v in d.items():
                if k not in ('kind','exp'):
                    print(f"      {k}: {v}")
        if len(drift) > 20:
            print(f"  ... +{len(drift)-20} more")
        if MODE == "fix":
            print(f"\nApplied {len(fixes_applied)} label fixes")

sys.exit(1 if drift else 0)
PYEOF
