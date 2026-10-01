#!/bin/sh
# How the results of this directory were made (research for "the code on the message", round 2 of the parser, B2 and the first token of B4).
# Nothing here writes in the worktree: the prototype is applied to a copy of src/js_parser under /tmp.
# Tree: /workspace/wt/parser at be1ebe5295. tsc 6.0.2 (node_modules/typescript of the worktree), typescript-go 89d5d5b (/tmp/rr/parsediag-bu,
# built by ledger/bottom-up/tsgo-oracle/build.sh), the probe binary of the head (/tmp/smph/out/bun_js_parser, built by
# round2/strict-members-params-heritage/bottom-up/build-probe.sh).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
S=${S:-/tmp/b2codes/scratch}
# 1. the model of the table alone (no crate of bun): prints "model ok"
rustc --edition 2021 -O -o /tmp/b2codes-model "$HERE/table-model.rs" && /tmp/b2codes-model
# 2. the prototype in a scratch copy of the crate: apply.py (the code), apply_tests.py + tests_module.rs (mod tests of syntax_errors.rs), zz_probe.rs
/workspace/tools/lk sh "$HERE/build-scratch.sh" /workspace/wt/parser "$S"
/workspace/tools/lk "$S/out/bun_js_parser"                       # 80 passed (61 of the other files, 18 of parse::syntax_errors, the probe)
(cd "$S" && rustfmt --edition 2024 --check src/js_parser/parse/syntax_errors.rs src/js_parser/parse/parse_entry.rs)
/workspace/tools/lk sh "$HERE/clippy-scratch.sh" /workspace/wt/parser "$S"   # only p.rs:7962, erased_tests.rs:147, generics.rs:719, which the head has too
# 3. the same first error as the head for every source of the older probes (150,708 sources): no line differs
for name in targeted extra1 extra2 extra3 fuzz; do
  SMPH_INIT=plain SMPH_INPUTS=/tmp/smph/$name.hex SMPH_OUT=/tmp/b2codes/new.plain.$name.tsv "$S/out/bun_js_parser" zz_probe >/dev/null 2>&1
  diff -q /tmp/smph/lint.$name.tsv /tmp/b2codes/new.plain.$name.tsv
done
# 4. the inputs of this research: the reference (probe/oracle*.expected.txt), the head (probe/head-*.txt), the prototype (probe/prototype.*.txt)
cd "$HERE/probe"
for n in "" 2 3 4; do
  node oracle.cjs inputs$n.json | diff - oracle$n.expected.txt
  node -e 'const fs=require("fs");const i=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],i.map(([k,s],n)=>`${n} ${k} ${Buffer.from(s,"utf8").toString("hex")}`).join("\n")+"\n")' inputs$n.json /tmp/b2codes/in$n.hex
  SMPH_INPUTS=/tmp/b2codes/in$n.hex SMPH_OUT=/tmp/b2codes/out$n.tsv "$S/out/bun_js_parser" zz_probe >/dev/null 2>&1
  node show.cjs /tmp/b2codes/out$n.tsv inputs$n.json | diff - prototype.lint-init$n.txt
done
