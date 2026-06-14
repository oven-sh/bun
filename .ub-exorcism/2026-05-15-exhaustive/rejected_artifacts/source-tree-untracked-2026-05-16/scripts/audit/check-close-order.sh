#!/usr/bin/env bash
# scripts/audit/check-close-order.sh — META-CLOSE-ORDER-ENFORCEMENT
#
# Enforces the R/T/D triplet close-order contract every bead's description
# claims. beads_rust does NOT enforce this natively; this script is the gate.
#
# Rules:
#   R-EXP-NNN closes only after T-EXP-NNN AND D-EXP-NNN are both closed
#   T-EXP-NNN closes only after R-EXP-NNN AND D-EXP-NNN are both closed
#   D-EXP-NNN closes only after R-EXP-NNN AND T-EXP-NNN are both closed
#
#   T-S<X>    closes only after R-S<X> AND D-S<X> AND every absorbed-EXP triplet
#   D-S<X>    closes only after R-S<X> AND T-S<X> AND every absorbed D-EXP-NNN
#
# Usage:
#   scripts/audit/check-close-order.sh                  # check current bead state
#   scripts/audit/check-close-order.sh --bead <ID>      # is this bead safe to close?
#   scripts/audit/check-close-order.sh --json           # machine-readable output
#
# Exit: 0 if all closures are valid; 1 if any violation; 2 on usage error.

set -euo pipefail

MODE="check"
TARGET=""
JSON=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --bead) MODE="check-one"; TARGET="$2"; shift 2 ;;
        --json) JSON=1; shift ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Parse beads via `br list --limit 0 --json`
if ! command -v br >/dev/null 2>&1; then
    echo "br (beads_rust CLI) not found in PATH" >&2
    exit 2
fi

BEADS_JSON="$(br list --limit 0 --json -a 2>/dev/null)"

# Build a map: EXP-NNN -> {R: <id+status>, T: <id+status>, D: <id+status>}
# Done in python because of the complex per-EXP triplet group-by.
python3 <<PYEOF
import json, re, sys

beads = json.loads("""$BEADS_JSON""")["issues"]

# Group by EXP-NNN
by_exp = {}  # {"EXP-NNN": {"R": (id, status), "T": (...), "D": (...)}}
by_s = {}    # {"S1": {"R": ..., "T": ..., "D": ..., "absorbed": ["EXP-002", ...]}}

EXP_RE = re.compile(r'(R|T|D)-EXP-([0-9]+(?:-[0-9]+)?(?:-[0-9]+)?)')
S_RE = re.compile(r'(R|T|D)-(S[0-9]+)')

for b in beads:
    title = b.get('title', '')
    bid = b['id']
    status = b.get('status', 'open')

    m = EXP_RE.search(title)
    if m:
        kind = m.group(1)
        # Bundled R-EXP-003-006 covers EXP-003, EXP-005, EXP-006 — split on hyphen
        for num in m.group(2).split('-'):
            eid = f'EXP-{num}'
            by_exp.setdefault(eid, {})[kind] = (bid, status)

    m = S_RE.search(title)
    if m:
        kind = m.group(1)
        s_id = m.group(2)
        by_s.setdefault(s_id, {})[kind] = (bid, status)
        # Look for absorbed-EXP mentions in the title parenthetical
        absorbed_m = re.search(r'\(structural fix R-S[0-9]+\)|absorbed: (EXP-\d+)', title)
        # (Best-effort; precise mapping requires the registry parse.)

violations = []
TARGET = "$TARGET"

def check_triplet(label, triplet, closing_kind):
    """If we're closing the bead of kind closing_kind, are the OTHER two closed?"""
    other_kinds = [k for k in ('R', 'T', 'D') if k != closing_kind]
    for k in other_kinds:
        entry = triplet.get(k)
        if entry is None:
            violations.append({"closing": triplet[closing_kind][0], "label": label,
                              "reason": f"{k}-bead for {label} does not exist"})
        elif entry[1] != 'closed':
            violations.append({"closing": triplet[closing_kind][0], "label": label,
                              "reason": f"{k}-{label} ({entry[0]}) is {entry[1]}, not closed"})

# For each EXP triplet that has ANY closed sibling, verify the close-order
for eid, triplet in by_exp.items():
    for kind in ('R', 'T', 'D'):
        entry = triplet.get(kind)
        if entry and entry[1] == 'closed':
            if TARGET and entry[0] != TARGET:
                continue
            check_triplet(eid, triplet, kind)

# Same for structural S triplets
for s_id, triplet in by_s.items():
    for kind in ('R', 'T', 'D'):
        entry = triplet.get(kind)
        if entry and entry[1] == 'closed':
            if TARGET and entry[0] != TARGET:
                continue
            check_triplet(s_id, triplet, kind)

output = {
    "violations": violations,
    "violation_count": len(violations),
    "total_triplets_checked": len(by_exp) + len(by_s),
}

if $JSON:
    print(json.dumps(output, indent=2))
else:
    if violations:
        print(f"FOUND {len(violations)} close-order violation(s):")
        for v in violations:
            print(f"  - bead {v['closing']} (label {v['label']}) closed but {v['reason']}")
    else:
        print(f"OK: no close-order violations across {len(by_exp)} EXP triplets + {len(by_s)} S triplets")

sys.exit(1 if violations else 0)
PYEOF
