#!/bin/sh
# Builds the probe that runs typescript-go's checker on parsed and bound files, with function coverage of checker and evaluator.
# Needs the Go 1.26 toolchain and the five dependencies of ts-dump-and-test-importer/groundtruth/build.sh (/tmp/rr/go126, /tmp/rr/deps).
# usage: build.sh [work dir, default /tmp/ctl/gt]      result: <work dir>/k4probe      run it under /workspace/tools/lk
set -e
W=${1:-/tmp/ctl/gt}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/mod/internal" "$W/mod/cmd/k4probe" "$W/gocache"
for p in ast astnav binder checker collections contentmapper core debug diagnostics evaluator glob ipc jsnum json jsonrpc locale module modulespecifiers nodebuilder outputpaths packagejson parser printer pseudochecker repo scanner semver sourcemap spanmap stringutil symlinks tracing tsoptions tspath vfs; do
  rm -rf "$W/mod/internal/$p"
  cp -r "$REF/internal/$p" "$W/mod/internal/$p"
  find "$W/mod/internal/$p" -name "*_test.go" -delete
done
cat "$HERE/zz_probe.go.txt" >> "$W/mod/internal/checker/exports.go"
cp "$HERE/k4probe_main.go.txt" "$W/mod/cmd/k4probe/main.go"
cat > "$W/mod/go.mod" <<'MOD'
module github.com/microsoft/typescript-go

go 1.26

require (
	github.com/go-json-experiment/json v0.0.0
	github.com/zeebo/xxh3 v1.1.0
	github.com/klauspost/cpuid/v2 v2.2.10
	golang.org/x/sync v0.21.0
	golang.org/x/text v0.38.0
)

replace github.com/go-json-experiment/json => /tmp/rr/deps/json
replace github.com/zeebo/xxh3 => /tmp/rr/deps/xxh3
replace github.com/klauspost/cpuid/v2 => /tmp/rr/deps/cpuid
replace golang.org/x/sync => /tmp/rr/deps/sync
replace golang.org/x/text => /tmp/rr/deps/text
MOD
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE="$W/gocache" PATH=/tmp/rr/go126/bin:$PATH
# The main package has to be in -coverpkg: without it the binary writes no counters.
(cd "$W/mod" && go build -cover -covermode=set -coverpkg=./cmd/k4probe,./internal/checker,./internal/evaluator -o "$W/k4probe" ./cmd/k4probe)
echo "built $W/k4probe"
