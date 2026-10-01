#!/bin/sh
# Builds the round trip probe of the emit printer (rtprobe_main.go.txt) from the reference at 89d5d5b and runs it on the
# distinct argument texts of the reference's error baselines. Needs /tmp/rr/go126 and /tmp/rr/deps (see
# ../../ts-dump-and-test-importer/groundtruth/build.sh). About 2 minutes to build, under a second to run.
# usage: sh build.sh [work dir, default /tmp/tp/rt]      results: ../data/roundtrip-texts.txt.gz roundtrip-diff.tsv roundtrip-noparse.txt
set -e
W=${1:-/tmp/tp/rt}
REF=/workspace/ref/typescript-go
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/mod/internal" "$W/mod/cmd/rtprobe" "$W/gocache"
for p in ast astnav binder collections contentmapper core debug diagnostics evaluator glob ipc jsnum json jsonrpc locale module modulespecifiers nodebuilder outputpaths packagejson parser printer pseudochecker repo scanner semver sourcemap spanmap stringutil symlinks tracing tsoptions tspath vfs; do
  rm -rf "$W/mod/internal/$p"
  cp -r "$REF/internal/$p" "$W/mod/internal/$p"
  find "$W/mod/internal/$p" -name "*_test.go" -delete
done
cp "$HERE/rtprobe_main.go.txt" "$W/mod/cmd/rtprobe/main.go"
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

replace github.com/go-json-experiment/json => /tmp/rr/deps/json
replace github.com/zeebo/xxh3 => /tmp/rr/deps/xxh3
replace github.com/klauspost/cpuid/v2 => /tmp/rr/deps/cpuid
replace golang.org/x/sync => /tmp/rr/deps/sync
replace golang.org/x/text => /tmp/rr/deps/text
MOD
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE="$W/gocache" PATH=/tmp/rr/go126/bin:$PATH
(cd "$W/mod" && /workspace/tools/lk go build -o "$W/rtprobe" ./cmd/rtprobe)
python3 "$HERE/../py/texts.py" "$W/distinct-args.txt"
"$W/rtprobe" "$W/distinct-args.txt" strip > "$W/rt.strip.out"
cut -f1 "$W/rt.strip.out" | sort | uniq -c
grep '^ok' "$W/rt.strip.out" | cut -f2 | gzip -9c > "$HERE/../data/roundtrip-texts.txt.gz"
grep '^diff' "$W/rt.strip.out" > "$HERE/../data/roundtrip-diff.tsv"
grep '^noparse' "$W/rt.strip.out" | cut -f2 > "$HERE/../data/roundtrip-noparse.txt"
