#!/bin/bash
# Builds parsediag, the parse oracle of typescript-go (internal/parser of /workspace/ref/typescript-go at 89d5d5b).
# It reuses the work directory of the tree dumper of the typecheck unit (Go 1.26 built from source, the five
# module dependencies of the parser's import closure from GitHub archives). When that directory lacks the
# toolchain, the recipe of the typecheck unit builds it first (about 15 minutes on a loaded machine).
# usage: build.sh [work dir, default /tmp/rr]      result: <work dir>/parsediag
set -e
W=${1:-/tmp/rr}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
RECIPE=/workspace/notes/lint/units/typecheck/ts-dump-and-test-importer/groundtruth/build.sh
if [ ! -x "$W/go126/bin/go" ] || [ ! -f "$W/mod/go.mod" ]; then
  bash "$RECIPE" "$W"
fi
# The copy of the import closure must be the reference commit, unchanged.
for p in parser ast scanner diagnostics; do
  for f in "$REF/internal/$p"/*.go; do
    case "$f" in *_test.go) continue ;; esac
    cmp -s "$f" "$W/mod/internal/$p/$(basename "$f")" || { echo "stale copy: $f"; exit 1; }
  done
done
mkdir -p "$W/mod/cmd/parsediag"
cp "$HERE/parsediag/main.go" "$W/mod/cmd/parsediag/main.go"
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
(cd "$W/mod" && PATH="$W/go126/bin:$PATH" GOROOT="$W/go126" GOFLAGS=-mod=mod go build -o "$W/parsediag" ./cmd/parsediag)
echo "built $W/parsediag ($(cd "$REF" && git rev-parse --short HEAD))"
