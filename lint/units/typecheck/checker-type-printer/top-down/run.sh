#!/bin/sh
# Runs the type printer probes through the reference (typescript-go 89d5d5b) and writes, next to each input, the
# diagnostics (<name>.out.txt) and the checker functions of the printer family that the input executed (<name>.fns.txt).
# The probe binary is the one of ../../checker-type-layers-scratch/groundtruth/build.sh (default /tmp/ctl/gt/k4probe):
# strict mode, lib es5 (plus es2015.symbol for stage_syms), noErrorTruncation unset, so type texts are truncated as
# they are for a user, which the reference's own test harness never does (it forces noErrorTruncation).
# usage: sh run.sh [work dir of the probe, default /tmp/ctl/gt]
set -e
W=${1:-/tmp/ctl/gt}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
export GOTOOLCHAIN=local PATH=/tmp/rr/go126/bin:$PATH
FAM='checker/(printer|nodebuilder|nodebuilderimpl|nodebuilderscopes|nodecopy|symbolaccessibility|pseudotypenodebuilder|symboltracker|emitresolver|nodebuilder_hover)\.go'
cd "$HERE/probes"
for f in min.ts trunc1.ts trunc2.ts utf8cut_a.ts utf8cut_b.ts objlit.ts sigs.ts stage_types.ts stage_scope.ts stage_syms.ts stage_more.ts; do
  C=$(mktemp -d)
  extra=""
  case "$f" in stage_syms.ts) extra="lib.es2015.symbol.d.ts=$LIB/es2015.symbol.d.ts mod.ts=mod.ts";; esac
  GOCOVERDIR="$C" "$W/k4probe" -strict lib.es5.d.ts=$LIB/es5.d.ts $extra "$f=$f" | grep -v '^RESOLUTIONDEPTH\|^COUNTS' > "${f%.ts}.out.txt"
  (cd "$W/mod" && go tool covdata func -i="$C") | grep -E "$FAM" | grep -v '	0.0%' | awk '{print $1, $2}' | sed 's#github.com/microsoft/typescript-go/internal/checker/##' > "${f%.ts}.fns.txt"
  rm -rf "$C"
done
wc -l *.out.txt *.fns.txt | tail -1
