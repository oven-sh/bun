#!/bin/sh
# How results/ was made: a lint parse (Parser::parse_for_lint_with_codes) of every source of corpus.small.json and
# corpus.targeted.json (grammar-diff/), of targeted/09-checker-grammar.txt and of the 3,214 TypeScript files under
# test/ and src/js, as .ts and as .tsx, joined with tsc 6.0.2, with typescript-go 89d5d5b and with a parse without lint.
# Tree: /workspace/wt/parser at be1ebe5295. Nothing here writes in the worktree. Scratch: $S (default /tmp/lpd-1a).
# Needs: one `bun bd --version` in the worktree (codegen, vendor), /tmp/rr/parsediag-bu (ledger/bottom-up/tsgo-oracle/build.sh),
# the release binary of the same commit (measure/parser/head/bun) for harness.mjs, typescript 6.0.2 in the worktree's node_modules.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WT=${WT:-/workspace/wt/parser}
S=${S:-/tmp/lpd-1a}
GD=/workspace/notes/lint/units/parser/grammar-diff
XGD=/workspace/notes/lint/units/parser/grammar-diff-oracle-and-causes/for-grammar-diff
HEAD_BIN=${HEAD_BIN:-/workspace/notes/lint/measure/parser/head/bun}
mkdir -p "$S/ext"
# 1. the probe: a crate outside the worktree that reads bun_js_parser by path (about 50 s of compiling, 1.1 GB in $S/target)
cp "$WT/Cargo.lock" "$HERE/lintprobe/Cargo.lock"
(cd "$WT" && /workspace/tools/lk cargo build --manifest-path "$HERE/lintprobe/Cargo.toml" --offline --target-dir "$S/target")
PROBE=$S/target/debug/lintprobe
# 2. the inputs: two lines per source (ts, tsx)
node "$HERE/mk09.cjs" "$XGD/targeted/09-checker-grammar.txt" "$S/corpus.targeted09.json"
cp "$GD/corpus.small.json" "$GD/corpus.targeted.json" "$S/"
for c in small targeted targeted09; do node "$HERE/mkhex.cjs" "$S/corpus.$c.json" "$S/$c.hex"; done
# 3. the oracles that grammar-diff/ does not hold yet: tsc with the grammar errors of its checker (oracle.mjs of
#    grammar-diff-oracle-and-causes/for-grammar-diff), and a parse without lint (harness.mjs with the release binary of the commit).
#    The tables of results/ were made with the files of the A1 run for small and targeted, which are made the same way.
mkdir -p "$S/gd" && cp "$GD/harness.mjs" "$XGD/oracle.mjs" "$S/gd/"
for c in small targeted targeted09; do
  [ -s "$S/ext/oracle.$c.jsonl.gz" ] || (cd "$S/gd" && bun oracle.mjs "$S/corpus.$c.json" "$S/ext/oracle.$c.jsonl.gz")
  [ -s "$S/ext/head.$c.jsonl.gz" ] || (cd "$S/gd" && "$HEAD_BIN" harness.mjs "$S/corpus.$c.json" "$S/ext/head.$c.jsonl.gz" --jobs=4)
done
# 4. the lint parses: 427,160 for each set of options, about a minute each (one process)
for c in small targeted targeted09; do for o in lint plain; do "$PROBE" "$S/$c.hex" "$S/new.$c.$o.tsv" "$o"; done; done
# 5. typescript-go over the same sources
for c in small targeted targeted09; do node "$HERE/mkgo.cjs" "$S/corpus.$c.json" "$S/go.$c.in.jsonl"; done
for c in small targeted targeted09; do /tmp/rr/parsediag-bu < "$S/go.$c.in.jsonl" > "$S/go.$c.out.jsonl"; done
# 6. the joins (j2: tsc, its checker, the parse without lint; j3: typescript-go too)
for c in small targeted targeted09; do node --max-old-space-size=8000 "$HERE/join2.cjs" "$S/corpus.$c.json" "$S/ext/oracle.$c.jsonl.gz" "$S/ext/head.$c.jsonl.gz" "$S/new.$c.lint.tsv" "$S/new.$c.plain.tsv" "$S/j2.$c.jsonl"; done
for c in small targeted targeted09; do node "$HERE/addgo.cjs" "$S/j2.$c.jsonl" "$S/go.$c.out.jsonl" "$S/j3.$c.jsonl" > "$S/addgo.$c.txt"; done
# 7. the tables
J="$S/j2.small.jsonl $S/j2.targeted.jsonl $S/j2.targeted09.jsonl"
R=$HERE/results
node "$HERE/verdictA.cjs" $J --ex=3 > "$R/classA.by-tsc-verdict.txt"
node "$HERE/classify.cjs" A $J --ex=3 > "$R/classA.by-place.txt"
node "$HERE/classify.cjs" B $J --ex=3 > "$R/classB.by-place.txt"
node "$HERE/groupB.cjs" $J --ex=3 > "$R/classB.by-tsc-code.txt"
node "$HERE/groupRR.cjs" $J --ex=2 > "$R/classRR.first-code.txt"
node "$HERE/summaryRR.cjs" $J > "$R/classRR.summary.txt"
node "$HERE/constructs.cjs" "$S/j2.small.jsonl" A > "$R/constructs.small.A.txt"
node "$HERE/constructs.cjs" "$S/j2.small.jsonl" B > "$R/constructs.small.B.txt"
# 8. the files of the repository (a lint parse of real code), and the hand-written lists of extra/
node "$HERE/realfiles.cjs" "$WT" "$S/real.hex" "$S/real.go.in.jsonl" "$S/real.tsc.jsonl"
"$PROBE" "$S/real.hex" "$S/real.lint.tsv" lint
"$PROBE" "$S/real.hex" "$S/real.plain.tsv" plain
/tmp/rr/parsediag-bu < "$S/real.go.in.jsonl" > "$S/real.go.out.jsonl"
for n in strict-map b3b4 after-as early; do LINTPROBE=$PROBE node "$HERE/extra/run.cjs" "$HERE/extra/$n.json" lint > "$HERE/extra/$n.lint.txt"; done
# 9. after a change of the parser: the same first error for every source, or the lines that changed
for c in small targeted targeted09; do zcat "$R/baseline/lint.$c.be1ebe5295.tsv.gz" | diff - "$S/new.$c.lint.tsv" | grep -c '^>' || true; done
