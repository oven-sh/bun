#!/bin/sh
# usage: cgbench-raw.sh <bun-profile binary> <out dir> <tag> [iterations]
# cgbench.sh with --vex-guest-chase=no: VEX then makes one exit per conditional jump, so Bc is the count of executed
# conditional jumps. With the default (chase on) VEX joins `a && b` / `a || b` pairs of jumps into one exit, and
# a change of block layout moves Bc without a change of the jumps that run.
BIN=$1; OUT=$2; TAG=$3; N=${4:-20}
mkdir -p "$OUT"
for g in bun-types typescript-lib src-js tsx js-control; do
  ( BUN_JSC_useJIT=0 BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/vg --tool=cachegrind --cache-sim=no --branch-sim=yes --vex-guest-chase=no \
      --cachegrind-out-file="$OUT/$TAG.$g.cg" "$BIN" /workspace/notes/lint/benchroot/bench/snippets/transpiler-typescript.mjs --iterations=$N --group=$g \
      > "$OUT/$TAG.$g.log" 2>&1 ) &
done
wait
for g in bun-types typescript-lib src-js tsx js-control; do
  printf '%s %s ' "$TAG" "$g"; python3 /workspace/notes/lint/tools/cgsum.py "$OUT/$TAG.$g.cg" --json
done
