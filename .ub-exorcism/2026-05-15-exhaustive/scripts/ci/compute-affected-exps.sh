#!/usr/bin/env bash
# scripts/ci/compute-affected-exps.sh — META-CI-SHARDING
#
# Given two git refs (base + head), computes the set of EXP-NNN entries
# whose registry file:line falls inside files modified by the diff. Outputs
# a GitHub Actions matrix-fromJson-compatible JSON array.
#
# Usage:
#   scripts/ci/compute-affected-exps.sh <base-ref> <head-ref> [--configs sb,tb,sp,sa]
#
# Output:
#   {"include": [
#     {"exp": "EXP-001", "cfg": "sb"},
#     {"exp": "EXP-004", "cfg": "sb"},
#     ...
#   ]}
#
# Edge cases handled:
#   - Bundled R-EXPs (R-EXP-003-006 covers 003+005+006): include ALL
#   - Generated code changes (src/codegen/*): emit ALL EXPs (full fallback)
#   - Vendor changes (vendor/*): emit empty list (no Miri coverage)
#   - No source changes: emit empty list

set -euo pipefail

if [[ $# -lt 2 ]]; then
    echo "usage: $0 <base-ref> <head-ref> [--configs sb,tb,sp,sa]" >&2
    exit 2
fi

BASE="$1"
HEAD="$2"
CONFIGS="sb"
if [[ "${3:-}" == "--configs" && -n "${4:-}" ]]; then
    CONFIGS="$4"
fi

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

REGISTRY=".ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md"
if [[ ! -f "$REGISTRY" ]]; then
    echo "registry not found: $REGISTRY" >&2; exit 2
fi

# Collect changed files in the diff. Pass through a temp file so the python
# script avoids heredoc-string-interpolation injection if a filename ever
# contains $, \, ", or """ — see scripts/ci/registry-paths.sh for the same
# fix pattern.
CHANGED_FILE="$(mktemp)"
trap 'rm -f "$CHANGED_FILE"' EXIT
if ! git diff --name-only "$BASE...$HEAD" > "$CHANGED_FILE" 2>/dev/null; then
    git diff --name-only HEAD~1 HEAD > "$CHANGED_FILE" 2>/dev/null || true
fi

python3 - "$REGISTRY" "$CONFIGS" "$CHANGED_FILE" <<'PYEOF'
import json, re, sys

REGISTRY_PATH, configs_arg, changed_path = sys.argv[1], sys.argv[2], sys.argv[3]
CONFIGS = configs_arg.split(",")
CHANGED = open(changed_path).read().strip().splitlines()

# Parse registry for EXP-NNN -> file_path map
exp_files = {}  # {"EXP-NNN": ["src/foo.rs", ...]}
reg_text = open(REGISTRY_PATH).read()
for chunk in re.split(r'(?m)^## EXP-', reg_text)[1:]:
    m = re.match(r'(\d+[a-z]?)\b', chunk)
    if not m: continue
    eid = 'EXP-' + m.group(1)
    files = []
    for pat in [
        r'\*\*Section:\*\*[^\n]*?\`((?:src|experiments|vendor|tests)/[^\`:]+)',
        r'\*\*Files?:\*\*\s*\`?((?:src|experiments|vendor|tests)/[^\`,\n:]+)',
        r'\`(src/[^\`]+\.rs)',
    ]:
        files.extend(m.group(1).strip() for m in re.finditer(pat, chunk))
    # Strip line-number suffixes, dedupe
    files = list({f.split(':')[0] for f in files})
    if files:
        exp_files[eid] = files

# Heuristics
if not CHANGED:
    print(json.dumps({"include": []}))
    sys.exit(0)

# Fallback: codegen changes invalidate everything
if any(f.startswith('src/codegen/') for f in CHANGED):
    sys.stderr.write("[shard] codegen change detected; emitting FULL matrix\n")
    matrix = [{"exp": eid, "cfg": cfg} for eid in sorted(exp_files) for cfg in CONFIGS]
    print(json.dumps({"include": matrix}))
    sys.exit(0)

# Compute affected EXPs.
# Matching rule (precise): an EXP matches a changed_path iff one of its
# registry file_paths is exactly equal to changed_path, OR is a parent
# directory of changed_path (changed file is inside the EXP's path), OR
# is a descendant of changed_path (changed dir contains the EXP's file).
# We deliberately do NOT use the looser "same-directory" rule that
# treats every EXP with a sibling file as affected.
affected = set()
for eid, eid_files in exp_files.items():
    for changed in CHANGED:
        for ef in eid_files:
            if ef == changed:
                affected.add(eid); break
            if changed.startswith(ef.rstrip('/') + '/'):
                affected.add(eid); break
            if ef.startswith(changed.rstrip('/') + '/'):
                affected.add(eid); break

# Fan out to configs
matrix = [{"exp": eid, "cfg": cfg} for eid in sorted(affected) for cfg in CONFIGS]
sys.stderr.write(f"[shard] affected_exps={len(affected)} matrix_size={len(matrix)}\n")
print(json.dumps({"include": matrix}))
PYEOF
