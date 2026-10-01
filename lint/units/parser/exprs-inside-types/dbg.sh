#!/bin/sh
# usage: dbg.sh <tag> <copy of src/js_parser>: the debug rlib of the copy, then the link of bun-debug outside the worktree.
TAG=$1; SRC=$2
python3 /tmp/eit/tools/rlib-debug.py $TAG $SRC || { grep -E '^error' -A 14 /tmp/eit/rlib-debug/$TAG/rustc.log | head -120; exit 1; }
python3 /tmp/eit/tools/link-debug.py $TAG /tmp/eit/rlib-debug/$TAG/libbun_js_parser-8337f9633b1f3cf3.rlib
