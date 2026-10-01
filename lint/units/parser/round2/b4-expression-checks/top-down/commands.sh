#!/bin/sh
# How the results of this directory were made: research, top-down, for "the checks of the reference on expressions outside the
# type grammar" (round 2 of the parser, B4: TS1477, TS17007, TS17006, TS1209, TS18030, TS2754, TS1034, TS1011, `for (using of of [])`).
# Nothing here writes in the worktree: the prototype is applied to copies of src/js_parser under $W/scratch.
# Tree: /workspace/wt/parser at be1ebe5295. tsc 6.0.2 (node_modules/typescript of the worktree). typescript-go 89d5d5b as
# /tmp/rr/parsediag-bu (ledger/bottom-up/tsgo-oracle/build.sh builds it). The sources of the sibling research are ../bottom-up/inputs.cjs.
# The scripts were run from a copy of this directory at /tmp/b4td, which their temporary files name: W is that copy.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${W:-/tmp/b4td}
mkdir -p "$W" && cp -r "$HERE"/. "$W"/ && cd "$W"

# 1. The reference for the corner sources of this research (extra1.cjs), with the oracle of the sibling research.
PARSEDIAG=/tmp/rr/parsediag-bu node ../bottom-up/oracle.cjs "$W/extra1.cjs" | diff - extra1.expected.txt

# 2. A parse WITHOUT lint of the head (release build of be1ebe5295): transformSync is parse and visit, scanImports the parse pass alone.
/workspace/notes/lint/measure/parser/head/bun bun-plain.mjs bun-plain.inputs.json

# 3. The lint parse of the head for every source, beside the first diagnostic of typescript-go: the probe binary of another research
#    (round2/strict-members-params-heritage/bottom-up/build-probe.sh, /tmp/smph/out/bun_js_parser; it has no top-level await).
node lint-head.cjs ../bottom-up/inputs.cjs > head-lint.inputs.txt && node condense.cjs head-lint.inputs.txt | diff - inputs.lint-head.be1ebe5295.txt
node lint-head.cjs extra1.cjs > head-lint.extra1.txt && node condense.cjs head-lint.extra1.txt | diff - extra1.lint-head.be1ebe5295.txt

# 4. How often the constructs that reach an edited site on a valid path occur in the inputs of cgbench (per parse).
node count-b4.cjs | diff - count-b4.benchroot.jsonl

# 5. The rows of the Rust tables: (text, loader, code, start, end, message) of the first diagnostic of typescript-go, marked where
#    tsc 6.0.2 has another one; "parses" groups have no diagnostic in either. Then what the lint parse of the head does with each row.
node make-test-rows.cjs > test-rows.txt
node rows-head.cjs test-rows.txt > rows.head-lint.txt

# 6. The prototype (proto/apply.py, proto/b4_helpers.rs.inc) and the head, each as a test binary of a scratch copy with proto/zz_probe.rs.
#    "proto" turns the comment list of the lexer on in a lint parse (what B1 does), "proto-nocomments" leaves it as the head has it.
#    Each build is one rustc of the crate (about 6 s of processor time): the first two were run under the lock, the last three outside it.
sh proto/build-scratch.sh head /workspace/wt/parser "$W/scratch"
sh proto/build-scratch.sh proto /workspace/wt/parser "$W/scratch"
sh proto/build-scratch.sh proto-nocomments /workspace/wt/parser "$W/scratch"
node rows-run.cjs "$W/scratch/out/bun_js_parser.proto" test-rows.txt > rows.proto.txt                       # 860 rows, 0 failed
B4_TLA=1 node rows-run.cjs "$W/scratch/out/bun_js_parser.proto" test-rows.txt > rows.proto.tla.txt          # 860 rows, 0 failed
node rows-run.cjs "$W/scratch/out/bun_js_parser.head" test-rows.txt > rows.head.txt                          # 860 rows, 704 failed
node rows-run.cjs "$W/scratch/out/bun_js_parser.proto-nocomments" test-rows.txt | grep -E '^FAIL|^// ' > rows.proto-nocomments.failed.txt   # 25 failed
#    every test of the crate with the prototype: a test run, under the lock
/workspace/tools/lk "$W/scratch/out/bun_js_parser.proto"
#    the lint parse of the prototype against the first diagnostic of typescript-go for every source of both input files
PROBE="$W/scratch/out/bun_js_parser.proto" PROBE_ENV=B4 node lint-any.cjs ../bottom-up/inputs.cjs > proto-lint.inputs.txt
PROBE="$W/scratch/out/bun_js_parser.proto" PROBE_ENV=B4 node lint-any.cjs extra1.cjs > proto-lint.extra1.txt

# 7. Parity: the parse pass without a side table (as `Parser::parse` runs it), head against prototype, every message of every source.
node parity.cjs "$W/scratch/out/bun_js_parser.head" "$W/scratch/out/bun_js_parser.proto" ../bottom-up/inputs.cjs extra1.cjs --rows test-rows.txt
node parity-corpus.cjs "$W/scratch/out/bun_js_parser.head" "$W/scratch/out/bun_js_parser.proto" /tmp/smph/targeted.hex /tmp/smph/extra1.hex /tmp/smph/extra2.hex /tmp/smph/extra3.hex /tmp/smph/fuzz.hex

# 8. The differential of the lint parse, head against prototype: the class-member corpus of another research (150,708 sources) and a
#    sweep of 93,400 generated expressions (sweep-gen.cjs). Every class of change, and the changed sources against the reference.
node sweep-gen.cjs > sweep.hex
for corpus in "/tmp/smph/targeted.hex /tmp/smph/extra1.hex /tmp/smph/extra2.hex /tmp/smph/extra3.hex /tmp/smph/fuzz.hex" sweep.hex; do
  # shellcheck disable=SC2086
  node differential.cjs "$W/scratch/out/bun_js_parser.head" "$W/scratch/out/bun_js_parser.proto" $corpus
  # shellcheck disable=SC2086
  node changed-vs-oracle.cjs "$W/scratch/out/bun_js_parser.head" "$W/scratch/out/bun_js_parser.proto" $corpus > changed.txt
  head -1 changed.txt && node rest-classes.cjs changed.txt
done
node parity-corpus.cjs "$W/scratch/out/bun_js_parser.head" "$W/scratch/out/bun_js_parser.proto" sweep.hex
