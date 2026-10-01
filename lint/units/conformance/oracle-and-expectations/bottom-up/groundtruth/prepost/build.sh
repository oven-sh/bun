#!/bin/sh
# Ground truth of the run set, of the kinds and of the instances whose error baseline depends on the emit: the suite of the reference itself.
# The Go hosts of Google are not reachable from the build machine: the toolchain and the modules come from GitHub.
# usage: sh build.sh <work dir>   (about 70 MB of downloads, 4 minutes to build, 5 minutes to run on 16 cores)
set -e
W=${1:-/tmp/oe-research}
R=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/go126" "$W/mods"
if [ ! -x "$W/go126/bin/go" ]; then
  curl -s -L -m 900 -o "$W/go126.tar.gz" https://github.com/actions/go-versions/releases/download/1.26.8-33583485350/go-1.26.8-linux-x64.tar.gz
  tar -xzf "$W/go126.tar.gz" -C "$W/go126"
fi
clone() { [ -d "$W/mods/$1" ] || git clone --quiet --depth 1 --branch "$3" "$2" "$W/mods/$1"; }
clone go-cmp https://github.com/google/go-cmp v0.7.0
clone go-osstat https://github.com/mackerelio/go-osstat v0.2.7
clone patience https://github.com/peter-evans/patience v0.3.0
clone xxh3 https://github.com/zeebo/xxh3 v1.1.0
clone cpuid https://github.com/klauspost/cpuid v2.2.10
clone x-sync https://github.com/golang/sync v0.21.0
clone x-sys https://github.com/golang/sys v0.46.0
clone x-term https://github.com/golang/term v0.44.0
clone x-text https://github.com/golang/text v0.38.0
clone gotest.tools https://github.com/gotestyourself/gotest.tools v3.5.2
if [ ! -d "$W/mods/json" ]; then
  git init -q "$W/mods/json"
  git -C "$W/mods/json" remote add origin https://github.com/go-json-experiment/json
  git -C "$W/mods/json" fetch -q --depth 1 origin 01eb4420fa68cc49437c0f7b50647364cb2bae38
  git -C "$W/mods/json" checkout -q FETCH_HEAD
fi
T=$W/tsgo
rm -rf "$T"
mkdir -p "$T/testdata/baselines/local"
cp -r "$R/internal" "$T/internal"
cp "$R/go.mod" "$R/go.sum" "$T/"
ln -s "$R/_submodules" "$T/_submodules"
ln -s "$R/testdata/baselines/reference" "$T/testdata/baselines/reference"
for x in fixtures tests submoduleAccepted.txt submoduleTriaged.txt; do ln -s "$R/testdata/$x" "$T/testdata/$x"; done
cat >> "$T/go.mod" <<EOM

replace (
	github.com/go-json-experiment/json => $W/mods/json
	github.com/google/go-cmp => $W/mods/go-cmp
	github.com/mackerelio/go-osstat => $W/mods/go-osstat
	github.com/peter-evans/patience => $W/mods/patience
	github.com/zeebo/xxh3 => $W/mods/xxh3
	github.com/klauspost/cpuid/v2 => $W/mods/cpuid
	golang.org/x/sync => $W/mods/x-sync
	golang.org/x/sys => $W/mods/x-sys
	golang.org/x/term => $W/mods/x-term
	golang.org/x/text => $W/mods/x-text
	gotest.tools/v3 => $W/mods/gotest.tools
)
EOM
python3 "$HERE/patch.py" "$T"
export PATH="$W/go126/bin:$PATH" GOROOT="$W/go126" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOCACHE="$W/gocache" GOMODCACHE="$W/gomodcache"
gofmt -w "$T/internal/testrunner/compiler_runner.go"
(cd "$T" && /workspace/tools/lk go test -c -o "$W/testrunner.test" ./internal/testrunner)
rm -rf "$W/prepost"
mkdir -p "$W/prepost"
(cd "$T/internal/testrunner" && OE_PREPOST_DIR="$W/prepost" /workspace/tools/lk "$W/testrunner.test" -test.run '^TestSubmodule$' -test.count=1 -test.v -test.timeout 55m > "$W/test.log" 2>&1) || true
tail -1 "$W/test.log"
echo "run instances: $(wc -l < "$W/prepost/run.tsv")"
echo "instances whose baseline before the emit differs from the one after it:"
awk -F'\t' '$6 != "true" || $7 != "true"' "$W/prepost/run.tsv"
