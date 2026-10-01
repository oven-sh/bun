#!/bin/bash
# Builds parsediag: the parser of typescript-go at 89d5d5b as a command that prints parse diagnostics
# (parsediag/main.go). The reference needs Go 1.26. This machine has Go 1.24.4 and reaches github.com but
# not proxy.golang.org, so the toolchain is built from source when it is missing (1.24.4 builds 1.25.0,
# 1.25.0 builds 1.26.0) and the five module dependencies of the parser's import closure come from GitHub
# archives. A work directory that already holds go126/ and deps/ (the tree dumper of the typecheck unit
# leaves them in /tmp/rr) is reused as it is: then the build takes about a minute.
# The module is assembled in its own directory (<work dir>/parsediag-mod), so nothing of another tool changes.
#
# usage: build.sh [work dir, default /tmp/rr] [output, default <work dir>/parsediag-bu]
set -e
W=${1:-/tmp/rr}
OUT=${2:-$W/parsediag-bu}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
M=$W/parsediag-mod
mkdir -p "$W/deps" "$M/internal" "$M/cmd/parsediag"
fetch() {
  if [ ! -d "$W/$1" ] || [ -z "$(ls "$W/$1")" ]; then
    mkdir -p "$W/$1"
    curl -s -L -m 600 -o "$W/x.tar.gz" "$2"
    tar -xzf "$W/x.tar.gz" -C "$W/$1" --strip-components=1
    rm "$W/x.tar.gz"
  fi
}
if [ ! -x "$W/go126/bin/go" ]; then
  fetch go125 https://codeload.github.com/golang/go/tar.gz/refs/tags/go1.25.0
  fetch go126 https://codeload.github.com/golang/go/tar.gz/refs/tags/go1.26.0
fi
fetch deps/xxh3 https://codeload.github.com/zeebo/xxh3/tar.gz/refs/tags/v1.1.0
fetch deps/cpuid https://codeload.github.com/klauspost/cpuid/tar.gz/refs/tags/v2.2.10
fetch deps/sync https://codeload.github.com/golang/sync/tar.gz/refs/tags/v0.21.0
fetch deps/text https://codeload.github.com/golang/text/tar.gz/refs/tags/v0.38.0
fetch deps/json https://codeload.github.com/go-json-experiment/json/tar.gz/01eb4420fa68
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
if [ ! -x "$W/go126/bin/go" ]; then
  if [ ! -x "$W/go125/bin/go" ]; then (cd "$W/go125/src" && GOROOT_BOOTSTRAP=$(go env GOROOT) ./make.bash); fi
  (cd "$W/go126/src" && GOROOT_BOOTSTRAP="$W/go125" ./make.bash)
fi
test "$(git -C "$REF" rev-parse --short=7 HEAD)" = 89d5d5b || echo "warning: $REF is not at 89d5d5b" >&2
# The non-test import closure of internal/parser, copied unchanged.
for p in parser ast collections core debug diagnostics scanner stringutil tspath locale spanmap json repo jsnum; do
  rm -rf "$M/internal/$p"
  cp -r "$REF/internal/$p" "$M/internal/$p"
  find "$M/internal/$p" -name "*_test.go" -delete
done
cp "$HERE/parsediag/main.go" "$M/cmd/parsediag/main.go"
cat > "$M/go.mod" <<MOD
module github.com/microsoft/typescript-go

go 1.26

require (
	github.com/go-json-experiment/json v0.0.0
	github.com/zeebo/xxh3 v1.1.0
	github.com/klauspost/cpuid/v2 v2.2.10
	golang.org/x/sync v0.21.0
	golang.org/x/text v0.38.0
)

replace github.com/go-json-experiment/json => $W/deps/json
replace github.com/zeebo/xxh3 => $W/deps/xxh3
replace github.com/klauspost/cpuid/v2 => $W/deps/cpuid
replace golang.org/x/sync => $W/deps/sync
replace golang.org/x/text => $W/deps/text
MOD
(cd "$M" && PATH="$W/go126/bin:$PATH" GOROOT="$W/go126" GOFLAGS=-mod=mod go build -o "$OUT" ./cmd/parsediag)
echo "built $OUT"
