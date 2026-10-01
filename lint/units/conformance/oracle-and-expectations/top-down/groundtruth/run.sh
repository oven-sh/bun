#!/bin/sh
# Research probe: runs TestSubmodule of the scratch copy with the pre-emit and post-emit recorder.
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod PATH=/tmp/rr/go126/bin:$PATH GOROOT=/tmp/rr/go126
export GOMAXPROCS=8 GOTMPDIR=/tmp/oe/gotmp
export OE_PROBE_OUT=/tmp/oe/probe-out
cd /tmp/oe/tsgo || exit 1
rm -rf /tmp/oe/probe-out/*
date
go test ./internal/testrunner/ -run '^TestSubmodule$' -count=1 -timeout 300m -parallel 8 > /tmp/oe/test.log 2>&1
echo "exit $?"
date
echo RUN-DONE
