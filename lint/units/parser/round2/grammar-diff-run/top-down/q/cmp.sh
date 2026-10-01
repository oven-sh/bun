#!/bin/bash
# cmp.sh <file of sources> [--tsx] : base, head and tsc side by side
M=/workspace/notes/lint/measure/parser
f=$1; shift
paste -d'\t' <($M/base/bun /tmp/gdr1b/q/ar.mjs "$f" "$@") <($M/head/bun /tmp/gdr1b/q/ar.mjs "$f" "$@") <($M/head/bun /tmp/gdr1b/q/tsc1.mjs -f "$f" | grep '^   ts:' | sed 's/^   ts: //; s/ other\[[0-9,]*\]//; s/ meta=.*//') <(grep -v '^# ' "$f" | grep -v '^$') | awk -F'\t' '{ b=substr($1,1,1); h=substr($2,1,1); printf "%s>%s  tsc %-38s %s\n      base: %s\n", b, h, $3, $4, substr($1,3) }' | sed '/base: $/d'
