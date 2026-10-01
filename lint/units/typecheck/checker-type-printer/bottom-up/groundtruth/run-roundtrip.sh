#!/bin/sh
# Builds the printer-only probe in the copy of the reference made by build.sh and runs it on the distinct argument
# texts of the reference's error baselines. The output is the oracle of the printer round-trip test: for a text
# that the reference prints back unchanged (TYPE-SAME, SIG-SAME, EXPR-SAME) the port has to print it back unchanged
# from a deep-cloned tree too; a DIFF line gives the expected output next to the input.
# usage: sh run-roundtrip.sh [work dir, default /tmp/ctp]      result: ../data/printer-roundtrip.tsv.gz
set -e
W=${1:-/tmp/ctp}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/tsgo/cmd/ctpprobe" "$W/corpus"
cp "$HERE/ctpprobe_main.go.txt" "$W/tsgo/cmd/ctpprobe/main.go"
export PATH="$W/go126/bin:/tmp/rr/go126/bin:$PATH" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$W/gocache" GOTMPDIR="$W/gotmp"
(cd "$W/tsgo" && /workspace/tools/lk go build -o "$W/ctpprobe" ./cmd/ctpprobe)
python3 "$HERE/../py/typecorpus.py" "$W/corpus/texts.tsv"
cut -f3- "$W/corpus/texts.tsv" | "$W/ctpprobe" all > "$W/corpus/roundtrip.tsv"
cut -f1 "$W/corpus/roundtrip.tsv" | sort | uniq -c
gzip -9 -c "$W/corpus/roundtrip.tsv" > "$HERE/../data/printer-roundtrip.tsv.gz"
