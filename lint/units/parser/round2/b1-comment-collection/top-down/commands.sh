#!/bin/sh
# Probes of the research on the comment list of a lint parse (round 2, B1, the list). Nothing is written into the worktree.
# Tree: /workspace/wt/parser at be1ebe5295. tsc 6.0.2 from /workspace/wt/parser/node_modules/typescript.
# The scratch test binaries need the target directory that `cargo test -p bun_js_parser --lib` left in the worktree.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
N=/workspace/notes/lint/units/parser
S=${S:-/tmp/b1cc}
mkdir -p "$S/in" "$S/src" "$S/out" "$S-base/src" "$S-base/out"

# 1. Two scratch copies of the crate: the tree as it is with the probe of a parse WITHOUT lint, and the tree with the edits.
rm -rf "$S-base/src/js_parser" "$S/src/js_parser"
cp -r /workspace/wt/parser/src/js_parser "$S-base/src/js_parser"
cp -r /workspace/wt/parser/src/js_parser "$S/src/js_parser"
cp "$HERE/zz_plain.rs" "$S-base/src/js_parser/"
printf '\n#[cfg(test)]\nmod zz_plain;\n' >> "$S-base/src/js_parser/lib.rs"
python3 "$HERE/apply-prototype.py" "$S/src/js_parser"
cp "$HERE/comments.rs" "$S/src/js_parser/parse/comments.rs"
python3 "$HERE/apply-toggles.py" "$S/src/js_parser"
python3 "$HERE/add-print-tests.py" "$S/src/js_parser"
cp "$HERE/zz_plain.rs" "$HERE/zz_probe.rs" "$S/src/js_parser/"
printf '\n#[cfg(test)]\nmod zz_plain;\n#[cfg(test)]\nmod zz_probe;\n' >> "$S/src/js_parser/lib.rs"
/workspace/tools/lk sh "$HERE/build.sh" "$S-base"
/workspace/tools/lk sh "$HERE/build.sh" "$S"

# 2. The edits keep the tests of the crate: 70 of the tree, 6 that print, 2 probes. Must end with `78 passed; 0 failed`.
"$S/out/bun_js_parser" | tail -2

# 3. The oracle: the comments of each source as tsc sees them (leading and trailing comment ranges of every token).
cd "$HERE"
node oracle.cjs "$S/in/all" $N/lexer-lint-hooks/bottom-up/comments-inputs.json $N/lexer-lint-hooks/top-down/comments-inputs.json \
  $N/round2/comments-capture/inputs.json $N/round2/comments-capture/inputs2.json \
  $N/round2/comments-capture/top-down/extra-inputs.json $N/round2/comments-capture/top-down/records-inputs.json b1-extra.json b1-misc.json
diff "$S/in/all.tsc.tsv" all.tsc.tsv

# 4. The lint parse with the edits against the oracle. Must print: same 267, lint parse rejects 3, tsc rejects 5, and no DIFF line.
B1_INPUTS="$S/in/all.hex" B1_OUT="$S/in/all.lint.tsv" "$S/out/bun_js_parser" zz_probe > /dev/null
node compare.cjs "$S/in/all.tsc.tsv" "$S/in/all.lint.tsv"
# The same with the first token read while comments were tracked (no second reading of the start of the file): the same bytes.
B1_PRIMED=1 B1_INPUTS="$S/in/all.hex" B1_OUT="$S/in/all.lint-primed.tsv" "$S/out/bun_js_parser" zz_probe > /dev/null
cmp "$S/in/all.lint.tsv" "$S/in/all.lint-primed.tsv"

# 5. Each part of the change is needed: with one part off, only `only-tsc` differences (toggles.expected.txt has the four runs, with the benchmark fixture added).
for bits in 1 2 4; do
  B1_DISABLE=$bits B1_INPUTS="$S/in/all.hex" B1_OUT="$S/in/all.lint-d$bits.tsv" "$S/out/bun_js_parser" zz_probe > /dev/null
  node compare.cjs "$S/in/all.tsc.tsv" "$S/in/all.lint-d$bits.tsv" | head -1
done

# 6. Every tracked TypeScript and JavaScript file under test/ and src/js (JavaScript is read with the jsx loader, as tsc reads it).
#    Result on 2026-10-01: ts 3208 same, 3 both reject, 3 only the lint parse rejects; js 7445 same, 75 both reject, 28 only the lint
#    parse rejects (Flow and TypeScript syntax in .js files); no file with a different list; 134,665 comments.
for kind in ts js; do
  node sweep-list.cjs /workspace/wt/parser "$S/in/sweep-$kind" $kind
  B1_INPUTS="$S/in/sweep-$kind.list" B1_OUT="$S/in/sweep-$kind.lint.tsv" "$S/out/bun_js_parser" zz_probe > /dev/null
  node compare.cjs "$S/in/sweep-$kind.tsc.tsv" "$S/in/sweep-$kind.lint.tsv" --show 5
done

# 7. What a parse WITHOUT lint records under minify_identifiers (Lexer::all_comments after the parse pass): the tree as it is and
#    the tree with the edits give the same bytes, for the inputs of 3 and for the files of 6.
for set in all.hex sweep-ts.list sweep-js.list; do
  B1_INPUTS="$S/in/$set" B1_PLAIN_OUT="$S/in/$set.plain-base.tsv" "$S-base/out/bun_js_parser" zz_plain > /dev/null
  B1_INPUTS="$S/in/$set" B1_PLAIN_OUT="$S/in/$set.plain-patched.tsv" "$S/out/bun_js_parser" zz_plain > /dev/null
  cmp "$S/in/$set.plain-base.tsv" "$S/in/$set.plain-patched.tsv" && echo "a parse without lint records the same: $set"
done

# 8. The records beside comments (rec/prints.prototype.txt) against the nodes of tsc (rec/nodes-all.txt, rec/cases.json):
"$S/out/bun_js_parser" zz_b1_print --nocapture --test-threads=1 > "$S/in/prints.txt" 2>&1 || true
node rec/nodes-all.cjs rec/cases.json | diff - rec/nodes-all.txt

# 9. Rows for a Rust table from the inputs that tsc and the lint parse read the same way (test-rows.txt).
node make-test-rows.cjs b1-extra.json "$S/in/all.tsc.tsv" "$S/in/all.lint.tsv" b1_extra > "$S/in/test-rows.txt"
