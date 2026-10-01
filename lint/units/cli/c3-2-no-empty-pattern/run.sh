#!/bin/sh
# src/lint/rules/no_empty_pattern.rs: its format, its comments, the compiler and clippy-driver on it inside a copy of the crate
# against the .rmeta files of the debug build, the same against stand-ins with its logic over hand-made patterns, and its cases
# through ESLint at the pin and the probe of the research.
# Needs no build of Bun and no cargo, and writes nothing into the repository. Only the build says that the workspace compiles
# and that `bun --lint` prints what the cases expect.
# usage: sh run.sh <scratch dir> [<repository>]      PROBE and ESLINT name the probe and the checkout of ESLint with its dependencies
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=${2:-/workspace/wt/cli}
lint=$(cd "$repo/src/lint" && pwd)
notes=$(cd "$here/.." && pwd)
final=$notes/c3-rule-support-unification/final
rule=$lint/rules/no_empty_pattern.rs
fixture=$repo/test/cli/lint/rules/no-empty-pattern.json
mkdir -p "$1" && cd "$1"
scratch=$PWD
R="rustup run nightly-2026-09-15"
# One heavy command at a time on the machine: the two checks against the build directory wait for it, at most 15 minutes.
LK="flock -w 900 /workspace/tools/heavy.lock"

$R rustfmt --edition 2024 --check "$rule" && echo "rustfmt: clean"
python3 "$notes/c2-sort-dedupe-probe/comment_runs.py" "$rule"

# The code of the file is the text of the research, which is what the probe has.
grep -v '^[[:space:]]*//' "$rule" > code.rs
grep -v '^[[:space:]]*//' "$final/src-lint/rules/no_empty_pattern.rs" > research.rs
cmp code.rs research.rs && echo "comments apart, the file is the text of the research"

echo "== 1. the file inside a copy of the crate, against the .rmeta files of the debug build"
$LK python3 "$here/check-real.py" "$scratch/real" "$repo"
CLIPPY=1 $LK python3 "$here/check-real.py" "$scratch/real" "$repo"
# Controls: a copy of src/lint with a fault in the file. The same check has to reject each, for the reason that is named.
control() {
  rm -rf "control$1" && mkdir -p "control$1/src" && cp -r "$lint" "control$1/src/lint"
  ln -s "$repo/build" "control$1/build" && ln -s "$repo/clippy.toml" "control$1/clippy.toml"
  sed "$2" "$rule" > "control$1/src/lint/rules/no_empty_pattern.rs"
  if cmp -s "$rule" "control$1/src/lint/rules/no_empty_pattern.rs"; then echo "control $1 changed nothing"; exit 1; fi
  if env "$4" $LK python3 "$here/check-real.py" "$scratch/control$1/scratch" "$scratch/control$1" > "control$1.log" 2>&1; then
    echo "the check takes control $1 ($3)"; exit 1
  fi
  grep -q "$5" "control$1.log" || { echo "control $1 ($3) fails for another reason"; cat "control$1.log"; exit 1; }
  echo "control $1 ($3): rejected, $(grep -c "$5" "control$1.log") lines with $5"
}
control 1 's/node\.items\.slice()/node.items.slices()/' 'a method that the list of a binding does not have' 'CLIPPY=' 'no_empty_pattern.rs:.*E0599'
control 2 's/pub(crate) fn e_object(/pub(crate) fn e_objects(/' 'a handler under another name' 'CLIPPY=' 'E0425'
control 3 's/loc: Loc) {/loc: \&Loc) {/' 'the place by reference' 'CLIPPY=' 'E0308'
control 4 's|^    if node\.items\.slice()\.is_empty() {|    let _map: std::collections::HashMap<u8, u8> = std::collections::HashMap::new();\n&|' 'a std HashMap in the file, for clippy-driver' 'CLIPPY=1' 'no_empty_pattern.rs:.*disallowed'

