#!/bin/sh
# Makes the generated tables and the test vectors of src/typecheck/{core,jsnum,stringutil,tspath} again from the
# reference, and checks the five leaf packages with rustc, clippy-driver and rustfmt alone (no cargo, no build of bun).
# The Go side copies upstream's packages unchanged into a scratch module (govec/setup.sh) and prints what upstream's
# functions answer. Go 1.24 is enough. The golden files of ../golden/run.sh are read from /tmp/golden.
# usage: regen.sh [vectors|tables|check|all]     work directory: /tmp/leafport
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=/workspace/wt/typecheck/src/typecheck
W=/tmp/leafport
mkdir -p "$W/out" "$W/govec"
export GOTOOLCHAIN=local GOFLAGS=-mod=mod GOCACHE=$W/gocache
what=${1:-all}
if [ "$what" = vectors ] || [ "$what" = all ]; then
  cp -r "$HERE"/govec/* "$W/govec/"
  sh "$W/govec/setup.sh" "$W/govec"
  (cd "$W/govec" && go run ./vecstringutil "$W/out" && go run ./vecjsnum > "$W/out/pseudobigint.tsv" && go run ./vectspath "$W/out/path.tsv" "$W/out/path_full.tsv" && go run ./veccore "$W/out")
  cp "$W/out/util.tsv" "$W/out/compare.tsv" "$W/out/js_case.tsv" "$SRC/stringutil/testdata/"
  cp "$W/out/pseudobigint.tsv" "$SRC/jsnum/testdata/"
  cp "$W/out/path.tsv" "$SRC/tspath/testdata/"
  cp "$W/out/pattern.tsv" "$W/out/core.tsv" "$SRC/core/testdata/"
  python3 "$HERE/sample_jsnum.py" /tmp/golden "$SRC/jsnum/testdata"
  echo "vecstringutil prints two digests: they are the constants of stringutil/util.rs and stringutil/js_case.rs"
fi
if [ "$what" = tables ] || [ "$what" = all ]; then
  # fold.txt: unicode.ToLower, ToUpper and SimpleFold of every rune, to check the exception tables of stringutil/util.rs
  (cd "$W/govec" && mkdir -p gofold && cp "$HERE/govec/gofold/main.go" gofold/ && go run ./gofold > "$W/out/fold.txt")
  python3 "$HERE/gen_tables.py" "$W/out" "$W/out/fold.txt"
  cp "$W/out/js_case_generated.rs" "$W/out/identifier_parts_generated.rs" "$SRC/stringutil/"
  rustfmt --edition 2024 "$SRC/stringutil/js_case_generated.rs" "$SRC/stringutil/identifier_parts_generated.rs"
fi
if [ "$what" = check ] || [ "$what" = all ]; then
  cp "$HERE"/scratch/lib.rs "$HERE"/scratch/full.rs "$HERE"/scratch/check.sh "$W/"
  (cd "$W" && sh check.sh lib && sh check.sh clippy && sh check.sh test)
  rustfmt --edition 2024 --check "$SRC"/core/*.rs "$SRC"/collections/*.rs "$SRC"/jsnum/*.rs "$SRC"/stringutil/*.rs "$SRC"/tspath/*.rs
fi
