#!/bin/sh
# Research probe: builds tsgo with coverage snapshots at the phase borders (parse, program, bind, checker init, check, report).
# usage: sh setup2.sh   (after setup.sh)
set -e
W=/tmp/k4drv
O=/tmp/oe-research
rm -rf "$W/tsgo2"
cp -r "$W/tsgo" "$W/tsgo2"
python3 "$W/patch2.py" "$W/tsgo2"
export PATH="$O/go126/bin:$PATH" GOROOT="$O/go126" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$O/gocache" GOMODCACHE="$O/gomodcache"
cd "$W/tsgo2"
gofmt -l internal/k4snap internal/compiler/program.go internal/checker/checker.go internal/execute/tsc/emit.go || true
date
go build -cover -covermode=atomic -coverpkg=github.com/microsoft/typescript-go/internal/...,github.com/microsoft/typescript-go/cmd/tsgo -o "$W/tsgo-snap" ./cmd/tsgo
echo "built tsgo-snap"
date
echo SETUP2-DONE
