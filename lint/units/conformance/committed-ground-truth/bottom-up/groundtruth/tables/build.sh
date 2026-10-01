#!/bin/sh
# Builds and runs the program that prints the four digests of Go's tables (reference_counts.json, member go.tables).
# usage: sh build.sh <typescript-go clone> [work directory]      needs go 1.24 or later, no network
set -e
REF=${1:?usage: sh build.sh <typescript-go clone> [work directory]}
W=${2:-/tmp/cgt-tables}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$W"
mkdir -p "$W/stringutil"
printf 'module gt\n\ngo 1.24\n' > "$W/go.mod"
for f in "$REF"/internal/stringutil/*.go; do case "$f" in *_test.go | *generate.go) ;; *) cp "$f" "$W/stringutil/" ;; esac; done
cp "$HERE/main.go" "$W/main.go"
(cd "$W" && GOCACHE="$W/gocache" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -o gt . && ./gt)
