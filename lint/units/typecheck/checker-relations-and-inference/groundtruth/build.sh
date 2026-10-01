#!/bin/bash
# Builds the probe that checks files with typescript-go's own checker and prints the relater and inference trace.
# Needs the Go 1.26 toolchain and the five module sources that ../../ts-dump-and-test-importer/groundtruth/build.sh puts in /tmp/rr.
# usage: build.sh [work dir, default /tmp/relinf/gt]      result: <work dir>/relprobe and <work dir>/relprobe-cover
set -e
W=${1:-/tmp/relinf/gt}
R=${RR:-/tmp/rr}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
CLOSURE=$HERE/../../checker-core-scratch/groundtruth/closure.py
rm -rf "$W/mod"
mkdir -p "$W/mod/cmd/relprobe" "$W/instr"
for p in $(python3 "$CLOSURE" internal/checker internal/parser internal/diagnosticwriter | sed '/--third/,$d'); do
  mkdir -p "$W/mod/$p"
  find "$REF/$p" -maxdepth 1 -type f \( -name '*.go' -o -name '*.json' \) ! -name '*_test.go' -exec cp {} "$W/mod/$p/" \;
done
cp -r "$REF/internal/diagnostics/loc" "$W/mod/internal/diagnostics/"
cp "$HERE/instr_main.go.txt" "$W/instr/main.go"
printf 'module instr\n\ngo 1.24\n' > "$W/instr/go.mod"
(cd "$W/instr" && GOTOOLCHAIN=local go build -o "$W/instr/instr" .)
"$W/instr/instr" "$W/mod/internal/checker/relater.go" "$W/mod/internal/checker/inference.go"
python3 "$HERE/patch.py" "$W/mod/internal/checker"
cp "$HERE/zz_relprobe.go.txt" "$W/mod/internal/checker/zz_relprobe.go"
cp "$HERE/relprobe_main.go.txt" "$W/mod/cmd/relprobe/main.go"
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

replace github.com/go-json-experiment/json => $R/deps/json
replace github.com/zeebo/xxh3 => $R/deps/xxh3
replace github.com/klauspost/cpuid/v2 => $R/deps/cpuid
replace golang.org/x/sync => $R/deps/sync
replace golang.org/x/text => $R/deps/text
MOD
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOROOT="$R/go126" PATH="$R/go126/bin:$PATH"
(cd "$W/mod" && /workspace/tools/lk go build -o "$W/relprobe" ./cmd/relprobe)
echo "built $W/relprobe"
# The main package must be in -coverpkg, or runtime/coverage has no counters to clear.
(cd "$W/mod" && /workspace/tools/lk go build -cover -covermode=atomic -coverpkg=github.com/microsoft/typescript-go/cmd/relprobe,github.com/microsoft/typescript-go/internal/checker,github.com/microsoft/typescript-go/internal/binder,github.com/microsoft/typescript-go/internal/printer,github.com/microsoft/typescript-go/internal/nodebuilder,github.com/microsoft/typescript-go/internal/evaluator,github.com/microsoft/typescript-go/internal/jsnum -o "$W/relprobe-cover" ./cmd/relprobe)
echo "built $W/relprobe-cover"
