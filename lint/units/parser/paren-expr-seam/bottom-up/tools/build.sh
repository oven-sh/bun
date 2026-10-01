#!/bin/sh
# usage: build.sh <tag> [<variant>[+<variant>...]] : fresh copy of the base in ONE fixed directory, patch, compile with the
# release rustc command (run.py). No variant: the base. Output: /tmp/pes/out/<tag>/bun_js_parser-*.s and .ll .
# Every build uses the same source path so that file!() strings have one length.
set -e
TAG=$1; V=$2
W=/tmp/pes/w
rm -rf $W; cp -r /tmp/pes/base $W
if [ -n "$V" ]; then python3 /tmp/pes/tools/variant.py "$V" $W; fi
rm -rf /tmp/pes/keep/$TAG; mkdir -p /tmp/pes/keep/$TAG
(cd $W && diff -ruN /tmp/pes/base . > /tmp/pes/keep/$TAG/variant.diff || true)
OUT=/tmp/pes/out RELAX=1 python3 /workspace/notes/lint/units/parser/build-sink-positions/quick/run.py $TAG $W || { grep -E '^error' -A 14 /tmp/pes/out/$TAG/rustc.log | head -90; exit 1; }
if [ -n "$RLIB" ]; then python3 /tmp/pes/tools/rlib.py $TAG $W || { grep -E '^error' -A 14 /tmp/pes/rlib/$TAG/rustc.log | head -60; exit 1; }; fi
