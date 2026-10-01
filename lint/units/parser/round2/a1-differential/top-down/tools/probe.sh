#!/bin/bash
# usage: probe.sh <sources.txt> [apis]     prints base, head and tsc for every source
M=/workspace/notes/lint/measure/parser
f=$1; [ -n "${2:-}" ] && export PROBE_APIS=$2
t=$(mktemp -d /tmp/a1td/p/run.XXXXXX)
"$M/base/bun" /tmp/a1td/p/side.mjs "$f" "$t/base.json" || exit 1
"$M/head/bun" /tmp/a1td/p/side.mjs "$f" "$t/head.json" || exit 1
bun /tmp/a1td/p/merge.mjs "$t/base.json" "$t/head.json"
rm -rf "$t"
