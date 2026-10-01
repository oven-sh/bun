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
node "$HERE/mk09.cjs" "$XGD/targeted/09-checker-grammar.txt" "$S/ext/oracle.targeted.jsonl.gz" "$S/corpus.targeted09.json" "$S/oracle.targeted09.jsonl.gz" 2>/dev/null || true
node "$HERE/mkhex.cjs" "$GD/corpus.small.json" "$S/small.hex"
node "$HERE/mkhex.cjs" "$GD/corpus.targeted.json" "$S/targeted.hex"
# 3. the oracles that grammar-diff/ does not hold yet: tsc with the grammar errors of its checker, and a parse without lint
#    (the A1 run makes the same files; they were taken from it here)
if [ ! -s "$S/ext/oracle.small.jsonl.gz" ]; then
  mkdir -p "$S/gd" && cp -r "$GD"/. "$S/gd/" && cp -r "$XGD"/. "$S/gd/"
  (cd "$S/gd" && bun targeted.mjs >/dev/null 2>&1; true)
  (cd "$S/gd" && bun oracle.mjs corpus.small.json "$S/ext/oracle.small.jsonl.gz" && bun oracle.mjs corpus.targeted.json "$S/ext/oracle.targeted.jsonl.gz")
  (cd "$S/gd" && "$HEAD_BIN" harness.mjs corpus.small.json "$S/ext/head.small.jsonl.gz" --jobs=4 && "$HEAD_BIN" harness.mjs corpus.targeted.json "$S/ext/head.targeted.jsonl.gz" --jobs=4)
fi
node "$HERE/mk09.cjs" "$XGD/targeted/09-checker-grammar.txt" "$S/ext/oracle.targeted.jsonl.gz" "$S/corpus.targeted09.json" "$S/oracle.targeted09.jsonl.gz"
node "$HERE/mkhex.cjs" "$S/corpus.targeted09.json" "$S/targeted09.hex"
# 4. the lint parses: 427,160 for each set of options, about a minute each (one process)
for c in small targeted targeted09; do for o in lint plain; do "$PROBE" "$S/$c.hex" "$S/new.$c.$o.tsv" "$o"; done; done
# 5. typescript-go over the same sources
node "$HERE/mkgo.cjs" "$GD/corpus.small.json" "$S/go.small.in.jsonl"
node "$HERE/mkgo.cjs" "$GD/corpus.targeted.json" "$S/go.targeted.in.jsonl"
node "$HERE/mkgo.cjs" "$S/corpus.targeted09.json" "$S/go.targeted09.in.jsonl"
for c in small targeted targeted09; do /tmp/rr/parsediag-bu < "$S/go.$c.in.jsonl" > "$S/go.$c.out.jsonl"; done
# 6. the joins (j2: tsc, its checker, the parse without lint; j3: typescript-go too)
node --max-old-space-size=8000 "$HERE/join2.cjs" "$GD/corpus.small.json" "$S/ext/oracle.small.jsonl.gz" "$S/ext/head.small.jsonl.gz" "$S/new.small.lint.tsv" "$S/new.small.plain.tsv" "$S/j2.small.jsonl"
node "$HERE/join2.cjs" "$GD/corpus.targeted.json" "$S/ext/oracle.targeted.jsonl.gz" "$S/ext/head.targeted.jsonl.gz" "$S/new.targeted.lint.tsv" "$S/new.targeted.plain.tsv" "$S/j2.targeted.jsonl"
node "$HERE/join2.cjs" "$S/corpus.targeted09.json" "$S/ext/oracle.targeted.jsonl.gz" "$S/ext/head.targeted.jsonl.gz" "$S/new.targeted09.lint.tsv" "$S/new.targeted09.plain.tsv" "$S/j2.targeted09.jsonl"
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
