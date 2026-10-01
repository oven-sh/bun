#!/bin/bash
# Builds the probe that prints the tree of typescript-go's own parser (groundtruth/dumpast/main.go).
# The reference needs Go 1.26. This machine has Go 1.24.4 and reaches github.com but not proxy.golang.org,
# so the toolchain is built from source (1.24.4 builds 1.25.0, 1.25.0 builds 1.26.0: 1.26 refuses a bootstrap
# older than 1.24.6) and the five module dependencies of the parser's import closure come from GitHub archives.
# usage: build.sh [work dir, default /tmp/rr]      result: <work dir>/dumpast
set -e
W=${1:-/tmp/rr}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/deps" "$W/mod/internal" "$W/mod/cmd/dumpast"
fetch() {
  if [ ! -d "$W/$1" ] || [ -z "$(ls "$W/$1")" ]; then
    mkdir -p "$W/$1"
    curl -s -L -m 600 -o "$W/x.tar.gz" "$2"
    tar -xzf "$W/x.tar.gz" -C "$W/$1" --strip-components=1
    rm "$W/x.tar.gz"
  fi
}
fetch go125 https://codeload.github.com/golang/go/tar.gz/refs/tags/go1.25.0
fetch go126 https://codeload.github.com/golang/go/tar.gz/refs/tags/go1.26.0
fetch deps/xxh3 https://codeload.github.com/zeebo/xxh3/tar.gz/refs/tags/v1.1.0
fetch deps/cpuid https://codeload.github.com/klauspost/cpuid/tar.gz/refs/tags/v2.2.10
fetch deps/sync https://codeload.github.com/golang/sync/tar.gz/refs/tags/v0.21.0
fetch deps/text https://codeload.github.com/golang/text/tar.gz/refs/tags/v0.38.0
fetch deps/json https://codeload.github.com/go-json-experiment/json/tar.gz/01eb4420fa68
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
if [ ! -x "$W/go125/bin/go" ]; then (cd "$W/go125/src" && GOROOT_BOOTSTRAP=$(go env GOROOT) ./make.bash); fi
if [ ! -x "$W/go126/bin/go" ]; then (cd "$W/go126/src" && GOROOT_BOOTSTRAP="$W/go125" ./make.bash); fi
# The non-test import closure of internal/parser at 89d5d5b, copied unchanged.
for p in parser ast collections core debug diagnostics scanner stringutil tspath locale spanmap json repo jsnum; do
  rm -rf "$W/mod/internal/$p"
  cp -r "$REF/internal/$p" "$W/mod/internal/$p"
  find "$W/mod/internal/$p" -name "*_test.go" -delete
done
cp "$HERE/dumpast/main.go" "$W/mod/cmd/dumpast/main.go"
cat > "$W/mod/go.mod" <<'MOD'
module github.com/microsoft/typescript-go

go 1.26

require (
	github.com/go-json-experiment/json v0.0.0
	github.com/zeebo/xxh3 v1.1.0
	github.com/klauspost/cpuid/v2 v2.2.10
	golang.org/x/sync v0.21.0
	golang.org/x/text v0.38.0
)

replace github.com/go-json-experiment/json => ../deps/json
replace github.com/zeebo/xxh3 => ../deps/xxh3
replace github.com/klauspost/cpuid/v2 => ../deps/cpuid
replace golang.org/x/sync => ../deps/sync
replace golang.org/x/text => ../deps/text
MOD
(cd "$W/mod" && PATH="$W/go126/bin:$PATH" GOROOT="$W/go126" GOFLAGS=-mod=mod go build -o "$W/dumpast" ./cmd/dumpast)
echo "built $W/dumpast"
