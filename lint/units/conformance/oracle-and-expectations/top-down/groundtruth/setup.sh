#!/bin/sh
# Research probe: builds a scratch copy of the reference with the recorder of diagnostics before and after emit.
# Needs Go 1.26 in /tmp/rr/go126 and its five modules in /tmp/rr/deps (units/typecheck/ts-dump-and-test-importer/groundtruth/build.sh makes both).
# Reaches codeload.github.com for four more modules. The reference clone is read, never written.
# usage: sh setup.sh [work dir, default /tmp/oe]; then: /workspace/tools/lk <work dir>/run.sh; result: <work dir>/probe-out/instances.tsv
set -e
W=${1:-/tmp/oe}
R=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
S=$W/tsgo
D=$W/deps
test -x /tmp/rr/go126/bin/go || { echo "Go 1.26 is missing in /tmp/rr/go126"; exit 1; }
rm -rf "$S"
mkdir -p "$S/testdata/baselines/local" "$D" "$W/probe-out" "$W/gotmp"
cp -r "$R/internal" "$S/internal"
ln -s "$R/_submodules" "$S/_submodules"
ln -s "$R/testdata/baselines/reference" "$S/testdata/baselines/reference"
cp "$R/testdata/submoduleAccepted.txt" "$R/testdata/submoduleTriaged.txt" "$S/testdata/"
cp -r "$R/testdata/tests" "$R/testdata/fixtures" "$S/testdata/"
fetch() {
  if [ ! -d "$D/$1" ] || [ -z "$(ls "$D/$1")" ]; then
    mkdir -p "$D/$1"
    curl -sS -L -m 600 -o "$D/x.tar.gz" "$2"
    tar -xzf "$D/x.tar.gz" -C "$D/$1" --strip-components=1
    rm "$D/x.tar.gz"
  fi
}
fetch gocmp https://codeload.github.com/google/go-cmp/tar.gz/refs/tags/v0.7.0
fetch patience https://codeload.github.com/peter-evans/patience/tar.gz/refs/tags/v0.3.0
fetch sys https://codeload.github.com/golang/sys/tar.gz/refs/tags/v0.46.0
fetch gotest https://codeload.github.com/gotestyourself/gotest.tools/tar.gz/refs/tags/v3.5.2
sed "s#/tmp/oe/deps#$D#g" "$HERE/go.mod.txt" > "$S/go.mod"
(cd "$S" && patch -p0 < "$HERE/compiler_runner.go.patch" && patch -p0 < "$HERE/harnessutil.go.patch")
cp "$HERE/probe_emit_order.go.txt" "$S/internal/testrunner/probe_emit_order.go"
sed "s#/tmp/oe#$W#g" "$HERE/run.sh" > "$W/run.sh"
chmod +x "$W/run.sh"
echo "ready: /workspace/tools/lk $W/run.sh"
