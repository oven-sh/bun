#!/bin/sh
# The order and the deduplication of src/lint (diagnostic.rs, program.rs) against the functions of typescript-go (89d5d5b), run with Go.
# The Go functions are cut out of the reference by line number; only the package qualifiers are removed. Needs no build of Bun, no cargo and no lock.
# usage: sh run.sh <scratch dir> [<repository>] [cases] [seed]
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=${2:-/workspace/wt/cli}
lint=$(cd "$repo/src/lint" && pwd)
ref=${REF:-/workspace/ref/typescript-go}
cases=${3:-20000}
seed=${4:-20260930}
mkdir -p "$1" && cd "$1"
R="rustup run nightly-2026-09-15"

$R rustfmt --edition 2024 --check "$lint/program.rs" "$lint/diagnostic.rs" && echo "rustfmt: clean"
python3 "$here/comment_runs.py" "$lint/program.rs" "$lint/diagnostic.rs"

# The two files as modules of one crate, against a stand-in of bun_ast and of crate::scanner.
$R rustc --edition 2024 --crate-type rlib --crate-name bun_ast "$here/shim_bun_ast.rs" -o libbun_ast.rlib
printf '//! `diagnostic.rs` and `program.rs` as the crate has them.\n\n#[path = "%s/diagnostic.rs"]\npub mod diagnostic;\n#[path = "%s/program.rs"]\npub mod program;\npub mod scanner {\n    pub fn compute_ecma_line_starts(_text: &[u8]) -> Vec<u32> {\n        vec![0]\n    }\n}\n' "$lint" "$lint" > lib_lints.rs
$R rustc --edition 2024 --test -D warnings lib_lints.rs --extern bun_ast=libbun_ast.rlib -o unit_tests
./unit_tests | tail -2 | head -1

# The lint levels of the workspace, with clippy-driver: the library and its tests.
python3 "$here/lint_flags.py" "$repo/Cargo.toml" > flags.txt
grep -v 'bun_core::output::' "$repo/clippy.toml" > clippy.toml
CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --crate-type lib --crate-name bun_lint lib_lints.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o libbun_lint.rmeta $(cat flags.txt)
CLIPPY_CONF_DIR=$PWD $R clippy-driver --edition 2024 --test --crate-name bun_lint lib_lints.rs \
  --extern bun_ast=libbun_ast.rlib --emit=metadata -o bun_lint_test.rmeta $(cat flags.txt)
echo "clippy-driver with the lint levels of the workspace: clean"

# The reference: its struct, its accessors, its comparison and equality functions and the two functions of program.go.
mkdir -p goref
{
  cat "$here/ref_head.go"
  sed -n '34,56p;58,74p' "$ref/internal/ast/diagnostic.go"
  echo
  sed -n '100,103p' "$ref/internal/ast/diagnostic.go"
  echo
  sed -n '112,115p' "$ref/internal/ast/diagnostic.go"
  echo
  sed -n '366,503p' "$ref/internal/ast/diagnostic.go"
  echo
  sed -n '1597,1635p' "$ref/internal/compiler/program.go"
  echo
} | sed -E 's/\bast\.//g; s/\bcore\.//g; s/\bdiagnostics\.(Category|Key|Message)\b/\1/g' > goref/ref.go
cat "$here/ref_main.go" >> goref/ref.go
printf 'module c22ref\n\ngo 1.24\n' > goref/go.mod
(cd goref && GOFLAGS=-mod=mod GOTOOLCHAIN=local go build -o ../ref .)

# The port, on the same cases: each function for each pair of diagnostics of a case, then the sorted list.
sed "s#LINT_DIR#$lint#g" "$here/main.rs" > main.rs
$R rustc --edition 2024 -O -A dead_code -o probe main.rs --extern bun_ast=libbun_ast.rlib
python3 "$here/gen.py" "$seed" "$cases" > inputs.txt
./probe inputs.txt > rust.out
./ref inputs.txt > go.out
cmp rust.out go.out && echo "identical to the reference: $cases cases, $(grep -c '^P' rust.out) pairs, $(grep -c '^S' rust.out) diagnostics after the sort"
