#!/bin/sh
# Builds the declaration probe in the copy of the reference made by build.sh and runs it on inputs/*.ts with
# lib.es5.d.ts and strict, once with the default truncation and once with noErrorTruncation, and compares with out/.
# usage: sh run-decls.sh [work dir, default /tmp/ctp]
set -e
W=${1:-/tmp/ctp}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
mkdir -p "$W/tsgo/cmd/ctpprobe3" "$W/decls"
cp "$HERE/ctpprobe3_main.go.txt" "$W/tsgo/cmd/ctpprobe3/main.go"
grep -q ProbeDeclarationStrings "$W/tsgo/internal/checker/exports.go" || cat "$HERE/zz_probe.go.txt" >> "$W/tsgo/internal/checker/exports.go"
export PATH="$W/go126/bin:/tmp/rr/go126/bin:$PATH" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$W/gocache" GOTMPDIR="$W/gotmp"
(cd "$W/tsgo" && /workspace/tools/lk go build -o "$W/ctpprobe3" ./cmd/ctpprobe3)
cd "$HERE/inputs"
for f in *.ts; do
  "$W/ctpprobe3" -strict lib.es5.d.ts=$LIB/es5.d.ts "$f=$f" > "$W/decls/$f.strings.tsv"
  "$W/ctpprobe3" -strict -notrunc lib.es5.d.ts=$LIB/es5.d.ts "$f=$f" > "$W/decls/$f.strings.notrunc.tsv"
  cmp "$W/decls/$f.strings.tsv" "$HERE/out/$f.strings.tsv" || echo "differs: $f"
  cmp "$W/decls/$f.strings.notrunc.tsv" "$HERE/out/$f.strings.notrunc.tsv" || echo "differs: $f (notrunc)"
done
echo "declaration probe ok"
