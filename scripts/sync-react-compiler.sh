#!/usr/bin/env bash
set -euo pipefail

# Diff Bun's in-tree React Compiler port against upstream facebook/react.
#
# Bun does NOT vendor the React Compiler — every upstream crate that Bun uses
# has been ported into src/react_compiler/ (HIR passes byte-for-byte; AST-
# boundary files re-typed onto bun_ast). This script sparse-fetches the
# upstream sources into a temp dir and prints, for each ported file, the diff
# between the SHA we last ported from (src/react_compiler/UPSTREAM_PORTED) and
# upstream's current tip. Nothing is written to the repo; the output is the
# input to the /sync-react-compiler skill, which re-ports each hunk by hand.
#
# Usage:
#   scripts/sync-react-compiler.sh             # diff against latest main
#   scripts/sync-react-compiler.sh <sha>       # diff against a specific commit
#   scripts/sync-react-compiler.sh --fixtures  # re-sync test fixtures at UPSTREAM_PORTED

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
ported_file="$repo_root/src/react_compiler/UPSTREAM_PORTED"
old=$(tr -d '[:space:]' < "$ported_file")

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ "${1:-}" = "--fixtures" ]; then
  # Re-sync the upstream Babel-plugin test fixtures into the repo at the SHA we
  # last ported from, so test/bundler/transpiler/react-compiler-fixtures/ stays
  # in lockstep with src/react_compiler/.
  fixtures_dst="$repo_root/test/bundler/transpiler/react-compiler-fixtures"
  upstream_fixtures="compiler/packages/babel-plugin-react-compiler/src/__tests__/fixtures/compiler"
  upstream_runtime="compiler/packages/snap/src/sprout/shared-runtime.ts"
  echo "Fetching facebook/react @ $old (sparse: fixtures) ..." >&2
  git -C "$tmp" init -q
  git -C "$tmp" remote add origin https://github.com/facebook/react.git
  git -C "$tmp" sparse-checkout init --cone
  git -C "$tmp" sparse-checkout set "$upstream_fixtures" "$(dirname "$upstream_runtime")"
  git -C "$tmp" fetch -q --depth=1 origin "$old"
  git -C "$tmp" checkout -q FETCH_HEAD
  rm -rf "$fixtures_dst"
  mkdir -p "$fixtures_dst"
  cp -R "$tmp/$upstream_fixtures/." "$fixtures_dst/"
  cp "$tmp/$upstream_runtime" "$fixtures_dst/shared-runtime.ts"
  echo "Synced $(find "$fixtures_dst" -type f | wc -l | tr -d ' ') files to $fixtures_dst" >&2
  exit 0
fi

ref="${1:-main}"

echo "Fetching facebook/react @ {$old, $ref} (sparse: compiler/crates) ..." >&2
git -C "$tmp" init -q
git -C "$tmp" remote add origin https://github.com/facebook/react.git
git -C "$tmp" sparse-checkout init --cone
git -C "$tmp" sparse-checkout set compiler/crates
git -C "$tmp" fetch -q --depth=1 origin "$old" "$ref"
new=$(git -C "$tmp" rev-parse FETCH_HEAD)

echo "UPSTREAM_PORTED: $old"
echo "UPSTREAM_HEAD:   $new"
if [ "$old" = "$new" ]; then
  echo "Already up to date."
  exit 0
fi
echo

# Upstream crate -> Bun port directory (whole-crate ports: HIR passes & support).
# These are kept byte-for-byte modulo crate-name/import rewrites, so a clean
# upstream diff applies mechanically.
declare -a pristine=(
  react_compiler_hir:hir
  react_compiler_diagnostics:diagnostics
  react_compiler_ssa:ssa
  react_compiler_inference:inference
  react_compiler_typeinference:typeinference
  react_compiler_optimization:optimization
  react_compiler_validation:validation
  react_compiler_reactive_scopes:reactive_scopes
  react_compiler_utils:utils
)

# Upstream file -> Bun port file (AST-boundary ports: re-typed onto bun_ast).
# Upstream diffs here must be re-ported by hand using the type-mapping table
# in src/react_compiler/DESIGN.md.
declare -a boundary=(
  react_compiler_lowering/src/build_hir.rs:lowering/build_hir/
  react_compiler_lowering/src/hir_builder.rs:lowering/hir_builder.rs
  react_compiler_lowering/src/find_context_identifiers.rs:lowering/find_context_identifiers.rs
  "react_compiler_lowering/src/identifier_loc_index.rs:(not ported; binding identity is Ref, see lowering/hir_builder.rs)"
  react_compiler_reactive_scopes/src/codegen_reactive_function.rs:codegen.rs
  react_compiler/src/entrypoint/pipeline.rs:pipeline.rs
  react_compiler/src/entrypoint/program.rs:program.rs
  react_compiler/src/entrypoint/imports.rs:imports.rs
  "react_compiler/src/entrypoint/gating.rs:(folded into program.rs)"
  "react_compiler/src/entrypoint/suppression.rs:(detected in js_parser/lexer.rs, consumed in program.rs)"
  react_compiler/src/entrypoint/compile_result.rs:compile_result.rs
)

diff_one() {
  local upstream="compiler/crates/$1" port="$2"
  case "$port" in '('*) ;; *) port="src/react_compiler/$port" ;; esac
  local out
  out=$(git -C "$tmp" diff --stat=120 --patch "$old" "$new" -- "$upstream")
  if [ -n "$out" ]; then
    echo "── $upstream"
    echo "   port: $port"
    echo "$out"
    echo
  fi
}

echo "### whole-crate ports (apply mechanically) ###"
echo
for pair in "${pristine[@]}"; do
  diff_one "${pair%%:*}/src" "${pair##*:}"
done

echo "### AST-boundary ports (re-port via DESIGN.md type map) ###"
echo
for pair in "${boundary[@]}"; do
  diff_one "${pair%%:*}" "${pair##*:}"
done

# Any new file that touches react_compiler_ast outside the known boundary set
# is a new boundary file that needs a Bun port + an entry above.
echo "### new react_compiler_ast consumers (need new Bun port) ###"
git -C "$tmp" checkout -q "$new"
git -C "$tmp" grep -l '\breact_compiler_ast\b' -- 'compiler/crates/*/src/*.rs' \
  | grep -Ev 'react_compiler_ast/|react_compiler_lowering/|react_compiler/src/entrypoint/|reactive_scopes/src/codegen_reactive_function\.rs' \
  || echo "(none)"
echo

echo "When porting is done: echo $new > $ported_file"
