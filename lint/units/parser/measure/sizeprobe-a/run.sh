#!/bin/sh
# usage: run.sh <tag> <tree> <codegen dir> <out dir>
# Writes <out dir>/sizes.<tag>.dev.txt (debug assertions on) and sizes.<tag>.release.txt, plus the raw cargo output.
# Heavy (two cargo check of the closure of bun_js_parser): call it through /workspace/tools/lk.
set -u
tag="$1"; tree="$2"; codegen="$3"; out="$4"
here=$(cd "$(dirname "$0")" && pwd)
work=/tmp/sizeprobe-a-$tag
mkdir -p "$work/src" "$out"
sed "s|@TREE@|$tree|g" "$here/Cargo.toml.in" > "$work/Cargo.toml"
cp "$here/probes.rs" "$work/src/lib.rs"
cp "$tree/Cargo.lock" "$work/Cargo.lock"
rc=0
for profile in dev release; do
  flag=""; [ "$profile" = release ] && flag="--release"
  (cd "$tree" && BUN_CODEGEN_DIR="$codegen" cargo check --offline $flag --manifest-path "$work/Cargo.toml" \
     --target-dir "$work/target" --message-format=json) > "$out/sizes.$tag.$profile.json" 2> "$out/sizes.$tag.$profile.stderr.txt"
  echo "cargo check $profile exit=$?" >> "$out/sizes.$tag.$profile.stderr.txt"
  {
    echo "# tree=$tree rev=$(git -C "$tree" rev-parse --short=10 HEAD) profile=$profile codegen=$codegen"
    echo "# $(cd "$tree" && rustc --version)"
    python3 "$here/parse.py" "$here/probes.rs" "$out/sizes.$tag.$profile.json"
  } > "$out/sizes.$tag.$profile.txt" || rc=1
  rm -f "$out/sizes.$tag.$profile.json"
done
exit $rc
