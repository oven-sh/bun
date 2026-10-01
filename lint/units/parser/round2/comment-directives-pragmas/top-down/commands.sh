#!/bin/sh
# Probes of the top-down research on comment directives and pragmas (round 2, B1). Run from this directory. Nothing here is built by cargo.
set -e
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
export GOTOOLCHAIN=local GOFLAGS=-p=2
# 1. The two oracles: the functions of typescript-go 89d5d5b copied verbatim into a Go 1.24 program that reads `name<TAB>hex` lines.
(cd oracle-hex/directives && python3 gen.py && go build -o oracle .)
(cd oracle-hex/pragmas && python3 gen.py && go build -o oracle .)
# 2. The vectors: 54 directive inputs, 35 + 77 pragma inputs. The .expected files are the output of the oracles.
node to-hex.cjs
oracle-hex/directives/oracle vectors/directives.hex | diff - vectors/directives.expected
oracle-hex/pragmas/oracle vectors/pragmas.hex | diff - vectors/pragmas.expected
# 3. TypeScript 6.0.2 beside typescript-go: must end with `same=49 diff=5` (four or more slashes; white space that is no blank or tab before the @).
node directives-vs-tsc.cjs | tail -1
# 4. Sources whose comments only a parse can tell: must print directives-parse-expected-tsc.txt.
node directives-parse.cjs | diff - directives-parse-expected-tsc.txt
# 5. The scratch port (std only, arguments kept in one list) against the oracles, on the vectors and on random texts.
(cd proto && rustc --edition 2024 -O -o proto main.rs)
proto/proto directives vectors/directives.hex | diff - vectors/directives.expected
proto/proto pragmas vectors/pragmas.hex | diff - vectors/pragmas.expected
node fuzz/gen.cjs directives 300000 999 > fuzz/d.hex
node fuzz/gen.cjs pragmas 300000 12345 > fuzz/p.hex
node fuzz/gen2.cjs 400000 4242 > fuzz/p2.hex
oracle-hex/directives/oracle fuzz/d.hex > fuzz/d.go.out && proto/proto directives fuzz/d.hex | cmp - fuzz/d.go.out
for f in p p2; do oracle-hex/pragmas/oracle fuzz/$f.hex > fuzz/$f.go.out && proto/proto pragmas fuzz/$f.hex | cmp - fuzz/$f.go.out; done
echo all the same
