#!/bin/sh
# usage: incrate.sh <tag> <rev> <repository> <codegen dir> <out dir> <probe type>...
# Sizes of types that are private to bun_js_parser: the sources of <rev> are copied out of git into /tmp, the probe
# lines go at the end of the copy of src/js_parser/p.rs, and cargo check of a crate that depends on the copy reports them.
# Heavy: call it through /workspace/tools/lk.
set -u
tag="$1"; rev="$2"; repo="$3"; codegen="$4"; out="$5"; shift 5
here=$(cd "$(dirname "$0")" && pwd)
tree=/tmp/sizeprobe-a-incrate-$tag/tree
work=/tmp/sizeprobe-a-incrate-$tag/crate
rm -rf "$tree" "$work"; mkdir -p "$tree" "$work/src" "$out"
git -C "$repo" archive "$rev" -- Cargo.toml Cargo.lock rust-toolchain.toml src | tar -x -C "$tree"
for t in "$@"; do
  printf "const _: [(); 0] = [(); core::mem::size_of::<%s>()];\n" "$t" >> "$tree/src/js_parser/p.rs"
done
sed "s|@TREE@|$tree|g" "$here/Cargo.toml.in" > "$work/Cargo.toml"
echo '// Empty: the probes are in the copy of the dependency.' > "$work/src/lib.rs"
cp "$tree/Cargo.lock" "$work/Cargo.lock"
rc=0
for profile in dev release; do
  flag=""; [ "$profile" = release ] && flag="--release"
  (cd "$tree" && BUN_CODEGEN_DIR="$codegen" cargo check --offline $flag --manifest-path "$work/Cargo.toml" \
     --target-dir "$work/target" --message-format=json) > "$work/$profile.json" 2> "$out/incrate.$tag.$profile.stderr.txt"
  echo "cargo check $profile exit=$?" >> "$out/incrate.$tag.$profile.stderr.txt"
  {
    echo "# rev=$rev profile=$profile: probes appended to a copy of src/js_parser/p.rs"
    python3 "$here/parse.py" "$tree/src/js_parser/p.rs" "$work/$profile.json" p.rs
  } > "$out/incrate.$tag.$profile.txt" || rc=1
  rm -f "$work/$profile.json"
done
exit $rc
