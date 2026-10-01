#!/bin/sh
# Runs clippy (the lints that Cargo.toml denies, and clippy's defaults) over the scratch copy that build-scratch.sh left, tests included, and prints what it says of the two files of the prototype.
# usage: /workspace/tools/lk sh clippy-scratch.sh [/workspace/wt/parser] [/tmp/b2codes/scratch]
ROOT=${1:-/workspace/wt/parser}
SCRATCH=${2:-/tmp/b2codes/scratch}
BUILD="$ROOT/target/debug/build"
EXTERNS=""
for name in thiserror bitflags bun_collections strum smallvec bun_react_compiler enumset bun_options_types bun_wyhash bun_core bun_ast bun_base64 bstr bun_url bun_ptr bun_alloc bytemuck scopeguard bun_crash_handler bun_paths bun_highway; do
  lib=$(ls -tr "$BUILD/$name"/*/out/lib"$name"-*.rlib | head -1)
  EXTERNS="$EXTERNS --extern $name=$lib --extern $name=${lib%.rlib}.rmeta"
done
SEARCH=""
for dir in "$BUILD"/*/*/out; do SEARCH="$SEARCH -L dependency=$dir"; done
LINTS=$(awk '/^\[workspace.lints.clippy\]/{on=1;next} /^\[/{on=0} on && /^[a-z_]+ *= *"deny"/{sub(/ *=.*/,""); printf " -W clippy::%s", $0}' "$ROOT/Cargo.toml")
RUST_LINTS="-W dead_code -W unreachable_pub -W unused_imports -W unused_variables -W unused_mut -W unused_assignments -W unused_macros -W unreachable_code -W unreachable_patterns -W unused_must_use"
cd "$ROOT"
# shellcheck disable=SC2086
CLIPPY_CONF_DIR="$ROOT" clippy-driver --crate-name bun_js_parser --edition=2024 "$SCRATCH/src/js_parser/lib.rs" --test --emit=metadata \
  -o "$SCRATCH/out/clippy.rmeta" -W clippy::all $LINTS $RUST_LINTS --error-format=short \
  $SEARCH $EXTERNS 2> "$SCRATCH/out/clippy.log"
echo "clippy-driver exit: $?"
grep -c . "$SCRATCH/out/clippy.log"
grep -n "parse/syntax_errors.rs\|parse/parse_entry.rs" "$SCRATCH/out/clippy.log" | head -60
