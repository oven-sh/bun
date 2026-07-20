#!/usr/bin/env bash
# Runs clippy across the workspace with cap-lints=warn (so deny-level lints
# don't block downstream crates from being checked), groups diagnostics by
# file, writes per-file rendered dumps, and emits a slim manifest.
#
# Output:
#   $OUT/round-$R.jsonl     raw cargo json
#   $OUT/round-$R.grouped.json
#   $OUT/diags/*.txt        per-file rendered diagnostics
#   $OUT/manifest-$R.json   [{file,count,diagPath}]  (stdout = path to this)
set -euo pipefail
R="${1:?round number}"
OUT="${CLIPPY_LOOP_DIR:-/tmp/clippy-loop}"
mkdir -p "$OUT"

find src/ -name '*.rs' -exec touch {} +
RUSTFLAGS="--cap-lints=warn" cargo clippy --workspace --no-deps --keep-going \
  --message-format=json 2>"$OUT/stderr-$R.log" > "$OUT/round-$R.jsonl"

bun scripts/clippy-loop/group-by-file.ts "$OUT/round-$R.jsonl" > "$OUT/round-$R.grouped.json"
rm -rf "$OUT/diags"
bun scripts/clippy-loop/split-diags.ts "$OUT/round-$R.grouped.json" "$OUT/diags" \
  | jq -c '[.[] | {file,count,diagPath}]' > "$OUT/manifest-$R.json"

>&2 jq -r '"files=\(length) diags=\([.[].count]|add // 0)"' "$OUT/round-$R.grouped.json"
echo "$OUT/manifest-$R.json"
