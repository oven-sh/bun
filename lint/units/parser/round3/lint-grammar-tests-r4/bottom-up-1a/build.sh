#!/bin/sh
# The checks of this pass on scratch copies of src/js_parser (made by ../top-down/run.sh under /tmp/r4td): nothing is written in the worktree.
# Needs target/ of `cargo test -p bun_js_parser --lib` in the worktree (../top-down/data/rustc-js-parser-test.args names its files).
#   root2   the worktree + the module line + the five helpers visible + ../top-down/data/import-type-rest.p1.diff
#   root3   root2 + ../bottom-up/results-2102fb058f/m.parse_path.diff (parse_path as on main)
# usage: sh build.sh <clippy|link> <root2|root3> <file of gen/rust5.mjs> <tag>      each rustc goes through /workspace/tools/lk
set -u
MODE=$1; ROOT=/tmp/r4td/$2; FILE=$3; TAG=$4
OUT=/tmp/r4bu/run; mkdir -p "$OUT"
if [ "$MODE" = clippy ]; then
  /workspace/tools/lk env S="$ROOT" sh /tmp/r4td/tools/clippy-variant.sh "$FILE" "$TAG" > "$OUT/$TAG.clippy.txt" 2>&1
  echo "exit=$?" >> "$OUT/$TAG.clippy.txt"
else
  /workspace/tools/lk env S="$ROOT" sh /tmp/r4td/tools/build-variant.sh "$FILE" "$TAG" > "$OUT/$TAG.build.txt" 2>&1
  echo "exit=$?" >> "$OUT/$TAG.build.txt"
  BIN=$(ls "$ROOT/out/$TAG"/bun_js_parser-* 2>/dev/null | grep -v '\.d$' | head -1)
  if [ -n "$BIN" ]; then /workspace/tools/lk "$BIN" > "$OUT/$TAG.run.txt" 2>&1; echo "exit=$?" >> "$OUT/$TAG.run.txt"; fi
fi
