#!/bin/sh
# Rebuilds and checks the scratch: inputs from the reference clone, generator, agreement test, unit tests, clippy with the workspace lint set, rustfmt.
set -e
cd "$(dirname "$0")"
REF=/workspace/ref/typescript-go
OUT=${TMPDIR:-/tmp}/tcdiag-out
mkdir -p "$OUT"
tr -d '\r' < "$REF/_submodules/TypeScript/src/compiler/diagnosticMessages.json" > crate/scripts/diagnosticMessages.json
cp "$REF/internal/diagnostics/extraDiagnosticMessages.json" crate/scripts/extraDiagnosticMessages.json
bun --bun /workspace/bun/node_modules/.bin/prettier --config /workspace/wt/typecheck/.prettierrc --write crate/scripts/diagnosticMessages.json crate/scripts/extraDiagnosticMessages.json
bun crate/scripts/generate-diagnostics.ts
bun data/compare-with-upstream-go.mjs
bun test test/diagnostics-generated.test.ts
cd crate
rustc --edition 2024 --test -C opt-level=s -o "$OUT/tests" lib.rs
"$OUT/tests"
FLAGS=$(cat ../../conventions-scratch/data/clippy_flags.txt)
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib -o "$OUT/lib.rlib" lib.rs -D warnings -W clippy::all -D dead_code -D unreachable_pub $FLAGS
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --test -o "$OUT/clippy_tests" lib.rs -D warnings -W clippy::all $FLAGS
rustfmt --edition 2024 --check lib.rs
rustc --edition 2024 --crate-type lib -C opt-level=s -C codegen-units=1 --emit obj -o "$OUT/lib.o" lib.rs
size -A "$OUT/lib.o" | awk '$2 > 2000' | sort -k2 -n -r
echo "scratch ok"
