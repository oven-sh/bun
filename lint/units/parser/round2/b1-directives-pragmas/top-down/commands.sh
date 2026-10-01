#!/bin/sh
# Reproduces the research of unit b1-directives-pragmas (round 2, top-down). Nothing is written in a worktree.
# Part 1 needs node, go 1.24 and rustc. Part 2 needs the debug build and one `cargo test -p bun_js_parser --lib` of /workspace/wt/parser, and goes through the lock.
set -e
here=$(cd "$(dirname "$0")" && pwd)
older=$here/../../comment-directives-pragmas/top-down
export GOTOOLCHAIN=local GOFLAGS=-p=2

# Part 1. The port as std-only Rust against the functions of typescript-go 89d5d5b, copied verbatim into two Go programs.
rm -rf /tmp/b1dp && mkdir -p /tmp/b1dp && cd /tmp/b1dp
cp -r "$older/oracle-hex" "$older/vectors" . && cp -r "$here/proto-std" proto2 && cp "$here"/probes/*.cjs "$here"/probes/*.mjs .
(cd oracle-hex/directives && python3 gen.py && go build -o oracle .)
(cd oracle-hex/pragmas && python3 gen.py && go build -o oracle .)
(cd proto2 && rustc --edition 2024 -O -o proto2 main.rs 2>/dev/null && rustc --edition 2024 --test -o libtest lib.rs && ./libtest | tail -2)
proto2/proto2 directives vectors/directives.hex | diff - vectors/directives.expected
oracle-hex/pragmas/oracle vectors/pragmas.hex | grep -v '^pragma ' > o.txt && proto2/proto2 pragmas vectors/pragmas.hex | diff - o.txt
node "$older/fuzz/gen.cjs" directives 300000 999 > d.hex && oracle-hex/directives/oracle d.hex > d.go.out && proto2/proto2 directives d.hex | cmp - d.go.out
node "$older/fuzz/gen.cjs" pragmas 300000 12345 > p.hex && node "$older/fuzz/gen2.cjs" 400000 4242 > p2.hex
for f in p p2; do oracle-hex/pragmas/oracle $f.hex | grep -v '^pragma ' > $f.go.out && proto2/proto2 pragmas $f.hex | cmp - $f.go.out; done
# The 96 sources of the test tables: the port against typescript-go (must be 0), and where TypeScript 6.0.2 differs (3 + 11).
node rows.cjs | diff - "$here/probes/rows.expected.txt"
# The cases of the brief as TypeScript 6.0.2 reads them, and the JSX pragmas of Bun's lexer beside tsc and typescript-go.
node brief.cjs d | diff - "$here/probes/brief-d.tsc.txt" && node brief.cjs p | diff - "$here/probes/brief-p.tsc.txt"
node -e 'const fs=require("fs");const c=[["block-header","/** @jsx h */\nlet e = <a/>;"],["line-header","// @jsx h\nlet e = <a/>;"],["block-after-first-token","let y;\n/** @jsx h */\nlet e = <a/>;"],["upper-case-name","/** @JSX h */\nlet e = <a/>;"],["hash-trigger","/** #jsx h */\nlet e = <a/>;"],["second-at-on-line","/** foo@x @jsx h */\nlet e = <a/>;"],["two-pragmas-last-wins","/* @jsx h */ /* @jsx g */\nlet e = <a/>;"],["value-on-next-line","/** @jsx\n h */\nlet e = <a/>;"],["colon-after-name","/** @jsx: h */\nlet e = <a/>;"],["frag","/** @jsx h */\n/** @jsxFrag F */\nlet e = <></>;"],["frag-lower","/** @jsx h */\n/** @jsxfrag F */\nlet e = <></>;"],["inside-jsx-tag","let e = <a /* @jsx h */ />;"],["value-then-star-slash","/*@jsx h*/\nlet e = <a/>;"]];fs.writeFileSync("jsx.hex",c.map(([n,s])=>n+"\t"+Buffer.from(s).toString("hex")).join("\n")+"\n")'
(bun jsxprobe.mjs; echo ---- tsc 6.0.2; node jsxtsc.cjs; echo ---- typescript-go; oracle-hex/pragmas/oracle jsx.hex) | diff - "$here/probes/jsx-relation.expected.txt" || echo "the first block is the installed bun: it differs when its revision does"
echo "part 1: all the same"

# Part 2. The two files in a COPY of the crate: type check with the lints of the workspace, the test binary, clippy, and the lint parse of the 96 sources.
rm -rf /tmp/b1check && mkdir -p /tmp/b1check/src /tmp/b1check/new /tmp/b1check/out && cd /tmp/b1check
cp -r /workspace/wt/parser/src/js_parser src/js_parser && cp "$here"/crate/*.rs new/ && cp "$here"/scratch-check/* .
python3 apply.py /tmp/b1check/src/js_parser /tmp/b1check/new
cp zz_probe.rs src/js_parser/zz_probe.rs && printf '\n#[cfg(test)]\nmod zz_probe;\n' >> src/js_parser/lib.rs
/workspace/tools/lk sh -c 'python3 typecheck.py lib | head -1; python3 typecheck.py test | head -1; python3 testbin.py link 8 | head -1; ./out-testbin/bun_js_parser 2>&1 | tail -2; sh clippy-scratch.sh /workspace/wt/parser /tmp/b1check'
# Only a source that Bun does not parse differs: 3 lines for the directives (a stray @ts-ignore after a comment, a comment without its end) and 1 for the pragmas (a #! line after a line break).
# apply.py lets the parse go on after TS1084 and TS1453, as the reference does; apply-a.py with crate-a/pragmas.rs is the variant that fails the parse there.
/tmp/b1dp/oracle-hex/directives/oracle /tmp/b1dp/rows-d.hex | diff rows-d.lint.txt - | grep -c '^[<>]' || true
/tmp/b1dp/oracle-hex/pragmas/oracle /tmp/b1dp/rows-p.hex | grep -v '^pragma ' | diff rows-p.lint.txt - | grep -c '^[<>]' || true
