#!/bin/sh
# Builds the probe that runs typescript-go's checker with chosen compiler options, with function coverage of checker and evaluator.
# It adds one main package to the module that ../../../checker-type-layers-scratch/groundtruth/build.sh creates in /tmp/ctl/gt/mod
# (run that script first: it needs the Go 1.26 toolchain in /tmp/rr/go126 and the five dependencies in /tmp/rr/deps).
# usage: build.sh [work dir, default /tmp/cdg/gt]      result: <work dir>/declprobe      run it under /workspace/tools/lk
set -e
W=${1:-/tmp/cdg/gt}
HERE=$(cd "$(dirname "$0")" && pwd)
M=/tmp/ctl/gt/mod
mkdir -p "$W" "$M/cmd/declprobe"
cp "$HERE/declprobe_main.go.txt" "$M/cmd/declprobe/main.go"
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE=/tmp/ctl/gt/gocache PATH=/tmp/rr/go126/bin:$PATH
# The main package has to be in -coverpkg: without it the binary writes no counters.
(cd "$M" && go build -cover -covermode=set -coverpkg=./cmd/declprobe,./internal/checker,./internal/evaluator -o "$W/declprobe" ./cmd/declprobe)
echo "built $W/declprobe"
