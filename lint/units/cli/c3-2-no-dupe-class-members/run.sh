#!/bin/sh
# src/lint/rules/no_dupe_class_members.rs: its format, its comments, the compiler and clippy-driver on it against stand-ins of what it
# reads, its logic over hand-made member lists, and its cases through ESLint at the pin and the probe of the research.
# Needs no build of Bun, no cargo and no lock. The stand-ins are not the real crates: only the build says that the file compiles there.
# usage: sh run.sh <scratch dir> [<repository>]      PROBE and ESLINT name the probe and the checkout of ESLint with its dependencies
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=${2:-/workspace/wt/cli}
lint=$(cd "$repo/src/lint" && pwd)
notes=$(cd "$here/.." && pwd)
final=$notes/c3-rule-support-unification/final
rule=$lint/rules/no_dupe_class_members.rs
fixture=$repo/test/cli/lint/rules/no-dupe-class-members.json
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
CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-name no_dupe_class_members_checks main.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o checks.rmeta $(cat flags.txt)
echo "clippy-driver with the lint levels of the workspace: clean"
# A control: the same call rejects a std HashMap in the file.
mkdir -p control/rules
sed 's|^    let properties = class.properties.slice();|    let _map: std::collections::HashMap<u8, u8> = std::collections::HashMap::new();\n&|' "$rule" > control/rules/no_dupe_class_members.rs
if cmp -s "$rule" control/rules/no_dupe_class_members.rs; then echo "the control changed nothing"; exit 1; fi
sed "s#LINT_DIR#$PWD/control#g" "$here/main.rs" > main_control.rs
if CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-name no_dupe_class_members_control main_control.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o control.rmeta $(cat flags.txt) > control.log 2>&1; then
  echo "clippy-driver takes a std HashMap: the lints are not live"; exit 1
fi
grep -q 'disallowed type `std::collections::HashMap`' control.log && echo "control with a std HashMap in the file: rejected"

# Faults put into the file on purpose: the checks fail on each.
fault() {
  mkdir -p "fault$1/rules"
  sed "$2" "$rule" > "fault$1/rules/no_dupe_class_members.rs"
  if cmp -s "$rule" "fault$1/rules/no_dupe_class_members.rs"; then echo "fault $1 changed nothing"; exit 1; fi
  sed "s#LINT_DIR#$PWD/fault$1#g" "$here/main.rs" > "main_fault$1.rs"
  $R rustc --edition 2024 "main_fault$1.rs" --extern bun_ast=libbun_ast.rlib -o "checks_fault$1" 2> "fault$1.build.log"
  if "./checks_fault$1" > "fault$1.log" 2>&1; then echo "the checks hold with fault $1 ($3)"; exit 1; fi
  echo "fault $1 ($3): a check fails, as it should"
}
fault 1 's/members\.sort_by(/members.sort_unstable_by(/' 'a sort that is not stable'
fault 2 's/^        if !is_static$/        if true/' 'a static method named constructor taken for the constructor'
fault 3 's/^            && !property\.flags\.contains(Flag::IsComputed)$//' 'a computed key named constructor taken for the constructor'
fault 4 's/^            && name\.bytes() == b"constructor"$//' 'every member that is not static and not computed taken for the constructor'
fault 5 's/G::PropertyKind::Get => (INIT | GET, GET),/G::PropertyKind::Get => (INIT | GET | SET, GET),/' 'a getter after a setter reported'
fault 6 's/G::PropertyKind::Set => (INIT | SET, SET),/G::PropertyKind::Set => (INIT, SET),/' 'a second setter not reported'
fault 7 's/G::PropertyKind::Normal => (INIT | GET | SET, INIT),/G::PropertyKind::Normal => (INIT, INIT),/' 'a method after an accessor not reported'
fault 8 's/        (self\.name\.bytes(), self\.is_static)/        (self.name.bytes(), false)/' 'one state for the static members and the others'
fault 9 's/            _ => continue,/            _ => (INIT | GET | SET, INIT),/' 'an auto-accessor counted as a field'
fault 10 's/    if properties\.len() < 2 {/    if properties.len() < 3 {/' 'a class of two members not read'

# The cases of the fixture: ESLint at the pin against the probe, which has the text of the research and not this file.
probe=${PROBE:-/tmp/c3final/out/lintprobe}
eslint=${ESLINT:-/tmp/cmp-probe/eslint-pin}
if [ ! -x "$probe" ] || [ ! -d "$eslint" ]; then echo "no probe or no ESLint: the cases were not run ($final/HOWTO.txt makes both)"; exit 0; fi
ASAN_OPTIONS=detect_leaks=0 node "$final/oracle/diff.cjs" no-dupe-class-members --probe "$probe" --eslint "$eslint" --out vectors.json "$fixture" | tee diff.log
node "$notes/c3-2-valid-typeof/check-fixture.cjs" "$fixture" vectors.json
# The cases that were added to those of the research are in the fixture.
node -e '
const added = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).map(c => (typeof c === "string" ? { code: c } : c));
const have = new Set(JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")).map(c => (c.jsx ? "J" : "") + c.code));
const lost = added.filter(c => !have.has((c.jsx ? "J" : "") + c.code));
console.log(`${added.length} added cases, ${lost.length} of them not in the fixture`);
process.exit(lost.length ? 1 : 0);
' "$final/cases/added-no-dupe-class-members.json" "$fixture"
# Every code of the test that ESLint has of the rule is a case of the fixture, and is marked: but the one that is TypeScript.
node "$final/oracle/extract.cjs" no-dupe-class-members --all > eslint-test-codes.json
node -e '
const codes = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const fixture = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const marked = new Set(fixture.filter(c => c.eslintTest).map(c => c.code));
const lost = codes.filter(c => !marked.has(c));
const extra = [...marked].filter(c => !codes.includes(c));
const typescript = lost.filter(c => c.includes("foo(a: string): string;"));
console.log(`${codes.length} codes in the test of ESLint, ${lost.length} of them not in the fixture (${typescript.length} with overload signatures of TypeScript), ${extra.length} cases marked that are not among them`);
process.exit(lost.length !== 1 || typescript.length !== 1 || extra.length ? 1 : 0);
' eslint-test-codes.json "$fixture"
# The body of test/cli/lint/rules.test.ts over the reports of the probe as plain lines.
node "$notes/c3-2-valid-typeof/simulate.cjs" no-dupe-class-members "$repo/test/cli/lint/rules" "$probe"
# What API.md says of the two parsers, of comments and of spans: the inputs of parser-cases.json, each with its answer.
ASAN_OPTIONS=detect_leaks=0 node "$final/oracle/diff.cjs" no-dupe-class-members --probe "$probe" --eslint "$eslint" --out parser-vectors.json "$here/parser-cases.json" > parser-diff.log
node "$here/check-parser-cases.cjs" "$here/parser-cases.json" parser-vectors.json
