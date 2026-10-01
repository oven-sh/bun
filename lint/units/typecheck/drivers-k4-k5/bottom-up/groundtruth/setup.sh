#!/bin/sh
# Research probe: builds typescript-go's own tsgo (89d5d5b) with and without coverage counters for all internal packages.
# Needs Go 1.26.8 and the module sources that units/conformance/oracle-and-expectations/bottom-up/groundtruth/prepost/build.sh put in /tmp/oe-research.
# usage: sh setup.sh [work dir, default /tmp/k4drv]
set -e
W=${1:-/tmp/k4drv}
O=/tmp/oe-research
R=/workspace/ref/typescript-go
T=$W/tsgo
test -x $O/go126/bin/go || { echo "Go 1.26.8 is missing in $O/go126"; exit 1; }
rm -rf "$T"
mkdir -p "$T"
cp -r "$R/internal" "$T/internal"
cp -r "$R/cmd" "$T/cmd"
cp "$R/go.mod" "$R/go.sum" "$T/"
cat >> "$T/go.mod" <<EOM

replace (
	github.com/go-json-experiment/json => $O/mods/json
	github.com/google/go-cmp => $O/mods/go-cmp
	github.com/mackerelio/go-osstat => $O/mods/go-osstat
	github.com/peter-evans/patience => $O/mods/patience
	github.com/zeebo/xxh3 => $O/mods/xxh3
	github.com/klauspost/cpuid/v2 => $O/mods/cpuid
	golang.org/x/sync => $O/mods/x-sync
	golang.org/x/sys => $O/mods/x-sys
	golang.org/x/term => $O/mods/x-term
	golang.org/x/text => $O/mods/x-text
	gotest.tools/v3 => $O/mods/gotest.tools
)
EOM
export PATH="$O/go126/bin:$PATH" GOROOT="$O/go126" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$O/gocache" GOMODCACHE="$O/gomodcache"
cd "$T"
date
go build -o "$W/tsgo-plain" ./cmd/tsgo
echo "built tsgo-plain"
date
go build -cover -covermode=set -coverpkg=github.com/microsoft/typescript-go/internal/...,github.com/microsoft/typescript-go/cmd/tsgo -o "$W/tsgo-cover" ./cmd/tsgo
echo "built tsgo-cover"
date
echo SETUP-DONE
