#!/bin/sh
# Builds the probe of typescript-go's real command line path, plain and with function coverage of every internal package.
# usage: build.sh      results: /tmp/e2e/k4real (plain) and /tmp/e2e/k4real.cov (coverage)      run it under /workspace/tools/lk
set -e
W=/tmp/e2e
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE="$W/gocache" PATH=/tmp/rr/go126/bin:$PATH
cd "$W/mod"
go vet ./cmd/k4real 2>&1 | head -40 || true
go build -o "$W/k4real" ./cmd/k4real
echo "built $W/k4real"
go build -cover -covermode=set -coverpkg=./... -o "$W/k4real.cov" ./cmd/k4real
echo "built $W/k4real.cov"
