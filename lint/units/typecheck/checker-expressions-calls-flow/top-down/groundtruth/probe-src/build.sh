#!/bin/bash
# Builds the probe that runs typescript-go's own checker on given files, with statement coverage of checker and binder.
# Needs the Go 1.26 toolchain and the five module sources that ../../ts-dump-and-test-importer/groundtruth/build.sh puts in /tmp/rr.
# usage: build.sh [work dir, default /tmp/ecf/gt]      result: <work dir>/checkprobe (plain) and <work dir>/checkprobe.cover (a test binary)
# coverage run: PROBE_ARGS="<args>" <work dir>/checkprobe.cover -test.run TestProbe -test.coverprofile=<file>
set -e
W=${1:-/tmp/ecf/gt}
R=${RR:-/tmp/rr}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/mod/cmd/checkprobe" "$W/mod/internal/zzprobe"
for p in $(python3 "$HERE/closure.py" internal/checker | sed '/--third/,$d'); do
  mkdir -p "$W/mod/$p"
  find "$REF/$p" -maxdepth 1 -type f \( -name '*.go' -o -name '*.json' \) ! -name '*_test.go' -exec cp {} "$W/mod/$p/" \;
done
cp -r "$REF/internal/diagnostics/loc" "$W/mod/internal/diagnostics/"
cp "$HERE/zz_probe.go.txt" "$W/mod/internal/checker/zz_probe.go"
cp "$HERE/checkprobe_main.go.txt" "$W/mod/cmd/checkprobe/main.go"
cp "$HERE/zzprobe.go.txt" "$W/mod/internal/zzprobe/zzprobe.go"
cp "$HERE/zzprobe_test.go.txt" "$W/mod/internal/zzprobe/zzprobe_test.go"
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
export GOCACHE=${GOCACHE:-$W/gocache}
M=github.com/microsoft/typescript-go/internal
(cd "$W/mod" && /workspace/tools/lk go build -o "$W/checkprobe" ./cmd/checkprobe)
(cd "$W/mod" && /workspace/tools/lk go test -c -cover -covermode=count -coverpkg=$M/checker,$M/binder -o "$W/checkprobe.cover" ./internal/zzprobe)
echo "built $W/checkprobe and $W/checkprobe.cover"
