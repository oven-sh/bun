#!/bin/sh
# usage: run-proto.sh <bun binary of the prototype>: the probes of this unit against a changed build.
B=$1; N=/workspace/notes/lint/units/parser/exprs-inside-types
export BUN_DEBUG_QUIET_LOGS=1
cd $N || exit 1
$B --revision
$B bunprobe.mjs inputs.json > bun-proto2.jsonl 2> /tmp/eit/res-probe.err; echo "probe rc $?"; wc -l bun-proto2.jsonl
node expected.cjs bun-proto2.jsonl > expected.json 2> prototype-summary.txt; cat prototype-summary.txt
$B state-leaks.mjs > state-leaks.txt 2>&1; tail -40 state-leaks.txt
$B snapshot-stale-symbol-repro.mjs 2>&1 | grep -n "design:type" 
$B speculation-flip.mjs 2>&1 | cut -c1-200
