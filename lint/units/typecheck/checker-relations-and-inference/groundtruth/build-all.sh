#!/bin/bash
# Builds a second probe from the module that build.sh made: every function of internal/checker records its entry.
# It gives the exact call tree below one relation or inference (out/k4.relation-tree.txt was made with it).
# usage: build-all.sh [work dir of build.sh, default /tmp/relinf/gt] [out dir, default /tmp/relinf/gt-all]      result: <out dir>/relprobe-all
set -e
G=${1:-/tmp/relinf/gt}
W=${2:-/tmp/relinf/gt-all}
R=${RR:-/tmp/rr}
mkdir -p "$W"
rm -rf "$W/mod"
cp -r "$G/mod" "$W/mod"
cd "$W/mod/internal/checker"
for f in *.go; do
  case "$f" in
    zz_relprobe.go|relater.go|inference.go|tracer.go|stringer_generated.go) ;;
    *) "$G/instr/instr" "$W/mod/internal/checker/$f" ;;
  esac
done
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOROOT="$R/go126" PATH="$R/go126/bin:$PATH"
(cd "$W/mod" && /workspace/tools/lk go build -o "$W/relprobe-all" ./cmd/relprobe)
echo "built $W/relprobe-all"
# The trace holds two lines that upstream does not produce: FormatTypeFlags and chainDepth are called by the probe's own notes.
