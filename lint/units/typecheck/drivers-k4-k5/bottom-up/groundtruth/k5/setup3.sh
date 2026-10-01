#!/bin/sh
# Research probe: the reference's own suite, patched to record the program (files in order, resolutions, metadata) and
# the origin of the diagnostics of every run instance. Needs /tmp/oe-research (Go 1.26.8 and the modules) and /tmp/k4drv/tsgo/go.mod.
# usage: sh setup3.sh   result: /tmp/k4drv/k5/out/manifest.jsonl
set -e
W=/tmp/k4drv/k5
O=/tmp/oe-research
R=/workspace/ref/typescript-go
T=$W/tsgo
rm -rf "$T" "$W/out"
mkdir -p "$T/testdata/baselines/local" "$W/out"
cp -r "$R/internal" "$T/internal"
cp /tmp/k4drv/tsgo/go.mod "$R/go.sum" "$T/"
ln -s "$R/_submodules" "$T/_submodules"
ln -s "$R/testdata/baselines/reference" "$T/testdata/baselines/reference"
for x in fixtures tests submoduleAccepted.txt submoduleTriaged.txt; do ln -s "$R/testdata/$x" "$T/testdata/$x"; done
python3 "$W/patch3.py" "$T" "$W"
export PATH="$O/go126/bin:$PATH" GOROOT="$O/go126" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$O/gocache" GOMODCACHE="$O/gomodcache"
gofmt -l "$T/internal/testrunner" "$T/internal/testutil/harnessutil" || true
date
(cd "$T" && go vet ./internal/testrunner 2>&1 | head -20 || true)
(cd "$T" && go test -c -o "$W/testrunner.test" ./internal/testrunner)
echo "built testrunner.test"
date
(cd "$T/internal/testrunner" && K5_MANIFEST_DIR="$W/out" "$W/testrunner.test" -test.run '^TestSubmodule$' -test.count=1 -test.timeout 170m > "$W/test.log" 2>&1) || true
tail -3 "$W/test.log"
wc -l "$W/out/manifest.jsonl"
date
echo SETUP3-DONE
