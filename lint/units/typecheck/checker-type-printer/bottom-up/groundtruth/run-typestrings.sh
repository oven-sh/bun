#!/bin/sh
# Builds the checker-level probe in the copy of the reference made by build.sh and runs it on the texts that the
# printer-only probe reads as a type and prints back unchanged (run-roundtrip.sh first). Each text becomes the
# annotation of `declare const __vN: <text>;` in one file checked with lib.es5.d.ts and strict. The output is the
# oracle of the node builder before relations exist: variable, input text, TypeToString, typeToStringEx with
# UseFullyQualifiedType, typeToString with the declaration as enclosing declaration.
# The run is made twice: with the default truncation and with noErrorTruncation (the harness default).
# usage: sh run-typestrings.sh [work dir, default /tmp/ctp]      results: ../data/typestrings.tsv.gz ../data/typestrings.notrunc.tsv.gz
set -e
W=${1:-/tmp/ctp}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
mkdir -p "$W/tsgo/cmd/ctpprobe2"
cp "$HERE/ctpprobe2_main.go.txt" "$W/tsgo/cmd/ctpprobe2/main.go"
grep -q ProbeTypeNodeToStrings "$W/tsgo/internal/checker/exports.go" || cat "$HERE/zz_probe.go.txt" >> "$W/tsgo/internal/checker/exports.go"
export PATH="$W/go126/bin:/tmp/rr/go126/bin:$PATH" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$W/gocache" GOTMPDIR="$W/gotmp"
(cd "$W/tsgo" && /workspace/tools/lk go build -o "$W/ctpprobe2" ./cmd/ctpprobe2)
awk -F'\t' '$1=="TYPE-SAME"{printf "declare const __v%d: %s;\n", n++, $2}' "$W/corpus/roundtrip.tsv" > "$W/corpus/vars.ts"
awk -F'\t' '$1=="TYPE-SAME"{printf "__v%d\t%s\n", n++, $2}' "$W/corpus/roundtrip.tsv" > "$W/corpus/vars.index.tsv"
"$W/ctpprobe2" -strict lib.es5.d.ts=$LIB/es5.d.ts vars.ts="$W/corpus/vars.ts" > "$W/corpus/typestrings.tsv"
"$W/ctpprobe2" -strict -notrunc lib.es5.d.ts=$LIB/es5.d.ts vars.ts="$W/corpus/vars.ts" > "$W/corpus/typestrings.notrunc.tsv"
paste "$W/corpus/vars.index.tsv" "$W/corpus/typestrings.notrunc.tsv" | cut -f1,2,4- | gzip -9 > "$HERE/../data/typestrings.notrunc.tsv.gz"
paste "$W/corpus/vars.index.tsv" "$W/corpus/typestrings.tsv" | cut -f1,2,4- | gzip -9 > "$HERE/../data/typestrings.tsv.gz"
wc -l < "$W/corpus/typestrings.tsv"
