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
# 4. The same port on random texts (generators: the copies in fuzz/ of ../top-down/fuzz), bytes that are no UTF-8 included. Ten lines of "same".
(cd "$here/directives/oracle" && go build -o /tmp/oracle-directives . ) && (cd "$here/pragmas/oracle" && go build -o /tmp/oracle-pragmas .)
node "$here/fuzz/gen.cjs" directives 300000 999 > /tmp/d.hex
node "$here/fuzz/gen.cjs" pragmas 300000 12345 > /tmp/p.hex
node "$here/fuzz/gen2.cjs" 400000 4242 > /tmp/p2.hex
/tmp/oracle-directives /tmp/d.hex > /tmp/d.go.out && ./proto directives-hex /tmp/d.hex /tmp/d.go.out | cmp - /tmp/d.go.out && echo "directives on 300000 random texts: same"
for f in p p2; do /tmp/oracle-pragmas /tmp/$f.hex > /tmp/$f.go.out && ./proto pragmas-hex /tmp/$f.hex | cmp - /tmp/$f.go.out && echo "pragmas on $f.hex: same"; done
rm -f "$here/directives/oracle/main.go" "$here/pragmas/oracle/main.go"
CLIPPY_CONF_DIR=/workspace/wt/parser clippy-driver --edition 2024 --crate-type lib --emit=metadata -o libproto.rmeta lib.rs
rustfmt --edition 2024 --check comment_directives.rs pragmas.rs
