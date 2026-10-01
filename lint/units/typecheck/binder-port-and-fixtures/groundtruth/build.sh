#!/bin/bash
# Builds the probe that prints what typescript-go's binder writes for a file (groundtruth/dumpbind/main.go).
# It needs the Go 1.26 toolchain and the module dependencies that ../../ts-dump-and-test-importer/groundtruth/build.sh makes in the work dir.
# usage: build.sh [work dir, default /tmp/rr]      result: <work dir>/dumpbind
# with COVER=1 the result counts the statements of internal/binder: run it with `-cover <dir>`, then `go tool covdata textfmt -i=<dir>/<n>,<dir>`.
set -e
W=${1:-/tmp/rr}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
if [ ! -x "$W/go126/bin/go" ] || [ ! -d "$W/deps/xxh3" ]; then bash "$HERE/../../ts-dump-and-test-importer/groundtruth/build.sh" "$W"; fi
M="$W/bindmod"
mkdir -p "$M/internal" "$M/cmd/dumpbind"
# The non-test import closure of internal/binder and internal/parser at 89d5d5b, copied unchanged.
for p in binder parser ast collections core debug diagnostics scanner stringutil tspath locale spanmap json repo jsnum; do
  rm -rf "$M/internal/$p"
  cp -r "$REF/internal/$p" "$M/internal/$p"
  find "$M/internal/$p" -name "*_test.go" -delete
done
cp "$HERE/dumpbind/main.go" "$M/cmd/dumpbind/main.go"
sed "s#=> \.\./deps/#=> $W/deps/#" "$W/mod/go.mod" > "$M/go.mod"
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod PATH="$W/go126/bin:$PATH" GOROOT="$W/go126"
if [ -n "$COVER" ]; then
  (cd "$M" && go build -cover -covermode=atomic -coverpkg=github.com/microsoft/typescript-go/internal/binder,github.com/microsoft/typescript-go/cmd/dumpbind -o "$W/dumpbind" ./cmd/dumpbind)
else
  (cd "$M" && go build -o "$W/dumpbind" ./cmd/dumpbind)
fi
echo "built $W/dumpbind"
