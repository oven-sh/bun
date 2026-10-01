#!/bin/sh
# Differential probe of jsnum and stringutil: upstream's Go code writes vectors, a Rust prototype must reproduce them.
# The upstream packages are copied unchanged into a scratch module. internal/json is replaced by encoding/json,
# which formats a float64 the same way. Go 1.24 and Go 1.26 give identical vectors.
# usage: run.sh [work dir, default /tmp/golden]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-/tmp/golden}
R=/workspace/ref/typescript-go/internal
export GOTOOLCHAIN=local GOFLAGS=-mod=mod
mkdir -p "$W/stringutil" "$W/jsnum" "$W/json" "$W/dump" "$W/dump2" "$W/dump3" "$W/chk" "$W/rs"
printf 'module golden\n\ngo 1.24\n' > "$W/go.mod"
for f in "$R"/stringutil/*.go; do case $f in *_test.go|*generate.go) ;; *) cp "$f" "$W/stringutil/";; esac; done
cp "$HERE/zz_export.go" "$W/stringutil/zz_export.go"
for f in "$R"/jsnum/*.go; do case $f in *_test.go) ;; *) sed 's#github.com/microsoft/typescript-go/internal/#golden/#' "$f" > "$W/jsnum/$(basename "$f")";; esac; done
printf 'package json\n\nimport stdjson "encoding/json"\n\nfunc Marshal(in any) ([]byte, error) { return stdjson.Marshal(in) }\n' > "$W/json/json.go"
for p in dump dump2 dump3 chk; do cp "$HERE/$p/main.go" "$W/$p/main.go"; done
cp "$HERE/rs/proto.rs" "$W/rs/proto.rs"
(cd "$W" && go run ./dump > vectors.tsv && go run ./dump2 > vectors2.tsv && go run ./dump3 > vectors4.tsv && go run ./chk > chk.txt)
(cd "$W/rs" && rustc -O --edition 2021 -o proto proto.rs)
for v in vectors.tsv vectors2.tsv vectors4.tsv; do echo "== $v"; "$W/rs/proto" < "$W/$v" | tail -12; done
