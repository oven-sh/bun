#!/bin/bash
# Size probe outside the worktrees: a crate that depends on bun_js_parser and bun_ast of one tree by path.
# usage: [PSIZE_REV=<sha of an exported tree>] run.sh <tree> <tag> <codegen dir of that tree> <out dir>
#   tree: /workspace/wt/parser or a scratch worktree; codegen dir: <tree>/build/debug/codegen or build/release/codegen
#   (bun_core's build script reads build_options.rs from it). Run it through /workspace/tools/lk.
set -u
TREE=$1; TAG=$2; CODEGEN=$3; OUT=$4
HERE=$(cd "$(dirname "$0")" && pwd)
D=$HERE/trees/$TAG
T=${PSIZE_TARGET:-/tmp/psize-target}/$TAG
mkdir -p "$D" "$OUT"
[ -f "$CODEGEN/build_options.rs" ] || { echo "no build_options.rs in $CODEGEN"; exit 2; }
cat > "$D/Cargo.toml" <<EOT
[package]
name = "psize_probe"
version = "0.0.0"
edition = "2024"

[lib]
path = "$HERE/src/lib.rs"

[dependencies]
bun_js_parser = { path = "$TREE/src/js_parser" }
bun_ast = { path = "$TREE/src/ast" }

[profile.dev]
panic = "abort"

[profile.release]
panic = "abort"

[workspace]
EOT
cp "$TREE/Cargo.lock" "$D/Cargo.lock"
CH=$(sed -n 's/^channel = "\(.*\)"/\1/p' "$TREE/rust-toolchain.toml")
echo "tree=$TREE rev=${PSIZE_REV:-$(git -C "$TREE" rev-parse HEAD 2>/dev/null)} toolchain=$CH codegen=$CODEGEN" > "$OUT/$TAG.info.txt"
for p in dev release; do
  flag=""; [ $p = release ] && flag="--release"
  s=$(date +%s)
  RUSTUP_TOOLCHAIN=$CH BUN_CODEGEN_DIR=$CODEGEN cargo check --manifest-path "$D/Cargo.toml" --offline --target-dir "$T" $flag > "$OUT/$TAG.$p.raw.txt" 2>&1
  echo "$TAG $p rc=$? $(( $(date +%s) - s ))s" >> "$OUT/$TAG.info.txt"
  python3 - "$OUT/$TAG.$p.raw.txt" "$HERE/src/lib.rs" > "$OUT/$TAG.$p.sizes.txt" <<'EOPY'
import re, sys
raw = open(sys.argv[1], errors='replace').read()
raw = re.sub(r'\x1b\[[0-9;]*m', '', raw)
src = open(sys.argv[2]).read().splitlines()
found = 0
for m in re.finditer(r'--> [^\n]*lib\.rs:(\d+):\d+.*?found one with a size of (\d+)', raw, re.S):
    ln = int(m.group(1)); found += 1
    what = re.search(r'(size_of|align_of)::<(.*)>\(\)', src[ln - 1])
    print(f"{what.group(1) if what else '?':8} {what.group(2) if what else src[ln - 1]:44} {m.group(2)}")
if not found:
    print('no size found; errors:')
    print('\n'.join(x for x in raw.splitlines() if x.startswith('error'))[:3000])
EOPY
  echo "== $TAG $p"; cat "$OUT/$TAG.$p.sizes.txt"
done
