#!/bin/sh
# Measures which functions of the type printer family the reference executes, per function, in two runs of its own
# compiler and conformance cases: "diag" (checker diagnostics only, see patch.py), "diagdecl" (diag plus declaration
# diagnostics without emit) and "full" (the unchanged harness: emit, declaration emit, .types and .symbols baselines). Also builds the typed call graph of the family.
# The Go hosts of Google are not reachable from the build machine: the toolchain and the modules come from GitHub.
# usage: sh build.sh [work dir, default /tmp/ctp]     (about 70 MB of downloads, 15 minutes to build, 2 minutes per run)
# results: <work dir>/family.tsv panics.tsv diag.external-callees.tsv, copied to ../data by hand when they change
set -e
W=${1:-/tmp/ctp}
R=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/go126" "$W/mods" "$W/gotmp"
if [ ! -x "$W/go126/bin/go" ]; then
  if [ -x /tmp/rr/go126/bin/go ]; then rmdir "$W/go126"; ln -s /tmp/rr/go126 "$W/go126"; else
    curl -s -L -m 900 -o "$W/go126.tar.gz" https://github.com/actions/go-versions/releases/download/1.26.8-33583485350/go-1.26.8-linux-x64.tar.gz
    tar -xzf "$W/go126.tar.gz" -C "$W/go126"
  fi
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
rm -rf "$T/internal/fourslash" "$T/internal/ls" "$T/internal/lsp" "$T/internal/project" "$T/internal/api"
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
export PATH="$W/go126/bin:$PATH" GOROOT="$W/go126" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$W/gocache" GOTMPDIR="$W/gotmp"
M=github.com/microsoft/typescript-go/internal
(cd "$T" && /workspace/tools/lk go test -c -cover -covermode=set -coverpkg=$M/checker,$M/printer,$M/nodebuilder,$M/pseudochecker,$M/modulespecifiers -o "$W/testrunner.cover.test" ./internal/testrunner)
(cd "$T/internal/testrunner" && CTP_MODE=diag /workspace/tools/lk "$W/testrunner.cover.test" -test.run '^(TestSubmodule|TestLocal)$' -test.count=1 -test.timeout 120m -test.coverprofile="$W/cover.diag.out" > "$W/run.diag.log" 2>&1) || true
(cd "$T/internal/testrunner" && CTP_MODE=diagdecl /workspace/tools/lk "$W/testrunner.cover.test" -test.run '^(TestSubmodule|TestLocal)$' -test.count=1 -test.timeout 120m -test.coverprofile="$W/cover.diagdecl.out" > "$W/run.diagdecl.log" 2>&1) || true
(cd "$T/internal/testrunner" && /workspace/tools/lk "$W/testrunner.cover.test" -test.run '^(TestSubmodule|TestLocal)$' -test.count=1 -test.timeout 120m -test.coverprofile="$W/cover.full.out" > "$W/run.full.log" 2>&1) || true
(cd "$T/internal/testrunner" && CTP_MODE=diag /workspace/tools/lk "$W/testrunner.cover.test" -test.run '^TestSubmodule$/^typeCheckExportsVariable.ts$' -test.count=1 -test.coverprofile="$W/cover.k4.out" > "$W/run.k4.log" 2>&1) || true
(cd "$HERE/../goanal" && go build -o "$W/goanal" .)
(cd "$W" && "$W/goanal" "$W/fns.json" checker printer nodebuilder pseudochecker modulespecifiers)
python3 "$HERE/../py/cover.py" "$W/fns.json" "$W/family.tsv" diag="$W/cover.diag.out" full="$W/cover.full.out" k4="$W/cover.k4.out" diagdecl="$W/cover.diagdecl.out"
python3 "$HERE/../py/panics.py" "$W/fns.json" "$W/family.tsv" "$W/panics.tsv"
python3 "$HERE/../py/deps.py" "$W/fns.json" "$W/family.tsv" "$W/diag"
echo "diag run: $(grep -c '^    --- FAIL' "$W/run.diag.log") instances differ from the reference baseline (they need the emit or declaration diagnostics)"
echo "diagdecl run: $(grep -c '^    --- FAIL' "$W/run.diagdecl.log") instances differ from the reference baseline (their diagnostics depend on the emit having run first)"
tail -3 "$W/run.full.log"
