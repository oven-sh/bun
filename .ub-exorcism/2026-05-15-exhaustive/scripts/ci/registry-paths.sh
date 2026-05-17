#!/usr/bin/env bash
# scripts/ci/registry-paths.sh — META-CI-SHARDING companion
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/ci/registry-paths.sh
# CANONICAL LOCATION: scripts/ci/registry-paths.sh
#
# Given a list of changed file paths (one per line on stdin), maps each path
# to the set of EXP-IDs whose registry file:line falls inside that path.
# This is the inverse mapping that compute-affected-exps.sh uses internally;
# exposing it separately lets CI scripts call it directly to attribute test
# failures to the most-relevant EXPs.
#
# Usage:
#   git diff --name-only main...HEAD | scripts/ci/registry-paths.sh
#   echo "src/runtime/webcore/encoding.rs" | scripts/ci/registry-paths.sh

set -euo pipefail
JSON=0
[[ "${1:-}" == "--json" ]] && JSON=1

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REGISTRY="$REPO_ROOT/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md"
[[ -f "$REGISTRY" ]] || { echo "registry not found: $REGISTRY" >&2; exit 2; }

# Capture stdin to a temp file so we can pass it to Python as a file path
# (avoids shell-injection via heredoc interpolation of $INPUT, which would
# break if a filename contains $, \, ", or """).
INPUT_FILE="$(mktemp)"
trap 'rm -f "$INPUT_FILE"' EXIT
cat > "$INPUT_FILE"

python3 - "$REGISTRY" "$JSON" "$INPUT_FILE" <<'PYEOF'
import json, re, sys

reg_path, json_out, input_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
changed = open(input_path).read().strip().splitlines()

# Build EXP -> [file paths] map
exp_files = {}
text = open(reg_path).read()
for chunk in re.split(r'(?m)^## EXP-', text)[1:]:
    m = re.match(r'(\d+[a-z]?)\b', chunk)
    if not m: continue
    eid = 'EXP-' + m.group(1)
    files = set()
    for pat in [
        r'\*\*Section:\*\*[^\n]*?\`((?:src|experiments|vendor|tests)/[^\`:]+)',
        r'\*\*Files?:\*\*\s*\`?((?:src|experiments|vendor|tests)/[^\`,\n:]+)',
        r'\`(src/[^\`]+\.rs)',
    ]:
        files.update(m.group(1).strip() for m in re.finditer(pat, chunk))
    files = {f.split(':')[0] for f in files}
    if files: exp_files[eid] = files

# For each changed path, find matching EXPs.
# Matching rule (precise): an EXP matches a changed_path iff one of its
# registry file_paths is exactly equal to changed_path, OR is a parent
# directory of changed_path, OR is a descendant of changed_path. This
# means a changed file in a directory the EXP references = match; a
# changed directory containing the EXP's file = match.
results = {}
for changed_path in changed:
    matches = []
    for eid, eid_files in exp_files.items():
        for ef in eid_files:
            if ef == changed_path:
                matches.append(eid); break
            # ef is parent dir of changed_path: ef = "src/runtime/timer", changed_path = "src/runtime/timer/mod.rs"
            if changed_path.startswith(ef.rstrip('/') + '/'):
                matches.append(eid); break
            # changed_path is parent of ef: changed_path = "src/runtime", ef = "src/runtime/timer/mod.rs"
            if ef.startswith(changed_path.rstrip('/') + '/'):
                matches.append(eid); break
    results[changed_path] = sorted(set(matches))

if json_out:
    print(json.dumps(results, indent=2))
else:
    for path, exps in results.items():
        if exps:
            print(f"{path}: {','.join(exps)}")
        else:
            print(f"{path}: (no matching EXPs)")
PYEOF
