#!/bin/bash
# The goldens of the ast utilities oracle ("astutil-dump v1", tsgoprobe astutil -bind): for every node of the state
# fixtures and of the inputs of the lowering probe, which of the single-node functions of internal/ast/utilities.go
# hold, what they return, and which ones panic in the reference.
# usage: bash astutil.sh make|check [work dir of bootstrap.sh, default /tmp/oracle-bu]     golden: golden.tar.gz
set -euo pipefail
MODE=${1:-check}
W=${2:-/tmp/oracle-bu}
HERE=$(cd "$(dirname "$0")" && pwd)
N=$(cd "$HERE/../../.." && pwd)
P=${PROBE:-$W/tsgoprobe}
T=$(mktemp -d)
mkdir -p "$T/astutil"
ARGS=""
for f in "$HERE"/../state/fixtures/*.ts "$N"/bun-ast-lowering/probe/src/*; do ARGS="$ARGS $(basename "$f")=$f"; done
"$P" astutil -bind "$T/astutil" $ARGS
case "$MODE" in
  make) tar -czf "$HERE/golden.tar.gz" -C "$T" astutil; echo "wrote $(ls "$T/astutil" | wc -l) dumps" ;;
  check)
    mkdir -p "$T/gold" && tar -xzf "$HERE/golden.tar.gz" -C "$T/gold"
    if diff -rq "$T/astutil" "$T/gold/astutil" > /dev/null; then echo "astutil.golden identical=$(ls "$T/astutil" | wc -l) different=0"; else echo "astutil.golden differs"; diff -rq "$T/astutil" "$T/gold/astutil" | head; fi ;;
esac
rm -rf "$T"
