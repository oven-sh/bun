#!/bin/sh
# Expected wrapper records of the test sources, read from the tree of tsc 6.0.2, and a type check of the edited functions
# against stand-ins of bun_ast, bun_alloc and bstr (no cargo, no build directory of the worktree is touched).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
bun "$HERE/oracle.cjs" "$HERE/cases.json"
bun "$HERE/oracle.cjs" "$HERE/extra.json"
S=${S:-/tmp/wrappers-scratch}
mkdir -p "$S" && cp "$HERE"/scratch/* "$S"/
cd /workspace/wt/parser
for c in bstr bun_alloc bun_ast; do rustc --edition 2024 --crate-type rlib --crate-name $c -A warnings -o "$S/lib$c.rlib" "$S/$c.rs"; done
(cd "$S" && python3 gen.py)
rustc --edition 2024 --test --crate-name scratch -L "$S" --extern bun_ast="$S/libbun_ast.rlib" --extern bun_alloc="$S/libbun_alloc.rlib" --extern bstr="$S/libbstr.rlib" -A warnings -o "$S/scratch-tests" "$S/lib.rs"
"$S/scratch-tests" identity_tells records_hold rewind_drops
