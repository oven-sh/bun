#!/bin/sh
# How the results of this directory were made: research for "the checks of the reference on expressions outside the type grammar"
# (round 2 of the parser, B4: TS1477, TS17007, TS17006, TS1209, TS18030, TS2754, TS1034, TS1011, `for (using of of [])`).
# Nothing here writes in the worktree: the prototype is applied to copies of src/js_parser under /tmp/b4ec.
# Tree: /workspace/wt/parser at be1ebe5295. tsc 6.0.2 (node_modules/typescript of the worktree). typescript-go 89d5d5b as
# /tmp/rr/parsediag-bu (ledger/bottom-up/tsgo-oracle/build.sh builds it). Release binaries: head build/release/bun of the worktree,
# base /workspace/notes/lint/measure/parser/base/bun (e3566be889).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
S=${S:-/tmp/b4ec}
cd "$HERE"

# 1. The reference: first and later parse diagnostics of typescript-go and tsc for every source of inputs.cjs, as a.ts and a.js.
node oracle.cjs | diff - expected.txt

# 2. A parse WITHOUT lint today (release binaries): scanImports is the parse pass alone.
BUN_DEBUG_QUIET_LOGS=1 /workspace/wt/parser/build/release/bun bun-plain.mjs | diff - plain.head-be1ebe5295.txt
BUN_DEBUG_QUIET_LOGS=1 /workspace/notes/lint/measure/parser/base/bun bun-plain.mjs | diff - plain.base-e3566be889.txt

# 3. The prototype (apply.py + proto_*.rs) and the head, each as a test binary of a scratch copy with zz_probe.rs.
/workspace/tools/lk sh build-scratch.sh head /workspace/wt/parser "$S"
/workspace/tools/lk sh build-scratch.sh proto /workspace/wt/parser "$S"
/workspace/tools/lk "$S/proto/out/bun_js_parser"     # 71 passed: the 70 tests of the crate and the probe
node run-probe.cjs "$S/head/out/bun_js_parser" lint | diff - lint.head.txt
node run-probe.cjs "$S/proto/out/bun_js_parser" lint | diff - lint.proto.txt
B4_TLA=1 node run-probe.cjs "$S/proto/out/bun_js_parser" lint | diff - lint.proto.tla.txt
# parity: the parse pass without a side table, head against prototype, no line differs
for tla in "" 1; do
  B4_TLA=$tla node run-probe.cjs "$S/head/out/bun_js_parser" plain > "$S/plain.head.$tla.txt"
  B4_TLA=$tla node run-probe.cjs "$S/proto/out/bun_js_parser" plain | diff - "$S/plain.head.$tla.txt"
done
# the first message of the lint parse of the prototype against the first diagnostic of typescript-go, by group
for g in TS1477 TS17007 TS1209 TS18030 TS2754 TS1011 "for head"; do node compare.cjs expected.txt lint.proto.tla.txt "$g" | tail -1; done
# rows for the Rust table of the tests (default options, and with top-level await)
node make-test-rows.cjs expected.txt lint.proto.txt plain.proto.txt | diff - test-rows.txt
node make-test-rows.cjs expected.txt lint.proto.tla.txt plain.proto.tla.txt | diff - test-rows.tla.txt

# 4. How often the placements on a valid path run in the inputs of the benchmark.
node count-bench.cjs | diff - count-bench.txt

# 5. Code generation, without a run: one optimized object of each copy with the flags of the release build (no LTO of the linker),
#    and the functions that the prototype touches side by side.
/workspace/tools/lk python3 build-release-obj.py head /workspace/wt/parser "$S"
/workspace/tools/lk python3 build-release-obj.py proto /workspace/wt/parser "$S"
sh static-codegen.sh "$S" | diff - static-codegen.txt
python3 disfn.py "$S/head/rel/bun_js_parser.o" '<bun_js_parser::p::P<false, false>>::pfx_t_minus' > "$S/h.s"
python3 disfn.py "$S/proto/rel/bun_js_parser.o" '<bun_js_parser::p::P<false, false>>::pfx_t_minus' | diff -y -W 170 "$S/h.s" - || true

# 6. The measurement with the benchmark: the library of the crate as the release build compiles it, linked into a bun-profile
#    as the release build links, and cgbench for head and prototype. One lock for all of it.
/workspace/tools/lk python3 build-release-rlib.py head /workspace/wt/parser "$S"
/workspace/tools/lk python3 build-release-rlib.py proto /workspace/wt/parser "$S"
/workspace/tools/lk sh measure.sh "$S" /workspace/wt/parser

# 7. More contexts. inputs2.cjs: heritage clauses, enums, decorators, statements of every kind (expected2.txt, lint.proto2.txt, lint.head2.txt).
#    inputs3.cjs: statements and class members that leave no node (expected3.txt): the walk of the first prototype read the statement
#    list only and missed all twelve; the prototype as it is now (proto_methods.rs) reads the side table too and the first-message
#    guard of TS1011. Its test binary is `build-scratch.sh proto2`: queued under the lock when this was written, not run.
node oracle.cjs inputs2.cjs | diff - expected2.txt
node oracle.cjs inputs3.cjs | diff - expected3.txt
/workspace/tools/lk sh build-scratch.sh proto2 /workspace/wt/parser "$S"
node compare.cjs expected3.txt lint.proto3.statement-list-only.txt   # the first prototype: 12 of 13 ts rows are accepted
node run-probe.cjs "$S/proto2/out/bun_js_parser" lint inputs3.cjs > "$S/lint.proto3.txt" && node compare.cjs expected3.txt "$S/lint.proto3.txt"
for g in TS1477 TS17007 TS1209 TS18030 TS2754 TS1011 "for head"; do node run-probe.cjs "$S/proto2/out/bun_js_parser" lint > "$S/lint.proto.new.txt"; node compare.cjs expected.txt "$S/lint.proto.new.txt" "$g" | tail -1; done

# 8. The corpora of round2/strict-members-params-heritage (/tmp/smph/*.hex, 150,708 sources): the lint parse of the head against the
#    prototype. 691 sources differ, all by the codes of this work (TS1034 419, TS2754 1, TS1011 13 first and 244 later messages,
#    TS1477 11); the guard of TS1011 takes the 244 later ones back.
for n in targeted extra1 extra2 extra3 fuzz; do
  for w in head proto; do B4_INPUTS=/tmp/smph/$n.hex B4_OUT="$S/corpus.$w.$n.tsv" B4_MODE=lint "$S/$w/out/bun_js_parser" zz_probe >/dev/null 2>&1; done
  diff "$S/corpus.head.$n.tsv" "$S/corpus.proto.$n.tsv" | grep -c '^>' || true
done

# 9. The release link emulated on the one module of the crate (no lock needed: one process), and the blocks that differ.
sh emulate-lto.sh "$S" | diff - emulated-lto.txt
python3 blocks.py "$S/dis2/h.parse_prefix.falsefalse.s" "$S/dis2/p.parse_prefix.falsefalse.s" v | head -120
