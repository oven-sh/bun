#!/bin/sh
# How the results of this directory were made (research of B3, round 2 of the parser, bottom-up). Nothing here writes in the worktree.
# Tree: /workspace/wt/parser at be1ebe5295. typescript-go 89d5d5b is /tmp/rr/parsediag (JSON lines {"id","name","text"} in, {"id","n","d":[[code,start,length,text]]} out, byte offsets),
# tsc 6.0.2 is /workspace/bun/node_modules/typescript, the release build of the head is /workspace/notes/lint/measure/parser/head/bun.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"
HEAD_BUN=/workspace/notes/lint/measure/parser/head/bun
# 1. the reference: first parse diagnostics of typescript-go, and where tsc 6.0.2 has another first one (none of 551 + 277 sources)
node go.cjs in1.txt; node go.cjs in2.txt 2; node go.cjs in3.txt 2; node go.cjs in4.txt 1; node go.cjs in5.txt 1; node go.cjs in6.txt 2
# 2. the reference against the parse pass without lint of the head (scanImports): rows.be1ebe5295.txt, classes REJECT 370, ok 152, native 27, over 2
node join.cjs $HEAD_BUN in1.txt in2.txt in3.txt in4.txt in5.txt in6.txt > rows.be1ebe5295.txt
# 3. the same sources through the lint parse of the head (probe binary, see prototype/build-scratch.sh plain): it takes what the parse pass without lint takes, but "++await;"
/workspace/tools/lk node lint-head.cjs in1.txt in2.txt in3.txt in4.txt in5.txt in6.txt > rows.lint-head.be1ebe5295.txt
# 4. option B, the count of runs of each site in the five groups of cgbench: count-sites.expected.txt
node count-sites.cjs | diff - count-sites.expected.txt
# 5. the files of test/ and src/js: 10,608 files, 78 with a parse diagnostic of tsc, all 78 rejected by the parse pass of bun, 0 statements that end in a postfix update before "(", "[" or a template
/workspace/tools/lk node corpus-tsc.cjs /workspace/wt/parser corpus.jsonl
$HEAD_BUN corpus-bun.mjs /workspace/wt/parser corpus.jsonl
# 6. the table of the test: table.txt -> rust-rows.txt (rows of typescript-go), must-parse.rs.txt (what both take)
node gen-rust-rows.cjs table.txt > rust-rows.txt
node gen-must-parse.cjs rows.be1ebe5295.txt > must-parse.rs.txt
# 7. the prototype, in a scratch copy of src/js_parser (prototype/operand_checks.rs, prototype/apply.py; the patch is prototype/prototype.be1ebe5295.patch,
#    which also holds the line of lib.rs for the probe): one run under the lock builds it and makes every comparison
/workspace/tools/lk sh prototype/run-all.sh
#    crate tests of the scratch binary: 71 passed (the 70 of the crate and the probe)
#    prototype/table.compare.txt   248 sources: same 230, EXTRA 11, DIFF 7
#    prototype/rows.compare.txt    551 sources: same 376, ok 137, DIFF 21, EXTRA 17, MISSED 0
#    prototype/prior.compare.txt   277 sources of the older list: same 109 (the head: 11, prototype/prior.compare.head.txt), MISSED 41, all of unit b4
#    prototype/fuzz.{ts,js,tsx}.txt  77,826 snippets (prototype/fuzz.cjs): no MISSED but TS1209, TS1477, TS17007 (unit b4) and "<" after a JSX element
#    prototype/corpus-lint.txt     10,608 files of test/ and src/js: the lint parse of the head and of the prototype agree on every file
