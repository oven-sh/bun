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
# Types that are private to bun_js_parser (ParserSnapshot, SidecarMark): rustc prints the layouts it computed.
mkdir -p "$work/ts/src"
{
  echo 'cargo-features = ["profile-rustflags"]'
  sed "s|@TREE@|$tree|g; s|name = \"sizeprobe\"|name = \"sizeprobe_ts\"|" "$here/Cargo.toml.in"
  printf '\n[profile.dev.package.bun_js_parser]\nrustflags = ["-Zprint-type-sizes"]\n\n[profile.release.package.bun_js_parser]\nrustflags = ["-Zprint-type-sizes"]\n'
} > "$work/ts/Cargo.toml.new"
awk '/^\[workspace\]/{ws=1; next} {print} END{print "\n[workspace]"}' "$work/ts/Cargo.toml.new" > "$work/ts/Cargo.toml"; rm -f "$work/ts/Cargo.toml.new"
echo '// Empty: the build of the dependency prints the sizes.' > "$work/ts/src/lib.rs"
cp "$tree/Cargo.lock" "$work/ts/Cargo.lock"
for profile in dev release; do
  flag=""; [ "$profile" = release ] && flag="--release"
  (cd "$tree" && BUN_CODEGEN_DIR="$codegen" cargo check --offline $flag --manifest-path "$work/ts/Cargo.toml" \
     --target-dir "$work/target") > "$work/ts/$profile.stdout" 2> "$out/typesizes.$tag.$profile.stderr.txt"
  echo "cargo check $profile exit=$?" >> "$out/typesizes.$tag.$profile.stderr.txt"
  {
    echo "# tree=$tree rev=$(git -C "$tree" rev-parse --short=10 HEAD) profile=$profile: layouts rustc computed while checking bun_js_parser"
    grep -a '^print-type-size type: ' "$work/ts/$profile.stdout" | grep -aE 'ParserSnapshot|SidecarMark|LexerSnapshot|lexer::Lexer<|`p::P<|StartsForParseOnly|FnOrArrowDataParse|ErasedMark|AttachedMark|parse_entry::Options|ParsedForLint' | sort -u
    echo "# lines in all: $(grep -ac '^print-type-size type: ' "$work/ts/$profile.stdout")"
  } > "$out/typesizes.$tag.$profile.txt"
  rm -f "$work/ts/$profile.stdout"
done
exit $rc
