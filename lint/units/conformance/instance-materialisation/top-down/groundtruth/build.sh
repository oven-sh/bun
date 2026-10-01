#!/bin/bash
# Builds the two ground truth programs of this directory against the reference's own packages.
# roots: makeUnitsFromTest, newCompilerTest and the head of CompileFilesEx by line range (roots/gen.py), real tsoptions, parser, vfstest.
# tsp:   the real internal/tspath on pairs of a name and a directory.
# Needs the Go 1.26 toolchain and the module archives that ../../../../typecheck/ts-dump-and-test-importer/groundtruth/build.sh leaves in /tmp/rr.
# usage: build.sh [work dir, default /tmp/im-td]      result: <work dir>/roots and <work dir>/tsp
set -e
W=${1:-/tmp/im-td}
RR=${RR:-/tmp/rr}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
test -x "$RR/go126/bin/go" || { echo "no Go 1.26 in $RR: run the build.sh of typecheck/ts-dump-and-test-importer first"; exit 1; }
mkdir -p "$W/mod/internal" "$W/mod/cmd/roots" "$W/mod/cmd/tsp"
# the import closure of tsoptions, tsoptionstest, parser and vfstest at 89d5d5b (roots/closure.py prints it), copied unchanged
for p in ast collections contentmapper core debug diagnostics glob ipc jsnum json jsonrpc locale module outputpaths packagejson parser repo scanner semver spanmap stringutil tsoptions tspath vfs; do
  rm -rf "$W/mod/internal/$p"; mkdir -p "$W/mod/internal/$p"
  find "$REF/internal/$p" -maxdepth 1 -name "*.go" ! -name "*_test.go" -exec cp {} "$W/mod/internal/$p/" \;
done
cp -r "$REF/internal/diagnostics/loc" "$W/mod/internal/diagnostics/"
mkdir -p "$W/mod/internal/tsoptions/tsoptionstest"
# parsedcommandline.go of tsoptionstest imports gotest.tools and is not needed
cp "$REF/internal/tsoptions/tsoptionstest/vfsparseconfighost.go" "$W/mod/internal/tsoptions/tsoptionstest/"
for s in internal iovfs vfsmatch vfstest; do
  mkdir -p "$W/mod/internal/vfs/$s"
  find "$REF/internal/vfs/$s" -maxdepth 1 -name "*.go" ! -name "*_test.go" -exec cp {} "$W/mod/internal/vfs/$s/" \;
done
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

replace github.com/go-json-experiment/json => $RR/deps/json
replace github.com/zeebo/xxh3 => $RR/deps/xxh3
replace github.com/klauspost/cpuid/v2 => $RR/deps/cpuid
replace golang.org/x/sync => $RR/deps/sync
replace golang.org/x/text => $RR/deps/text
MOD
python3 "$HERE/roots/gen.py" "$HERE/roots/tail.go.txt" "$W/mod/cmd/roots/main.go"
cp "$HERE/tsp/main.go" "$W/mod/cmd/tsp/main.go"
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off PATH="$RR/go126/bin:$PATH" GOROOT="$RR/go126" GOFLAGS=-mod=mod GOCACHE="$W/gocache"
(cd "$W/mod" && go build -o "$W/roots" ./cmd/roots && go build -o "$W/tsp" ./cmd/tsp)
echo "built $W/roots and $W/tsp"
echo "dump:    $W/roots <tests/cases> <tests/lib> <out.jsonl>"
echo "vectors: python3 $HERE/roots/to_vectors.py <out.jsonl> <roots.jsonl.gz> [nontrivial]"