echo "== 2. the file against stand-ins of what it reads, every warning an error, and its logic over hand-made patterns"
$R rustc --edition 2024 --crate-type rlib --crate-name bun_ast -D warnings "$here/shim_bun_ast.rs" -o libbun_ast.rlib
sed "s#LINT_DIR#$lint#g" "$here/main.rs" > main.rs
$R rustc --edition 2024 -D warnings main.rs --extern bun_ast=libbun_ast.rlib -o checks
./checks
# Faults put into the file on purpose: the checks fail on each.
fault() {
  mkdir -p "fault$1/rules"
  sed "$2" "$rule" > "fault$1/rules/no_empty_pattern.rs"
  if cmp -s "$rule" "fault$1/rules/no_empty_pattern.rs"; then echo "fault $1 changed nothing"; exit 1; fi
  sed "s#LINT_DIR#$PWD/fault$1#g" "$here/main.rs" > "main_fault$1.rs"
  $R rustc --edition 2024 "main_fault$1.rs" --extern bun_ast=libbun_ast.rlib -o "checks_fault$1" 2> "fault$1.build.log"
  if "./checks_fault$1" > "fault$1.log" 2>&1; then echo "the checks hold with fault $1 ($3)"; exit 1; fi
  echo "fault $1 ($3): $(grep -c FAILED "fault$1.log") checks fail, as they should"
}
fault 1 's/if node\.items\.slice()\.is_empty() {/if !node.items.slice().is_empty() {/' 'a binding with elements reported, an empty one not'
fault 2 's/if node\.properties\.as_slice()\.is_empty() {/if node.properties.as_slice().len() <= 1 {/' 'an assignment target with one property reported'
fault 3 's/b"Unexpected empty array pattern\."/b"Unexpected empty object pattern."/' 'the text of the object for an array'
fault 4 's/if node\.items\.as_slice()\.is_empty() {/if node.items.as_slice().iter().all(|item| item.is_missing) {/' 'an assignment target of holes reported'
fault 5 's/context\.report(&RULE, loc, b"Unexpected empty object pattern\.");/context.report(\&RULE, Loc { start: loc.start.wrapping_add(1) }, b"Unexpected empty object pattern.");/' 'the place of an object moved by one'

echo "== 3. the cases: ESLint at the pin against the probe, which has the text of the research and not this file"
probe=${PROBE:-/tmp/c3final/out/lintprobe}
eslint=${ESLINT:-/tmp/cmp-probe/eslint-pin}
if [ ! -x "$probe" ] || [ ! -d "$eslint" ]; then echo "no probe or no ESLint: the cases were not run ($final/HOWTO.txt makes both)"; exit 0; fi
export ASAN_OPTIONS=detect_leaks=0
node "$final/oracle/diff.cjs" no-empty-pattern --probe "$probe" --eslint "$eslint" --show --out vectors.json "$fixture" > diff.log
cat diff.log
node "$notes/c3-2-valid-typeof/check-fixture.cjs" "$fixture" vectors.json
# The codes of the test that ESLint has of the rule: which are cases of the fixture and marked.
node "$final/oracle/extract.cjs" no-empty-pattern --all > eslint-test-codes.json
node -e '
const codes = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const fixture = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const marked = new Set(fixture.filter(c => c.eslintTest).map(c => c.code));
const lost = codes.filter(c => !marked.has(c));
const extra = [...marked].filter(c => !codes.includes(c));
console.log(`${codes.length} codes in the test of ESLint, ${lost.length} of them not in the fixture, ${extra.length} cases marked that are not among them`);
for (const c of lost) console.log("  not in the fixture: " + JSON.stringify(c));
' eslint-test-codes.json "$fixture"
# Code that is not in the fixture: the four of ESLint that are not in it, and what the walk can reach a pattern through.
node "$final/oracle/diff.cjs" no-empty-pattern --probe "$probe" --eslint "$eslint" --show --out outside.json "$here/outside-the-fixture.json" > outside.log
cat outside.log
node -e '
const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const n = f => v.filter(f).length;
const differ = n(c => c.differs && !/reject/.test(c.differs));
console.log(`outside the fixture: ${v.length} cases, ${n(c => c.expect && c.expect.length)} with a report of the probe, ${n(c => /reject/.test(c.differs || ""))} that a parser rejects, ${differ} where both parse and the answers differ`);
process.exit(differ ? 1 : 0);
' outside.json
# A left side in parentheses or of a compound assignment: ESLint has no answer, its parser rejects the code.
node "$final/oracle/diff.cjs" no-empty-pattern --probe "$probe" --eslint "$eslint" --show --out parenthesized.vectors.json "$here/parenthesized.json" > parenthesized.log
cat parenthesized.log
# The body of test/cli/lint/rules.test.ts over the reports of the probe as plain lines, and the lines of this rule in the cases of the other rules.
node "$here/simulate.cjs" no-empty-pattern "$repo/test/cli/lint/rules" "$probe"
