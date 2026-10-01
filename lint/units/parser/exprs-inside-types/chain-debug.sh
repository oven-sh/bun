#!/bin/sh
# usage: chain-debug.sh <tag> <copy of src/js_parser>: assembly of the release command (run.py), then the debug rlib and the link of bun-debug.
TAG=$1; SRC=$2
Q=/workspace/notes/lint/units/parser/build-sink-positions/quick
OUT=/tmp/eit/q RELAX=1 python3 $Q/run.py $TAG $SRC || { grep -E '^(error|warning: unused)' -A 14 /tmp/eit/q/$TAG/rustc.log | head -200; exit 1; }
python3 /tmp/eit/tools/rlib-debug.py $TAG $SRC || { grep -E '^error' -A 14 /tmp/eit/rlib-debug/$TAG/rustc.log | head -120; exit 1; }
python3 /tmp/eit/tools/link-debug.py $TAG /tmp/eit/rlib-debug/$TAG/libbun_js_parser-8337f9633b1f3cf3.rlib
