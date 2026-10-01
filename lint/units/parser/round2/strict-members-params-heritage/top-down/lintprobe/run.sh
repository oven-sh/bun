#!/bin/bash
# Builds the lint-parse probe against one tree, outside it, and runs it over inputs.json of the parent directory.
# usage: /workspace/tools/lk ./run.sh [tree=/workspace/wt/parser] [inputs.json] [out.txt]   (a cargo build: run it through the lock)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TREE=${1:-/workspace/wt/parser}
INPUTS=${2:-$HERE/../inputs.json}
OUT=${3:-$HERE/../lint.head.txt}
D=/tmp/smph-probe
T=/tmp/smph-target
mkdir -p "$D"
cat > "$D/Cargo.toml" <<EOT
[package]
name = "lintprobe"
version = "0.0.0"
edition = "2024"

[[bin]]
name = "lintprobe"
path = "$HERE/main.rs"

[dependencies]
bun_js_parser = { path = "$TREE/src/js_parser" }
bun_ast = { path = "$TREE/src/ast" }
bun_alloc = { path = "$TREE/src/bun_alloc" }
bun_core = { path = "$TREE/src/bun_core" }

[profile.dev]
debug = 0
opt-level = 1

[workspace]
EOT
cp "$TREE/Cargo.lock" "$D/Cargo.lock"
CH=$(sed -n 's/^channel = "\(.*\)"/\1/p' "$TREE/rust-toolchain.toml")
s=$(date +%s)
RUSTUP_TOOLCHAIN=$CH BUN_CODEGEN_DIR=$TREE/build/debug/codegen cargo build --manifest-path "$D/Cargo.toml" --offline --target-dir "$T" > "$D/build.log" 2>&1
rc=$?
echo "build rc=$rc $(( $(date +%s) - s ))s"
[ $rc = 0 ] || { grep -E '^(error|warning: unused)' -A12 "$D/build.log" | head -80; exit $rc; }
node -e '
const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write(a.map(r => (r.l || "ts") + "\t" + Buffer.from(r.s, "utf8").toString("hex")).join("\n") + "\n");
' "$INPUTS" > "$D/inputs.hex"
"$T/debug/lintprobe" "$D/inputs.hex" > "$OUT" 2> "$D/run.err"
echo "run rc=$? lines=$(wc -l < "$OUT")"
tail -3 "$D/run.err"
