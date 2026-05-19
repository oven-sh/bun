#!/usr/bin/env bash
# scripts/audit/check-safety-blocks.sh — META-DOC-CONVENTIONS enforcer
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/check-safety-blocks.sh
# CANONICAL LOCATION: scripts/audit/check-safety-blocks.sh
#
# Greps src/ for `unsafe fn` and `unsafe {` and reports any site that lacks
# an immediately-preceding SAFETY block.
#
# Usage:
#   check-safety-blocks.sh                  # check all src/
#   check-safety-blocks.sh --crate <name>   # check one crate (e.g. bun_runtime)
#   check-safety-blocks.sh --json           # JSON output

set -euo pipefail
JSON=0; CRATE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)  JSON=1; shift ;;
        --crate) CRATE="$2"; shift 2 ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

SCOPE="src/"
if [[ -n "$CRATE" ]]; then
    # Resolve crate name -> directory using resolve_crate.py.
    # Pass CRATE as an argv arg to the inner Python (NOT string-interpolated
    # into the script body) to avoid shell-injection if a crate name ever
    # contains a single quote or other special char.
    DIR="$(python3 "$(dirname "$0")/resolve_crate.py" --json | python3 -c '
import json, sys
target = sys.argv[1]
d = json.load(sys.stdin)
for k, v in d.items():
    if v == target:
        print(k); break
' "$CRATE")"
    [[ -z "$DIR" ]] && { echo "crate not found: $CRATE" >&2; exit 2; }
    SCOPE="$DIR"
fi

# Use ripgrep to find every `unsafe fn` and `unsafe {` with 5 lines context.
# Then python parses to identify those without an adjacent SAFETY / # Safety block.
python3 - "$SCOPE" "$JSON" <<'PYEOF'
import json, re, subprocess, sys, pathlib

scope, json_out = sys.argv[1], int(sys.argv[2])

violations = []
for kind, pattern in (("unsafe-block", r"\bunsafe\s*\{"),
                      ("unsafe-fn",    r"\bpub\s+(?:async\s+)?unsafe\s+fn|\bunsafe\s+fn")):
    try:
        # NOTE: must be `-t rust` (two args) or `--type=rust`. The shorthand
        # `-trust` works (joined), but `-tr rust` is parsed as `-t r rust`
        # which fails silently.
        out = subprocess.check_output(
            ["rg", "-n", "--no-heading", "--type", "rust", pattern, scope],
            stderr=subprocess.DEVNULL, text=True
        )
    except subprocess.CalledProcessError:
        out = ""

    for line in out.splitlines():
        m = re.match(r'^([^:]+):(\d+):(.*)$', line)
        if not m: continue
        file, lineno, code = m.group(1), int(m.group(2)), m.group(3)
        # Skip comment-only lines
        if re.search(r'^\s*(//|/\*|\*)', code): continue
        # Read 8 lines preceding to look for SAFETY / # Safety
        try:
            lines = pathlib.Path(file).read_text().splitlines()
        except Exception:
            continue
        if lineno - 1 >= len(lines): continue
        context = "\n".join(lines[max(0, lineno-9):lineno-1])
        # Match SAFETY: or # Safety
        has_safety = bool(re.search(r'(SAFETY\s*:|//\s*SAFETY\s*$|///\s*#\s*Safety\b)', context))
        if not has_safety:
            violations.append({"file": file, "line": lineno, "kind": kind, "snippet": code.strip()[:120]})

# Cap output
result = {
    "scope": scope,
    "violation_count": len(violations),
    "violations": violations[:200],
    "truncated": len(violations) > 200,
}

if json_out:
    print(json.dumps(result, indent=2))
else:
    if not violations:
        print(f"OK: no undocumented unsafe blocks in {scope}")
    else:
        print(f"FOUND {len(violations)} undocumented unsafe site(s) in {scope}:")
        for v in violations[:30]:
            print(f"  {v['file']}:{v['line']} ({v['kind']}): {v['snippet']}")
        if len(violations) > 30: print(f"  ... +{len(violations)-30} more")
sys.exit(1 if violations else 0)
PYEOF
