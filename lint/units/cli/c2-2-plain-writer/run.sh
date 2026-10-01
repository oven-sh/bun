#!/bin/sh
# src/lint/scanner.rs, tspath.rs and diagnosticwriter.rs against the functions of typescript-go that they port,
# run with Go: no build of Bun, no cargo, no lock. The Go side is the text of the reference functions, cut out
# of the checkout by extract.py; Go 1.24 to 1.26 have one Unicode edition (15.0.0) and one strings.EqualFold.
# usage: sh run.sh <scratch dir> [<directory of the three sources>] [<repository>] [<typescript-go checkout>]
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=${3:-/workspace/wt/cli}
src=$(cd "${2:-$repo/src/lint}" && pwd)
ref=${4:-/workspace/ref/typescript-go}
mkdir -p "$1" && cd "$1"
cp "$here"/*.py "$here"/*.go "$here"/*.rs .
R="rustup run nightly-2026-09-15"

for f in scanner.rs tspath.rs diagnosticwriter.rs; do $R rustfmt --edition 2024 --check "$src/$f"; done
echo "rustfmt: clean"
python3 comment_runs.py "$src/scanner.rs" "$src/tspath.rs" "$src/diagnosticwriter.rs" | tail -1

# The reference, as a program that answers one vector per line.
mkdir -p goref && python3 extract.py "$ref" > /dev/null && mv ref_gen.go goref/ && cp ref_main.go goref/main.go
printf 'module c22ref\n\ngo 1.24\n' > goref/go.mod
(cd goref && go build -o ../c22ref .)

# The three sources, tspath.rs with three wrappers that let the driver reach private functions.
mkdir -p gen gen_plain
cp "$src/scanner.rs" "$src/diagnosticwriter.rs" gen/
cp "$src/tspath.rs" gen_plain/tspath.rs
cat "$src/tspath.rs" - > gen/tspath.rs <<'EOT'

pub fn probe_encoded_root_length(path: &[u8]) -> isize {
    get_encoded_root_length(path)
}
pub fn probe_equate_string_case_insensitive(a: &[u8], b: &[u8]) -> bool {
    equate_string_case_insensitive(a, b)
}
pub fn probe_simple_fold_key(r: char) -> u32 {
    simple_fold_key(r)
}
EOT
$R rustc --edition 2024 --crate-type rlib --crate-name bun_core -O shim_bun_core.rs -o libbun_core.rlib
$R rustc --edition 2024 -O -D warnings -A dead_code probe_main.rs --extern bun_core=libbun_core.rlib -o c22probe

python3 gen_vectors.py > /dev/null
./c22ref < vectors.txt > v_go.txt
./c22probe < vectors.txt > v_rust.txt
cmp v_go.txt v_rust.txt && echo "$(wc -l < v_rust.txt) vectors: identical to the reference"
echo K | ./c22ref > k_go.txt
echo K | ./c22probe > k_rust.txt
cmp k_go.txt k_rust.txt && echo "fold keys of $(wc -l < k_rust.txt) code points: identical to unicode.SimpleFold"
echo O | ./c22ref > orbit_vectors.txt
./c22ref < orbit_vectors.txt > o_go.txt
./c22probe < orbit_vectors.txt > o_rust.txt
cmp o_go.txt o_rust.txt && echo "$(wc -l < o_rust.txt) pairs: identical to strings.EqualFold"

# The table of tspath.rs is what Go's tables give.
go run fold_table_gen.go | python3 fold_table_pack.py > table_go.txt
sed -n '/^static SIMPLE_FOLD/,/^];/p' "$src/tspath.rs" > table_rust.txt
cmp table_go.txt table_rust.txt && echo "SIMPLE_FOLD: identical to the table made from Go's unicode package"

# The unit tests inside the three files, against the stand-ins.
printf '#![allow(dead_code)]\n#[path = "gen_plain/tspath.rs"]\npub mod tspath;\n#[path = "gen/scanner.rs"]\npub mod scanner;\n#[path = "gen/diagnosticwriter.rs"]\npub mod diagnosticwriter;\n#[path = "standin_diagnostic.rs"]\npub mod diagnostic;\n' > unit_tests.rs
$R rustc --edition 2024 --test -D warnings -A dead_code unit_tests.rs --extern bun_core=libbun_core.rlib -o unit_tests
./unit_tests | tail -2 | head -1

# The lint levels of the workspace, with clippy-driver: the library and its tests.
python3 lint_flags.py "$repo/Cargo.toml" > flags.txt
grep -v 'bun_core::output::' "$repo/clippy.toml" > clippy.toml
CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-type lib --crate-name bun_lint lib_lints.rs \
  --extern bun_core=libbun_core.rlib --emit=metadata -o libbun_lint.rmeta $(cat flags.txt)
CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --test --crate-name bun_lint lib_lints.rs \
  --extern bun_core=libbun_core.rlib --emit=metadata -o bun_lint_test.rmeta $(cat flags.txt)
echo "clippy-driver with the lint levels of the workspace: clean"

# With a build tree: the flags of the build's own rustc call for bun_lint, the real bun_core and bun_ast, the
# diagnostic.rs of the repository (its call of Msg::code replaced when the cached bun_ast is older than it).
unit=$(ls "$repo"/build/debug/rust-target/units/bun_lint-*.json 2>/dev/null | head -1)
if [ -n "$unit" ]; then
  sed -e 's/msg\.code()/None::<u32>/' "$repo/src/lint/diagnostic.rs" > diagnostic_real.rs
  printf '//! The three modules with the diagnostic.rs of the repository.\n\n#[path = "%s/diagnostic_real.rs"]\npub mod diagnostic;\n#[path = "%s/diagnosticwriter.rs"]\npub mod diagnosticwriter;\n#[path = "%s/scanner.rs"]\npub mod scanner;\n#[path = "%s/tspath.rs"]\npub mod tspath;\n' "$PWD" "$src" "$src" "$src" > lib_real.rs
  mkdir -p out_real
  CMD_OUT=$PWD/cmd_real.sh python3 real_flags_cmd.py "$PWD/lib_real.rs" "$PWD/out_real" bun_core bun_ast > /dev/null
  sh cmd_real.sh && echo "rustc with the flags of the build, real bun_core and bun_ast: clean"
  sed -e 's#/bin/rustc #/bin/clippy-driver #' cmd_real.sh > cmd_real_clippy.sh
  CLIPPY_CONF_DIR=$repo sh cmd_real_clippy.sh && echo "clippy-driver with the same flags and the clippy.toml of the repository: clean"
fi
