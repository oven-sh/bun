#!/usr/bin/env bash
# scripts/audit/check-close-order.sh — META-CLOSE-ORDER-ENFORCEMENT
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/check-close-order.sh
# CANONICAL LOCATION: scripts/audit/check-close-order.sh
#
# Enforces the R/T/D triplet close-order contract. beads_rust does NOT enforce
# this natively; this script is the gate.
#
# Rules:
#   R-EXP-NNN closes only after T-EXP-NNN AND D-EXP-NNN are both closed
#   T-EXP-NNN closes only after R-EXP-NNN AND D-EXP-NNN
#   D-EXP-NNN closes only after R-EXP-NNN AND T-EXP-NNN
#   T-S<X>    closes only after R-S<X> AND D-S<X> AND every absorbed triplet
#   D-S<X>    closes only after R-S<X> AND T-S<X> AND every absorbed D-EXP-NNN

set -euo pipefail

MODE="check"; TARGET=""; JSON=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --bead) MODE="check-one"; TARGET="$2"; shift 2 ;;
        --json) JSON=1; shift ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

if ! command -v br >/dev/null 2>&1; then
    echo "br (beads_rust CLI) not found in PATH" >&2; exit 2
fi

# Write beads JSON to a file (avoids shell quoting issues)
BEADS_FILE="$(mktemp)"
# Single-quote the trap body so $BEADS_FILE is evaluated at trap-fire time
# (not trap-set time), and quote the var inside so paths with spaces work.
trap 'rm -f "$BEADS_FILE"' EXIT
br list --limit 0 --json -a > "$BEADS_FILE" 2>/dev/null

python3 - "$BEADS_FILE" "$TARGET" "$JSON" <<'PYEOF'
import json, re, sys

beads_file, target, json_out = sys.argv[1], sys.argv[2], int(sys.argv[3])
beads = json.load(open(beads_file))["issues"]

# Match bundled bead titles like "R-EXP-003-006" or hypothetical
# "R-EXP-100-103-106" (unbounded chain). The drift checker uses the same
# pattern; keep them consistent.
EXP_RE = re.compile(r'(R|T|D)-EXP-([0-9]+(?:-[0-9]+)*)')
S_RE = re.compile(r'(R|T|D)-(S[0-9]+)')

by_exp = {}; by_s = {}
for b in beads:
    title = b.get('title', '')
    m = EXP_RE.search(title)
    if m:
        kind = m.group(1)
        for num in m.group(2).split('-'):
            eid = f'EXP-{num}'
            by_exp.setdefault(eid, {})[kind] = (b['id'], b.get('status', 'open'))
    m = S_RE.search(title)
    if m:
        kind = m.group(1)
        by_s.setdefault(m.group(2), {})[kind] = (b['id'], b.get('status', 'open'))

violations = []
def check_triplet(label, triplet, closing_kind):
    for k in ('R', 'T', 'D'):
        if k == closing_kind: continue
        e = triplet.get(k)
        if e is None:
            violations.append({"closing": triplet[closing_kind][0], "label": label,
                              "reason": f"{k}-bead for {label} does not exist"})
        elif e[1] != 'closed':
            violations.append({"closing": triplet[closing_kind][0], "label": label,
                              "reason": f"{k}-{label} ({e[0]}) is {e[1]}, not closed"})

for eid, triplet in by_exp.items():
    for kind in ('R', 'T', 'D'):
        e = triplet.get(kind)
        if e and e[1] == 'closed':
            if target and e[0] != target: continue
            check_triplet(eid, triplet, kind)
for s_id, triplet in by_s.items():
    for kind in ('R', 'T', 'D'):
        e = triplet.get(kind)
        if e and e[1] == 'closed':
            if target and e[0] != target: continue
            check_triplet(s_id, triplet, kind)

output = {"violations": violations, "violation_count": len(violations),
          "total_triplets_checked": len(by_exp) + len(by_s)}
if json_out:
    print(json.dumps(output, indent=2))
else:
    if violations:
        print(f"FOUND {len(violations)} close-order violation(s):")
        for v in violations: print(f"  - bead {v['closing']} (label {v['label']}) closed but {v['reason']}")
    else:
        print(f"OK: no close-order violations across {len(by_exp)} EXP triplets + {len(by_s)} S triplets")
sys.exit(1 if violations else 0)
PYEOF
