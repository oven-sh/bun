#!/bin/sh
# Reproduces the vectors of this directory and checks the scratch port (proto/) against the verbatim functions of
# typescript-go. Nothing here is built by cargo and nothing touches the worktree. Work directory: $1, default a new one.
set -e
here=$(cd "$(dirname "$0")" && pwd)
prior=$here/../../comment-directives-pragmas/bottom-up
hooks=$here/../../../lexer-lint-hooks
work=${1:-$(mktemp -d /tmp/b1-directives-pragmas.XXXXXX)}
mkdir -p "$work/d" "$work/p" "$work/r"
# 1. The three oracles: the comment arm of Scan with processCommentDirective, finishSourceFile's pragma functions (full
#    output), and the same with the one-line output that the fuzz compares.
cp "$prior"/directives/oracle/* "$work/d/" && (cd "$work/d" && python3 gen.py && GOFLAGS=-mod=mod go build -o "$work/oracle-directives" .)
cp "$here"/pragmas/oracle/* "$work/p/" && (cd "$work/p" && python3 gen.py && GOFLAGS=-mod=mod go build -o "$work/oracle-pragmas" .)
cp "$prior"/pragmas/oracle/* "$work/r/" && (cd "$work/r" && python3 gen.py && GOFLAGS=-mod=mod go build -o "$work/oracle-pragmas-reduced" .)
# 2. The expectations: typescript-go (verbatim functions) and TypeScript 6.0.2 (createSourceFile).
"$work/oracle-directives" "$here/directives/inputs.json" | diff - "$here/directives/expected-go.txt"
node "$prior/directives/tsc-directives.cjs" "$here/directives/inputs.json" | diff - "$here/directives/expected-tsc.txt"
"$work/oracle-pragmas" "$here/pragmas/inputs.json" | diff - "$here/pragmas/expected-go.txt"
node "$here/pragmas/tsc-header.cjs" "$here/pragmas/inputs.json" | diff - "$here/pragmas/expected-tsc.txt"
# Where the two references differ (exit 1 is expected: 3 of 31 directives, 7 of 62 headers).
node "$here/pragmas/cmp.cjs" "$here/directives/expected-tsc.txt" "$here/directives/expected-go.txt" directives || true
node "$here/pragmas/cmp.cjs" "$here/pragmas/expected-tsc.txt" "$here/pragmas/expected-go.txt" || true
# 3. The scratch port against them, and the rows of the two test tables.
cd "$here/proto"
rustc --edition 2024 -O -o "$work/proto" main.rs
"$work/proto" directives "$here/directives/inputs.json" "$here/directives/expected-go.txt" > "$work/directives.rust.txt"
node "$here/pragmas/cmp.cjs" "$work/directives.rust.txt" "$here/directives/expected-go.txt" directives
"$work/proto" pragmas "$here/pragmas/inputs.json" > "$work/pragmas.rust.txt"
node "$here/pragmas/cmp.cjs" "$work/pragmas.rust.txt" "$here/pragmas/expected-go.txt"
"$work/proto" rust-directives "$here/directives/inputs.json" "$here/directives/expected-go.txt" "$here/directives/expected-tsc.txt" | diff - "$here/tables/directives.rows.rs.txt"
"$work/proto" rust-headers "$here/pragmas/inputs.json" | diff - "$here/tables/headers.rows.rs.txt"
# The 148 earlier header inputs and the 45 earlier directive inputs.
for f in "$hooks/top-down/pragma-inputs.json" "$hooks/bottom-up/pragmas-inputs.json" "$prior/pragmas/extra-inputs.json"; do "$work/proto" pragmas-reduced "$f"; done | diff - "$prior/pragmas/expected-go-reduced.txt"
"$work/proto" directives "$prior/directives/inputs.json" "$prior/directives/expected-go.txt" > "$work/directives45.rust.txt"
node "$here/pragmas/cmp.cjs" "$work/directives45.rust.txt" "$prior/directives/expected-go.txt" directives
# 4. Random texts, bytes that are no UTF-8 included: three lines of "same".
node "$prior/fuzz/gen.cjs" directives 300000 999 > "$work/d.hex"
node "$prior/fuzz/gen.cjs" pragmas 300000 12345 > "$work/p.hex"
node "$prior/fuzz/gen2.cjs" 400000 4242 > "$work/p2.hex"
"$work/oracle-directives" "$work/d.hex" > "$work/d.go.out" && "$work/proto" directives-hex "$work/d.hex" "$work/d.go.out" | cmp - "$work/d.go.out" && echo "directives on 300000 random texts: same"
for f in p p2; do "$work/oracle-pragmas-reduced" "$work/$f.hex" > "$work/$f.go.out" && "$work/proto" pragmas-hex "$work/$f.hex" | cmp - "$work/$f.go.out" && echo "pragmas on $f.hex: same"; done
# 5. No panic with overflow checks on every prefix of a header and on ranges that are no comments; the lints of the workspace.
rustc --edition 2024 -C debug-assertions=on -C overflow-checks=on -O -o "$work/robust" robust.rs && "$work/robust"
CLIPPY_CONF_DIR=/workspace/wt/parser clippy-driver --edition 2024 --crate-type lib --emit=metadata -o "$work/libproto.rmeta" lib.rs
rustfmt --edition 2024 --check comment_directives.rs pragmas.rs
# 6. What the lexer's JSXPragma makes of the same comments (the installed bun, lexer unchanged since then).
(cd "$here/jsx" && bun jsx-pragma-of-the-lexer.mjs | diff - jsx-pragma-of-the-lexer.bun143-367d939d9.txt)
echo "all checks passed in $work"
