#!/bin/bash
# Builds the probe that runs typescript-go's own NewChecker, symbol merge and alias resolution and prints what they made.
# Needs the Go 1.26 toolchain and the five module sources that ../../ts-dump-and-test-importer/groundtruth/build.sh puts in /tmp/rr.
# usage: build.sh [work dir, default /tmp/k3a/gt]      result: <work dir>/initprobe, then run.sh writes out/*.txt again
set -e
W=${1:-/tmp/k3a/gt}
R=${RR:-/tmp/rr}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/mod/cmd/initprobe"
for p in $(python3 "$HERE/closure.py" internal/checker | sed '/--third/,$d'); do
  mkdir -p "$W/mod/$p"
  find "$REF/$p" -maxdepth 1 -type f \( -name '*.go' -o -name '*.json' \) ! -name '*_test.go' -exec cp {} "$W/mod/$p/" \;
done
cp -r "$REF/internal/diagnostics/loc" "$W/mod/internal/diagnostics/"
python3 "$HERE/patch.py" "$W/mod/internal/checker/checker.go"
cp "$HERE/zz_probe.go.txt" "$W/mod/internal/checker/zz_probe.go"
cp "$HERE/initprobe_main.go.txt" "$W/mod/cmd/initprobe/main.go"
cat > "$W/mod/go.mod" <<MOD
module github.com/microsoft/typescript-go

go 1.26

require (
	github.com/go-json-experiment/json v0.0.0
	github.com/zeebo/xxh3 v1.1.0
	github.com/klauspost/cpuid/v2 v2.2.10
	golang.org/x/sync v0.21.0
	golang.org/x/text v0.38.0
)

replace github.com/go-json-experiment/json => $R/deps/json
replace github.com/zeebo/xxh3 => $R/deps/xxh3
replace github.com/klauspost/cpuid/v2 => $R/deps/cpuid
replace golang.org/x/sync => $R/deps/sync
replace golang.org/x/text => $R/deps/text
MOD
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOROOT="$R/go126" PATH="$R/go126/bin:$PATH"
(cd "$W/mod" && /workspace/tools/lk go build -o "$W/initprobe" ./cmd/initprobe)
echo "built $W/initprobe"
