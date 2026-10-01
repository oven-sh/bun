#!/bin/sh
# src/lint/rules/valid_typeof.rs: its format, its comments, the compiler and clippy-driver on it against stand-ins of what it reads,
# its logic over hand-made comparisons, and its cases through ESLint at the pin and the probe of the research.
# Needs no build of Bun, no cargo and no lock. The stand-ins are not the real crates: only the build says that the file compiles there.
# usage: sh run.sh <scratch dir> [<repository>]      PROBE and ESLINT name the probe and the checkout of ESLint with its dependencies
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=${2:-/workspace/wt/cli}
lint=$(cd "$repo/src/lint" && pwd)
notes=$(cd "$here/.." && pwd)
final=$notes/c3-rule-support-unification/final
rule=$lint/rules/valid_typeof.rs
fixture=$repo/test/cli/lint/rules/valid-typeof.json
mkdir -p "$1" && cd "$1"
R="rustup run nightly-2026-09-15"

$R rustfmt --edition 2024 --check "$rule" && echo "rustfmt: clean"
python3 "$notes/c2-sort-dedupe-probe/comment_runs.py" "$rule"

# The file as a module of a crate that has stand-ins for what it reads, with every warning an error.
$R rustc --edition 2024 --crate-type rlib --crate-name bun_ast -D warnings "$here/shim_bun_ast.rs" -o libbun_ast.rlib
sed "s#LINT_DIR#$lint#g" "$here/main.rs" > main.rs
$R rustc --edition 2024 -D warnings main.rs --extern bun_ast=libbun_ast.rlib -o checks
./checks

# The lint levels of the workspace, with clippy-driver and the clippy.toml of the repository.
python3 "$notes/c2-sort-dedupe-probe/lint_flags.py" "$repo/Cargo.toml" > flags.txt
grep -v 'bun_core::output::' "$repo/clippy.toml" > clippy.toml
CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-name valid_typeof_checks main.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o checks.rmeta $(cat flags.txt)
echo "clippy-driver with the lint levels of the workspace: clean"
# A control: the same call rejects a std HashMap in the file.
mkdir -p control/rules
sed 's|^    if !is_equality(node.op) {|    let _map: std::collections::HashMap<u8, u8> = std::collections::HashMap::new();\n&|' "$rule" > control/rules/valid_typeof.rs
if cmp -s "$rule" control/rules/valid_typeof.rs; then echo "the control changed nothing"; exit 1; fi
sed "s#LINT_DIR#$PWD/control#g" "$here/main.rs" > main_control.rs
if CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-name valid_typeof_control main_control.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o control.rmeta $(cat flags.txt) > control.log 2>&1; then
  echo "clippy-driver takes a std HashMap: the lints are not live"; exit 1
fi
grep -q 'disallowed type `std::collections::HashMap`' control.log && echo "control with a std HashMap in the file: rejected"

# Four faults put into the file on purpose: the checks fail on each.
fault() {
  mkdir -p "fault$1/rules"
  sed "$2" "$rule" > "fault$1/rules/valid_typeof.rs"
  if cmp -s "$rule" "fault$1/rules/valid_typeof.rs"; then echo "fault $1 changed nothing"; exit 1; fi
  sed "s#LINT_DIR#$PWD/fault$1#g" "$here/main.rs" > "main_fault$1.rs"
  $R rustc --edition 2024 "main_fault$1.rs" --extern bun_ast=libbun_ast.rlib -o "checks_fault$1" 2> "fault$1.build.log"
  if "./checks_fault$1" > "fault$1.log" 2>&1; then echo "the checks hold with fault $1 ($3)"; exit 1; fi
  echo "fault $1 ($3): a check fails, as it should"
}
fault 1 's/| b"bigint"/| b"bigInt"/' 'a type name misspelled'
fault 2 's/check_sibling(context, &node.right);/check_sibling(context, \&node.left);/' 'the typeof itself checked for a typeof on the left'
fault 3 's/        | ExprData::ENull(_)$//' 'null is no literal'
fault 4 's/            Globals::UNDEFINED$/            Globals::NONE/' 'undefined reported without waiting for its declarations'

# The cases of the fixture: ESLint at the pin against the probe, which has the text of the research and not this file.
probe=${PROBE:-/tmp/c3final/out/lintprobe}
eslint=${ESLINT:-/tmp/cmp-probe/eslint-pin}
if [ ! -x "$probe" ] || [ ! -d "$eslint" ]; then echo "no probe or no ESLint: the cases were not run ($final/HOWTO.txt makes both)"; exit 0; fi
ASAN_OPTIONS=detect_leaks=0 node "$final/oracle/diff.cjs" valid-typeof --probe "$probe" --eslint "$eslint" --out vectors.json "$fixture" | tee diff.log
node "$here/check-fixture.cjs" "$fixture" vectors.json
# The cases that were added to those of the research are in the fixture.
node -e '
const added = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).map(c => (typeof c === "string" ? { code: c } : c));
const have = new Set(JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")).map(c => (c.jsx ? "J" : "") + c.code));
const lost = added.filter(c => !have.has((c.jsx ? "J" : "") + c.code));
console.log(`${added.length} added cases, ${lost.length} of them not in the fixture`);
process.exit(lost.length ? 1 : 0);
' "$final/cases/added-valid-typeof.json" "$fixture"
# Every code of the test that ESLint has of the rule is a case of the fixture, and is marked.
node "$final/oracle/extract.cjs" valid-typeof --all > eslint-test-codes.json
node -e '
const codes = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const fixture = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const marked = new Set(fixture.filter(c => c.eslintTest).map(c => c.code));
const lost = codes.filter(c => !marked.has(c));
const extra = [...marked].filter(c => !codes.includes(c));
console.log(`${codes.length} codes in the test of ESLint, ${lost.length} of them not in the fixture, ${extra.length} cases marked that are not among them`);
process.exit(lost.length || extra.length ? 1 : 0);
' eslint-test-codes.json "$fixture"
# The body of test/cli/lint/rules.test.ts over the reports of the probe as plain lines.
node "$here/simulate.cjs" valid-typeof "$repo/test/cli/lint/rules" "$probe"
