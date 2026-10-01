#!/bin/sh
# Reproduces the vectors and checks the scratch port against them. Run from this directory. Nothing here is built by cargo.
set -e
here=$(cd "$(dirname "$0")" && pwd)
notes=$here/../../../lexer-lint-hooks
# 1. The directives of the verbatim scanner arm of typescript-go (45 inputs), and of TypeScript 6.0.2 for the same inputs.
(cd "$here/directives/oracle" && python3 gen.py && go run . ../inputs.json) > /tmp/directives-go.txt
diff /tmp/directives-go.txt "$here/directives/expected-go.txt"
node "$here/directives/tsc-directives.cjs" "$here/directives/inputs.json" > /tmp/directives-tsc.txt
node "$here/directives/tsc-directives.cjs" "$here/directives/context-inputs.json" > /tmp/directives-context-tsc.txt
diff /tmp/directives-context-tsc.txt "$here/directives/context-expected-tsc.txt"
# 2. The header of the verbatim pragma functions of typescript-go: 77 + 35 + 36 inputs, one line each.
(cd "$here/pragmas/oracle" && python3 gen.py && for f in "$notes/top-down/pragma-inputs.json" "$notes/bottom-up/pragmas-inputs.json" ../extra-inputs.json; do go run . "$f"; done) > /tmp/pragmas-go-reduced.txt
diff /tmp/pragmas-go-reduced.txt "$here/pragmas/expected-go-reduced.txt"
# 3. The scratch port (std only) against both, then the lints of the workspace on it.
cd "$here/proto"
node gen-vectors.cjs && node gen-context.cjs
rustc --edition 2024 -O -o proto main.rs && ./proto
CLIPPY_CONF_DIR=/workspace/wt/parser clippy-driver --edition 2024 --crate-type lib --emit=metadata -o libproto.rmeta lib.rs
rustfmt --edition 2024 --check comment_directives.rs pragmas.rs
