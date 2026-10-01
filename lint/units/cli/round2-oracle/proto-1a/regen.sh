#!/bin/sh
# Regenerates the fixture of one rule from its lists of cases: cases/<rule>.json (seed.cjs writes it once) and every
# cases/<rule>.*.json beside it (cases/<rule>.ts.json: the TypeScript cases). ESLint at the pin answers, `bun --lint` of the
# debug build of the worktree is the probe. Writes vectors/<rule>.json, logs/<rule>.log and the fixture of the tree.
# usage: sh regen.sh <rule> [directory for the fixture]     default: test/cli/lint/rules of the worktree
# Before: sh setup.sh (ESLint and typescript-eslint under /workspace/ref), and a debug build (bun bd --version).
set -e
cd "$(dirname "$0")"
rule=$1
[ -n "$rule" ] || { echo "usage: sh regen.sh <rule> [fixture directory]" >&2; exit 1; }
mkdir -p vectors logs
[ -f "cases/$rule.json" ] || node seed.cjs "$rule"
node diff.cjs "$rule" --show --out "vectors/$rule.json" cases/"$rule".json $(ls cases/"$rule".*.json 2>/dev/null) > "logs/$rule.log"
head -1 "logs/$rule.log"
if [ -n "$2" ]; then node make-fixtures.cjs --to "$2" "$rule"; else node make-fixtures.cjs "$rule"; fi
