#!/bin/sh
# src/lint/rules/no_dupe_keys.rs: its format, its comments, the compiler and clippy-driver on it against stand-ins of what it reads,
# its logic over hand-made property lists, and its cases through ESLint at the pin and the probe of the research.
# Needs no build of Bun, no cargo and no lock. The stand-ins are not the real crates: only the build says that the file compiles there.
# usage: sh run.sh <scratch dir> [<repository>]      PROBE and ESLINT name the probe and the checkout of ESLint with its dependencies
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=${2:-/workspace/wt/cli}
lint=$(cd "$repo/src/lint" && pwd)
notes=$(cd "$here/.." && pwd)
final=$notes/c3-rule-support-unification/final
rule=$lint/rules/no_dupe_keys.rs
fixture=$repo/test/cli/lint/rules/no-dupe-keys.json
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
CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-name no_dupe_keys_checks main.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o checks.rmeta $(cat flags.txt)
echo "clippy-driver with the lint levels of the workspace: clean"
# A control: the same call rejects a std HashMap in the file.
mkdir -p control/rules
sed 's|^    let properties = node.properties.as_slice();|    let _map: std::collections::HashMap<u8, u8> = std::collections::HashMap::new();\n&|' "$rule" > control/rules/no_dupe_keys.rs
if cmp -s "$rule" control/rules/no_dupe_keys.rs; then echo "the control changed nothing"; exit 1; fi
sed "s#LINT_DIR#$PWD/control#g" "$here/main.rs" > main_control.rs
if CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-name no_dupe_keys_control main_control.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o control.rmeta $(cat flags.txt) > control.log 2>&1; then
  echo "clippy-driver takes a std HashMap: the lints are not live"; exit 1
fi
grep -q 'disallowed type `std::collections::HashMap`' control.log && echo "control with a std HashMap in the file: rejected"

# A sort that is not stable moves a report, and the checks say so.
mkdir -p unstable/rules
sed 's/keys\.sort_by(/keys.sort_unstable_by(/' "$rule" > unstable/rules/no_dupe_keys.rs
if cmp -s "$rule" unstable/rules/no_dupe_keys.rs; then echo "no sort_by to replace"; exit 1; fi
sed "s#LINT_DIR#$PWD/unstable#g" "$here/main.rs" > main_unstable.rs
$R rustc --edition 2024 main_unstable.rs --extern bun_ast=libbun_ast.rlib -o checks_unstable
if ./checks_unstable > unstable.log 2>&1; then echo "the checks hold with sort_unstable_by"; exit 1; fi
echo "with sort_unstable_by a check fails, as it should"

# The cases of the fixture: ESLint at the pin against the probe, which has the text of the research and not this file.
probe=${PROBE:-/tmp/c3final/out/lintprobe}
eslint=${ESLINT:-/tmp/cmp-probe/eslint-pin}
if [ ! -x "$probe" ] || [ ! -d "$eslint" ]; then echo "no probe or no ESLint: the cases were not run ($final/HOWTO.txt makes both)"; exit 0; fi
node "$final/oracle/diff.cjs" no-dupe-keys --probe "$probe" --eslint "$eslint" --show --out vectors.json "$fixture" | tee diff.log
# The body of test/cli/lint/rules.test.ts over the probe's reports as plain lines.
mkdir -p sim/fixtures && cp "$final/simulate-test.cjs" sim/ && cp "$fixture" sim/fixtures/
node sim/simulate-test.cjs "$probe"
