#!/bin/sh
# rustc alone on the probe of checker/c17_unary_meta_yield.rs: the real file beside the real leaf packages, types.rs, c01_data.rs and stand-ins with the signatures of the tree.
# Run: sh c17-probe.sh [directory]       exit 0 and no output after the line of the generator: no error and no warning.
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-/tmp/c17-probe}"
python3 "$HERE/c17-probe-gen.py" "$OUT" || exit 1
cd "$OUT" || exit 1
rustc --edition 2024 --crate-type lib --crate-name bun_collections --emit=metadata -o libbun_collections.rmeta bun_collections.rs || exit 1
exec rustc --edition 2024 --crate-type lib --emit=metadata --extern bun_collections=libbun_collections.rmeta --error-format=short -o c17-probe.rmeta c17-probe.rs
